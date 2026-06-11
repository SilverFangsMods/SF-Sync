# SF-Sync

Sincronizador de pastas multi-inquilino: mantém suas pastas iguais em vários
computadores, de forma automática e criptografada, e permite compartilhar pastas
com pessoas convidadas.

- **Backup vivo** - suas pastas sempre iguais entre os seus aparelhos.
- **Trabalho em conjunto** - pastas compartilhadas por convite.
- **Seguro** - verificação em duas etapas, criptografia em repouso e credenciais
  guardadas apenas no próprio dispositivo.

## Arquitetura

- **App de desktop (Windows):** Tauri 2 + Rust, residente na bandeja.
- **Motor de sincronização:** rclone bisync - baixa primeiro, mostra prévia e
  protege contra exclusões em massa.
- **Destinos:** Cloudflare R2, Google Drive ou NAS/pasta de rede.
- **Backend serverless:** Cloudflare Worker + D1 + Durable Object + R2.
- **Identidade própria:** e-mail + senha + TOTP (2FA) ou login com Google.

## Build

Pré-requisitos: [Rust](https://rustup.rs), [Bun](https://bun.sh) (ou Node) e a
[Tauri CLI](https://v2.tauri.app).

```bash
# App
bun install
bun run tauri dev      # desenvolvimento
bun run tauri build    # instalador (.msi)

# Worker
cd worker
bun install
bunx wrangler deploy
```

## Configuração

Segredos **nunca** ficam no repositório. No Worker, defina-os com
`wrangler secret put`:

| Secret | Uso |
| --- | --- |
| `JWT_SECRET` | sessão do app |
| `MASTER_KEY` | base64 de 32 bytes; cifra as chaves de criptografia dos espaços |
| `RESEND_API_KEY` | envio de convites por e-mail (opcional) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | login com Google (opcional) |

A conta Cloudflare é informada pela variável de ambiente
`CLOUDFLARE_ACCOUNT_ID` no momento do deploy.

## Licença

[MIT](LICENSE) © Silver Fangs
