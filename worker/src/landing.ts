const VERSION = "0.1.17";

const PAGE_HEAD = `<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  :root{--bg:#0d0f13;--panel:#161a21;--panel2:#1c212b;--line:#2a313d;--txt:#e8ebf1;--muted:#99a3b3;--accent:#7c5cff;--accent2:#a78bfa;--silver:#cdd5e0;--ok:#34d399;--err:#f87171}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--txt);font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.6}
  a{color:var(--accent2);text-decoration:none} a:hover{text-decoration:underline}
  .card{max-width:460px;margin:8vh auto;background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:34px 30px;text-align:center}
  .card img.logo{height:54px;margin:0 auto 20px;display:block}
  .card h1{font-size:1.5rem;margin:.2em 0 .1em}
  .card p{color:var(--muted);margin:.5em 0}
  label{display:block;text-align:left;font-size:.85rem;color:var(--muted);margin:14px 0 5px}
  input{width:100%;padding:12px 14px;border-radius:10px;border:1px solid var(--line);background:#11151c;color:var(--txt);font-size:1rem}
  .btn{display:inline-flex;align-items:center;justify-content:center;gap:9px;width:100%;margin-top:16px;background:var(--accent);color:#fff;font-weight:700;font-size:1rem;padding:13px;border-radius:11px;border:0;cursor:pointer}
  .btn:hover{filter:brightness(1.07);text-decoration:none}
  .btn.ghost{background:transparent;border:1px solid var(--line);color:var(--txt)}
  .msg{margin-top:14px;font-size:.92rem}
  .msg.err{color:var(--err)} .msg.ok{color:var(--ok)}
  .code{font-size:1.3rem;font-weight:700;letter-spacing:3px;background:#11151c;border:1px solid var(--line);padding:10px;border-radius:10px;margin:8px 0}
  .foot{margin-top:22px;font-size:.8rem;color:var(--muted)}
  .hidden{display:none}
  ol{text-align:left;color:var(--silver);font-size:.92rem;padding-left:20px}
  ol li{margin:.35em 0}
</style>`;

export function joinHtml(token: string, status: { ok: boolean; reason?: string }): string {
  const safeToken = token.replace(/[^A-Za-z0-9_-]/g, "");
  if (!status.ok) {
    return `<!doctype html><html lang="pt-BR"><head><title>Convite &middot; SF-Sync</title>${PAGE_HEAD}</head><body>
<div class="card">
  <a href="https://silverfangs.com"><img class="logo" src="/logo.webp?v=3" alt="Silver Fangs" /></a>
  <h1>Convite indisponivel</h1>
  <p>${escapeText(status.reason || "Este link nao e valido.")}</p>
  <a class="btn ghost" href="/">Ir para a pagina do SF-Sync</a>
</div></body></html>`;
  }
  return `<!doctype html><html lang="pt-BR"><head><title>Voce foi convidado &middot; SF-Sync</title>${PAGE_HEAD}</head><body>
<div class="card">
  <a href="https://silverfangs.com"><img class="logo" src="/logo.webp?v=3" alt="Silver Fangs" /></a>
  <h1>Voce foi convidado para o SF-Sync</h1>
  <p>Informe seu e-mail para liberar seu acesso. Depois e so baixar o app e entrar.</p>

  <div id="form">
    <label for="email">Seu e-mail</label>
    <input id="email" type="email" placeholder="voce@exemplo.com" autocomplete="email" />
    <button class="btn" id="go">Liberar meu acesso</button>
    <div class="msg err hidden" id="err"></div>
  </div>

  <div id="done" class="hidden">
    <p class="msg ok">Acesso liberado! &#9989;</p>
    <ol>
      <li><b>Baixe e instale</b> o SF-Sync.</li>
      <li>Abra o app, digite <b id="who"></b> e clique em <b>Entrar com Google</b> (sem codigo).</li>
      <li>Prefere senha? No app escolha criar conta e use o codigo abaixo.</li>
    </ol>
    <div class="code" id="code"></div>
    <a class="btn" href="/download"><span>&#11015;</span> Baixar para Windows</a>
    <a class="btn ghost" href="/manual.pdf">Ver o manual (PDF)</a>
  </div>

  <div id="already" class="hidden">
    <p class="msg ok">Voce ja tem conta no SF-Sync.</p>
    <p>E so abrir o app e entrar normalmente (Entrar com Google ou e-mail e senha).</p>
    <a class="btn" href="/download"><span>&#11015;</span> Baixar para Windows</a>
  </div>

  <div class="foot">SF-Sync &middot; Silver Fangs</div>
</div>
<script>
  var TOKEN = ${JSON.stringify(safeToken)};
  var go = document.getElementById("go");
  go.addEventListener("click", async function(){
    var email = document.getElementById("email").value.trim();
    var err = document.getElementById("err");
    err.classList.add("hidden");
    if(!email || email.indexOf("@")<0){ err.textContent="Informe um e-mail valido."; err.classList.remove("hidden"); return; }
    go.disabled = true; go.textContent = "Liberando...";
    try{
      var r = await fetch("/join/"+TOKEN, {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email:email})});
      var j = await r.json();
      if(!j.ok){ err.textContent = j.error || "Falhou. Tente de novo."; err.classList.remove("hidden"); go.disabled=false; go.textContent="Liberar meu acesso"; return; }
      document.getElementById("form").classList.add("hidden");
      if(j.already){ document.getElementById("already").classList.remove("hidden"); return; }
      document.getElementById("who").textContent = j.email;
      document.getElementById("code").textContent = j.code;
      document.getElementById("done").classList.remove("hidden");
    }catch(e){ err.textContent="Erro de rede. Tente de novo."; err.classList.remove("hidden"); go.disabled=false; go.textContent="Liberar meu acesso"; }
  });
  document.getElementById("email").addEventListener("keydown", function(e){ if(e.key==="Enter") go.click(); });
</script>
</body></html>`;
}

