use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

use anyhow::{anyhow, bail, Context, Result};
use serde::{Deserialize, Serialize};

const WORKER_URL: &str = "https://sf-sync-lock.silverfangs.workers.dev";

pub fn base_url() -> String {
    std::env::var("SF_SYNC_WORKER").unwrap_or_else(|_| WORKER_URL.to_string())
}

fn read_secret(path: &Path) -> Option<String> {
    let bytes = std::fs::read(path).ok()?;
    if let Some(dec) = crate::dpapi::unprotect(&bytes) {
        return String::from_utf8(dec).ok();
    }
    String::from_utf8(bytes).ok()
}

fn write_secret(path: &Path, content: &str) -> Result<()> {
    let bytes = content.as_bytes();
    let out = crate::dpapi::protect(bytes).unwrap_or_else(|| bytes.to_vec());
    std::fs::write(path, out).with_context(|| format!("gravar {path:?}"))
}

fn appdata_dir() -> Result<PathBuf> {
    let a = std::env::var("APPDATA").context("APPDATA ausente")?;
    let d = PathBuf::from(a).join("sf-sync");
    std::fs::create_dir_all(&d).ok();
    Ok(d)
}

fn device_token_path() -> Result<PathBuf> {
    Ok(appdata_dir()?.join("device.token"))
}
fn spaces_map_path() -> Result<PathBuf> {
    Ok(appdata_dir()?.join("spaces.json"))
}

pub fn device_token() -> Option<String> {
    if let Ok(t) = std::env::var("SF_SYNC_DEVICE_TOKEN") {
        if !t.trim().is_empty() {
            return Some(t.trim().to_string());
        }
    }
    let p = device_token_path().ok()?;
    let t = read_secret(&p)?;
    let t = t.trim().to_string();
    if t.is_empty() {
        None
    } else {
        Some(t)
    }
}

pub fn is_paired() -> bool {
    device_token().is_some()
}

pub fn unpair() -> Result<()> {
    if let Ok(p) = device_token_path() {
        let _ = std::fs::remove_file(p);
    }
    if let Ok(p) = spaces_map_path() {
        let _ = std::fs::remove_file(p);
    }
    if let Ok(p) = connections_path() {
        let _ = std::fs::remove_file(p);
    }
    Ok(())
}

