/// <reference types="@cloudflare/workers-types" />
import {
  hashPassword, verifyPassword, jwtSign, jwtVerify,
  totpSecret, totpVerify, totpUri, aesEnc, aesDec, genCryptKey,
  genRecoveryCodes, sha256hex,
} from "./crypto";
import { sendEmail, inviteAccountHtml, inviteSpaceHtml } from "./email";

export interface ControlEnv {
  CTRL: D1Database;
  JWT_SECRET: string;
  MASTER_KEY: string;
  RESEND_API_KEY?: string;
  CLIENTS: KVNamespace;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
}

const RL_MAX = 6;
const RL_TTL = 900;
async function rlBlocked(env: ControlEnv, key: string): Promise<boolean> {
  const v = await env.CLIENTS.get(`rl:${key}`);
  return parseInt(v ?? "0", 10) >= RL_MAX;
}
async function rlBump(env: ControlEnv, key: string): Promise<void> {
  const n = parseInt((await env.CLIENTS.get(`rl:${key}`)) ?? "0", 10) + 1;
  await env.CLIENTS.put(`rl:${key}`, String(n), { expirationTtl: RL_TTL });
}
async function rlClear(env: ControlEnv, key: string): Promise<void> {
  await env.CLIENTS.delete(`rl:${key}`);
}

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "authorization,content-type",
};
function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", ...CORS } });
}
const norm = (e: string) => (e ?? "").trim().toLowerCase();
const slug = (s: string) => (s ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const rand = (n = 18) => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(n)))).replace(/[+/=]/g, "");
const inviteCode = () => rand(6).toUpperCase().slice(0, 8);
const bearer = (req: Request) => (req.headers.get("authorization") ?? "").match(/^Bearer (.+)$/)?.[1] ?? null;

interface UserRow { email: string; name: string; password_hash: string; totp_secret: string; totp_enrolled: number; }

async function userOf(req: Request, env: ControlEnv): Promise<{ email: string } | null> {
  const claims = await jwtVerify(bearer(req) ?? "", env.JWT_SECRET);
  return claims?.email ? { email: norm(claims.email) } : null;
}

async function deviceOf(req: Request, env: ControlEnv) {
  const t = bearer(req);
  if (!t) return null;
  return await env.CTRL.prepare("SELECT device_id, person, name FROM devices WHERE token=?")
    .bind(t).first<{ device_id: string; person: string; name: string }>();
}

export async function authStatus(req: Request, env: ControlEnv): Promise<Response> {
  const { email } = await req.json<{ email?: string }>();
  const e = norm(email ?? "");
  const u = await env.CTRL.prepare("SELECT password_hash, totp_enrolled FROM users WHERE email=?").bind(e).first<UserRow>();
  const inv = await env.CTRL.prepare("SELECT code FROM invites WHERE email=? AND used=0").bind(e).first();
  const anyUser = await env.CTRL.prepare("SELECT 1 FROM users LIMIT 1").first();
  return json({
    ok: true,
    registered: !!u?.password_hash,
    totp: !!u?.totp_enrolled,
    invited: !!inv || !anyUser,
  });
}

export async function register(req: Request, env: ControlEnv): Promise<Response> {
  const b = await req.json<{ email?: string; password?: string; name?: string; code?: string }>();
  const e = norm(b.email ?? "");
  if (!e.includes("@")) return json({ ok: false, error: "e-mail invalido" }, 400);
  if (!b.password || String(b.password).length < 8) return json({ ok: false, error: "senha minima de 8 caracteres" }, 400);
  if (await rlBlocked(env, `register:${e}`)) return json({ ok: false, error: "muitas tentativas - espere ~15 min" }, 429);

  const exists = await env.CTRL.prepare("SELECT password_hash FROM users WHERE email=?").bind(e).first<UserRow>();
  if (exists?.password_hash) return json({ ok: false, error: "ja cadastrado (faca login)" }, 409);

  const anyUser = await env.CTRL.prepare("SELECT 1 FROM users LIMIT 1").first();
  let invite: { code: string } | null = null;
  if (anyUser) {
    invite = await env.CTRL.prepare("SELECT code FROM invites WHERE email=? AND code=? AND used=0")
      .bind(e, (b.code ?? "").trim().toUpperCase()).first<{ code: string }>();
    if (!invite) {
      await rlBump(env, `register:${e}`);
      return json({ ok: false, error: "convite invalido ou ausente para este e-mail" }, 403);
    }
  }

  const ph = await hashPassword(String(b.password));
  const secret = totpSecret();
  await env.CTRL.prepare(
    "INSERT INTO users (email,name,password_hash,totp_secret,totp_enrolled,created_at) VALUES (?,?,?,?,0,?) " +
      "ON CONFLICT(email) DO UPDATE SET name=excluded.name, password_hash=excluded.password_hash, totp_secret=excluded.totp_secret, totp_enrolled=0"
  ).bind(e, (b.name ?? "").trim() || e.split("@")[0], ph, secret, Date.now()).run();
  if (invite) await env.CTRL.prepare("UPDATE invites SET used=1 WHERE code=?").bind(invite.code).run();

  return json({ ok: true, totp_uri: totpUri(e, secret), totp_secret: secret });
}

