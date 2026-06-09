use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader, Read};
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use anyhow::{bail, Context, Result};
use serde::Serialize;

use crate::acl;
use crate::control::{self, Control};
use crate::lock::{Claim, LockClient};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const RELEASE_SECS: u64 = 30;

const REFRESH_SECS: u64 = 60;

fn appdata() -> PathBuf {
    std::env::var("APPDATA")
        .map(|a| PathBuf::from(a).join("sf-sync"))
        .unwrap_or_else(|_| PathBuf::from(r".\sf-sync"))
}

fn base_conf() -> PathBuf {
    if let Ok(p) = std::env::var("SF_SYNC_BASE_CONF") {
        return PathBuf::from(p);
    }
    appdata().join("base.conf")
}

#[derive(Clone)]
struct ActiveSpace {
    id: String,
    name: String,
    local: PathBuf,
    remote: String,
    backend_kind: String,
    encrypted: bool,
    remote_path: String,
    gdrive_token: String,
    gd_folder: String,
    activated: bool,
    workdir: PathBuf,
    filter: PathBuf,
}

#[derive(Clone, Serialize, Default)]
pub struct Progress {
    pub pct: u32,
    pub files: u32,
}

#[derive(Clone, Serialize, Default)]
pub struct Preview {
    pub to_remote: u32,
    pub to_local: u32,
    pub deletes: u32,
    pub first: bool,
    pub error: Option<String>,
}

#[derive(Clone, Serialize, Default)]
pub struct SpaceStatus {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub backend_kind: String,
    pub encrypted: bool,
    pub local_path: Option<String>,
    pub remote_path: Option<String>,
    pub configured: bool,
    pub activated: bool,
    pub needs_gdrive_auth: bool,
    pub pending: Option<Preview>,
    pub progress: Option<Progress>,
    pub members: Vec<String>,
}

#[derive(Clone, Serialize, Default)]
pub struct Status {
    pub state: String,
    pub last: Option<u64>,
    pub last_changes: u32,
    pub conflicts: Vec<String>,
    pub detail: Option<String>,
    pub paired: bool,
    pub held: Vec<String>,
    pub readonly: Vec<String>,
    pub spaces: Vec<SpaceStatus>,
}

pub struct Engine {
    rclone: Mutex<Option<PathBuf>>,
    home: PathBuf,
    gen_conf: PathBuf,
    control: Option<Control>,
    spaces: Mutex<Vec<ActiveSpace>>,
    cfg_cache: Mutex<HashMap<String, control::SpaceConfig>>,
    pending: Mutex<HashMap<String, Preview>>,
    progress: Mutex<HashMap<String, Progress>>,
    dirty: AtomicBool,
    running: AtomicBool,
    status: Mutex<Status>,
    last_refresh: Mutex<Option<Instant>>,
    watch_gen: AtomicU64,
    lock: Option<LockClient>,
    held: Mutex<HashMap<String, (PathBuf, Instant)>>,
    readonly: Mutex<HashMap<String, PathBuf>>,
    job: Option<crate::jobobj::Job>,
}

struct RunGuard<'a>(&'a AtomicBool);
impl Drop for RunGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

impl Engine {
    pub fn new() -> Self {
        let home = appdata();
        std::fs::create_dir_all(home.join("filters")).ok();
        std::fs::create_dir_all(home.join("workdirs")).ok();
        Self {
            rclone: Mutex::new(None),
            gen_conf: home.join("rclone.gen.conf"),
            home,
            control: Control::new()
                .map_err(|e| tracing::warn!("control plane off: {e:#}"))
                .ok(),
            spaces: Mutex::new(Vec::new()),
            cfg_cache: Mutex::new(HashMap::new()),
            pending: Mutex::new(HashMap::new()),
            progress: Mutex::new(HashMap::new()),
            dirty: AtomicBool::new(true),
            running: AtomicBool::new(false),
            status: Mutex::new(Status {
                state: "ocioso".into(),
                paired: control::is_paired(),
                ..Default::default()
            }),
            last_refresh: Mutex::new(None),
            watch_gen: AtomicU64::new(0),
            lock: match LockClient::new() {
                Ok(c) => Some(c),
                Err(e) => {
                    tracing::warn!("lock desativado: {e:#}");
                    None
                }
            },
            held: Mutex::new(HashMap::new()),
            readonly: Mutex::new(HashMap::new()),
            job: crate::jobobj::Job::new(),
        }
    }

    pub fn watch_generation(&self) -> u64 {
        self.watch_gen.load(Ordering::Relaxed)
    }

    pub fn watch_paths(&self) -> Vec<PathBuf> {
        self.spaces.lock().unwrap().iter().map(|s| s.local.clone()).collect()
    }

    pub fn mark_dirty(&self) {
        self.dirty.store(true, Ordering::Relaxed);
    }

    fn set_state(&self, state: &str, detail: Option<String>) {
        let mut s = self.status.lock().unwrap();
        s.state = state.into();
        s.detail = detail;
    }