function escapeText(s: string): string {
  return (s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

const PRIVACY_CONTACT = "privacidade@silverfangs.com";

export function privacyHtml(): string {
  return `<!doctype html><html lang="pt-BR"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Politica de Privacidade &middot; SF-Sync</title>
<style>
  :root{--bg:#0d0f13;--panel:#161a21;--panel2:#1c212b;--line:#2a313d;--txt:#e8ebf1;--muted:#99a3b3;--accent:#7c5cff;--accent2:#a78bfa;--silver:#cdd5e0}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--txt);font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.65}
  a{color:var(--accent2);text-decoration:none} a:hover{text-decoration:underline}
  .wrap{max-width:760px;margin:0 auto;padding:0 22px}
  header{text-align:center;padding:40px 0 26px;border-bottom:1px solid var(--line)}
  header img{height:46px;margin-bottom:10px}
  header h1{font-size:1.7rem;margin:.2em 0 .1em}
  header .upd{color:var(--muted);font-size:.86rem}
  main{padding:24px 0 10px}
  h2{font-size:1.12rem;margin:26px 0 .4em;padding-top:16px;border-top:1px solid var(--line)}
  h2:first-of-type{border-top:0;padding-top:0}
  p,li{color:var(--silver)} p{margin:.5em 0}
  ul{padding-left:20px} li{margin:.3em 0}
  .lead{color:var(--muted)}
  code{background:#11151c;border:1px solid var(--line);padding:1px 6px;border-radius:6px;font-size:.86em}
  blockquote{margin:1em 0;padding:12px 16px;background:var(--panel2);border-left:3px solid var(--accent);border-radius:0 10px 10px 0}
  footer{margin-top:40px;border-top:1px solid var(--line);background:#0a0c10;padding:24px 0 36px}
  footer .wrap{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}
  footer img{height:26px;opacity:.9}
  footer .links a{color:var(--silver);margin-left:16px;font-size:.9rem}
</style></head>
<body>
<header><div class="wrap">
  <a href="https://silverfangs.com"><img src="/logo.webp?v=3" alt="Silver Fangs" /></a>
  <h1>Politica de Privacidade do SF-Sync</h1>
  <div class="upd">Ultima atualizacao: 9 de junho de 2026</div>
</div></header>

<div class="wrap"><main>
  <p class="lead">O SF-Sync e um aplicativo da Silver Fangs que sincroniza pastas entre os computadores do usuario e, quando ele escolhe, com pessoas convidadas. Esta politica explica quais dados tratamos, por que e como os protegemos.</p>

  <h2>1. Dados que coletamos</h2>
  <ul>
    <li><b>Conta:</b> seu e-mail, nome de exibicao, uma versao protegida (hash) da senha e o segredo da verificacao em duas etapas (2FA).</li>
    <li><b>Dispositivos:</b> um identificador e o nome que voce da a cada computador conectado a sua conta.</li>
    <li><b>Conteudo sincronizado:</b> os arquivos das pastas que voce escolhe sincronizar. Eles trafegam e ficam <b>criptografados</b> no destino que voce seleciona (R2, NAS ou Google Drive); a Silver Fangs nao le o conteudo dos seus arquivos.</li>
    <li><b>Convites:</b> o e-mail de quem voce convida, para liberar o acesso.</li>
  </ul>

  <h2>2. Entrar com Google</h2>
  <p>Se voce optar por "Entrar com Google", recebemos do Google apenas as informacoes basicas de identidade dos escopos <code>openid</code>, <code>email</code> e <code>profile</code> (seu e-mail, nome e foto de perfil), usadas <b>somente para autenticar</b> voce e criar/entrar na sua conta. Esses escopos <b>nao dao acesso aos seus arquivos do Google Drive</b>.</p>
  <p>A conexao opcional com o Google Drive para sincronizar seus proprios arquivos e separada, autorizada por voce dentro do app, e usada exclusivamente para mover os arquivos que voce mesmo escolheu.</p>

  <h2>3. Como usamos os dados</h2>
  <ul>
    <li>Operar o servico de sincronizacao e o compartilhamento que voce solicitar.</li>
    <li>Autenticar voce e proteger sua conta (senha + 2FA).</li>
    <li>Enviar e-mails operacionais, como convites que voce dispara.</li>
  </ul>
  <p>Nao usamos seus dados para publicidade e <b>nao vendemos</b> dados a ninguem.</p>

  <h2>4. Onde guardamos e como protegemos</h2>
  <ul>
    <li>Dados de conta ficam na infraestrutura da Cloudflare (banco de dados gerenciado).</li>
    <li>As chaves de criptografia dos espacos sao guardadas cifradas; o conteudo e envolvido por criptografia antes de ir ao destino.</li>
    <li>As credenciais de acesso ficam <b>apenas no seu computador</b>, protegidas pelo cofre do proprio Windows.</li>
    <li>Verificacao em duas etapas (2FA) obrigatoria na conta.</li>
  </ul>

  <h2>5. Com quem compartilhamos</h2>
  <p>Nao compartilhamos seus dados, exceto com os provedores de infraestrutura estritamente necessarios para o servico funcionar: <b>Cloudflare</b> (hospedagem e banco), <b>Google</b> (login e, se voce ligar, Google Drive) e <b>Resend</b> (envio de e-mails). Cada um trata os dados apenas para prestar esse servico.</p>

  <h2>6. Uso limitado (Google API Services)</h2>
  <blockquote>O uso, pelo SF-Sync, das informacoes recebidas das APIs do Google obedece a <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>, incluindo os requisitos de Uso Limitado (Limited Use).</blockquote>

  <h2>7. Retencao e exclusao</h2>
  <p>Voce pode, a qualquer momento, remover um dispositivo da sua conta dentro do app. Para excluir sua conta e os dados associados, basta solicitar pelo contato abaixo; atendemos a remocao em prazo razoavel. O conteudo sincronizado e seu e permanece no destino que voce controla.</p>

  <h2>8. Seus direitos</h2>
  <p>Conforme a legislacao aplicavel (incluindo a LGPD, no Brasil), voce pode solicitar acesso, correcao ou exclusao dos seus dados pessoais, e revogar consentimentos. Use o contato abaixo.</p>

  <h2>9. Alteracoes</h2>
  <p>Podemos atualizar esta politica. A data de "ultima atualizacao" no topo reflete a versao vigente.</p>

  <h2>10. Contato</h2>
  <p>Duvidas ou solicitacoes sobre privacidade: <a href="mailto:${PRIVACY_CONTACT}">${PRIVACY_CONTACT}</a>.</p>
</main></div>

<footer><div class="wrap">
  <a href="https://silverfangs.com"><img src="/logo.webp?v=3" alt="Silver Fangs" /></a>
  <div class="links">
    <a href="/">Inicio</a>
    <a href="/download">Baixar</a>
    <a href="https://silverfangs.com">Pagina principal</a>
  </div>
</div></footer>
</body></html>`;
}

export function landingHtml(): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>SF-Sync &middot; Silver Fangs</title>
<meta name="description" content="SF-Sync: mantenha suas pastas iguais em todos os seus computadores, de forma automatica e segura." />
<style>
  :root{
    --bg:#0d0f13; --panel:#161a21; --panel2:#1c212b; --line:#2a313d;
    --txt:#e8ebf1; --muted:#99a3b3; --accent:#7c5cff; --accent2:#a78bfa; --silver:#cdd5e0;
  }
  *{box-sizing:border-box}
  html{scroll-behavior:smooth}
  body{margin:0;background:var(--bg);color:var(--txt);font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.65}
  a{color:var(--accent2);text-decoration:none}
  a:hover{text-decoration:underline}
  .wrap{max-width:860px;margin:0 auto;padding:0 22px}

  header.hero{
    background:radial-gradient(1100px 420px at 50% -120px, rgba(124,92,255,.20), transparent 70%);
    border-bottom:1px solid var(--line);
    padding:56px 0 48px;text-align:center;
  }
  .hero img.logo{height:64px;width:auto;display:block;margin:0 auto 18px}
  .hero h1{font-size:2.3rem;margin:.1em 0 .15em;letter-spacing:.5px}
  .hero .tag{color:var(--muted);font-size:1.06rem;max-width:560px;margin:0 auto 26px}
  .cta{display:inline-flex;align-items:center;gap:10px;background:var(--accent);color:#fff;
    font-weight:700;font-size:1.05rem;padding:14px 26px;border-radius:12px;border:0;cursor:pointer;
    box-shadow:0 8px 24px rgba(124,92,255,.35);transition:transform .08s ease, box-shadow .2s ease}
  .cta:hover{transform:translateY(-1px);box-shadow:0 10px 30px rgba(124,92,255,.45);text-decoration:none}
  .cta .ic{font-size:1.2rem}
  .meta{color:var(--muted);font-size:.86rem;margin-top:14px}
  .meta a{color:var(--muted);text-decoration:underline}

  .pillars{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:38px 0 8px}
  .pillar{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:18px}
  .pillar h3{margin:.1em 0 .3em;font-size:1.02rem}
  .pillar p{margin:0;color:var(--muted);font-size:.92rem}

  .toc{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:18px 22px;margin:34px 0}
  .toc h2{margin:.1em 0 .5em;font-size:1.05rem}
  .toc ol{margin:0;padding-left:20px;columns:2;column-gap:30px}
  .toc li{margin:3px 0;color:var(--silver)}

  main section{padding-top:18px;margin-top:18px;border-top:1px solid var(--line)}
  main section:first-of-type{border-top:0}
  h2.sec{font-size:1.28rem;margin:.4em 0 .4em}
  h2.sec .n{color:var(--accent2);font-weight:700;margin-right:8px}
  main p{margin:.5em 0}
  main ul,main ol{margin:.5em 0;padding-left:22px}
  main li{margin:.28em 0}
  code{background:#11151c;border:1px solid var(--line);padding:1px 6px;border-radius:6px;font-size:.86em;color:var(--silver)}
  blockquote{margin:.8em 0;padding:10px 16px;background:var(--panel2);border-left:3px solid var(--accent);border-radius:0 10px 10px 0;color:var(--silver)}
  table{width:100%;border-collapse:collapse;margin:.6em 0;font-size:.95rem}
  th,td{text-align:left;padding:9px 12px;border-bottom:1px solid var(--line)}
  th{color:var(--muted);font-weight:600}

  .download-strip{background:var(--panel);border:1px solid var(--line);border-radius:14px;
    padding:22px;margin:36px 0 10px;display:flex;align-items:center;justify-content:space-between;gap:18px;flex-wrap:wrap}
  .download-strip .t{font-weight:600}
  .download-strip .s{color:var(--muted);font-size:.9rem}

  footer{margin-top:54px;border-top:1px solid var(--line);background:#0a0c10;padding:30px 0 40px}
  footer .wrap{display:flex;align-items:center;justify-content:space-between;gap:18px;flex-wrap:wrap}
  footer img{height:30px;width:auto;opacity:.92}
  footer .copy{color:var(--muted);font-size:.86rem}
  footer .links a{color:var(--silver);margin-left:18px;font-size:.9rem}

  @media (max-width:640px){
    .pillars{grid-template-columns:1fr}
    .toc ol{columns:1}
    .hero h1{font-size:1.9rem}
  }
</style>
</head>
<body>

<header class="hero">
  <div class="wrap">
    <a href="https://silverfangs.com" title="Silver Fangs"><img class="logo" src="/logo.webp?v=3" alt="Silver Fangs" /></a>
    <h1>SF-Sync</h1>
    <p class="tag">Mantenha suas pastas iguais em todos os seus computadores, de forma automatica e segura.</p>
    <a class="cta" href="/download"><span class="ic">&#11015;</span> Baixar para Windows</a>
    <div class="meta">Versao ${VERSION} &middot; instalador assinado (.msi) &middot; <a href="/manual.pdf">Manual em PDF</a></div>
  </div>
</header>

<div class="wrap">

  <div class="pillars">
    <div class="pillar"><h3>Backup vivo</h3><p>Suas pastas sempre iguais entre os seus aparelhos, sem pen drive nem anexo.</p></div>
    <div class="pillar"><h3>Trabalho em conjunto</h3><p>Compartilhe pastas com quem voce escolher, de forma sincronizada.</p></div>
    <div class="pillar"><h3>Tranquilidade</h3><p>Senha, verificacao em duas etapas e criptografia cuidando de tudo.</p></div>
  </div>

  <nav class="toc">
    <h2>Manual de instalacao e uso</h2>
    <ol>
      <li><a href="#s1">O que e o SF-Sync</a></li>
      <li><a href="#s2">Antes de comecar</a></li>
      <li><a href="#s3">Instalando no Windows</a></li>
      <li><a href="#s4">Criando sua conta</a></li>
      <li><a href="#s5">Entrar com Google</a></li>
      <li><a href="#s6">Conectando outro computador</a></li>
      <li><a href="#s7">A tela principal</a></li>
      <li><a href="#s8">Conexoes</a></li>
      <li><a href="#s9">Criando um espaco</a></li>
      <li><a href="#s10">Como a sincronizacao funciona</a></li>
      <li><a href="#s11">Compartilhando uma pasta</a></li>
      <li><a href="#s12">Recebendo um compartilhamento</a></li>
      <li><a href="#s13">Seus dispositivos</a></li>
      <li><a href="#s14">Conta e seguranca</a></li>
      <li><a href="#s15">O icone perto do relogio</a></li>
      <li><a href="#s16">Suas informacoes protegidas</a></li>
      <li><a href="#s17">Perguntas frequentes</a></li>
      <li><a href="#s18">Glossario rapido</a></li>
    </ol>
  </nav>

  <main>
    <section id="s1"><h2 class="sec"><span class="n">1</span>O que e o SF-Sync</h2>
      <p>O SF-Sync e um programa que mantem as <b>mesmas pastas iguais em varios computadores</b>. Voce trabalha em um arquivo no computador do escritorio e, pouco depois, ele aparece atualizado no computador de casa, sem precisar copiar nada em pen drive ou anexar em e-mail.</p>
      <p>Ele tambem permite <b>compartilhar pastas com outras pessoas</b>: voce escolhe uma pasta, indica com quem quer dividir, e o conteudo passa a ficar sincronizado entre voces.</p>
      <ul>
        <li><b>Seu proprio backup vivo:</b> suas pastas sempre iguais entre os seus aparelhos.</li>
        <li><b>Trabalho em conjunto:</b> pastas compartilhadas com quem voce escolher.</li>
        <li><b>Tranquilidade:</b> tudo protegido por senha, verificacao em duas etapas e criptografia.</li>
      </ul>
      <blockquote>O programa fica discreto, rodando perto do relogio (a area de notificacao do Windows), e trabalha sozinho em segundo plano.</blockquote>
    </section>

    <section id="s2"><h2 class="sec"><span class="n">2</span>Antes de comecar</h2>
      <ul>
        <li>Um computador com <b>Windows</b> e um <b>e-mail</b> valido.</li>
        <li>Um <b>aplicativo autenticador</b> no celular (Google Authenticator, Microsoft Authenticator ou similar). Ele gera um codigo de seis numeros que muda a cada 30 segundos e funciona como segunda chave da sua conta (a verificacao em duas etapas).</li>
        <li>Se for usar <b>Google Drive</b> como espaco na nuvem, tenha sua conta Google a mao.</li>
      </ul>
      <p>Reserve cinco minutinhos para o primeiro acesso. Depois disso, o programa cuida de quase tudo sozinho.</p>
    </section>

    <section id="s3"><h2 class="sec"><span class="n">3</span>Instalando no Windows</h2>
      <ol>
        <li>Baixe o instalador (botao no topo desta pagina), com nome parecido com <code>SF-Sync_${VERSION}_x64_en-US.msi</code>.</li>
        <li>De dois cliques nele.</li>
        <li>Se o Windows perguntar se voce confia no programa, confirme: o instalador e <b>assinado digitalmente pela Silver Fangs</b>, entao e seguro prosseguir.</li>
        <li>Avance ate o fim e clique em <b>Concluir</b>.</li>
      </ol>
      <p>Pronto. O SF-Sync ja inicia junto com o Windows e fica esperando perto do relogio.</p>
      <blockquote><b>Dica:</b> abrir o atalho na area de trabalho apenas abre a janela do programa. Ele nunca cria duas copias abertas ao mesmo tempo.</blockquote>
    </section>

    <section id="s4"><h2 class="sec"><span class="n">4</span>Primeiro acesso: criando sua conta</h2>
      <p>Ao abrir o programa pela primeira vez, aparece a tela <b>"Conectar este dispositivo"</b>.</p>
      <ol>
        <li>Digite seu <b>e-mail</b> e clique em <b>Continuar</b>.</li>
        <li>Como ainda nao existe conta para esse e-mail, preencha <b>Nome</b>, <b>Senha</b> (min. 8) e o <b>Codigo do convite</b> (deixe vazio se voce e o primeiro dono). Clique em <b>Criar conta</b>.</li>
        <li>Aponte o app autenticador para o <b>QR Code</b> da tela (ou digite o codigo secreto), informe o codigo de seis numeros e clique em <b>Confirmar 2FA</b>.</li>
        <li><b>Guarde os codigos de recuperacao</b> em lugar seguro (cada um vale uma vez, caso perca o celular) e clique em <b>Guardei - continuar</b>.</li>
      </ol>
      <blockquote><b>Atencao:</b> confira o campo "Nome deste dispositivo" (ex.: "Notebook do escritorio") para reconhecer cada aparelho depois.</blockquote>
    </section>

    <section id="s5"><h2 class="sec"><span class="n">5</span>Entrar com Google (atalho)</h2>
      <p>Na tela inicial existe o botao <b>"Entrar com Google"</b>.</p>
      <ol>
        <li>Clique nele.</li>
        <li>O navegador abre na tela de login do Google. Escolha sua conta e autorize.</li>
        <li>Volte para o SF-Sync: ele reconhece o login e conecta o computador.</li>
      </ol>
      <p>E uma forma mais rapida de entrar, sem digitar senha. Funciona para contas que ja existem ou que foram convidadas.</p>
    </section>

    <section id="s6"><h2 class="sec"><span class="n">6</span>Conectando outro computador a mesma conta</h2>
      <ol>
        <li>Instale o programa no outro PC.</li>
        <li>Na tela "Conectar este dispositivo", digite o <b>mesmo e-mail</b> e clique em <b>Continuar</b>.</li>
        <li>Informe a <b>senha</b> e o <b>codigo 2FA</b> do autenticador.</li>
        <li>Clique em <b>Entrar e parear</b>.</li>
      </ol>
      <p>Esse computador passa a fazer parte da sua conta e aparece depois na secao Dispositivos.</p>
    </section>

    <section id="s7"><h2 class="sec"><span class="n">7</span>Conhecendo a tela principal</h2>
      <table>
        <tr><th>Atalho</th><th>Para que serve</th></tr>
        <tr><td>&#128451; <b>Espacos</b></td><td>Suas pastas sincronizadas. Onde voce passa a maior parte do tempo.</td></tr>
        <tr><td>&#128268; <b>Conexoes</b></td><td>Onde voce liga o Google Drive ou um NAS/pasta, uma vez so.</td></tr>
        <tr><td>&#128187; <b>Dispositivos</b></td><td>A lista de computadores conectados a sua conta.</td></tr>
        <tr><td>&#9993; <b>Convites</b></td><td>Pastas que outras pessoas quiseram compartilhar com voce.</td></tr>
        <tr><td>&#9881; <b>Ajustes</b></td><td>Trocar senha, gerar novos codigos de recuperacao e desconectar.</td></tr>
      </table>
      <p>No alto da tela de Espacos ha uma barra com o estado atual (sincronizando, em dia, pausado) e o botao "Sincronizar agora".</p>
    </section>

    <section id="s8"><h2 class="sec"><span class="n">8</span>Conexoes: ligar uma vez, usar sempre</h2>
      <p>Antes de criar um espaco, voce define <b>onde</b> os arquivos ficam guardados, na secao Conexoes:</p>
      <ul>
        <li><b>+ Conectar Google Drive:</b> abre o navegador para autorizar sua conta Google.</li>
        <li><b>+ Adicionar NAS / Pasta:</b> usa um disco de rede ou uma pasta da maquina como destino.</li>
      </ul>
      <blockquote>Suas credenciais ficam guardadas <b>apenas neste computador</b> e de forma protegida. Voce liga a conexao uma vez e todos os espacos a reaproveitam.</blockquote>
    </section>

    <section id="s9"><h2 class="sec"><span class="n">9</span>Criando um espaco de sincronizacao</h2>
      <p>Clique em <b>+ Novo sync</b> e siga o assistente: <b>para quem e</b> (so seu ou compartilhado), <b>conexao</b>, <b>nome</b>, <b>onde fica neste computador</b> e <b>quais pastas</b>.</p>
      <blockquote><b>Importante:</b> por seguranca, o espaco comeca pausado. Nada e sincronizado ate voce conferir e ativar.</blockquote>
    </section>

    <section id="s10"><h2 class="sec"><span class="n">10</span>Como a sincronizacao funciona</h2>
      <ol>
        <li><b>Primeiro ele baixa:</b> traz o que ja existe na nuvem, para voce nunca apagar algo sem querer.</li>
        <li><b>Confira a previa:</b> o programa mostra o que vai acontecer antes de mexer nos arquivos.</li>
        <li><b>Ative o espaco:</b> dai em diante a sincronizacao roda sozinha (envia o que voce muda, baixa o que mudou na nuvem).</li>
      </ol>
      <blockquote><b>Protecao contra exclusoes em massa:</b> se uma sincronizacao fosse apagar muitos arquivos de uma vez, o programa segura e pede sua confirmacao antes.</blockquote>
      <p>Se duas pessoas editarem o mesmo arquivo ao mesmo tempo, o SF-Sync guarda as duas versoes e avisa, para nada ser perdido.</p>
    </section>

    <section id="s11"><h2 class="sec"><span class="n">11</span>Compartilhando uma pasta com outra pessoa</h2>
      <p>Ao criar ou abrir um espaco compartilhado, indique o <b>e-mail da pessoa</b>. Ela recebe um convite e, ao aceitar, escolhe onde guardar os arquivos no computador dela.</p>
      <p>Quando o espaco usa <b>Google Drive</b>, ha um passo a mais, feito por voce uma unica vez por espaco:</p>
      <ol>
        <li>No site do Google Drive, compartilhe a pasta com o e-mail da pessoa.</li>
        <li>Copie o identificador da pasta (o codigo no endereco dela no Drive) e cole no campo indicado pelo SF-Sync.</li>
      </ol>
      <p>Isso existe de proposito: o SF-Sync nao mexe sozinho no seu Google Drive. Quem decide o que e com quem compartilhar e voce.</p>
      <blockquote><b>Nota:</b> em espacos por NAS ou no espaco interno da Silver Fangs, esse passo nao existe.</blockquote>
    </section>

    <section id="s12"><h2 class="sec"><span class="n">12</span>Recebendo um compartilhamento</h2>
      <ol>
        <li>Abra a secao &#9993; <b>Convites</b> (um numero aparece quando ha novidades).</li>
        <li>Veja o espaco compartilhado e clique para <b>aceitar</b>.</li>
        <li>Escolha onde os arquivos vao ficar no seu computador.</li>
      </ol>
      <p>A partir dai funciona como qualquer espaco seu: baixa primeiro, depois mantem tudo em dia automaticamente.</p>
    </section>

    <section id="s13"><h2 class="sec"><span class="n">13</span>Seus dispositivos</h2>
      <p>Na secao &#128187; <b>Dispositivos</b> voce ve todos os computadores conectados a sua conta.</p>
      <ul>
        <li>Reconhece cada um pelo nome que voce deu ao conectar.</li>
        <li>Pode remover um aparelho que nao usa mais (um computador vendido, por exemplo): ele perde o acesso a sua conta.</li>
      </ul>
    </section>

    <section id="s14"><h2 class="sec"><span class="n">14</span>Conta e seguranca</h2>
      <p>Tudo isso fica na secao &#9881; <b>Ajustes</b>.</p>
      <ul>
        <li><b>Trocar a senha:</b> com o codigo 2FA e a nova senha.</li>
        <li><b>Esqueci a senha:</b> na tela de entrada, clique em "esqueci a senha" e redefina com o codigo do autenticador.</li>
        <li><b>Perdi o autenticador:</b> clique em "perdi o autenticador" e entre com a senha + um codigo de recuperacao; depois recadastre o 2FA em um novo celular.</li>
        <li><b>Novos codigos de recuperacao:</b> em Ajustes, com o codigo do autenticador (os antigos deixam de valer).</li>
        <li><b>Sair:</b> "Desconectar este dispositivo" encerra a sessao neste computador.</li>
      </ul>
      <blockquote><b>Atencao:</b> guarde os codigos de recuperacao com o cuidado de uma chave reserva da sua casa.</blockquote>
    </section>

    <section id="s15"><h2 class="sec"><span class="n">15</span>O icone perto do relogio</h2>
      <ul>
        <li>Clique no icone na area de notificacao para abrir a janela.</li>
        <li>Fechar a janela <b>nao encerra</b> o programa: ele continua sincronizando.</li>
        <li>Ele inicia junto com o Windows.</li>
      </ul>
    </section>

    <section id="s16"><h2 class="sec"><span class="n">16</span>Suas informacoes estao protegidas</h2>
      <ul>
        <li><b>Verificacao em duas etapas</b> alem da senha.</li>
        <li><b>Criptografia</b> do conteudo sincronizado.</li>
        <li><b>Credenciais so no seu aparelho</b>, guardadas de forma protegida.</li>
        <li><b>Pastas sensiveis nunca sao copiadas</b> (senhas/segredos e dados internos de controle de versao): protecao automatica.</li>
      </ul>
    </section>

    <section id="s17"><h2 class="sec"><span class="n">17</span>Perguntas frequentes</h2>
      <p><b>Preciso deixar o programa aberto?</b> Nao. Ele roda sozinho e inicia com o Windows.</p>
      <p><b>Se eu apagar um arquivo, ele some em todo lugar?</b> A sincronizacao reflete suas mudancas, mas exclusoes grandes sao seguradas e pedem confirmacao antes.</p>
      <p><b>Cheguei em outro computador. Ele vai apagar o que ja tenho la?</b> Nao: baixa primeiro e mostra uma previa antes de mexer.</p>
      <p><b>E se duas pessoas editarem o mesmo arquivo?</b> As duas versoes sao guardadas e voce e avisado.</p>
      <p><b>Perdi o celular do autenticador. E agora?</b> Use "perdi o autenticador" com a senha e um codigo de recuperacao.</p>
      <p><b>Posso usar Google Drive e tambem um NAS?</b> Pode. Cada espaco usa a conexao que voce escolher.</p>
    </section>

    <section id="s18"><h2 class="sec"><span class="n">18</span>Glossario rapido</h2>
      <ul>
        <li><b>Espaco:</b> pasta(s) que o SF-Sync mantem sincronizada.</li>
        <li><b>Conexao:</b> o destino dos arquivos (Google Drive, NAS, pasta de rede). Liga-se uma vez.</li>
        <li><b>Dispositivo:</b> cada computador conectado a sua conta.</li>
        <li><b>Sincronizar:</b> manter os arquivos iguais entre os lugares, automaticamente.</li>
        <li><b>Verificacao em duas etapas (2FA):</b> a camada extra de seguranca, com o codigo do autenticador.</li>
        <li><b>Codigos de recuperacao:</b> chaves reservas, de uso unico.</li>
        <li><b>Convite:</b> o pedido para participar de um espaco compartilhado.</li>
      </ul>
    </section>
  </main>

  <div class="download-strip">
    <div><div class="t">Pronto para comecar?</div><div class="s">Instalador assinado para Windows, versao ${VERSION}.</div></div>
    <a class="cta" href="/download"><span class="ic">&#11015;</span> Baixar para Windows</a>
  </div>

</div>

<footer>
  <div class="wrap">
    <a href="https://silverfangs.com"><img src="/logo.webp?v=3" alt="Silver Fangs" /></a>
    <div class="copy">&copy; Silver Fangs &middot; SF-Sync ${VERSION} &middot; assinatura de codigo por <a href="https://signpath.org">SignPath Foundation</a></div>
    <div class="links">
      <a href="https://silverfangs.com">Pagina principal</a>
      <a href="/manual.pdf">Manual (PDF)</a>
      <a href="/privacy">Privacidade</a>
    </div>
  </div>
</footer>

</body>
</html>`;
}