export async function totpConfirm(req: Request, env: ControlEnv): Promise<Response> {
  const b = await req.json<{ email?: string; code?: string }>();
  const e = norm(b.email ?? "");
  const u = await env.CTRL.prepare("SELECT totp_secret FROM users WHERE email=?").bind(e).first<UserRow>();
  if (!u?.totp_secret) return json({ ok: false, error: "sem TOTP pendente" }, 400);
  if (!(await totpVerify(u.totp_secret, String(b.code ?? "")))) return json({ ok: false, error: "codigo invalido" }, 401);
  await env.CTRL.prepare("UPDATE users SET totp_enrolled=1 WHERE email=?").bind(e).run();
  await env.CTRL.prepare("DELETE FROM recovery_codes WHERE email=?").bind(e).run();
  const codes = genRecoveryCodes(10);
  const stmts = await Promise.all(
    codes.map(async (c) => env.CTRL.prepare("INSERT INTO recovery_codes (email,code_hash,used) VALUES (?,?,0)").bind(e, await sha256hex(c)))
  );
  await env.CTRL.batch(stmts);
  return json({ ok: true, recovery_codes: codes });
}

export async function googleLogin(req: Request, env: ControlEnv): Promise<Response> {
  if (!env.GOOGLE_CLIENT_ID) return json({ ok: false, error: "login Google nao configurado (falta GOOGLE_CLIENT_ID)" }, 501);
  const b = await req.json<{ id_token?: string; code?: string; code_verifier?: string; redirect_uri?: string }>();
  let id_token = b.id_token;
  if (!id_token && b.code) {
    const form = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      code: b.code,
      code_verifier: b.code_verifier ?? "",
      redirect_uri: b.redirect_uri ?? "",
      grant_type: "authorization_code",
    });
    if (env.GOOGLE_CLIENT_SECRET) form.set("client_secret", env.GOOGLE_CLIENT_SECRET);
    const tk = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    const tj = await tk.json<{ id_token?: string; error?: string; error_description?: string }>();
    if (!tk.ok || !tj.id_token) {
      return json({ ok: false, error: "troca do code falhou: " + (tj.error_description || tj.error || "sem id_token") }, 401);
    }
    id_token = tj.id_token;
  }
  if (!id_token) return json({ ok: false, error: "sem id_token nem code" }, 400);
  const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(id_token)}`);
  if (!r.ok) return json({ ok: false, error: "id_token invalido" }, 401);
  const p = await r.json<{ aud?: string; email?: string; email_verified?: string; name?: string }>();
  if (p.aud !== env.GOOGLE_CLIENT_ID) return json({ ok: false, error: "client_id (aud) nao confere" }, 401);
  if (String(p.email_verified) !== "true") return json({ ok: false, error: "e-mail Google nao verificado" }, 401);
  const e = norm(p.email ?? "");
  if (!e) return json({ ok: false, error: "id_token sem e-mail" }, 401);
  const exists = await env.CTRL.prepare("SELECT 1 FROM users WHERE email=?").bind(e).first();
  const invited = await env.CTRL.prepare("SELECT 1 FROM invites WHERE email=? AND used=0").bind(e).first();
  const anyUser = await env.CTRL.prepare("SELECT 1 FROM users LIMIT 1").first();
  if (!exists && !invited && anyUser) return json({ ok: false, error: "sem convite para este e-mail" }, 403);
  await env.CTRL.prepare("INSERT INTO users (email,name,created_at) VALUES (?,?,?) ON CONFLICT(email) DO NOTHING")
    .bind(e, (p.name ?? e.split("@")[0]).trim(), Date.now()).run();
  if (!exists && invited) await env.CTRL.prepare("UPDATE invites SET used=1 WHERE email=? AND used=0").bind(e).run();
  const token = await jwtSign({ email: e, name: p.name ?? e }, env.JWT_SECRET);
  return json({ ok: true, token, email: e, name: p.name ?? e });
}

export async function regenCodes(req: Request, env: ControlEnv): Promise<Response> {
  const b = await req.json<{ email?: string; code?: string }>();
  const e = norm(b.email ?? "");
  if (await rlBlocked(env, `recover:${e}`)) return json({ ok: false, error: "muitas tentativas - espere ~15 min" }, 429);
  const u = await env.CTRL.prepare("SELECT totp_secret, totp_enrolled FROM users WHERE email=?").bind(e).first<UserRow>();
  if (!u?.totp_enrolled || !u.totp_secret) return json({ ok: false, error: "sem 2FA ativo" }, 400);
  if (!(await totpVerify(u.totp_secret, String(b.code ?? "")))) {
    await rlBump(env, `recover:${e}`);
    return json({ ok: false, error: "codigo do autenticador invalido" }, 401);
  }
  await env.CTRL.prepare("DELETE FROM recovery_codes WHERE email=?").bind(e).run();
  const codes = genRecoveryCodes(10);
  const stmts = await Promise.all(
    codes.map(async (c) => env.CTRL.prepare("INSERT INTO recovery_codes (email,code_hash,used) VALUES (?,?,0)").bind(e, await sha256hex(c)))
  );
  await env.CTRL.batch(stmts);
  return json({ ok: true, recovery_codes: codes });
}

export async function recover(req: Request, env: ControlEnv): Promise<Response> {
  const b = await req.json<{ email?: string; password?: string; code?: string }>();
  const e = norm(b.email ?? "");
  if (await rlBlocked(env, `recover:${e}`)) return json({ ok: false, error: "muitas tentativas - espere ~15 min" }, 429);
  const u = await env.CTRL.prepare("SELECT password_hash FROM users WHERE email=?").bind(e).first<UserRow>();
  if (!u?.password_hash) {
    await rlBump(env, `recover:${e}`);
    return json({ ok: false, error: "nao cadastrado" }, 401);
  }
  if (!(await verifyPassword(String(b.password ?? ""), u.password_hash))) {
    await rlBump(env, `recover:${e}`);
    return json({ ok: false, error: "senha incorreta" }, 401);
  }
  const h = await sha256hex(String(b.code ?? ""));
  const rc = await env.CTRL.prepare("SELECT rowid FROM recovery_codes WHERE email=? AND code_hash=? AND used=0").bind(e, h).first<{ rowid: number }>();
  if (!rc) {
    await rlBump(env, `recover:${e}`);
    return json({ ok: false, error: "código de recuperação inválido ou já usado" }, 401);
  }
  await rlClear(env, `recover:${e}`);
  await env.CTRL.prepare("UPDATE recovery_codes SET used=1 WHERE rowid=?").bind(rc.rowid).run();
  const secret = totpSecret();
  await env.CTRL.prepare("UPDATE users SET totp_secret=?, totp_enrolled=0 WHERE email=?").bind(secret, e).run();
  return json({ ok: true, totp_uri: totpUri(e, secret), totp_secret: secret });
}

export async function login(req: Request, env: ControlEnv): Promise<Response> {
  const b = await req.json<{ email?: string; password?: string; code?: string }>();
  const e = norm(b.email ?? "");
  if (await rlBlocked(env, `login:${e}`)) return json({ ok: false, error: "muitas tentativas - espere ~15 min" }, 429);
  const u = await env.CTRL.prepare("SELECT name, password_hash, totp_secret, totp_enrolled FROM users WHERE email=?").bind(e).first<UserRow>();
  if (!u?.password_hash) {
    await rlBump(env, `login:${e}`);
    return json({ ok: false, error: "nao cadastrado" }, 401);
  }
  if (!(await verifyPassword(String(b.password ?? ""), u.password_hash))) {
    await rlBump(env, `login:${e}`);
    return json({ ok: false, error: "senha incorreta" }, 401);
  }
  if (u.totp_enrolled && !(await totpVerify(u.totp_secret, String(b.code ?? "")))) {
    await rlBump(env, `login:${e}`);
    return json({ ok: false, error: "codigo 2FA invalido", need_totp: true }, 401);
  }
  await rlClear(env, `login:${e}`);
  const token = await jwtSign({ email: e, name: u.name }, env.JWT_SECRET);
  return json({ ok: true, token, email: e, name: u.name });
}

export async function resetPassword(req: Request, env: ControlEnv): Promise<Response> {
  const b = await req.json<{ email?: string; code?: string; password?: string }>();
  const e = norm(b.email ?? "");
  if (!b.password || String(b.password).length < 8) return json({ ok: false, error: "senha minima de 8 caracteres" }, 400);
  const u = await env.CTRL.prepare("SELECT totp_secret, totp_enrolled FROM users WHERE email=?").bind(e).first<UserRow>();
  if (!u?.totp_enrolled || !u.totp_secret) return json({ ok: false, error: "sem 2FA ativo - reset por TOTP indisponivel" }, 400);
  if (!(await totpVerify(u.totp_secret, String(b.code ?? "")))) return json({ ok: false, error: "codigo do autenticador invalido" }, 401);
  const ph = await hashPassword(String(b.password));
  await env.CTRL.prepare("UPDATE users SET password_hash=? WHERE email=?").bind(ph, e).run();
  return json({ ok: true });
}

export async function createInvite(req: Request, env: ControlEnv): Promise<Response> {
  const me = await userOf(req, env);
  if (!me) return json({ ok: false, error: "faca login" }, 401);
  const { email } = await req.json<{ email?: string }>();
  const e = norm(email ?? "");
  if (!e.includes("@")) return json({ ok: false, error: "e-mail invalido" }, 400);
  const code = inviteCode();
  await env.CTRL.prepare("INSERT INTO invites (code,email,invited_by,used,created_at) VALUES (?,?,?,0,?)")
    .bind(code, e, me.email, Date.now()).run();
  const mail = await sendEmail(env.RESEND_API_KEY, e, "Convite para o SF-Sync", inviteAccountHtml(code, me.email));
  return json({ ok: true, code, email: e, mail_sent: mail.sent, mail_error: mail.error });
}

export async function createInviteLink(req: Request, env: ControlEnv): Promise<Response> {
  const me = await deviceOf(req, env);
  if (!me) return json({ ok: false, error: "dispositivo nao pareado" }, 401);
  const b = await req.json<{ max_uses?: number; expires_days?: number }>().catch(() => ({} as any));
  const maxUses = Math.max(1, Math.min(1000, Math.floor(Number(b.max_uses ?? 1)) || 1));
  const days = Number(b.expires_days ?? 7);
  const expiresAt = days > 0 ? Date.now() + days * 86400000 : null;
  const token = rand(15);
  await env.CTRL.prepare(
    "INSERT INTO invite_links (token,created_by,max_uses,used_count,expires_at,revoked,created_at) VALUES (?,?,?,0,?,0,?)"
  ).bind(token, me.person, maxUses, expiresAt, Date.now()).run();
  return json({ ok: true, token, url: `https://sync.silverfangs.com/join/${token}`, max_uses: maxUses, expires_at: expiresAt });
}

