/// <reference types="@cloudflare/workers-types" />
import {
  authStatus, register, totpConfirm, login, resetPassword, recover, regenCodes, googleLogin, createInvite,
  createInviteLink, inviteLinkStatus, claimInviteLink,
  pairDevice, listDevices, revokeDevice,
  createSpace, listSpaces, spaceConfig, inviteMember, listSpaceInvites, acceptSpace,
  deleteSpace, leaveSpace,
} from "./control";
import { landingHtml, joinHtml, privacyHtml } from "./landing";

export interface Env {
  LOCKS: DurableObjectNamespace;
  CLIENTS: KVNamespace;
  CONFIG: KVNamespace;
  CTRL: D1Database;
  JWT_SECRET: string;
  MASTER_KEY: string;
  RESEND_API_KEY?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  DIST: R2Bucket;
}

interface Lock {
  holder: string;
  claimedAt: number;
  expiresAt: number;
}

const TTL_MS = 120_000;
const REAP_MS = 30_000;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    const url = new URL(req.url);
    const cp = url.pathname;

    const isGet = req.method === "GET" || req.method === "HEAD";
    if (isGet && (cp === "/" || cp === "/index.html")) {
      return new Response(landingHtml(), { headers: { "content-type": "text/html; charset=utf-8", ...CORS } });
    }
    if (isGet && cp === "/privacy") {
      return new Response(privacyHtml(), { headers: { "content-type": "text/html; charset=utf-8", ...CORS } });
    }
    if (isGet && cp === "/logo.webp") return serveAsset(env, "logo.webp", "image/webp");
    if (isGet && cp === "/applogo.webp") return serveAsset(env, "applogo.webp", "image/webp");
    if (isGet && cp === "/manual.pdf") return serveAsset(env, "Manual_SF-Sync.pdf", "application/pdf");
    if (isGet && cp === "/download") {
      return serveAsset(env, "SF-Sync-latest.msi", "application/x-msdownload", "SF-Sync.msi");
    }
    if (cp.startsWith("/join/")) {
      const token = decodeURIComponent(cp.slice("/join/".length));
      if (req.method === "POST") return claimInviteLink(req, env, token);
      if (req.method === "GET") {
        const st = await inviteLinkStatus(env, token);
        return new Response(joinHtml(token, st), { headers: { "content-type": "text/html; charset=utf-8", ...CORS } });
      }
    }

    if (req.method === "POST" && cp === "/auth/status") return authStatus(req, env);
    if (req.method === "POST" && cp === "/auth/register") return register(req, env);
    if (req.method === "POST" && cp === "/auth/totp-confirm") return totpConfirm(req, env);
    if (req.method === "POST" && cp === "/auth/login") return login(req, env);
    if (req.method === "POST" && cp === "/auth/reset-password") return resetPassword(req, env);
    if (req.method === "POST" && cp === "/auth/recover") return recover(req, env);
    if (req.method === "POST" && cp === "/auth/regen-codes") return regenCodes(req, env);
    if (req.method === "POST" && cp === "/auth/google") return googleLogin(req, env);
    if (req.method === "POST" && cp === "/invites/create") return createInvite(req, env);
    if (req.method === "POST" && cp === "/invites/link") return createInviteLink(req, env);
    if (req.method === "POST" && cp === "/devices/pair") return pairDevice(req, env);
    if (req.method === "GET" && cp === "/devices") return listDevices(req, env);
    if (req.method === "POST" && cp === "/devices/revoke") return revokeDevice(req, env);
    if (req.method === "POST" && cp === "/spaces/create") return createSpace(req, env);
    if (req.method === "GET" && cp === "/spaces") return listSpaces(req, env);
    if (req.method === "GET" && cp === "/spaces/config") return spaceConfig(req, env, url.searchParams.get("id") ?? "");
    if (req.method === "POST" && cp === "/spaces/invite") return inviteMember(req, env);
    if (req.method === "GET" && cp === "/spaces/invites") return listSpaceInvites(req, env);
    if (req.method === "POST" && cp === "/spaces/accept") return acceptSpace(req, env);
    if (req.method === "POST" && cp === "/spaces/delete") return deleteSpace(req, env);
    if (req.method === "POST" && cp === "/spaces/leave") return leaveSpace(req, env);

    const client = await clientFromToken(req, env);
    if (!client) return json({ ok: false, error: "unauthorized" }, 401);

    if (req.method === "GET" && url.pathname === "/config") {
      const cfg = await env.CONFIG.get<{ r2_conf?: string }>("shared", "json");
      if (!cfg) return json({ ok: false, error: "no_config" }, 404);
      const r2member = await env.CTRL
        .prepare("SELECT 1 FROM spaces s JOIN members m ON m.space_id=s.id WHERE s.backend_kind='r2' AND m.person=? LIMIT 1")
        .bind(client)
        .first();
      if (!r2member && cfg.r2_conf) {
        const { r2_conf: _omit, ...rest } = cfg;
        return json({ ok: true, client, config: rest });
      }
      return json({ ok: true, client, config: cfg });
    }

    const stub = env.LOCKS.get(env.LOCKS.idFromName("global"));
    const body = req.method === "POST" ? await req.text() : undefined;
    const fwd = new Request(`https://do${url.pathname}`, {
      method: req.method,
      headers: { "x-client": client, "content-type": "application/json" },
      body,
    });
    return stub.fetch(fwd);
  },
};

