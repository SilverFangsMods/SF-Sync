# SF-Sync
## Manual de Instalação e Uso

Mantenha suas pastas iguais em todos os seus computadores, de forma automática e segura.

*Versão 0.1.12 · Silver Fangs*

---

### Sumário
1. O que é o SF-Sync
2. Antes de começar
3. Instalando no Windows
4. Primeiro acesso: criando sua conta
5. Entrar com Google (atalho)
6. Conectando outro computador à mesma conta
7. Conhecendo a tela principal
8. Conexões: ligar uma vez, usar sempre
9. Criando um espaço de sincronização
10. Como a sincronização funciona
11. Compartilhando uma pasta com outra pessoa
12. Recebendo um compartilhamento
13. Seus dispositivos
14. Conta e segurança
15. O ícone perto do relógio
16. Suas informações estão protegidas
17. Perguntas frequentes
18. Glossário rápido

---

### 1. O que é o SF-Sync

O SF-Sync é um programa que mantém as mesmas pastas iguais em vários computadores. Você trabalha em um arquivo no computador do escritório e, pouco depois, ele aparece atualizado no computador de casa, sem você precisar copiar nada em pen drive ou anexar em e-mail.

Ele também permite compartilhar pastas com outras pessoas: você escolhe uma pasta, indica com quem quer dividir, e o conteúdo passa a ficar sincronizado entre vocês.

Em resumo, o SF-Sync cuida de três coisas para você:

- **Seu próprio backup vivo:** suas pastas sempre iguais entre os seus aparelhos.
- **Trabalho em conjunto:** pastas compartilhadas com quem você escolher.
- **Tranquilidade:** tudo protegido por senha, verificação em duas etapas e criptografia.

> **Observação:** O programa fica discreto, rodando perto do relógio (a área de notificação do Windows), e trabalha sozinho em segundo plano.

### 2. Antes de começar

Você vai precisar de:

- Um computador com Windows.
- Um e-mail válido.
- Um aplicativo autenticador no celular, por exemplo, o Google Authenticator, o Microsoft Authenticator ou similar. Ele gera um código de seis números que muda a cada 30 segundos e serve como uma segunda chave da sua conta (a chamada verificação em duas etapas).
- Se for usar Google Drive como espaço na nuvem, tenha sua conta Google à mão.

Reserve cinco minutinhos para o primeiro acesso. Depois disso, o programa cuida de quase tudo sozinho.

### 3. Instalando no Windows

1. Recebe o arquivo de instalação, com nome parecido com `SF-Sync_0.1.12_x64_en-US.msi`.
2. Dê dois cliques nele.
3. Se o Windows perguntar se você confia no programa, confirme: o instalador é assinado digitalmente pela Silver Fangs, então é seguro prosseguir.
4. Avance até o fim e clique em **Concluir**.

Pronto. O SF-Sync já inicia junto com o Windows e fica esperando perto do relógio.

> **Dica:** se você abrir o atalho do SF-Sync na área de trabalho, ele simplesmente abre a janela do programa. Ele nunca cria duas cópias abertas ao mesmo tempo, sempre haverá apenas uma.

### 4. Primeiro acesso: criando sua conta

Ao abrir o programa pela primeira vez, aparece a tela "Conectar este dispositivo". Passo a passo:

1. Digite seu e-mail e clique em **Continuar**.
2. Como ainda não existe conta para esse e-mail, o programa abre a criação de conta. Preencha:
   - **Nome:** como você quer ser identificado.
   - **Senha:** no mínimo 8 caracteres.
   - **Código do convite:** se alguém te convidou. Se você é a primeira pessoa (o dono), pode deixar esse campo vazio.
3. Clique em **Criar conta**.
4. Agora a verificação em duas etapas. Abra o aplicativo autenticador no celular e aponte a câmera para o QR Code que aparece na tela (ou digite o código secreto mostrado).
5. Digite no programa o código de seis números que o aplicativo gerou e clique em **Confirmar 2FA**.
6. O programa mostra seus códigos de recuperação. Guarde-os em lugar seguro (anote ou salve em um cofre de senhas). Cada um funciona uma única vez e é o que vai te salvar caso você perca o celular do autenticador. Clique em **Guardei - continuar**.

Feito isso, sua conta está criada e este computador já está conectado a ela.

> **Atenção:** Antes de finalizar, confira o campo "Nome deste dispositivo" (ex.: "Notebook do escritório"). Assim você reconhece cada aparelho depois.

### 5. Entrar com Google (atalho)

Se preferir, na tela inicial existe o botão "Entrar com Google".

1. Clique nele.
2. O navegador abre na tela de login do Google. Escolha sua conta e autorize.
3. Volte para o SF-Sync, ele reconhece o login automaticamente e conecta o computador.

É uma forma mais rápida de entrar, sem precisar digitar senha. (Funciona para contas que já existem ou que foram convidadas.)