interface InviteLinkRow { token: string; created_by: string; max_uses: number; used_count: number; expires_at: number | null; revoked: number; }

async function getValidLink(env: ControlEnv, token: string): Promise<{ link?: InviteLinkRow; reason?: string }> {
  const link = await env.CTRL.prepare("SELECT * FROM invite_links WHERE token=?").bind(token).first<InviteLinkRow>();
  if (!link || link.revoked) return { reason: "Este link de convite e invalido." };
  if (link.expires_at && Date.now() > link.expires_at) return { reason: "Este link de convite expirou." };
  if (link.used_count >= link.max_uses) return { reason: "Este link de convite ja atingiu o limite de usos." };
  return { link };
}

export async function inviteLinkStatus(env: ControlEnv, token: string): Promise<{ ok: boolean; reason?: string }> {
  const { link, reason } = await getValidLink(env, token);
  return link ? { ok: true } : { ok: false, reason };
}

export async function claimInviteLink(req: Request, env: ControlEnv, token: string): Promise<Response> {
  const { link, reason } = await getValidLink(env, token);
  if (!link) return json({ ok: false, error: reason }, 410);
  const b = await req.json<{ email?: string }>().catch(() => ({} as any));
  const e = norm(b.email ?? "");
  if (!e.includes("@")) return json({ ok: false, error: "Informe um e-mail valido." }, 400);
  if (await rlBlocked(env, `join:${token}`)) return json({ ok: false, error: "muitas tentativas - espere ~15 min" }, 429);
  const exists = await env.CTRL.prepare("SELECT 1 FROM users WHERE email=?").bind(e).first();
  if (exists) return json({ ok: true, already: true, email: e });
  let inv = await env.CTRL.prepare("SELECT code FROM invites WHERE email=? AND used=0").bind(e).first<{ code: string }>();
  if (!inv) {
    const code = inviteCode();
    await env.CTRL.prepare("INSERT INTO invites (code,email,invited_by,used,created_at) VALUES (?,?,?,0,?)")
      .bind(code, e, link.created_by, Date.now()).run();
    await env.CTRL.prepare("UPDATE invite_links SET used_count=used_count+1 WHERE token=?").bind(token).run();
    inv = { code };
  }
  await rlBump(env, `join:${token}`);
  await sendEmail(env.RESEND_API_KEY, e, "Seu acesso ao SF-Sync", inviteAccountHtml(inv.code, link.created_by));
  return json({ ok: true, code: inv.code, email: e });
}