    pub fn status(&self) -> Status {
        let mut s = self.status.lock().unwrap().clone();
        s.paired = control::is_paired();
        s.held = self.held.lock().unwrap().keys().cloned().collect();
        s.readonly = self.readonly.lock().unwrap().keys().cloned().collect();
        let pend = self.pending.lock().unwrap();
        let prog = self.progress.lock().unwrap();
        for sp in s.spaces.iter_mut() {
            sp.pending = pend.get(&sp.id).cloned();
            sp.progress = prog.get(&sp.id).cloned();
        }
        s
    }

    pub fn refresh_spaces(&self) -> Result<()> {
        let Some(ctrl) = &self.control else {
            return Ok(());
        };
        if !control::is_paired() {
            return Ok(());
        }
        let metas = ctrl.list_spaces().context("listar espaços")?;
        let paths = control::load_space_paths();

        let mut active = Vec::new();
        let mut ui = Vec::new();
        for m in &metas {
            let pp = paths.get(&m.id).cloned();
            let local_str = pp.as_ref().map(|p| p.local.clone()).filter(|s| !s.is_empty());
            let subpath = pp.as_ref().map(|p| p.subpath.clone()).unwrap_or_default();
            let conn = pp
                .as_ref()
                .filter(|p| !p.connection_id.is_empty())
                .and_then(|p| control::get_connection(&p.connection_id));
            let is_nas = m.backend_kind == "nas";
            let is_gd = m.backend_kind == "gdrive";
            let is_r2 = !is_nas && !is_gd;

            let nas_remote = if is_nas {
                conn.as_ref()
                    .filter(|c| !c.nas_root.is_empty())
                    .map(|c| {
                        let mut p = PathBuf::from(&c.nas_root);
                        if !subpath.is_empty() {
                            p.push(&subpath);
                        }
                        p.to_string_lossy().to_string()
                    })
                    .unwrap_or_default()
            } else {
                String::new()
            };
            let gd_token = if is_gd {
                conn.as_ref().map(|c| c.gdrive_token.clone()).unwrap_or_default()
            } else {
                String::new()
            };
            let activated = pp.as_ref().map(|p| p.activated).unwrap_or(false);

            let configured = local_str.is_some()
                && (is_r2 || conn.is_some())
                && (!is_nas || !nas_remote.is_empty())
                && (!is_gd || !gd_token.is_empty());

            ui.push(SpaceStatus {
                id: m.id.clone(),
                name: m.name.clone(),
                kind: m.kind.clone(),
                backend_kind: m.backend_kind.clone(),
                encrypted: m.encrypted,
                local_path: local_str.clone(),
                remote_path: if is_nas && !nas_remote.is_empty() { Some(nas_remote.clone()) } else { None },
                configured,
                activated,
                needs_gdrive_auth: is_gd && gd_token.is_empty(),
                pending: self.pending.lock().unwrap().get(&m.id).cloned(),
                progress: None,
                members: m.members.iter().map(|x| x.person.clone()).collect(),
            });
            if !configured {
                continue;
            }
            let cfg = match ctrl.space_config(&m.id) {
                Ok(c) => c,
                Err(e) => {
                    tracing::warn!(space = %m.id, "config falhou: {e:#}");
                    continue;
                }
            };
            let local = PathBuf::from(local_str.unwrap());
            if let Err(e) = std::fs::create_dir_all(&local) {
                tracing::warn!(space = %m.id, ?local, "criar pasta local: {e}");
            }
            let gd_folder = if subpath.is_empty() { cfg.r2_prefix.clone() } else { subpath.clone() };
            let remote = match m.backend_kind.as_str() {
                "nas" if !m.encrypted => nas_remote.clone(),
                "nas" => format!("nascrypt-{}:", m.id),
                "gdrive" if !m.encrypted => format!("gd-{}:{}", m.id, gd_folder),
                "gdrive" => format!("gdcrypt-{}:", m.id),
                _ => format!("r2crypt-{}:", m.id),
            };
            let filter = self.home.join("filters").join(format!("{}.filter", m.id));
            self.write_filter(&filter, &m.kind, &local, &cfg.folders)?;
            active.push(ActiveSpace {
                id: m.id.clone(),
                name: m.name.clone(),
                local,
                remote,
                backend_kind: m.backend_kind.clone(),
                encrypted: m.encrypted,
                remote_path: nas_remote.clone(),
                gdrive_token: gd_token.clone(),
                gd_folder: gd_folder.clone(),
                activated,
                workdir: self.home.join("workdirs").join(&m.id),
                filter,
            });
            self.stash_config(&m.id, &cfg);
        }

        self.write_gen_conf()?;

        let new_paths: HashSet<String> = active.iter().filter_map(|s| s.local.to_str().map(String::from)).collect();
        let old_paths: HashSet<String> = self
            .spaces
            .lock()
            .unwrap()
            .iter()
            .filter_map(|s| s.local.to_str().map(String::from))
            .collect();
        if new_paths != old_paths {
            self.watch_gen.fetch_add(1, Ordering::Relaxed);
        }

        *self.spaces.lock().unwrap() = active;
        self.status.lock().unwrap().spaces = ui;
        Ok(())
    }

    fn stash_config(&self, id: &str, cfg: &control::SpaceConfig) {
        let mut m = self.cfg_cache.lock().unwrap();
        m.insert(id.to_string(), cfg.clone());
    }

