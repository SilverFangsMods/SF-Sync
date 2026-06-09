export async function sendEmail(
  apiKey: string | undefined,
  to: string,
  subject: string,
  html: string,
  from = "SF-Sync <no-reply@silverfangs.com>"
): Promise<{ sent: boolean; error?: string }> {
  if (!apiKey) return { sent: false, error: "sem RESEND_API_KEY" };
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to, subject, html }),
    });
    if (!r.ok) return { sent: false, error: `resend ${r.status}` };
    return { sent: true };
  } catch (e: any) {
    return { sent: false, error: String(e?.message ?? e) };
  }
}

export function inviteAccountHtml(code: string, invitedBy: string): string {
  return `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto">
    <h2 style="color:#6d28d9">Convite para o SF-Sync</h2>
    <p>${escapeHtml(invitedBy)} convidou voce para o SF-Sync (sincronizacao de pastas).</p>
    <p>Seu codigo de cadastro:</p>
    <p style="font-size:24px;font-weight:700;letter-spacing:2px;background:#f4f4f5;padding:12px 16px;border-radius:8px;text-align:center">${escapeHtml(code)}</p>
    <p style="color:#71717a;font-size:13px">Abra o app SF-Sync, escolha "Tenho um convite" e informe este codigo com o seu e-mail.</p>
  </div>`;
}

export function inviteSpaceHtml(spaceName: string, invitedBy: string): string {
  return `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto">
    <h2 style="color:#6d28d9">Convite de sincronizacao</h2>
    <p>${escapeHtml(invitedBy)} quer compartilhar o espaco <b>${escapeHtml(spaceName)}</b> com voce no SF-Sync.</p>
    <p style="color:#71717a;font-size:13px">Abra o app SF-Sync &rarr; aba Espacos &rarr; Convites pendentes para aceitar e escolher onde sincronizar neste PC.</p>
  </div>`;
}

function escapeHtml(s: string): string {
  return (s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