export async function pairDevice(req: Request, env: ControlEnv): Promise<Response> {
  const me = await userOf(req, env);
  if (!me) return json({ ok: false, error: "faca login no SF-Sync" }, 401);
  const { name } = await req.json<{ name?: string }>();
  const token = rand(24), device_id = rand(12);
  await env.CTRL.prepare("INSERT INTO devices (token,device_id,person,name,created_at) VALUES (?,?,?,?,?)")
    .bind(token, device_id, me.email, name || "dispositivo", Date.now()).run();
  return json({ ok: true, device_token: token, device_id, person: me.email });
}

export async function revokeDevice(req: Request, env: ControlEnv): Promise<Response> {
  const dev = await deviceOf(req, env);
  if (!dev) return json({ ok: false, error: "device nao pareado" }, 401);
  const { device_id } = await req.json<{ device_id?: string }>();
  if (!device_id) return json({ ok: false, error: "device_id obrigatorio" }, 400);
  const r = await env.CTRL.prepare("DELETE FROM devices WHERE device_id=? AND person=?").bind(device_id, dev.person).run();
  return json({ ok: true, revoked: device_id, was_self: device_id === dev.device_id, changes: r.meta?.changes ?? 0 });
}

export async function listDevices(req: Request, env: ControlEnv): Promise<Response> {
  const dev = await deviceOf(req, env);
  if (!dev) return json({ ok: false, error: "device nao pareado" }, 401);
  const r = await env.CTRL.prepare("SELECT device_id, name, created_at FROM devices WHERE person=? ORDER BY created_at")
    .bind(dev.person).all<any>();
  return json({ ok: true, person: dev.person, this_device: dev.device_id, devices: r.results });
}

