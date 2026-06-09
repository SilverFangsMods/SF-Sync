import { invoke } from "@tauri-apps/api/core";
import QRCode from "qrcode";

async function showTotp(uri: string, secret: string) {
  $("a-uri").setAttribute("href", uri);
  $("a-secret").textContent = secret;
  try { ($("a-qr") as HTMLImageElement).src = await QRCode.toDataURL(uri, { margin: 1, width: 220 }); } catch (e) { console.error("qr:", e); }
}

const WORKER = "https://sf-sync-lock.silverfangs.workers.dev";

// ───────── helpers ─────────
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const show = (id: string, on = true) => $(id).classList.toggle("hidden", !on);
const el = (tag: string, cls?: string, text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
async function api(path: string, body?: unknown, token?: string) {
  const r = await fetch(WORKER + path, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.json();
}
const initials = (s: string) => (s || "?").trim()[0]?.toUpperCase() || "?";
function colorFor(s: string) {
  const cols = ["#4fd1c5", "#7c8cff", "#e0a83c", "#56d364", "#e08080", "#c58bff"];
  let h = 0;
  for (const c of s || "") h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return cols[h % cols.length];
}
function avatar(person: string) {
  const a = el("div", "av", initials(person));
  a.style.background = colorFor(person);
  a.title = person;
  return a;
}

// ───────── tipos ─────────
type Preview = { to_remote: number; to_local: number; deletes: number; first: boolean; error: string | null };
type Progress = { pct: number; files: number };
type SpaceStatus = { id: string; name: string; kind: string; backend_kind: string; encrypted: boolean; local_path: string | null; remote_path: string | null; configured: boolean; activated: boolean; needs_gdrive_auth: boolean; pending: Preview | null; progress: Progress | null; owner?: string; members: { person: string; status: string }[] | string[] };
const BACKEND_LABEL: Record<string, string> = { r2: "☁ R2", nas: "🗄 NAS", gdrive: "▽ Drive" };
const previewText = (p: Preview) => p.first ? "1ª sincronização (baseline)" : `envia ${p.to_remote} · baixa ${p.to_local} · apaga ${p.deletes}`;
type Invite = { id: string; name: string; kind: string; invited_by: string | null };
type Status = { state: string; last: number | null; last_changes: number; conflicts: string[]; detail: string | null; paired: boolean; held: string[]; readonly: string[]; spaces: SpaceStatus[] };
type DevicesView = { person: string; this_device: string; devices: { device_id: string; name: string }[] };

let pending = { email: "", pass: "", code: "" };
let MY_EMAIL = "";
let spacesCache: SpaceStatus[] = [];

const setMsg = (id: string, t: string) => { $(id).textContent = t; };

// ───────── boot ─────────
async function boot() {
  let paired = false;
  try { paired = await invoke<boolean>("is_paired"); } catch (e) { console.error("is_paired:", e); }
  if (paired) enterApp();
  else { show("auth", true); resetAuth(); }
}

function resetAuth() {
  ["a-login", "a-register", "a-totp", "a-forgot", "a-codes", "a-recover"].forEach((i) => show(i, false));
  show("a-email-step", true);
  setMsg("a-msg", "");
}

// ───────── auth ─────────
$("a-continue").addEventListener("click", async () => {
  const email = $<HTMLInputElement>("a-email").value.trim().toLowerCase();
  if (!email.includes("@")) return setMsg("a-msg", "informe um e-mail válido");
  pending.email = email;
  setMsg("a-msg", "verificando…");
  const s = await api("/auth/status", { email });
  setMsg("a-msg", "");
  show("a-email-step", false);
  if (s.registered) show("a-login", true);
  else if (s.invited) { setMsg("a-msg", "Você tem acesso - crie sua conta."); show("a-register", true); }
  else { show("a-email-step", true); setMsg("a-msg", "Este e-mail não tem convite. Peça um convite ao dono."); }
});

$("a-google").addEventListener("click", async () => {
  setMsg("a-msg", "abrindo o Google no navegador - conclua por la e volte…");
  try {
    const g = await invoke<{ code: string; code_verifier: string; redirect_uri: string }>("google_login");
    const r = await api("/auth/google", g);
    if (!r.ok) return setMsg("a-msg", r.error || "falha no login Google");
    pending.email = r.email || pending.email;
    await doPair(r.token);
  } catch (e) { setMsg("a-msg", `Google: ${e}`); }
});

$("a-do-login").addEventListener("click", async () => {
  const r = await api("/auth/login", { email: pending.email, password: $<HTMLInputElement>("a-pass").value, code: $<HTMLInputElement>("a-code").value.trim() });
  if (!r.ok) return setMsg("a-msg", r.error || "falha no login");
  await doPair(r.token);
});

$("a-forgot-link").addEventListener("click", () => { show("a-login", false); show("a-forgot", true); setMsg("a-msg", ""); });

$("a-do-forgot").addEventListener("click", async () => {
  const r = await api("/auth/reset-password", { email: pending.email, code: $<HTMLInputElement>("a-fcode").value.trim(), password: $<HTMLInputElement>("a-fpass").value });
  if (!r.ok) return setMsg("a-msg", r.error || "falha ao redefinir");
  const lg = await api("/auth/login", { email: pending.email, password: $<HTMLInputElement>("a-fpass").value, code: $<HTMLInputElement>("a-fcode").value.trim() });
  if (!lg.ok) return setMsg("a-msg", "senha redefinida - faça login");
  await doPair(lg.token);
});

$("a-do-register").addEventListener("click", async () => {
  pending.pass = $<HTMLInputElement>("a-rpass").value;
  const r = await api("/auth/register", { email: pending.email, password: pending.pass, name: $<HTMLInputElement>("a-name").value.trim(), code: $<HTMLInputElement>("a-invite").value.trim() });
  if (!r.ok) return setMsg("a-msg", r.error || "falha no cadastro");
  await showTotp(r.totp_uri, r.totp_secret);
  show("a-register", false); show("a-totp", true); setMsg("a-msg", "");
});

$("a-do-totp").addEventListener("click", async () => {
  const code = $<HTMLInputElement>("a-totp-code").value.trim();
  const r = await api("/auth/totp-confirm", { email: pending.email, code });
  if (!r.ok) return setMsg("a-msg", r.error || "código inválido");
  pending.code = code;
  if (Array.isArray(r.recovery_codes)) {
    $("a-codes-list").textContent = r.recovery_codes.join("\n");
    show("a-totp", false); show("a-codes", true); setMsg("a-msg", "");
  } else {
    const lg = await api("/auth/login", { email: pending.email, password: pending.pass, code });
    if (lg.ok) await doPair(lg.token); else setMsg("a-msg", "conta criada - faça login");
  }
});

$("a-codes-ok").addEventListener("click", async () => {
  const lg = await api("/auth/login", { email: pending.email, password: pending.pass, code: pending.code });
  if (!lg.ok) return setMsg("a-msg", "conta criada - faça login");
  await doPair(lg.token);
});

$("a-lost-link").addEventListener("click", () => { show("a-login", false); show("a-recover", true); setMsg("a-msg", ""); });

$("a-do-recover").addEventListener("click", async () => {
  pending.pass = $<HTMLInputElement>("a-rec-pass").value;
  const r = await api("/auth/recover", { email: pending.email, password: pending.pass, code: $<HTMLInputElement>("a-rec-code").value.trim() });
  if (!r.ok) return setMsg("a-msg", r.error || "falha na recuperação");
  await showTotp(r.totp_uri, r.totp_secret);
  show("a-recover", false); show("a-totp", true); setMsg("a-msg", "Recadastre o autenticador com o novo QR/segredo.");
});

async function doPair(jwt: string) {
  const name = $<HTMLInputElement>("a-devname").value.trim() || "Meu PC";
  try { await invoke("pair_device", { jwt, name }); enterApp(); }
  catch (e) { setMsg("a-msg", `pareamento falhou: ${e}`); }
}

// ───────── app shell ─────────
async function enterApp() {
  show("auth", false); show("app", true);
  try { const d = await invoke<DevicesView>("list_devices"); MY_EMAIL = d.person; $("dev-name").textContent = d.devices.find(x => x.device_id === d.this_device)?.name || "este PC"; $("dev-sub").textContent = d.person; } catch {}
  nav("spaces");
  refreshStatus(); loadSpaces();
  setInterval(refreshStatus, 3000);
}

document.querySelector(".side")!.addEventListener("click", (e) => {
  const n = (e.target as HTMLElement).closest<HTMLElement>("[data-nav]");
  if (n) nav(n.dataset.nav!);
});

function nav(view: string) {
  document.querySelectorAll<HTMLElement>(".nav").forEach((n) => n.classList.toggle("on", n.dataset.nav === view));
  ["spaces", "connections", "devices", "invites", "convidar", "settings", "help"].forEach((v) => show(`view-${v}`, v === view));
  if (view === "spaces") loadSpaces();
  if (view === "connections") loadConnections();
  if (view === "devices") loadDevices();
  if (view === "invites") loadInvites();
}

// ───────── convidar (link de convite) ─────────
$("il-gen").addEventListener("click", async () => {
  const days = parseInt($<HTMLSelectElement>("il-days").value, 10);
  const uses = parseInt($<HTMLSelectElement>("il-uses").value, 10);
  setMsg("il-msg", "gerando…");
  try {
    const url = await invoke<string>("create_invite_link", { maxUses: uses, expiresDays: days });
    setMsg("il-msg", "");
    $<HTMLInputElement>("il-url").value = url;
    show("il-out", true);
  } catch (e) { setMsg("il-msg", `erro: ${e}`); }
});
$("il-copy").addEventListener("click", async () => {
  const inp = $<HTMLInputElement>("il-url");
  try { await navigator.clipboard.writeText(inp.value); } catch { inp.select(); document.execCommand("copy"); }
  $("il-copy").textContent = "Copiado ✓";
  setTimeout(() => { $("il-copy").textContent = "Copiar"; }, 1500);
});

// ───────── conexões ─────────
type Connection = { id: string; kind: string; label: string; detail: string };
let connCache: Connection[] = [];
const CONN_ICON: Record<string, string> = { gdrive: "▽", nas: "🗄" };

async function loadConnections() {
  try { connCache = await invoke<Connection[]>("list_connections"); } catch (e) { console.error(e); connCache = []; }
  const box = $("conn-list"); box.replaceChildren();
  if (!connCache.length) box.appendChild(el("p", "muted", "Nenhuma conexão ainda. Conecte o Google Drive ou um NAS acima."));
  for (const c of connCache) {
    const row = el("div", "row");
    const left = el("div"); left.append(el("b", undefined, `${CONN_ICON[c.kind] || ""} ${c.label}`), el("div", "muted small", c.detail || (c.kind === "gdrive" ? "Google Drive" : "NAS")));
    row.appendChild(left);
    const rm = el("button", "btn danger sm", "Remover");
    rm.addEventListener("click", async () => {
      if (!confirm(`Remover a conexão "${c.label}"? Espaços que a usam ficam sem destino até você reatribuir.`)) return;
      try { await invoke("remove_connection", { id: c.id }); loadConnections(); } catch (e) { alert(`erro: ${e}`); }
    });
    row.appendChild(rm); box.appendChild(row);
  }
}

$("conn-add-gdrive").addEventListener("click", async () => {
  setMsg("conn-msg", "abrindo o navegador… autorize o Google e volte (pode demorar).");
  try {
    const token = await invoke<string>("authorize_gdrive");
    await invoke("add_connection", { kind: "gdrive", label: "Google Drive", token, nasRoot: "" });
    setMsg("conn-msg", "Google Drive conectado ✓"); loadConnections();
  } catch (e) { setMsg("conn-msg", `falha: ${e}`); }
});

$("conn-add-nas").addEventListener("click", async () => {
  try {
    const root = await invoke<string | null>("pick_folder");
    if (!root) return;
    const label = "NAS " + root.split(/[\\/]/).filter(Boolean).pop();
    await invoke("add_connection", { kind: "nas", label, token: "", nasRoot: root });
    setMsg("conn-msg", "NAS adicionado ✓"); loadConnections();
  } catch (e) { setMsg("conn-msg", `falha: ${e}`); }
});

async function refreshStatus() {
  try {
    const s = await invoke<Status>("sync_status");
    $("state").textContent = s.detail ? `${s.state} - ${s.detail}` : s.state;
    $("last").textContent = s.last ? `· última: ${new Date(s.last * 1000).toLocaleTimeString()} (${s.last_changes} mud.)` : "";
    const parts: string[] = [];
    if (s.held?.length) parts.push(`editando: ${s.held.join(", ")}`);
    if (s.readonly?.length) parts.push(`🔒 só-leitura: ${s.readonly.join(", ")}`);
    $("locks").textContent = parts.join(" · ");
    const cf = $("conflicts"); cf.replaceChildren();
    show("conflicts", (s.conflicts?.length ?? 0) > 0);
    for (const c of s.conflicts || []) cf.appendChild(el("li", undefined, c));
    if (!$("view-spaces").classList.contains("hidden") && Array.isArray(s.spaces)) {
      spacesCache = s.spaces;
      renderGrid(s.spaces);
    }
  } catch (e) { console.error(e); }
}

// ───────── espaços ─────────
function renderGrid(spaces: SpaceStatus[]) {
  const g = $("grid"); g.replaceChildren();
  if (!spaces.length) { g.appendChild(el("p", "muted", "Nenhum espaço ainda. Clique em “＋ Novo sync”.")); return; }
  for (const sp of spaces) g.appendChild(spaceCard(sp));
}

async function loadSpaces() {
  try { spacesCache = await invoke<SpaceStatus[]>("list_spaces"); renderGrid(spacesCache); } catch (e) { console.error(e); }
  loadInvites(); // atualiza badge
}

function memberList(sp: SpaceStatus): string[] {
  return (sp.members || []).map((m: any) => (typeof m === "string" ? m : m.person));
}

function spaceCard(sp: SpaceStatus): HTMLElement {
  const card = el("div", "space");
  card.appendChild(el("div", "glow"));
  const top = el("div", "top");
  top.appendChild(el("h3", undefined, sp.name));
  top.appendChild(el("span", `kind ${sp.kind === "compartilhado" ? "comp" : "pess"}`, sp.kind));
  card.appendChild(top);
  const avs = el("div", "avatars");
  memberList(sp).forEach((m) => avs.appendChild(avatar(m)));
  card.appendChild(avs);
  if (sp.configured && sp.local_path) {
    const p = el("div", "path"); p.append("📁 " + sp.local_path); card.appendChild(p);
  } else {
    const p = el("div", "path warn"); p.append("⚠ definir caminho neste PC"); card.appendChild(p);
  }
  // estado: sem caminho / aguardando confirmação / pausado / sincronizando
  let label = "sem caminho", color = "#8a90a4";
  if (sp.configured && sp.pending) { label = "⚠ confirmar: " + previewText(sp.pending); color = "#e0a83c"; }
  else if (sp.configured && !sp.activated) { label = "pausado - revisar e ativar"; color = "#8a90a4"; }
  else if (sp.configured && sp.progress) { label = `sincronizando · ${sp.progress.pct}% (${sp.progress.files} arq.)`; color = "#4fd1c5"; }
  else if (sp.configured && sp.activated) { label = "ativo (em dia)"; color = "#56d364"; }
  const meta = el("div", "meta");
  const st = el("span"); const dot = el("span", "dot"); dot.style.background = color;
  st.append(dot, label);
  meta.append(st, el("span", undefined, BACKEND_LABEL[sp.backend_kind] || sp.backend_kind));
  card.appendChild(meta);
  card.addEventListener("click", () => openDetail(sp));
  return card;
}

// detalhe do espaço (definir caminho, conexão, convidar, sync)
async function openDetail(sp: SpaceStatus) {
  const isOwner = !!MY_EMAIL && sp.owner === MY_EMAIL;
  const w = $("wiz"); w.replaceChildren();
  w.appendChild(el("h2", undefined, sp.name));
  w.appendChild(el("p", "q", `${sp.kind} · ${memberList(sp).join(", ")}`));

  const isR2 = sp.backend_kind === "r2";
  w.appendChild(el("p", "muted small", `destino: ${BACKEND_LABEL[sp.backend_kind] || sp.backend_kind}${sp.encrypted ? " · cifrado" : ""}`));

  w.appendChild(el("label", undefined, "Pasta de trabalho neste PC"));
  const pick = el("div", "pathpick");
  const input = el("input") as HTMLInputElement;
  input.placeholder = "ainda não definida";
  if (sp.local_path) input.value = sp.local_path;
  const browse = el("button", "btn ghost sm", "Procurar…");
  browse.addEventListener("click", async () => { const p = await invoke<string | null>("pick_folder"); if (p) input.value = p; });
  pick.append(input, browse);
  w.appendChild(pick);

  let connSel: HTMLSelectElement | null = null;
  let subInput: HTMLInputElement | null = null;
  if (!isR2) {
    try { connCache = await invoke<Connection[]>("list_connections"); } catch {}
    const mine = connCache.filter((c) => c.kind === sp.backend_kind);
    w.appendChild(el("label", undefined, "Conexão"));
    connSel = el("select") as HTMLSelectElement;
    if (!mine.length) {
      const o = el("option", undefined, "- nenhuma; crie em Conexões -") as HTMLOptionElement; o.value = ""; connSel.appendChild(o);
    }
    for (const c of mine) {
      const o = el("option", undefined, `${CONN_ICON[c.kind] || ""} ${c.label}`) as HTMLOptionElement; o.value = c.id; connSel.appendChild(o);
    }
    w.appendChild(connSel);
    w.appendChild(el("label", undefined, "Pasta dentro da conexão"));
    subInput = el("input") as HTMLInputElement; subInput.placeholder = sp.id;
    w.appendChild(subInput);
  }

  const saveP = el("button", "btn sm full", "Salvar");
  saveP.addEventListener("click", async () => {
    try {
      await invoke("set_space_path", { id: sp.id, local: input.value.trim(), connectionId: connSel ? connSel.value : "", subpath: subInput ? subInput.value.trim() : "" });
      closeModal(); loadSpaces();
    } catch (e) { alert(`erro: ${e}`); }
  });
  w.appendChild(saveP);

  if (sp.kind === "compartilhado" && isOwner) {
    w.appendChild(el("label", undefined, "Convidar pessoa (e-mail)"));
    const ie = el("input") as HTMLInputElement; ie.placeholder = "pessoa@exemplo.com";
    w.appendChild(ie);
    const ib = el("button", "btn ghost sm full", "Enviar convite");
    ib.addEventListener("click", async () => {
      if (!ie.value.includes("@")) return;
      try {
        const r = await invoke<{ has_account: boolean; account_invite_code: string | null }>("invite_to_space", { id: sp.id, email: ie.value.trim().toLowerCase() });
        ie.value = ""; ib.textContent = "convite enviado ✓";
        if (!r.has_account && r.account_invite_code) {
          alert(`Essa pessoa ainda não tem conta no SF-Sync.\n\nCódigo de cadastro: ${r.account_invite_code}\n\nPeça pra ela usar este código ao criar a conta (ela também precisa aceitar o espaço depois).`);
        }
      } catch (e) { alert(`erro: ${e}`); }
    });
    w.appendChild(ib);
  }

  if (sp.configured) {
    const prev = el("p", "muted small"); prev.style.minHeight = "1em";
    if (sp.pending) { prev.textContent = "⚠ vai apagar - " + previewText(sp.pending); prev.style.color = "#e0a83c"; }
    w.appendChild(prev);

    if (sp.pending) {
      const confirmBtn = el("button", "btn sm full", "Confirmar e sincronizar (vai apagar)");
      confirmBtn.style.background = "#e0a83c";
      confirmBtn.addEventListener("click", async () => { try { await invoke("space_confirm", { id: sp.id }); closeModal(); loadSpaces(); } catch (e) { alert(`erro: ${e}`); } });
      const pause = el("button", "btn ghost sm full", "Pausar");
      pause.addEventListener("click", async () => { try { await invoke("space_pause", { id: sp.id }); closeModal(); loadSpaces(); } catch (e) { alert(`erro: ${e}`); } });
      w.append(confirmBtn, pause);
    } else if (!sp.activated) {
      const review = el("button", "btn ghost sm full", "Revisar (prévia do que vai acontecer)");
      review.addEventListener("click", async () => {
        review.textContent = "calculando…"; (review as HTMLButtonElement).disabled = true;
        try {
          const p = await invoke<Preview>("space_preview", { id: sp.id });
          prev.textContent = p.error ? `erro: ${p.error}` : `vai ${previewText(p)}`;
          prev.style.color = p.deletes > 0 ? "#e0a83c" : "#8a90a4";
        } catch (e) { prev.textContent = `erro: ${e}`; }
        review.textContent = "Revisar (prévia do que vai acontecer)"; (review as HTMLButtonElement).disabled = false;
      });
      const activate = el("button", "btn sm full", "Ativar e sincronizar");
      activate.addEventListener("click", async () => { try { await invoke("space_activate", { id: sp.id }); closeModal(); loadSpaces(); } catch (e) { alert(`erro: ${e}`); } });
      w.append(review, activate);
    } else {
      const pause = el("button", "btn ghost sm full", "Pausar sync");
      pause.addEventListener("click", async () => { try { await invoke("space_pause", { id: sp.id }); closeModal(); loadSpaces(); } catch (e) { alert(`erro: ${e}`); } });
      w.appendChild(pause);
    }
  }

  // --- remover / sair (NÃO apaga arquivos) ---
  const danger = el("button", "btn danger sm full", isOwner ? "Remover espaço" : "Sair do espaço");
  danger.style.marginTop = "12px";
  danger.addEventListener("click", async () => {
    if (!confirm(`${isOwner ? "Remover" : "Sair de"} "${sp.name}"?\n\nIsso NÃO apaga seus arquivos (nem locais nem no destino) - só desfaz o sync neste app.`)) return;
    try { await invoke(isOwner ? "delete_space" : "leave_space", { id: sp.id }); closeModal(); loadSpaces(); } catch (e) { alert(`erro: ${e}`); }
  });
  w.appendChild(danger);

  const act = el("div", "wact");
  const close = el("button", "btn ghost sm", "Fechar"); close.addEventListener("click", closeModal);
  act.append(close, el("span"));
  w.appendChild(act);
  $("modal").classList.add("on");
}

// ───────── wizard novo sync ─────────
$("new-sync").addEventListener("click", openWizard);
const W = { kind: "pessoal", backend: "", connectionId: "", encrypted: true, name: "", email: "", local: "", subpath: "", gdriveFolderId: "", folders: new Set<string>() };
const NSTEPS = 5;

async function openWizard() {
  W.kind = "pessoal"; W.backend = ""; W.connectionId = ""; W.encrypted = true; W.name = ""; W.email = ""; W.local = ""; W.subpath = ""; W.gdriveFolderId = ""; W.folders = new Set();
  try { connCache = await invoke<Connection[]>("list_connections"); } catch {}
  wizStep(1);
  $("modal").classList.add("on");
}
function bar(n: number) { return `<div class="steps">${Array.from({ length: NSTEPS }, (_, i) => `<div class="stp ${i < n ? "on" : ""}"></div>`).join("")}</div>`; }

function wizStep(n: number) {
  const w = $("wiz");
  if (n === 1) {
    w.innerHTML = bar(1) + `<h2>Sincronizar com quem?</h2><p class="q">Escolha o alcance deste espaço.</p>
      <div class="opt" data-who="self"><span class="emoji">👤</span><div><b>Comigo mesmo</b><small>entre os meus dispositivos</small></div></div>
      <div class="opt" data-who="invite"><span class="emoji">🤝</span><div><b>Convidar alguém</b><small>compartilhar com outra pessoa (por e-mail)</small></div></div>`;
    w.querySelectorAll<HTMLElement>("[data-who]").forEach((o) => o.addEventListener("click", () => { W.kind = o.dataset.who === "invite" ? "compartilhado" : "pessoal"; wizStep(2); }));
  } else if (n === 2) {
    const opts = connCache.map((c) => `<div class="opt" data-conn="${c.id}" data-kind="${c.kind}"><span class="emoji">${CONN_ICON[c.kind] || "📦"}</span><div><b>${c.label}</b><small>${c.detail || (c.kind === "gdrive" ? "Google Drive" : "NAS")}</small></div></div>`).join("");
    w.innerHTML = bar(2) + `<h2>Onde os arquivos ficam?</h2><p class="q">Escolha uma conexão (Google Drive ou NAS).</p>
      ${opts || `<p class="muted">Você ainda não tem conexões. Crie uma em “Conexões”.</p>`}
      <div class="wact"><button class="btn ghost sm" id="w-back">Voltar</button><button class="btn ghost sm" id="w-toconn">Ir para Conexões</button></div>`;
    $("w-back").addEventListener("click", () => wizStep(1));
    $("w-toconn").addEventListener("click", () => { closeModal(); nav("connections"); });
    w.querySelectorAll<HTMLElement>("[data-conn]").forEach((o) => o.addEventListener("click", () => {
      W.connectionId = o.dataset.conn!; W.backend = o.dataset.kind!; W.encrypted = W.backend !== "nas";
      wizStep(3);
    }));
  } else if (n === 3) {
    const inv = W.kind === "compartilhado";
    w.innerHTML = bar(3) + `<h2>Nome do espaço</h2><p class="q">${inv ? "Um espaço compartilhado." : "Um espaço entre os seus dispositivos."}</p>
      ${inv ? `<label>Convidar (e-mail) - opcional</label><input id="w-email" placeholder="pessoa@exemplo.com"/>` : ""}
      <label>Nome</label><input id="w-name" placeholder="ex.: Projetos, Fotos, Cervejaria"/>
      <div class="wact"><button class="btn ghost sm" id="w-back">Voltar</button><button class="btn sm" id="w-next">Próximo</button></div>`;
    if (W.name) ($("w-name") as HTMLInputElement).value = W.name;
    $("w-back").addEventListener("click", () => wizStep(2));
    $("w-next").addEventListener("click", () => {
      W.name = ($("w-name") as HTMLInputElement).value.trim();
      if (inv) W.email = ($("w-email") as HTMLInputElement).value.trim();
      if (!W.name) return;
      wizStep(4);
    });
  } else if (n === 4) {
    const encLabel = W.backend === "nas" ? "cifrar no NAS (ilegível fora do app)" : "cifrar no Drive (privado; Google não lê)";
    const sharedGd = W.backend === "gdrive" && W.kind === "compartilhado";
    w.innerHTML = bar(4) + `<h2>Onde fica neste PC?</h2><p class="q">A pasta de trabalho é só deste dispositivo.</p>
      <label>Pasta de trabalho</label>
      <div class="pathpick"><input id="w-local"/><button class="btn ghost sm" id="w-blocal">Procurar…</button></div>
      <label>Pasta dentro da conexão (destino)</label>
      <input id="w-subpath" placeholder="${W.name}"/>
      ${sharedGd ? `<label>ID da pasta compartilhada no Drive (do dono)</label><input id="w-gfid" placeholder="cole o ID da pasta do Google Drive"/><span class="pill">💡 crie uma pasta no SEU Drive, compartilhe com os convidados (Drive web) e cole aqui o ID (da URL da pasta)</span>` : ""}
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-top:10px"><input type="checkbox" id="w-enc" style="width:auto" ${W.encrypted ? "checked" : ""}/> ${encLabel}</label>
      <div class="wact"><button class="btn ghost sm" id="w-back">Voltar</button><button class="btn sm" id="w-next">Próximo</button></div>`;
    ($("w-local") as HTMLInputElement).placeholder = "C:\\Sync\\" + W.name;
    if (W.local) ($("w-local") as HTMLInputElement).value = W.local;
    ($("w-subpath") as HTMLInputElement).value = W.subpath || W.name;
    $("w-blocal").addEventListener("click", async () => { const p = await invoke<string | null>("pick_folder"); if (p) ($("w-local") as HTMLInputElement).value = p; });
    $("w-back").addEventListener("click", () => wizStep(3));
    $("w-next").addEventListener("click", () => {
      W.local = ($("w-local") as HTMLInputElement).value.trim();
      W.subpath = ($("w-subpath") as HTMLInputElement).value.trim();
      W.encrypted = ($("w-enc") as HTMLInputElement).checked;
      if (sharedGd) W.gdriveFolderId = ($("w-gfid") as HTMLInputElement).value.trim();
      if (!W.local) return;
      wizStep(5);
    });
  } else if (n === 5) {
    w.innerHTML = bar(5) + `<h2>Quais pastas?</h2><p class="q">Vazio = sincroniza tudo (100%, só fora .git e .secrets). ${W.kind === "compartilhado" ? "Compartilhado: respeita o .gitignore da pasta." : ""}</p>
      <div class="folders" id="w-fols"><p class="muted small" style="padding:8px">lendo pastas…</p></div>
      <div class="wact"><button class="btn ghost sm" id="w-back">Voltar</button><button class="btn" id="w-finish">✓ Criar espaço</button></div>`;
    $("w-back").addEventListener("click", () => wizStep(4));
    $("w-finish").addEventListener("click", finishWizard);
    invoke<string[]>("list_subfolders", { path: W.local }).then((subs) => {
      const box = $("w-fols"); box.replaceChildren();
      if (!subs.length) { box.appendChild(el("p", "muted small", "(sem subpastas - sincroniza a pasta inteira)")); return; }
      subs.forEach((f) => {
        const row = el("div", "fol");
        row.append(el("span", "chk", ""), document.createTextNode("📁 " + f));
        row.addEventListener("click", () => { row.classList.toggle("sel"); if (row.classList.contains("sel")) W.folders.add(f); else W.folders.delete(f); (row.firstChild as HTMLElement).textContent = row.classList.contains("sel") ? "✓" : ""; });
        box.appendChild(row);
      });
    });
  }
}

async function finishWizard() {
  try {
    const sp = await invoke<{ id: string }>("create_space", { name: W.name, kind: W.kind, folders: Array.from(W.folders), backendKind: W.backend, encrypted: W.encrypted, gdriveFolderId: W.gdriveFolderId });
    await invoke("set_space_path", { id: sp.id, local: W.local, connectionId: W.connectionId, subpath: W.subpath });
    if (W.kind === "compartilhado" && W.email.includes("@")) {
      try {
        const r = await invoke<{ has_account: boolean; account_invite_code: string | null }>("invite_to_space", { id: sp.id, email: W.email.toLowerCase() });
        if (r && !r.has_account && r.account_invite_code) {
          alert(`Convidado sem conta no SF-Sync.\n\nCódigo de cadastro: ${r.account_invite_code}\n\nEnvie à pessoa para ela criar a conta.`);
        }
      } catch {}
    }
    closeModal(); loadSpaces();
  } catch (e) { alert(`erro ao criar: ${e}`); }
}

// ───────── convites ─────────
async function loadInvites() {
  let invites: Invite[] = [];
  try { invites = await invoke<Invite[]>("list_invites"); } catch (e) { console.error(e); }
  const badge = $("inv-badge");
  badge.textContent = String(invites.length);
  show("inv-badge", invites.length > 0);
  const box = $("inv-list"); box.replaceChildren();
  if (!invites.length) box.appendChild(el("p", "muted", "Nenhum convite pendente."));
  for (const inv of invites) {
    const row = el("div", "row inv");
    const who = el("div", "who"); who.append(avatar(inv.invited_by || "?"));
    const info = el("div"); info.append(el("b", undefined, inv.name), el("div", "muted small", `${inv.invited_by ?? "?"} · ${inv.kind}`));
    who.appendChild(info); row.appendChild(who);
    const btn = el("button", "btn sm", "Aceitar e escolher pasta");
    btn.addEventListener("click", async () => {
      try { await invoke("accept_space", { id: inv.id }); nav("spaces"); const sp = spacesCache.find(s => s.id === inv.id) || { id: inv.id, name: inv.name, kind: inv.kind, local_path: null, configured: false, members: [] } as any; openDetail(sp); }
      catch (e) { alert(`erro: ${e}`); }
    });
    row.appendChild(btn); box.appendChild(row);
  }
}

// ───────── dispositivos ─────────
async function loadDevices() {
  const box = $("dev-list"); box.replaceChildren();
  try {
    const d = await invoke<DevicesView>("list_devices");
    for (const dev of d.devices) {
      const isSelf = dev.device_id === d.this_device;
      const row = el("div", "row");
      const who = el("div", "who"); who.append(avatar(d.person));
      const info = el("div"); info.append(el("b", undefined, dev.name + (isSelf ? " (este)" : "")), el("div", "muted small", d.person));
      who.appendChild(info); row.appendChild(who);
      const rm = el("button", "btn danger sm", isSelf ? "Desconectar este" : "Remover");
      rm.addEventListener("click", async () => {
        if (!confirm(`Remover "${dev.name}"?${isSelf ? "\n\nEste é o dispositivo atual - você será desconectado." : "\n\nO outro dispositivo perde o acesso (token revogado)."}`)) return;
        try {
          const wasSelf = await invoke<boolean>("revoke_device", { deviceId: dev.device_id });
          if (wasSelf) { show("app", false); show("auth", true); resetAuth(); }
          else loadDevices();
        } catch (e) { alert(`erro: ${e}`); }
      });
      row.appendChild(rm);
      box.appendChild(row);
    }
  } catch (e) { box.appendChild(el("p", "muted", `erro: ${e}`)); }
}

// ───────── ajustes ─────────
$("s-change").addEventListener("click", async () => {
  const r = await api("/auth/reset-password", { email: MY_EMAIL, code: $<HTMLInputElement>("s-code").value.trim(), password: $<HTMLInputElement>("s-pass").value });
  setMsg("s-msg", r.ok ? "senha alterada ✓" : (r.error || "falha"));
  if (r.ok) { ($("s-code") as HTMLInputElement).value = ""; ($("s-pass") as HTMLInputElement).value = ""; }
});
$("rc-gen").addEventListener("click", async () => {
  const r = await api("/auth/regen-codes", { email: MY_EMAIL, code: $<HTMLInputElement>("rc-code").value.trim() });
  if (!r.ok) { setMsg("rc-msg", r.error || "falha"); return; }
  $("rc-out").textContent = (r.recovery_codes || []).join("\n");
  show("rc-out", true);
  setMsg("rc-msg", "Guarde estes códigos; os antigos foram invalidados.");
  ($("rc-code") as HTMLInputElement).value = "";
});
$("s-logout").addEventListener("click", async () => {
  if (!confirm("Desconectar este dispositivo? Os espaços param de sincronizar aqui.")) return;
  try { await invoke("unpair"); show("app", false); show("auth", true); resetAuth(); } catch (e) { alert(`erro: ${e}`); }
});

// ───────── sync now (aba espaços) ─────────
$("sync-now").addEventListener("click", async () => { await invoke("sync_now"); setTimeout(refreshStatus, 1500); });

function closeModal() { $("modal").classList.remove("on"); }
$("modal").addEventListener("click", (e) => { if (e.target === $("modal")) closeModal(); });

boot();
