//! Enforcement de read-only por pasta via icacls do Windows.

use std::os::windows::process::CommandExt;
use std::process::Command;

use anyhow::{Context, Result};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn current_user() -> Result<String> {
    static USER: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    if let Some(u) = USER.get() {
        return Ok(u.clone());
    }
    let out = Command::new("whoami")
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .context("whoami")?;
    let u = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let _ = USER.set(u.clone());
    Ok(u)
}

fn run_icacls(args: &[&str]) -> Result<()> {
    let out = Command::new("icacls")
        .args(args)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .context("falha ao executar icacls")?;
    if !out.status.success() {
        tracing::warn!(
            "icacls parcial: {}",
            String::from_utf8_lossy(&out.stdout).trim()
        );
    }
    Ok(())
}

pub fn set_readonly(path: &str) -> Result<()> {
    let user = current_user()?;
    run_icacls(&[path, "/deny", &format!("{user}:(OI)(CI)W"), "/T", "/C", "/Q"])
}

pub fn restore_writable(path: &str) -> Result<()> {
    let user = current_user()?;
    run_icacls(&[path, "/remove:d", &user, "/T", "/C", "/Q"])
}
