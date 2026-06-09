const te = new TextEncoder();
const td = new TextDecoder();

export function b64(buf: ArrayBuffer | Uint8Array): string {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const c of u) s += String.fromCharCode(c);
  return btoa(s);
}
export function unb64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}
const b64url = (b: ArrayBuffer | Uint8Array) => b64(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function aesKey(masterB64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", unb64(masterB64), "AES-GCM", false, ["encrypt", "decrypt"]);
}
export async function aesEnc(masterB64: string, plain: string): Promise<string> {
  const k = await aesKey(masterB64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, te.encode(plain)));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return b64(out);
}
export async function aesDec(masterB64: string, data: string): Promise<string> {
  const k = await aesKey(masterB64);
  const buf = unb64(data);
  return td.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: buf.slice(0, 12) }, k, buf.slice(12)));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt);
  return `${b64(salt)}$${b64(hash)}`;
}
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltB64, hashB64] = stored.split("$");
  if (!saltB64 || !hashB64) return false;
  const hash = await pbkdf2(password, unb64(saltB64));
  return b64(hash) === hashB64;
}
async function pbkdf2(password: string, salt: Uint8Array): Promise<ArrayBuffer> {
  const base = await crypto.subtle.importKey("raw", te.encode(password), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, base, 256);
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", te.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
export async function jwtSign(payload: object, secret: string, ttlSec = 8 * 3600): Promise<string> {
  const body = { ...payload, exp: Math.floor(Date.now() / 1000) + ttlSec };
  const head = b64url(te.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const pl = b64url(te.encode(JSON.stringify(body)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), te.encode(`${head}.${pl}`));
  return `${head}.${pl}.${b64url(sig)}`;
}
export async function jwtVerify(token: string, secret: string): Promise<any | null> {
  const [head, pl, sig] = token.split(".");
  if (!head || !pl || !sig) return null;
  const ok = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret),
    unb64(sig.replace(/-/g, "+").replace(/_/g, "/")),
    te.encode(`${head}.${pl}`)
  );
  if (!ok) return null;
  const body = JSON.parse(td.decode(unb64(pl.replace(/-/g, "+").replace(/_/g, "/"))));
  if (body.exp && body.exp < Math.floor(Date.now() / 1000)) return null;
  return body;
}

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function totpSecret(): string {
  const r = crypto.getRandomValues(new Uint8Array(20));
  let bits = "";
  for (const b of r) bits += b.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}
function b32decode(s: string): Uint8Array {
  let bits = "";
  for (const c of s.toUpperCase().replace(/=+$/, "")) {
    const v = B32.indexOf(c);
    if (v < 0) continue;
    bits += v.toString(2).padStart(5, "0");
  }
  const out = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  return out;
}
async function hotp(secret: Uint8Array, counter: number): Promise<string> {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setUint32(4, counter);
  const key = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const h = new Uint8Array(await crypto.subtle.sign("HMAC", key, buf));
  const o = h[19] & 0xf;
  const code = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return (code % 1_000_000).toString().padStart(6, "0");
}
export async function totpVerify(secretB32: string, code: string): Promise<boolean> {
  const secret = b32decode(secretB32);
  const t = Math.floor(Date.now() / 1000 / 30);
  for (let w = -1; w <= 1; w++) {
    if ((await hotp(secret, t + w)) === code.trim()) return true;
  }
  return false;
}
export function totpUri(email: string, secretB32: string): string {
  return `otpauth://totp/SF-Sync:${encodeURIComponent(email)}?secret=${secretB32}&issuer=SF-Sync`;
}

export function genCryptKey(): string {
  return b64(crypto.getRandomValues(new Uint8Array(32)));
}

const RC = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function genRecoveryCodes(n = 10): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const r = crypto.getRandomValues(new Uint8Array(8));
    let s = "";
    for (const b of r) s += RC[b % RC.length];
    out.push(`${s.slice(0, 4)}-${s.slice(4)}`);
  }
  return out;
}
export async function sha256hex(s: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", te.encode(s.trim().toUpperCase())));
  return Array.from(h).map((b) => b.toString(16).padStart(2, "0")).join("");
}