export async function createSpace(req: Request, env: ControlEnv): Promise<Response> {
  const dev = await deviceOf(req, env);
  if (!dev) return json({ ok: false, error: "device nao pareado" }, 401);
  const b = await req.json<{ name?: string; kind?: string; folders?: string[]; backend_kind?: string; encrypted?: boolean; gdrive_folder_id?: string }>();
  if (!b.name) return json({ ok: false, error: "name obrigatorio" }, 400);
  const k = b.kind === "compartilhado" ? "compartilhado" : "pessoal";
  const backend = ["r2", "nas", "gdrive"].includes(b.backend_kind ?? "") ? b.backend_kind! : "r2";
  const enc = (b.encrypted ?? backend !== "nas") ? 1 : 0;
  let id = slug(b.name);
  if (!id) id = `espaco-${rand(4).toLowerCase()}`;
  if (await env.CTRL.prepare("SELECT id FROM spaces WHERE id=?").bind(id).first()) id = `${id}-${rand(4).toLowerCase()}`;

  const cryptKey = genCryptKey();
  const cryptEnc = await aesEnc(env.MASTER_KEY, cryptKey);
  const folders = JSON.stringify(Array.isArray(b.folders) ? b.folders : []);
  const gfid = (b.gdrive_folder_id ?? "").trim() || null;
  if (gfid && !/^[A-Za-z0-9_-]{1,128}$/.test(gfid)) return json({ ok: false, error: "gdrive_folder_id invalido" }, 400);
  await env.CTRL.prepare(
    "INSERT INTO spaces (id,name,kind,r2_prefix,crypt_key_enc,backend_kind,encrypted,folders,gdrive_folder_id,owner,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)"
  ).bind(id, b.name, k, id, cryptEnc, backend, enc, folders, gfid, dev.person, Date.now()).run();
  await env.CTRL.prepare("INSERT OR IGNORE INTO members (space_id,person,status) VALUES (?,?,'active')").bind(id, dev.person).run();
  return json({ ok: true, space: { id, name: b.name, kind: k, r2_prefix: id, backend_kind: backend, encrypted: !!enc, folders: JSON.parse(folders), gdrive_folder_id: gfid, owner: dev.person } });
}