### 6. Conectando outro computador à mesma conta

Quer usar o SF-Sync em um segundo computador (ou no de casa)? Simples:

1. Instale o programa nele (capítulo 3).
2. Na tela "Conectar este dispositivo", digite o mesmo e-mail e clique em **Continuar**.
3. Como a conta já existe, o programa pede sua senha e o código 2FA do autenticador.
4. Clique em **Entrar e parear**.

Esse computador passa a fazer parte da sua conta. Cada aparelho que você conecta aparece depois na seção Dispositivos.

### 7. Conhecendo a tela principal

Do lado esquerdo ficam os atalhos:

| Atalho | Para que serve |
| :--- | :--- |
| 🗃 **Espaços** | Suas pastas sincronizadas. É onde você passa a maior parte do tempo. |
| 🔌 **Conexões** | Onde você liga o Google Drive ou um NAS/pasta, uma vez só. |
| 💻 **Dispositivos** | A lista de computadores conectados à sua conta. |
| ✉ **Convites** | Pastas que outras pessoas quiseram compartilhar com você. |
| ⚙ **Ajustes** | Trocar senha, gerar novos códigos de recuperação e desconectar. |

No alto da tela de Espaços há uma barra que mostra o estado atual (sincronizando, em dia, pausado) e um botão "Sincronizar agora" para forçar uma atualização na hora.

### 8. Conexões: ligar uma vez, usar sempre

Antes de criar um espaço, você define onde os arquivos vão ficar guardados na nuvem ou na rede. Isso é feito uma única vez, na seção Conexões.

- **+ Conectar Google Drive:** liga sua conta do Google Drive. Ao clicar, o programa abre o navegador para você autorizar o acesso.
- **+ Adicionar NAS / Pasta:** usa um disco de rede (NAS) ou uma pasta da sua máquina como destino. Você dá um nome e indica o caminho.

> **Segurança:** Suas credenciais ficam guardadas apenas neste computador e de forma protegida. Você liga a conexão uma vez e todos os espaços passam a reaproveitá-la, sem precisar autorizar de novo a cada pasta.

### 9. Criando um espaço de sincronização

Um espaço é uma pasta (ou conjunto de pastas) que o SF-Sync mantém sincronizada. Para criar, clique em **+ Novo sync** e siga o assistente:

1. **Para quem é:** só seu ou compartilhado com outras pessoas.
2. **Conexão:** escolha uma das conexões que você já ligou (Google Drive, NAS...).
3. **Nome:** um nome fácil de lembrar para o espaço.
4. **Onde fica neste computador:** a pasta local onde os arquivos vão morar. Cada computador pode ter um caminho diferente.
5. **Quais pastas:** você pode sincronizar tudo ou selecionar pastas específicas.

Ao terminar, o espaço aparece na tela de Espaços.

> **Importante:** por segurança, o espaço começa pausado. Nada é sincronizado até você conferir e ativar (veja o próximo capítulo).

### 10. Como a sincronização funciona

Quando você abre um espaço recém-criado, o SF-Sync segue uma ordem segura:

1. **Primeiro ele baixa:** traz para o seu computador o que já existe na nuvem. Assim você nunca apaga, sem querer, algo que estava lá.
2. **Confira a prévia:** o programa mostra o que vai acontecer antes de mexer de verdade nos arquivos.
3. **Ative o espaço:** quando estiver tudo certo, você ativa. A partir daí a sincronização roda sozinha: o que você mudar é enviado, o que mudar na nuvem é baixado.

Você sempre pode usar "Sincronizar agora" para forçar uma atualização, ou pausar um espaço quando quiser.

> **Proteção contra exclusões em massa:** se uma sincronização automática fosse apagar muitos arquivos de uma vez, o programa segura a operação e pede sua confirmação antes. Nada de surpresas.

Se duas pessoas (ou dois computadores) editarem o mesmo arquivo ao mesmo tempo, o SF-Sync guarda as duas versões e avisa, para nada ser perdido.

### 11. Compartilhando uma pasta com outra pessoa

Você pode dividir um espaço com alguém (um familiar, um colega de projeto).

**O básico:** ao criar ou abrir um espaço compartilhado, você indica o e-mail da pessoa. Ela recebe um convite e, ao aceitar, escolhe onde guardar os arquivos no computador dela.

Quando o espaço usa Google Drive, há um passo a mais, feito por você (o dono), uma única vez por espaço:

1. No site do Google Drive, compartilhe a pasta com o e-mail da pessoa (como você já faz normalmente no Drive).
2. Copie o identificador da pasta (aquele código que aparece no endereço da pasta no Drive) e cole no campo indicado pelo SF-Sync.

Isso existe de propósito: o SF-Sync não mexe sozinho no seu Google Drive. Quem decide o que e com quem compartilhar é você, mais controle nas suas mãos.

