use std::io::{Read, Write};
use std::net::TcpListener;
use std::time::{Duration, Instant};

const GOOGLE_CLIENT_ID: &str =
    "294385375146-ijuml0080fbdfqb9r74sfjte7ebsuoro.apps.googleusercontent.com";

#[derive(serde::Serialize)]
pub struct GoogleAuth {
    pub code: String,
    pub code_verifier: String,
    pub redirect_uri: String,
}

fn hexs(b: &[u8]) -> String {
    let mut s = String::with_capacity(b.len() * 2);
    for x in b {
        s.push_str(&format!("{x:02x}"));
    }
    s
}

fn enc(s: &str) -> String {
    let mut o = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => o.push(b as char),
            _ => o.push_str(&format!("%{b:02X}")),
        }
    }
    o
}

fn dec(s: &str) -> String {
    let b = s.as_bytes();
    let mut o: Vec<u8> = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'%' if i + 2 < b.len() => {
                if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                    o.push(v);
                    i += 3;
                    continue;
                }
                o.push(b[i]);
                i += 1;
            }
            b'+' => {
                o.push(b' ');
                i += 1;
            }
            c => {
                o.push(c);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&o).into_owned()
}

fn query_get(query: &str, key: &str) -> Option<String> {
    for pair in query.split('&') {
        let mut it = pair.splitn(2, '=');
        if it.next() == Some(key) {
            return Some(dec(it.next().unwrap_or("")));
        }
    }
    None
}

#[tauri::command]
pub fn google_login() -> Result<GoogleAuth, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| format!("loopback: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| e.to_string())?
        .port();
    let redirect_uri = format!("http://127.0.0.1:{port}");

    let mut vb = [0u8; 32];
    let mut sb = [0u8; 16];
    getrandom::getrandom(&mut vb).map_err(|e| e.to_string())?;
    getrandom::getrandom(&mut sb).map_err(|e| e.to_string())?;
    let verifier = hexs(&vb);
    let state = hexs(&sb);

    let auth_url = format!(
        "https://accounts.google.com/o/oauth2/v2/auth?client_id={cid}&redirect_uri={ru}&response_type=code&scope={sc}&code_challenge={cc}&code_challenge_method=plain&state={st}&prompt=select_account",
        cid = enc(GOOGLE_CLIENT_ID),
        ru = enc(&redirect_uri),
        sc = enc("openid email profile"),
        cc = verifier,
        st = state,
    );

    std::process::Command::new("rundll32.exe")
        .args(["url.dll,FileProtocolHandler", &auth_url])
        .spawn()
        .map_err(|e| format!("nao abriu o navegador: {e}"))?;

    listener
        .set_nonblocking(true)
        .map_err(|e| e.to_string())?;
    let start = Instant::now();
    loop {
        match listener.accept() {
            Ok((mut stream, _)) => {
                stream.set_nonblocking(false).ok();
                stream
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .ok();
                let mut buf = [0u8; 8192];
                let n = stream.read(&mut buf).unwrap_or(0);
                let req = String::from_utf8_lossy(&buf[..n]);
                let line = req.lines().next().unwrap_or("");
                // "GET /?code=...&state=... HTTP/1.1"
                let path = line.split_whitespace().nth(1).unwrap_or("");
                let query = path.splitn(2, '?').nth(1).unwrap_or("");

                if query_get(query, "code").is_none() && query_get(query, "error").is_none() {
                    let _ = write_page(&mut stream, "Aguardando o Google...");
                    if start.elapsed() > Duration::from_secs(120) {
                        return Err("tempo esgotado".into());
                    }
                    continue;
                }

                let _ = write_page(
                    &mut stream,
                    "Login concluido. Pode fechar esta aba e voltar ao SF-Sync.",
                );

                if let Some(err) = query_get(query, "error") {
                    return Err(format!("Google recusou: {err}"));
                }
                let st = query_get(query, "state").unwrap_or_default();
                if st != state {
                    return Err("state nao confere (possivel CSRF)".into());
                }
                let code = query_get(query, "code").ok_or("redirect sem code")?;
                return Ok(GoogleAuth {
                    code,
                    code_verifier: verifier,
                    redirect_uri,
                });
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                if start.elapsed() > Duration::from_secs(120) {
                    return Err("tempo esgotado (2 min) — tente de novo".into());
                }
                std::thread::sleep(Duration::from_millis(150));
            }
            Err(e) => return Err(e.to_string()),
        }
    }
}

fn write_page(stream: &mut std::net::TcpStream, msg: &str) -> std::io::Result<()> {
    let body = format!(
        "<!doctype html><html><head><meta charset=utf-8><title>SF-Sync</title></head><body style='font-family:system-ui,sans-serif;text-align:center;padding-top:60px;color:#222'><h2>SF-Sync</h2><p>{msg}</p></body></html>"
    );
    let resp = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    stream.write_all(resp.as_bytes())
}