export async function listSpaces(req: Request, env: ControlEnv): Promise<Response> {
  const dev = await deviceOf(req, env);
  if (!dev) return json({ ok: false, error: "device nao pareado" }, 401);
  const r = await env.CTRL.prepare(
    "SELECT s.id,s.name,s.kind,s.r2_prefix,s.backend_kind,s.encrypted,s.folders,s.owner FROM spaces s " +
      "JOIN members m ON m.space_id=s.id WHERE m.person=? AND m.status='active' ORDER BY s.name"
  ).bind(dev.person).all<any>();
  for (const sp of r.results) {
    sp.folders = sp.folders ? JSON.parse(sp.folders) : [];
    sp.encrypted = !!sp.encrypted;
    const mem = await env.CTRL.prepare("SELECT person, status FROM members WHERE space_id=?").bind(sp.id).all<{ person: string; status: string }>();
    sp.members = mem.results;
  }
  return json({ ok: true, person: dev.person, device: dev.name, spaces: r.results });
}

export async function spaceConfig(req: Request, env: ControlEnv, id: string): Promise<Response> {
  const dev = await deviceOf(req, env);
  if (!dev) return json({ ok: false, error: "device nao pareado" }, 401);
  const sp = await env.CTRL.prepare(
    "SELECT s.r2_prefix,s.crypt_key_enc,s.crypt_salt_enc,s.backend_kind,s.encrypted,s.folders,s.gdrive_folder_id FROM spaces s " +
      "JOIN members m ON m.space_id=s.id WHERE s.id=? AND m.person=? AND m.status='active'"
  ).bind(id, dev.person).first<{ r2_prefix: string; crypt_key_enc: string; crypt_salt_enc: string | null; backend_kind: string; encrypted: number; folders: string; gdrive_folder_id: string | null }>();
  if (!sp) return json({ ok: false, error: "espaco nao encontrado ou sem acesso" }, 404);
  const crypt_key = await aesDec(env.MASTER_KEY, sp.crypt_key_enc);
  const crypt_salt = sp.crypt_salt_enc ? await aesDec(env.MASTER_KEY, sp.crypt_salt_enc) : null;
  return json({ ok: true, r2_prefix: sp.r2_prefix, crypt_key, crypt_salt, backend_kind: sp.backend_kind ?? "r2", encrypted: !!sp.encrypted, folders: sp.folders ? JSON.parse(sp.folders) : [], gdrive_folder_id: sp.gdrive_folder_id ?? null });
}