fn save_device_token(token: &str) -> Result<()> {
    write_secret(&device_token_path()?, token.trim())
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SpacePaths {
    pub local: String,
    #[serde(default)]
    pub connection_id: String,
    #[serde(default)]
    pub subpath: String,
    #[serde(default)]
    pub activated: bool,
    #[serde(default)]
    pub remote_path: String,
    #[serde(default)]
    pub gdrive_token: String,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum PathsCompat {
    New(SpacePaths),
    Old(String),
}

pub fn load_space_paths() -> BTreeMap<String, SpacePaths> {
    let raw: BTreeMap<String, PathsCompat> = spaces_map_path()
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    raw.into_iter()
        .map(|(k, v)| {
            let sp = match v {
                PathsCompat::New(sp) => sp,
                PathsCompat::Old(local) => SpacePaths { local, ..Default::default() },
            };
            (k, sp)
        })
        .collect()
}

fn save_space_paths(m: &BTreeMap<String, SpacePaths>) -> Result<()> {
    std::fs::write(spaces_map_path()?, serde_json::to_string_pretty(m)?).context("gravar spaces.json")?;
    Ok(())
}

pub fn set_space_path(space_id: &str, local: &str, connection_id: &str, subpath: &str) -> Result<()> {
    let mut m = load_space_paths();
    if local.trim().is_empty() {
        m.remove(space_id);
    } else {
        let entry = m.entry(space_id.to_string()).or_default();
        entry.local = local.trim().to_string();
        entry.connection_id = connection_id.trim().to_string();
        entry.subpath = subpath.trim().to_string();
    }
    save_space_paths(&m)
}

pub fn set_activated(space_id: &str, on: bool) -> Result<()> {
    let mut m = load_space_paths();
    if let Some(e) = m.get_mut(space_id) {
        e.activated = on;
    }
    save_space_paths(&m)
}

pub fn forget_local(space_id: &str) -> Result<()> {
    let mut m = load_space_paths();
    m.remove(space_id);
    save_space_paths(&m)
}

fn connections_path() -> Result<PathBuf> {
    Ok(appdata_dir()?.join("connections.json"))
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Connection {
    pub id: String,
    pub kind: String,
    pub label: String,
    #[serde(default)]
    pub gdrive_token: String,
    #[serde(default)]
    pub nas_root: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ConnectionView {
    pub id: String,
    pub kind: String,
    pub label: String,
    pub detail: String,
}
impl From<Connection> for ConnectionView {
    fn from(c: Connection) -> Self {
        ConnectionView { id: c.id, kind: c.kind, label: c.label, detail: c.nas_root }
    }
}

pub fn load_connections() -> Vec<Connection> {
    connections_path()
        .ok()
        .and_then(|p| read_secret(&p))
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_connections(v: &[Connection]) -> Result<()> {
    write_secret(&connections_path()?, &serde_json::to_string_pretty(v)?)
}

pub fn add_connection(kind: &str, label: &str, gdrive_token: &str, nas_root: &str) -> Result<Connection> {
    let mut v = load_connections();
    let ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let c = Connection {
        id: format!("{kind}-{ms}"),
        kind: kind.to_string(),
        label: if label.trim().is_empty() {
            if kind == "gdrive" { "Google Drive".into() } else { "NAS".into() }
        } else {
            label.trim().to_string()
        },
        gdrive_token: gdrive_token.trim().to_string(),
        nas_root: nas_root.trim().to_string(),
    };
    v.push(c.clone());
    save_connections(&v)?;
    Ok(c)
}

pub fn remove_connection(id: &str) -> Result<()> {
    let mut v = load_connections();
    v.retain(|c| c.id != id);
    save_connections(&v)
}

pub fn get_connection(id: &str) -> Option<Connection> {
    load_connections().into_iter().find(|c| c.id == id)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Member {
    pub person: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpaceMeta {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub r2_prefix: String,
    #[serde(default = "default_backend")]
    pub backend_kind: String,
    #[serde(default)]
    pub encrypted: bool,
    #[serde(default)]
    pub folders: Vec<String>,
    pub owner: String,
    #[serde(default)]
    pub members: Vec<Member>,
}

fn default_backend() -> String {
    "r2".into()
}

#[derive(Debug, Clone, Deserialize)]
pub struct SpaceConfig {
    pub r2_prefix: String,
    pub crypt_key: String,
    #[serde(default)]
    pub crypt_salt: Option<String>,
    #[serde(default = "default_backend")]
    pub backend_kind: String,
    #[serde(default)]
    pub encrypted: bool,
    #[serde(default)]
    pub folders: Vec<String>,
    #[serde(default)]
    pub gdrive_folder_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpaceInvite {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub invited_by: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DeviceInfo {
    pub device_id: String,
    pub person: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct InviteResult {
    pub has_account: bool,
    pub account_invite_code: Option<String>,
    pub mail_sent: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceRow {
    pub device_id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DevicesView {
    #[serde(default)]
    pub person: String,
    #[serde(default)]
    pub this_device: String,
    #[serde(default)]
    pub devices: Vec<DeviceRow>,
}

pub struct Control {
    base: String,
    http: reqwest::blocking::Client,
}

impl Control {
    pub fn new() -> Result<Self> {
        Ok(Self {
            base: base_url(),
            http: reqwest::blocking::Client::builder()
                .timeout(Duration::from_secs(20))
                .build()?,
        })
    }

    fn token(&self) -> Result<String> {
        device_token().ok_or_else(|| anyhow!("dispositivo nao pareado"))
    }

    pub fn pair(&self, jwt: &str, name: &str) -> Result<DeviceInfo> {
        #[derive(Deserialize)]
        struct R {
            ok: bool,
            #[serde(default)]
            error: Option<String>,
            #[serde(default)]
            device_token: Option<String>,
            #[serde(default)]
            device_id: Option<String>,
            #[serde(default)]
            person: Option<String>,
        }
        let r: R = self
            .http
            .post(format!("{}/devices/pair", self.base))
            .bearer_auth(jwt)
            .json(&serde_json::json!({ "name": name }))
            .send()
            .context("rede /devices/pair")?
            .json()
            .context("resposta /devices/pair")?;
        if !r.ok {
            bail!("pareamento recusado: {}", r.error.unwrap_or_default());
        }
        let token = r.device_token.ok_or_else(|| anyhow!("sem device_token"))?;
        save_device_token(&token)?;
        Ok(DeviceInfo {
            device_id: r.device_id.unwrap_or_default(),
            person: r.person.unwrap_or_default(),
        })
    }

    fn get_json<T: for<'de> Deserialize<'de>>(&self, path: &str) -> Result<T> {
        let token = self.token()?;
        self.http
            .get(format!("{}{}", self.base, path))
            .bearer_auth(token)
            .send()
            .with_context(|| format!("rede GET {path}"))?
            .json::<T>()
            .with_context(|| format!("resposta GET {path}"))
    }

    fn post_json<T: for<'de> Deserialize<'de>>(&self, path: &str, body: serde_json::Value) -> Result<T> {
        let token = self.token()?;
        self.http
            .post(format!("{}{}", self.base, path))
            .bearer_auth(token)
            .json(&body)
            .send()
            .with_context(|| format!("rede POST {path}"))?
            .json::<T>()
            .with_context(|| format!("resposta POST {path}"))
    }

    pub fn list_devices(&self) -> Result<DevicesView> {
        self.get_json::<DevicesView>("/devices")
    }

    pub fn revoke_device(&self, device_id: &str) -> Result<bool> {
        #[derive(Deserialize)]
        struct R {
            ok: bool,
            #[serde(default)]
            error: Option<String>,
            #[serde(default)]
            was_self: bool,
        }
        let r: R = self.post_json("/devices/revoke", serde_json::json!({ "device_id": device_id }))?;
        if !r.ok {
            bail!("{}", r.error.unwrap_or_else(|| "falha".into()));
        }
        Ok(r.was_self)
    }

    pub fn fetch_r2_base(&self) -> Option<String> {
        #[derive(Deserialize)]
        struct Cfg {
            #[serde(default)]
            r2_conf: Option<String>,
        }
        #[derive(Deserialize)]
        struct R {
            #[serde(default)]
            config: Option<Cfg>,
        }
        self.get_json::<R>("/config").ok()?.config?.r2_conf
    }

    pub fn list_spaces(&self) -> Result<Vec<SpaceMeta>> {
        #[derive(Deserialize)]
        struct R {
            #[serde(default)]
            spaces: Vec<SpaceMeta>,
        }
        Ok(self.get_json::<R>("/spaces")?.spaces)
    }

    pub fn space_config(&self, id: &str) -> Result<SpaceConfig> {
        self.get_json::<SpaceConfig>(&format!("/spaces/config?id={}", urlenc(id)))
    }

    pub fn list_invites(&self) -> Result<Vec<SpaceInvite>> {
        #[derive(Deserialize)]
        struct R {
            #[serde(default)]
            invites: Vec<SpaceInvite>,
        }
        Ok(self.get_json::<R>("/spaces/invites")?.invites)
    }

    pub fn accept_space(&self, space_id: &str) -> Result<()> {
        let r: OkResp = self.post_json("/spaces/accept", serde_json::json!({ "space_id": space_id }))?;
        r.into_result()
    }

    pub fn create_space(&self, name: &str, kind: &str, folders: &[String], backend_kind: &str, encrypted: bool, gdrive_folder_id: &str) -> Result<SpaceMeta> {
        #[derive(Deserialize)]
        struct R {
            ok: bool,
            #[serde(default)]
            error: Option<String>,
            #[serde(default)]
            space: Option<SpaceMeta>,
        }
        let r: R = self.post_json(
            "/spaces/create",
            serde_json::json!({ "name": name, "kind": kind, "folders": folders, "backend_kind": backend_kind, "encrypted": encrypted, "gdrive_folder_id": gdrive_folder_id }),
        )?;
        if !r.ok {
            bail!("criar espaco: {}", r.error.unwrap_or_default());
        }
        r.space.ok_or_else(|| anyhow!("sem espaco na resposta"))
    }

    pub fn invite_to_space(&self, space_id: &str, email: &str) -> Result<InviteResult> {
        #[derive(Deserialize)]
        struct R {
            ok: bool,
            #[serde(default)]
            error: Option<String>,
            #[serde(default)]
            has_account: bool,
            #[serde(default)]
            account_invite_code: Option<String>,
            #[serde(default)]
            mail_sent: bool,
        }
        let r: R = self.post_json("/spaces/invite", serde_json::json!({ "space_id": space_id, "email": email }))?;
        if !r.ok {
            bail!("{}", r.error.unwrap_or_else(|| "falha".into()));
        }
        Ok(InviteResult { has_account: r.has_account, account_invite_code: r.account_invite_code, mail_sent: r.mail_sent })
    }

    /// Gera um link de convite reutilizavel. Retorna a URL (ex.: sync.silverfangs.com/join/...).
    pub fn create_invite_link(&self, max_uses: u32, expires_days: i64) -> Result<String> {
        #[derive(Deserialize)]
        struct R {
            ok: bool,
            #[serde(default)]
            error: Option<String>,
            #[serde(default)]
            url: Option<String>,
        }
        let r: R = self.post_json("/invites/link", serde_json::json!({ "max_uses": max_uses, "expires_days": expires_days }))?;
        if !r.ok {
            bail!("{}", r.error.unwrap_or_else(|| "falha".into()));
        }
        r.url.ok_or_else(|| anyhow!("sem url na resposta"))
    }

    pub fn delete_space(&self, space_id: &str) -> Result<()> {
        let r: OkResp = self.post_json("/spaces/delete", serde_json::json!({ "space_id": space_id }))?;
        r.into_result()?;
        forget_local(space_id)
    }

    pub fn leave_space(&self, space_id: &str) -> Result<()> {
        let r: OkResp = self.post_json("/spaces/leave", serde_json::json!({ "space_id": space_id }))?;
        r.into_result()?;
        forget_local(space_id)
    }
}

#[derive(Deserialize)]
struct OkResp {
    ok: bool,
    #[serde(default)]
    error: Option<String>,
}
impl OkResp {
    fn into_result(self) -> Result<()> {
        if self.ok {
            Ok(())
        } else {
            bail!("{}", self.error.unwrap_or_else(|| "falha".into()))
        }
    }
}

fn urlenc(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{:02X}", b),
        })
        .collect()
}