    fn r2_base_section(&self) -> Result<String> {
        if let Ok(base) = std::fs::read_to_string(base_conf()) {
            if let Some(r2) = extract_section(&base, "r2") {
                return Ok(r2);
            }
        }
        if let Some(ctrl) = &self.control {
            if let Some(body) = ctrl.fetch_r2_base() {
                return Ok(body);
            }
        }
        bail!("creds R2 ([r2]) indisponíveis (sem .secrets local e sem /config)")
    }

    fn write_gen_conf(&self) -> Result<()> {
        let rclone = self.rclone()?;
        let cache = self.cfg_cache.lock().unwrap();
        let spaces = self.spaces.lock().unwrap();

        let mut out = String::new();
        if spaces.iter().any(|s| s.backend_kind == "r2") {
            let r2 = self.r2_base_section().context("creds R2 ([r2]) indisponíveis (nem local nem /config)")?;
            out.push_str("[r2]\n");
            out.push_str(&r2);
            out.push('\n');
        }
        for sp in spaces.iter() {
            let Some(cfg) = cache.get(&sp.id) else { continue };
            match sp.backend_kind.as_str() {
                "nas" if !sp.encrypted => {}
                "nas" => out.push_str(&crypt_section(&rclone, &format!("nascrypt-{}", sp.id), &sp.remote_path, cfg)?),
                "gdrive" => {
                    out.push_str(&format!("\n[gd-{}]\ntype = drive\nscope = drive\ntoken = {}\n", sp.id, sp.gdrive_token));
                    if let Some(fid) = cfg
                        .gdrive_folder_id
                        .as_deref()
                        .filter(|s| !s.is_empty() && s.len() <= 128 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-'))
                    {
                        out.push_str(&format!("root_folder_id = {fid}\n"));
                    }
                    if sp.encrypted {
                        let target = format!("gd-{}:{}", sp.id, sp.gd_folder);
                        out.push_str(&crypt_section(&rclone, &format!("gdcrypt-{}", sp.id), &target, cfg)?);
                    }
                }
                _ => out.push_str(&crypt_section(&rclone, &format!("r2crypt-{}", sp.id), &format!("r2:sf-sync/{}", cfg.r2_prefix), cfg)?),
            }
        }
        std::fs::write(&self.gen_conf, out).context("gravar rclone.gen.conf")?;
        Ok(())
    }

    fn write_filter(&self, path: &Path, kind: &str, local: &Path, folders: &[String]) -> Result<()> {
        let custom = path.with_extension("custom");
        if custom.exists() {
            std::fs::copy(&custom, path).with_context(|| format!("copiar filtro custom {custom:?}"))?;
            return Ok(());
        }
        let mut f = String::new();
        f.push_str("- .git/**\n- .secrets/**\n");
        if kind == "compartilhado" {
            if let Ok(content) = std::fs::read_to_string(local.join(".gitignore")) {
                for rule in gitignore_to_rclone(&content) {
                    f.push_str(&rule);
                    f.push('\n');
                }
            }
        }
        if !folders.is_empty() {
            for d in folders {
                let d = d.trim_matches('/');
                f.push_str(&format!("+ /{d}/**\n"));
            }
            f.push_str("- *\n");
        }
        std::fs::write(path, f).with_context(|| format!("gravar filtro {path:?}"))?;
        Ok(())
    }

    fn gate(&self, rclone: &Path, sp: &ActiveSpace) -> Result<usize> {
        let out = Command::new(rclone)
            .arg("lsf")
            .arg(&sp.local)
            .arg("--filter-from")
            .arg(&sp.filter)
            .args(["-R", "--files-only"])
            .arg("--config")
            .arg(&self.gen_conf)
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .context("rclone lsf (gate)")?;
        let listing = String::from_utf8_lossy(&out.stdout);
        let mut total = 0usize;
        for line in listing.lines() {
            total += 1;
            let l = line.replace('\\', "/");
            if l == ".git" || l.starts_with(".git/") || l.contains("/.git/") {
                bail!("GATE[{}]: .git no escopo ({line}) — abortado", sp.id);
            }
            if l.starts_with(".secrets/") || l.contains("/.secrets/") {
                bail!("GATE[{}]: .secrets no escopo ({line}) — abortado", sp.id);
            }
        }
        Ok(total)
    }

    fn listings_exist(&self, sp: &ActiveSpace) -> bool {
        std::fs::read_dir(&sp.workdir)
            .map(|rd| rd.flatten().any(|e| e.path().extension().map_or(false, |x| x == "lst")))
            .unwrap_or(false)
    }

    fn lift_readonly(&self, space_id: &str) -> Vec<(String, PathBuf)> {
        let lifted: Vec<(String, PathBuf)> = self
            .readonly
            .lock()
            .unwrap()
            .iter()
            .filter(|(k, _)| k.starts_with(&format!("{space_id}::")))
            .map(|(k, p)| (k.clone(), p.clone()))
            .collect();
        for (_, path) in &lifted {
            if let Some(s) = path.to_str() {
                let _ = acl::restore_writable(s);
            }
        }
        lifted
    }

    fn reapply_readonly(&self, lifted: &[(String, PathBuf)]) {
        let ro = self.readonly.lock().unwrap();
        for (k, path) in lifted {
            if ro.contains_key(k) {
                if let Some(s) = path.to_str() {
                    let _ = acl::set_readonly(s);
                }
            }
        }
    }

    fn set_progress(&self, id: &str, pct: u32, files: u32) {
        self.progress.lock().unwrap().insert(id.to_string(), Progress { pct, files });
    }
    fn clear_progress(&self, id: &str) {
        self.progress.lock().unwrap().remove(id);
    }

    fn sync_space(&self, rclone: &Path, sp: &ActiveSpace, allow_delete: bool) -> Result<(u32, Vec<String>)> {
        std::fs::create_dir_all(&sp.workdir).ok();
        {
            let marker = sp.workdir.join(".remote");
            let cur = std::fs::read_to_string(&marker).unwrap_or_default();
            if cur.trim() != sp.remote {
                if let Ok(rd) = std::fs::read_dir(&sp.workdir) {
                    for e in rd.flatten() {
                        if e.file_name().to_string_lossy().contains(".lst") {
                            let _ = std::fs::remove_file(e.path());
                        }
                    }
                }
                let _ = std::fs::write(&marker, &sp.remote);
            }
        }
        if sp.backend_kind == "nas" && !sp.remote_path.is_empty() {
            std::fs::create_dir_all(&sp.remote_path).ok();
        }

        if let Ok(rd) = std::fs::read_dir(&sp.workdir) {
            for e in rd.flatten() {
                if e.path().extension().map_or(false, |x| x == "lck") {
                    let _ = std::fs::remove_file(e.path());
                }
            }
        }

        let first = !self.listings_exist(sp);
        if first {
            let scope = self.gate(rclone, sp)?;
            tracing::info!(space = %sp.id, in_scope = scope, "gate OK; baseline");
            let _ = Command::new(rclone)
                .arg("mkdir")
                .arg(&sp.remote)
                .arg("--config")
                .arg(&self.gen_conf)
                .creation_flags(CREATE_NO_WINDOW)
                .output();
        }
        let lifted = self.lift_readonly(&sp.id);

        let mut cmd = Command::new(rclone);
        cmd.arg("bisync")
            .arg(&sp.local)
            .arg(&sp.remote)
            .arg("--filter-from")
            .arg(&sp.filter)
            .arg("--workdir")
            .arg(&sp.workdir)
            .args(["--max-delete", if allow_delete { "50" } else { "0" }])
            .args(["--conflict-resolve", "none"])
            .args(["--resilient", "--recover", "--create-empty-src-dirs"])
            .args(["--transfers", "8", "--checkers", "16"])
            .arg("-v")
            .arg("--config")
            .arg(&self.gen_conf);
        if first {
            cmd.arg("--resync");
        }
        cmd.args(["--stats", "1s", "--stats-one-line"])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .creation_flags(CREATE_NO_WINDOW);

        self.set_progress(&sp.id, 0, 0);
        let (status, log) = match cmd.spawn() {
            Ok(mut child) => {
                if let Some(j) = &self.job {
                    j.assign(&child);
                }
                let out_h = child.stdout.take().map(|o| {
                    std::thread::spawn(move || {
                        let mut s = String::new();
                        let _ = BufReader::new(o).read_to_string(&mut s);
                        s
                    })
                });
                let mut log = String::new();
                let mut files = 0u32;
                let mut pct = 0u32;
                if let Some(err) = child.stderr.take() {
                    for line in BufReader::new(err).lines().map_while(Result::ok) {
                        if let Some(p) = parse_pct(&line) {
                            pct = p;
                        }
                        if line.contains(": Copied") || line.contains(": Updated") || line.contains(": Deleted") || line.contains(": Moved") {
                            files += 1;
                        }
                        self.set_progress(&sp.id, pct, files);
                        log.push_str(&line);
                        log.push('\n');
                    }
                }
                let status = child.wait();
                if let Some(h) = out_h {
                    if let Ok(s) = h.join() {
                        log.push_str(&s);
                    }
                }
                (status, log)
            }
            Err(e) => {
                self.reapply_readonly(&lifted);
                self.clear_progress(&sp.id);
                return Err(anyhow::Error::new(e).context("spawn rclone bisync"));
            }
        };
        self.reapply_readonly(&lifted);
        self.clear_progress(&sp.id);
        let status = status.context("rclone bisync")?;

        let conflicts: Vec<String> = log
            .lines()
            .filter(|l| l.to_lowercase().contains("conflict"))
            .map(|l| format!("[{}] {}", sp.id, l.trim()))
            .take(50)
            .collect();
        let changes = count_changes(&log);
        if !status.success() {
            let tail = log.lines().rev().take(4).collect::<Vec<_>>().join(" | ");
            bail!("bisync [{}] falhou: {} — {}", sp.id, status, tail);
        }
        Ok((changes, conflicts))
    }

    pub fn sync_once(&self) -> Result<()> {
        if self.running.swap(true, Ordering::SeqCst) {
            return Ok(());
        }
        let _guard = RunGuard(&self.running);

        if let Err(e) = self.refresh_spaces() {
            tracing::warn!("refresh_spaces: {e:#}");
        }
        let rclone = match self.rclone() {
            Ok(p) => p,
            Err(e) => {
                self.set_state("erro", Some(e.to_string()));
                return Err(e);
            }
        };

        let ids: Vec<String> = self
            .spaces
            .lock()
            .unwrap()
            .iter()
            .filter(|s| s.activated)
            .map(|s| s.id.clone())
            .collect();
        if ids.is_empty() {
            self.set_state("ocioso", None);
            return Ok(());
        }

        self.set_state("sincronizando", None);
        let mut total_changes = 0u32;
        let mut all_conflicts = Vec::new();
        let mut errors = Vec::new();

        for id in ids {
            if self.pending.lock().unwrap().contains_key(&id) {
                continue;
            }
            let snap = {
                let spaces = self.spaces.lock().unwrap();
                spaces.iter().find(|s| s.id == id).cloned()
            };
            let Some(sp) = snap else { continue };
            match self.sync_space(&rclone, &sp, false) {
                Ok((c, mut cf)) => {
                    total_changes += c;
                    all_conflicts.append(&mut cf);
                }
                Err(e) => {
                    let pv = self.preview_space(&sp);
                    if pv.deletes > 0 || pv.first {
                        self.pending.lock().unwrap().insert(sp.id.clone(), pv);
                        tracing::warn!(space = %sp.id, "rodada barrada (apagaria/baseline) — aguardando confirmacao");
                    } else {
                        tracing::error!("sync espaço {}: {e:#}", sp.id);
                        errors.push(format!("{}: {e}", sp.name));
                    }
                }
            }
        }

        let mut s = self.status.lock().unwrap();
        if errors.is_empty() {
            s.state = "ocioso".into();
            s.detail = None;
        } else {
            s.state = "erro".into();
            s.detail = Some(errors.join(" | "));
        }
        s.last = SystemTime::now().duration_since(UNIX_EPOCH).ok().map(|d| d.as_secs());
        s.last_changes = total_changes;
        s.conflicts = all_conflicts;
        drop(s);
        if !errors.is_empty() {
            bail!("rodada com erros: {}", errors.join(" | "));
        }
        Ok(())
    }

    pub fn tick(&self) {
        let due = {
            let mut lr = self.last_refresh.lock().unwrap();
            let due = lr.map_or(true, |t| t.elapsed().as_secs() >= REFRESH_SECS);
            if due {
                *lr = Some(Instant::now());
            }
            due
        };
        if due {
            if let Err(e) = self.refresh_spaces() {
                tracing::warn!("refresh: {e:#}");
            }
        }
        self.enforce_locks();
        if self.dirty.swap(false, Ordering::SeqCst) {
            if let Err(e) = self.sync_once() {
                tracing::error!("sync_once: {e:#}");
            }
        }
    }

    fn resolve(&self, path: &Path) -> Option<(String, PathBuf)> {
        let spaces = self.spaces.lock().unwrap();
        for sp in spaces.iter() {
            if let Ok(rel) = path.strip_prefix(&sp.local) {
                let folder = rel.components().next()?.as_os_str().to_string_lossy().to_string();
                if folder.is_empty() {
                    return None;
                }
                let key = format!("{}::{}", sp.id, folder);
                return Some((key, sp.local.join(&folder)));
            }
        }
        None
    }

    pub fn note_activity(&self, path: &Path) {
        if self.lock.is_none() {
            return;
        }
        if self.running.load(Ordering::Relaxed) {
            return;
        }
        if let Some((key, folder)) = self.resolve(path) {
            self.held.lock().unwrap().insert(key, (folder, Instant::now()));
        }
    }

    pub fn release_all(&self) {
        let Some(lock) = &self.lock else { return };
        let keys: Vec<String> = self.held.lock().unwrap().keys().cloned().collect();
        for k in keys {
            let _ = lock.release(&k);
        }
        self.held.lock().unwrap().clear();
    }

    pub fn startup_reconcile(&self) {
        if self.lock.is_none() {
            return;
        }
        for (_, path) in load_readonly() {
            if let Some(s) = path.to_str() {
                let _ = acl::restore_writable(s);
            }
        }
        save_readonly(&HashMap::new());
        let _ = self.refresh_spaces();
        self.enforce_locks();
    }

    pub fn enforce_locks(&self) {
        let Some(lock) = &self.lock else { return };

        let now = Instant::now();
        let mut to_release = Vec::new();
        {
            let held = self.held.lock().unwrap();
            for (key, (_, last)) in held.iter() {
                if now.duration_since(*last).as_secs() > RELEASE_SECS {
                    to_release.push(key.clone());
                } else {
                    match lock.claim(key) {
                        Ok(Claim::Granted) => {}
                        Ok(Claim::HeldBy(h)) => tracing::warn!(key = %key, holder = %h, "editando sem lock"),
                        Err(e) => tracing::warn!(key = %key, "claim falhou: {e:#}"),
                    }
                }
            }
        }
        for key in &to_release {
            let _ = lock.release(key);
            self.held.lock().unwrap().remove(key);
        }
        let our_held: HashSet<String> = self.held.lock().unwrap().keys().cloned().collect();

        let locks = match lock.status() {
            Ok(l) => l,
            Err(e) => {
                tracing::warn!("status lock: {e:#}");
                return;
            }
        };
        let held_by_others: HashSet<String> = locks
            .into_iter()
            .map(|l| l.product)
            .filter(|k| !our_held.contains(k))
            .collect();

        let known: HashMap<String, PathBuf> = {
            let spaces = self.spaces.lock().unwrap();
            spaces
                .iter()
                .flat_map(|sp| {
                    let local = sp.local.clone();
                    let id = sp.id.clone();
                    list_top_folders(&local)
                        .into_iter()
                        .map(move |f| (format!("{id}::{f}"), local.join(&f)))
                })
                .collect()
        };

        let mut ro = self.readonly.lock().unwrap();
        for key in &held_by_others {
            if !ro.contains_key(key) {
                if let Some(path) = known.get(key) {
                    if let Some(s) = path.to_str() {
                        if acl::set_readonly(s).is_ok() {
                            ro.insert(key.clone(), path.clone());
                            tracing::info!(key = %key, "read-only (detido por outro)");
                        }
                    }
                }
            }
        }
        let restore: Vec<String> = ro
            .iter()
            .filter(|(k, _)| !held_by_others.contains(*k))
            .map(|(k, _)| k.clone())
            .collect();
        for key in restore {
            if let Some(path) = ro.get(&key) {
                if let Some(s) = path.to_str() {
                    let _ = acl::restore_writable(s);
                }
            }
            ro.remove(&key);
            tracing::info!(key = %key, "editável de novo");
        }
        save_readonly(&ro);
    }

    fn rclone(&self) -> Result<PathBuf> {
        let mut slot = self.rclone.lock().unwrap();
        if let Some(p) = slot.as_ref() {
            return Ok(p.clone());
        }
        let p = find_rclone()?;
        *slot = Some(p.clone());
        Ok(p)
    }

    fn ctrl(&self) -> Result<&Control> {
        self.control.as_ref().context("control plane indisponível")
    }

    pub fn pair(&self, jwt: &str, name: &str) -> Result<control::DeviceInfo> {
        let info = self.ctrl()?.pair(jwt, name)?;
        self.status.lock().unwrap().paired = true;
        let _ = self.refresh_spaces();
        self.watch_gen.fetch_add(1, Ordering::Relaxed);
        Ok(info)
    }

    pub fn spaces_ui(&self) -> Vec<SpaceStatus> {
        let _ = self.refresh_spaces();
        self.status.lock().unwrap().spaces.clone()
    }

    pub fn list_invites(&self) -> Result<Vec<control::SpaceInvite>> {
        self.ctrl()?.list_invites()
    }

    pub fn list_devices(&self) -> Result<control::DevicesView> {
        self.ctrl()?.list_devices()
    }

    pub fn revoke_device(&self, device_id: &str) -> Result<bool> {
        let was_self = self.ctrl()?.revoke_device(device_id)?;
        if was_self {
            self.unpair()?;
        }
        Ok(was_self)
    }

    pub fn accept_space(&self, id: &str) -> Result<()> {
        self.ctrl()?.accept_space(id)?;
        self.refresh_spaces()
    }

    pub fn create_space(&self, name: &str, kind: &str, folders: Vec<String>, backend_kind: &str, encrypted: bool, gdrive_folder_id: &str) -> Result<control::SpaceMeta> {
        let m = self.ctrl()?.create_space(name, kind, &folders, backend_kind, encrypted, gdrive_folder_id)?;
        self.refresh_spaces()?;
        Ok(m)
    }

    pub fn invite_to_space(&self, id: &str, email: &str) -> Result<control::InviteResult> {
        self.ctrl()?.invite_to_space(id, email)
    }

    pub fn create_invite_link(&self, max_uses: u32, expires_days: i64) -> Result<String> {
        self.ctrl()?.create_invite_link(max_uses, expires_days)
    }

    pub fn unpair(&self) -> Result<()> {
        control::unpair()?;
        self.spaces.lock().unwrap().clear();
        self.cfg_cache.lock().unwrap().clear();
        {
            let mut s = self.status.lock().unwrap();
            s.paired = false;
            s.spaces.clear();
        }
        self.watch_gen.fetch_add(1, Ordering::Relaxed);
        Ok(())
    }

    pub fn set_space_path(&self, id: &str, local: &str, connection_id: &str, subpath: &str) -> Result<()> {
        control::set_space_path(id, local, connection_id, subpath)?;
        self.refresh_spaces()?;
        self.mark_dirty();
        Ok(())
    }

    pub fn add_connection(&self, kind: &str, label: &str, token: &str, nas_root: &str) -> Result<control::Connection> {
        let c = control::add_connection(kind, label, token, nas_root)?;
        let _ = self.refresh_spaces();
        Ok(c)
    }
    pub fn list_connections(&self) -> Vec<control::ConnectionView> {
        control::load_connections().into_iter().map(control::ConnectionView::from).collect()
    }
    pub fn remove_connection(&self, id: &str) -> Result<()> {
        control::remove_connection(id)?;
        self.refresh_spaces()
    }

    fn preview_space(&self, sp: &ActiveSpace) -> Preview {
        let rclone = match self.rclone() {
            Ok(r) => r,
            Err(_) => return Preview { error: Some("rclone ausente".into()), ..Default::default() },
        };
        let first = !self.listings_exist(sp);
        if first {
            let _ = Command::new(&rclone)
                .arg("mkdir").arg(&sp.remote).arg("--config").arg(&self.gen_conf)
                .creation_flags(CREATE_NO_WINDOW).output();
        }
        let mut cmd = Command::new(&rclone);
        cmd.arg("bisync").arg(&sp.local).arg(&sp.remote)
            .arg("--filter-from").arg(&sp.filter)
            .arg("--workdir").arg(&sp.workdir)
            .args(["--conflict-resolve", "none"])
            .arg("--dry-run").arg("-v")
            .arg("--config").arg(&self.gen_conf);
        if first {
            cmd.arg("--resync");
        }
        cmd.creation_flags(CREATE_NO_WINDOW);
        let mut p = Preview { first, ..Default::default() };
        match cmd.output() {
            Ok(o) => {
                let log = format!("{}{}", String::from_utf8_lossy(&o.stdout), String::from_utf8_lossy(&o.stderr));
                for l in log.lines() {
                    let ll = l.to_lowercase();
                    if ll.contains("copy to path2") {
                        p.to_remote += 1;
                    } else if ll.contains("copy to path1") {
                        p.to_local += 1;
                    }
                    if ll.contains("queue delete") || (ll.contains("delete") && (ll.contains("path1") || ll.contains("path2"))) {
                        p.deletes += 1;
                    }
                }
            }
            Err(e) => p.error = Some(format!("dry-run: {e}")),
        }
        p
    }

    pub fn space_preview(&self, id: &str) -> Preview {
        let snap = { self.spaces.lock().unwrap().iter().find(|s| s.id == id).cloned() };
        match snap {
            Some(sp) => self.preview_space(&sp),
            None => Preview { error: Some("espaço sem caminho configurado".into()), ..Default::default() },
        }
    }

    pub fn set_space_activated(&self, id: &str, on: bool) -> Result<()> {
        control::set_activated(id, on)?;
        if !on {
            self.pending.lock().unwrap().remove(id);
        }
        self.refresh_spaces()
    }

    pub fn confirmed_sync_one(&self, id: &str) -> Result<()> {
        if self.running.swap(true, Ordering::SeqCst) {
            return Ok(());
        }
        let _guard = RunGuard(&self.running);
        let _ = self.refresh_spaces();
        let rclone = self.rclone()?;
        let snap = { self.spaces.lock().unwrap().iter().find(|s| s.id == id).cloned() };
        let Some(sp) = snap else { return Ok(()) };
        self.set_state("sincronizando", Some(sp.name.clone()));
        let r = self.sync_space(&rclone, &sp, true);
        self.pending.lock().unwrap().remove(id);
        let mut s = self.status.lock().unwrap();
        match r {
            Ok((c, cf)) => {
                s.state = "ocioso".into();
                s.detail = None;
                s.last = SystemTime::now().duration_since(UNIX_EPOCH).ok().map(|d| d.as_secs());
                s.last_changes = c;
                s.conflicts = cf;
                Ok(())
            }
            Err(e) => {
                s.state = "erro".into();
                s.detail = Some(format!("{}: {e}", sp.name));
                Err(e)
            }
        }
    }

    pub fn delete_space(&self, id: &str) -> Result<()> {
        self.ctrl()?.delete_space(id)?;
        self.pending.lock().unwrap().remove(id);
        self.refresh_spaces()
    }

    pub fn leave_space(&self, id: &str) -> Result<()> {
        self.ctrl()?.leave_space(id)?;
        self.pending.lock().unwrap().remove(id);
        self.refresh_spaces()
    }
}

fn list_top_folders(root: &Path) -> Vec<String> {
    std::fs::read_dir(root)
        .map(|rd| {
            rd.flatten()
                .filter(|e| e.path().is_dir())
                .map(|e| e.file_name().to_string_lossy().to_string())
                .filter(|n| !n.starts_with('.') && n != "node_modules" && n != "target" && n != "dist")
                .collect()
        })
        .unwrap_or_default()
}

fn extract_section(conf: &str, name: &str) -> Option<String> {
    let header = format!("[{name}]");
    let mut body = String::new();
    let mut inside = false;
    for line in conf.lines() {
        let t = line.trim();
        if t.starts_with('[') && t.ends_with(']') {
            if inside {
                break;
            }
            inside = t == header;
            continue;
        }
        if inside {
            body.push_str(line);
            body.push('\n');
        }
    }
    if body.trim().is_empty() {
        None
    } else {
        Some(body)
    }
}

fn crypt_section(rclone: &Path, name: &str, target: &str, cfg: &control::SpaceConfig) -> Result<String> {
    let pass = obscure(rclone, &cfg.crypt_key)?;
    let mut s = format!(
        "\n[{name}]\ntype = crypt\nfilename_encryption = standard\ndirectory_name_encryption = true\nremote = {target}\npassword = {pass}\n"
    );
    if let Some(salt) = &cfg.crypt_salt {
        let p2 = obscure(rclone, salt)?;
        s.push_str(&format!("password2 = {p2}\n"));
    }
    Ok(s)
}

pub fn rclone_bin() -> Result<PathBuf> {
    find_rclone()
}

fn obscure(rclone: &Path, secret: &str) -> Result<String> {
    let out = Command::new(rclone)
        .arg("obscure")
        .arg(secret)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .context("rclone obscure")?;
    if !out.status.success() {
        bail!("rclone obscure falhou");
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// Converte um .gitignore em regras de filtro do rclone.
fn gitignore_to_rclone(content: &str) -> Vec<String> {
    let mut rules: Vec<String> = Vec::new();
    for raw in content.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let (sign, pat) = match line.strip_prefix('!') {
            Some(rest) => ("+", rest.trim()),
            None => ("-", line),
        };
        let dir_only = pat.ends_with('/');
        let g = pat.trim_end_matches('/');
        if g.is_empty() {
            continue;
        }
        if dir_only {
            rules.push(format!("{sign} {g}/**"));
        } else {
            rules.push(format!("{sign} {g}"));
            rules.push(format!("{sign} {g}/**"));
        }
    }
    rules.reverse();
    rules
}

fn parse_pct(line: &str) -> Option<u32> {
    if !line.contains("Transferred:") {
        return None;
    }
    for tok in line.split(|c: char| c == ' ' || c == ',') {
        if let Some(num) = tok.strip_suffix('%') {
            if let Ok(n) = num.trim().parse::<u32>() {
                return Some(n);
            }
        }
    }
    None
}

fn count_changes(log: &str) -> u32 {
    log.lines()
        .filter(|l| {
            l.contains(": Copied") || l.contains(": Deleted") || l.contains(": Updated") || l.contains(": Moved")
        })
        .count() as u32
}

fn readonly_state_file() -> Option<PathBuf> {
    std::env::var("APPDATA").ok().map(|a| PathBuf::from(a).join("sf-sync").join("readonly.json"))
}

fn save_readonly(map: &HashMap<String, PathBuf>) {
    if let Some(p) = readonly_state_file() {
        if let Some(dir) = p.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let ser: HashMap<&String, String> =
            map.iter().map(|(k, v)| (k, v.to_string_lossy().to_string())).collect();
        let _ = std::fs::write(&p, serde_json::to_string(&ser).unwrap_or_default());
    }
}

fn load_readonly() -> HashMap<String, PathBuf> {
    readonly_state_file()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str::<HashMap<String, String>>(&s).ok())
        .map(|m| m.into_iter().map(|(k, v)| (k, PathBuf::from(v))).collect())
        .unwrap_or_default()
}

fn find_rclone() -> Result<PathBuf> {
    if let Ok(p) = std::env::var("SF_SYNC_RCLONE") {
        let pb = PathBuf::from(p);
        if pb.exists() {
            return Ok(pb);
        }
    }
    if Command::new("rclone")
        .arg("version")
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
    {
        return Ok(PathBuf::from("rclone"));
    }
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        let base = PathBuf::from(local).join(r"Microsoft\WinGet\Packages");
        if let Some(p) = find_exe(&base, "rclone.exe", 6) {
            return Ok(p);
        }
    }
    bail!("rclone nao encontrado — instale: winget install Rclone.Rclone")
}