> **Nota:** Em espaços por NAS ou no espaço interno da Silver Fangs, esse passo extra não existe: o acesso já vem resolvido.

### 12. Recebendo um compartilhamento

Quando alguém compartilha um espaço com você:

1. Abra a seção ✉ **Convites** (um número aparece ao lado quando há convites novos).
2. Veja o espaço que foi compartilhado e clique para **aceitar**.
3. Escolha onde esses arquivos vão ficar no seu computador.

A partir daí funciona como qualquer espaço seu: baixa primeiro, depois mantém tudo em dia automaticamente.

### 13. Seus dispositivos

Na seção 💻 **Dispositivos** você vê todos os computadores conectados à sua conta.

- Reconhece cada um pelo nome que você deu na hora de conectar.
- Pode remover um aparelho que você não usa mais (um computador vendido, por exemplo). Ao remover, ele perde o acesso à sua conta.

É uma boa prática revisar essa lista de vez em quando.

### 14. Conta e segurança

Tudo isso fica na seção ⚙ **Ajustes**.

- **Trocar a senha:** Informe o código 2FA do autenticador e a nova senha, e clique em Salvar nova senha.
- **Esqueci a senha:** Na tela de entrada, clique em "esqueci a senha". Você redefine a senha usando o código do autenticador.
- **Perdi o autenticador (celular):** Na tela de entrada, clique em "perdi o autenticador". Entre com a senha e um dos códigos de recuperação que você guardou no início. O programa permite recadastrar a verificação em duas etapas em um novo celular.
- **Gerar novos códigos de recuperação:** Se você já usou quase todos, vá em Ajustes, informe o código do autenticador e clique em Gerar novos códigos. Os antigos deixam de valer.
- **Sair:** Desconectar este dispositivo encerra a sessão neste computador.

> **Atenção:** Guarde os códigos de recuperação com o mesmo cuidado de uma chave reserva da sua casa. Eles são a sua porta de entrada caso perca o celular.

### 15. O ícone perto do relógio

O SF-Sync vive discretamente na área de notificação do Windows (perto do relógio, no canto inferior direito).

- Clique no ícone para abrir a janela do programa.
- Fechar a janela não encerra o programa, ele continua sincronizando em segundo plano.
- Ele inicia junto com o Windows, então você não precisa lembrar de abri-lo.

### 16. Suas informações estão protegidas

Mesmo sem entrar em detalhes técnicos, vale saber:

- **Verificação em duas etapas:** além da senha, sua conta exige o código do autenticador.
- **Criptografia:** o conteúdo sincronizado é embaralhado, de modo que só faz sentido para quem tem acesso autorizado.
- **Credenciais só no seu aparelho:** suas chaves de acesso ficam guardadas de forma protegida no próprio computador, nunca expostas.
- **Pastas sensíveis nunca são copiadas:** por segurança, o programa jamais sincroniza pastas de senhas/segredos nem dados internos de controle de versão. É uma proteção automática, que você não precisa configurar.

### 17. Perguntas frequentes

- **Preciso deixar o programa aberto?** Não. Ele roda sozinho perto do relógio e inicia com o Windows.
- **Se eu apagar um arquivo, ele some em todo lugar?** A sincronização reflete suas mudanças. Mas exclusões grandes são seguradas e pedem sua confirmação antes, justamente para evitar acidentes.
- **Cheguei em outro computador. Ele vai apagar o que já tenho lá?** Não. O SF-Sync baixa primeiro e mostra uma prévia antes de mexer. Você confere e só depois ativa.
- **E se duas pessoas editarem o mesmo arquivo?** As duas versões são guardadas e você é avisado. Nada é perdido em silêncio.
- **Perdi o celular do autenticador. E agora?** Use a opção "perdi o autenticador" com a senha e um código de recuperação. Por isso é tão importante guardá-los.
- **Posso usar Google Drive e também um NAS?** Pode. Você liga as conexões que quiser em Conexões e cada espaço usa a que você escolher.

### 18. Glossário rápido

- **Espaço:** uma pasta (ou conjunto delas) que o SF-Sync mantém sincronizada.
- **Conexão:** o destino onde os arquivos ficam guardados (Google Drive, NAS, pasta de rede). Você liga uma vez.
- **Dispositivo:** cada computador conectado à sua conta.
- **Sincronizar:** manter os arquivos iguais entre os lugares, automaticamente.
- **Verificação em duas etapas (2FA):** a camada extra de segurança, com o código de seis números do autenticador.
- **Códigos de recuperação:** chaves reservas, de uso único, para recuperar o acesso se você perder o autenticador.
- **Convite:** o pedido para participar de um espaço compartilhado por outra pessoa.

---

*Em caso de dúvida, fale com quem te convidou ou com o responsável pelo SF-Sync.*