export async function inviteMember(req: Request, env: ControlEnv): Promise<Response> {
  const dev = await deviceOf(req, env);
  if (!dev) return json({ ok: false, error: "device nao pareado" }, 401);
  const b = await req.json<{ space_id?: string; email?: string }>();
  const e = norm(b.email ?? "");
  const sp = await env.CTRL.prepare("SELECT name, owner FROM spaces WHERE id=?").bind(b.space_id).first<{ name: string; owner: string }>();
  if (!sp) return json({ ok: false, error: "espaco inexistente" }, 404);
  if (sp.owner !== dev.person) return json({ ok: false, error: "so o dono convida" }, 403);
  await env.CTRL.prepare("INSERT OR IGNORE INTO members (space_id,person,status,invited_by,invited_at) VALUES (?,?,'invited',?,?)")
    .bind(b.space_id, e, dev.person, Date.now()).run();
  const reg = await env.CTRL.prepare("SELECT 1 FROM users WHERE email=?").bind(e).first();

  let account_invite_code: string | null = null;
  if (!reg) {
    const existing = await env.CTRL.prepare("SELECT code FROM invites WHERE email=? AND used=0").bind(e).first<{ code: string }>();
    if (existing) {
      account_invite_code = existing.code;
    } else {
      account_invite_code = inviteCode();
      await env.CTRL.prepare("INSERT INTO invites (code,email,invited_by,used,created_at) VALUES (?,?,?,0,?)")
        .bind(account_invite_code, e, dev.person, Date.now()).run();
    }
  }

  const html = reg
    ? inviteSpaceHtml(sp.name, dev.person)
    : `${inviteAccountHtml(account_invite_code!, dev.person)}${inviteSpaceHtml(sp.name, dev.person)}`;
  const mail = await sendEmail(env.RESEND_API_KEY, e, `Convite: espaco ${sp.name}`, html);
  return json({ ok: true, invited: e, has_account: !!reg, account_invite_code, mail_sent: mail.sent });
}

export async function listSpaceInvites(req: Request, env: ControlEnv): Promise<Response> {
  const dev = await deviceOf(req, env);
  if (!dev) return json({ ok: false, error: "device nao pareado" }, 401);
  const r = await env.CTRL.prepare(
    "SELECT s.id,s.name,s.kind,m.invited_by,m.invited_at FROM spaces s " +
      "JOIN members m ON m.space_id=s.id WHERE m.person=? AND m.status='invited' ORDER BY m.invited_at DESC"
  ).bind(dev.person).all<any>();
  return json({ ok: true, invites: r.results });
}

export async function deleteSpace(req: Request, env: ControlEnv): Promise<Response> {
  const dev = await deviceOf(req, env);
  if (!dev) return json({ ok: false, error: "device nao pareado" }, 401);
  const { space_id } = await req.json<{ space_id?: string }>();
  const sp = await env.CTRL.prepare("SELECT owner FROM spaces WHERE id=?").bind(space_id).first<{ owner: string }>();
  if (!sp) return json({ ok: false, error: "espaco inexistente" }, 404);
  if (sp.owner !== dev.person) return json({ ok: false, error: "so o dono remove" }, 403);
  await env.CTRL.prepare("DELETE FROM members WHERE space_id=?").bind(space_id).run();
  await env.CTRL.prepare("DELETE FROM spaces WHERE id=?").bind(space_id).run();
  return json({ ok: true });
}

export async function leaveSpace(req: Request, env: ControlEnv): Promise<Response> {
  const dev = await deviceOf(req, env);
  if (!dev) return json({ ok: false, error: "device nao pareado" }, 401);
  const { space_id } = await req.json<{ space_id?: string }>();
  await env.CTRL.prepare("DELETE FROM members WHERE space_id=? AND person=?").bind(space_id, dev.person).run();
  return json({ ok: true });
}

export async function acceptSpace(req: Request, env: ControlEnv): Promise<Response> {
  const dev = await deviceOf(req, env);
  if (!dev) return json({ ok: false, error: "device nao pareado" }, 401);
  const { space_id } = await req.json<{ space_id?: string }>();
  const m = await env.CTRL.prepare("SELECT status FROM members WHERE space_id=? AND person=?").bind(space_id, dev.person).first<{ status: string }>();
  if (!m) return json({ ok: false, error: "sem convite para este espaco" }, 404);
  await env.CTRL.prepare("UPDATE members SET status='active' WHERE space_id=? AND person=?").bind(space_id, dev.person).run();
  return json({ ok: true, space_id });
}