fn find_exe(dir: &Path, name: &str, depth: u32) -> Option<PathBuf> {
    if depth == 0 {
        return None;
    }
    let rd = std::fs::read_dir(dir).ok()?;
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() {
            if let Some(found) = find_exe(&p, name, depth - 1) {
                return Some(found);
            }
        } else if p.file_name().map_or(false, |f| f.eq_ignore_ascii_case(name)) {
            return Some(p);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::{gitignore_to_rclone, parse_pct};

    #[test]
    fn pct_extraction() {
        assert_eq!(parse_pct("Transferred: 1.2 MiB / 5 MiB, 24%, 1 MiB/s, ETA 3s"), Some(24));
        assert_eq!(parse_pct("Transferred: 100 / 100, 100%"), Some(100));
        assert_eq!(parse_pct("linha sem stats"), None);
        assert_eq!(parse_pct("Transferred: 0 B / 0 B, -, 0 B/s, ETA -"), None);
    }

    #[test]
    fn gitignore_conversion() {
        let r = gitignore_to_rclone("# comentario\n\nnode_modules/\n*.log\n!keep.log\n/dist\n");
        let s = r.join("\n");
        assert!(s.contains("- node_modules/**"), "pasta -> /**");
        assert!(s.contains("- *.log"), "padrao de arquivo");
        assert!(s.contains("+ keep.log"), "negacao vira include");
        assert!(s.contains("- /dist"), "ancora preservada");
        let keep = r.iter().position(|x| x == "+ keep.log").unwrap();
        let log = r.iter().position(|x| x == "- *.log").unwrap();
        assert!(keep < log, "negacao precede o exclude apos a inversao");
    }
}
