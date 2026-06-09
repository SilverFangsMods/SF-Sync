//! Cliente do backend de lock.
//!
//! Chamar sempre de uma thread sincrona (nao do runtime async do Tauri), pois
//! usa reqwest::blocking.

use std::time::Duration;

use anyhow::{Context, Result};
use serde::Deserialize;

use crate::control;

pub struct LockClient {
    base: String,
    token: String,
    http: reqwest::blocking::Client,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LockInfo {
    pub product: String,
    pub holder: String,
    pub expires_at: u64,
}

#[derive(Debug, Deserialize)]
struct StatusResp {
    #[serde(default)]
    locks: Vec<LockInfo>,
}

#[derive(Debug, Deserialize)]
struct OpResp {
    ok: bool,
    #[serde(default)]
    held_by: Option<String>,
    #[serde(default)]
    reason: Option<String>,
}

pub enum Claim {
    Granted,
    HeldBy(String),
}

impl LockClient {
    pub fn new() -> Result<Self> {
        Ok(Self {
            base: control::base_url(),
            token: load_token()?,
            http: reqwest::blocking::Client::builder()
                .timeout(Duration::from_secs(15))
                .build()?,
        })
    }

    fn op(&self, path: &str, product: &str) -> Result<OpResp> {
        let r = self
            .http
            .post(format!("{}{}", self.base, path))
            .bearer_auth(&self.token)
            .json(&serde_json::json!({ "product": product }))
            .send()
            .context("falha de rede ao backend de lock")?
            .json::<OpResp>()
            .context("resposta invalida do backend de lock")?;
        Ok(r)
    }

    pub fn claim(&self, product: &str) -> Result<Claim> {
        let r = self.op("/claim", product)?;
        if r.ok {
            Ok(Claim::Granted)
        } else {
            Ok(Claim::HeldBy(r.held_by.unwrap_or_else(|| "?".into())))
        }
    }

    pub fn release(&self, product: &str) -> Result<()> {
        let r = self.op("/release", product)?;
        if !r.ok {
            tracing::warn!(product, reason = ?r.reason, "release nao aplicado");
        }
        Ok(())
    }

    pub fn status(&self) -> Result<Vec<LockInfo>> {
        let r = self
            .http
            .get(format!("{}/status", self.base))
            .bearer_auth(&self.token)
            .send()
            .context("falha de rede ao backend de lock")?
            .json::<StatusResp>()
            .context("status invalido do backend de lock")?;
        Ok(r.locks)
    }
}

fn load_token() -> Result<String> {
    control::device_token().context("sem device token — pareie o dispositivo")
}