async function clientFromToken(req: Request, env: Env): Promise<string | null> {
  const m = (req.headers.get("authorization") ?? "").match(/^Bearer (.+)$/);
  if (!m) return null;
  const dev = await env.CTRL.prepare("SELECT person FROM devices WHERE token=?").bind(m[1]).first<{ person: string }>();
  return dev?.person ?? null;
}

export class LockRegistry {
  constructor(private state: DurableObjectState) {}

  async fetch(req: Request): Promise<Response> {
    const client = req.headers.get("x-client") ?? "";
    const { pathname } = new URL(req.url);
    if (req.method === "POST" && pathname === "/claim") return this.claim(req, client);
    if (req.method === "POST" && pathname === "/release") return this.release(req, client);
    if (req.method === "POST" && pathname === "/force-release") return this.forceRelease(req);
    if (req.method === "GET" && pathname === "/status") return this.status();
    return json({ ok: false, error: "not_found" }, 404);
  }

  private async product(req: Request): Promise<string> {
    const { product } = await req.json<{ product: string }>();
    return product;
  }

  private async claim(req: Request, client: string): Promise<Response> {
    const product = await this.product(req);
    const now = Date.now();
    const key = `lock:${product}`;
    const cur = await this.state.storage.get<Lock>(key);
    if (cur && cur.expiresAt > now && cur.holder !== client) {
      return json({ ok: false, reason: "held_by_other", held_by: cur.holder, expires_at: cur.expiresAt }, 409);
    }
    const lock: Lock = { holder: client, claimedAt: cur?.holder === client ? cur.claimedAt : now, expiresAt: now + TTL_MS };
    await this.state.storage.put(key, lock);
    await this.ensureAlarm();
    return json({ ok: true, ...lock });
  }

  private async release(req: Request, client: string): Promise<Response> {
    const product = await this.product(req);
    const key = `lock:${product}`;
    const cur = await this.state.storage.get<Lock>(key);
    if (!cur) return json({ ok: true, reason: "not_held" });
    if (cur.holder !== client) return json({ ok: false, reason: "held_by_other", held_by: cur.holder }, 409);
    await this.state.storage.delete(key);
    return json({ ok: true });
  }

  private async forceRelease(req: Request): Promise<Response> {
    const product = await this.product(req);
    await this.state.storage.delete(`lock:${product}`);
    return json({ ok: true, forced: true });
  }

  private async status(): Promise<Response> {
    const now = Date.now();
    const map = await this.state.storage.list<Lock>({ prefix: "lock:" });
    const locks = [];
    for (const [k, v] of map) {
      if (v.expiresAt > now) locks.push({ product: k.slice(5), holder: v.holder, claimed_at: v.claimedAt, expires_at: v.expiresAt });
    }
    return json({ ok: true, now, locks });
  }

  private async ensureAlarm(): Promise<void> {
    if ((await this.state.storage.getAlarm()) === null) {
      await this.state.storage.setAlarm(Date.now() + REAP_MS);
    }
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    const map = await this.state.storage.list<Lock>({ prefix: "lock:" });
    let active = 0;
    for (const [k, v] of map) {
      if (v.expiresAt <= now) await this.state.storage.delete(k);
      else active++;
    }
    if (active > 0) await this.state.storage.setAlarm(now + REAP_MS);
  }
}

export const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "authorization,content-type",
};

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", ...CORS } });
}

async function serveAsset(env: Env, key: string, contentType: string, downloadAs?: string): Promise<Response> {
  const obj = await env.DIST.get(key);
  if (!obj) return new Response("nao encontrado", { status: 404, headers: CORS });
  const headers = new Headers({ "content-type": contentType, "cache-control": "public, max-age=300", ...CORS });
  if (obj.httpEtag) headers.set("etag", obj.httpEtag);
  if (downloadAs) headers.set("content-disposition", `attachment; filename="${downloadAs}"`);
  return new Response(obj.body, { headers });
}
