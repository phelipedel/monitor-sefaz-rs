# ⚡ Monitor SEFAZ-RS (NFC-e e NF-e) em Tempo Real

Painel moderno de monitoramento de alta precisão da **SEFAZ Rio Grande do Sul (RS)**, com foco exclusivo em **NFC-e** e **NF-e**, interface escura (Dark Theme) de alta legibilidade, classificação de latência em 5 níveis e visualização em tempo real, por hora e por dia.

---

## 🚀 Principais Recursos

- ⏱️ **Motor de Checagem Automática a cada 3 Minutos:** Executa requisições contínuas contra o WebService de Produção da SEFAZ RS (SVRS), medindo a latência exata em milissegundos.
- ⏳ **Contador Regressivo em Tempo Real:** Badge no topo com contador regressivo (`02:59...`) indicando a próxima checagem automática.
- 🪪 **Validação de Certificado Digital (A1 / .pfx):**
  - O usuário pode selecionar o certificado digital instalado na máquina.
  - O sistema lê: **Razão Social**, **CNPJ**, **Emissor** (ex: Certisign, Serasa), **Validade** e **Dias Restantes**.
  - Alerta visual caso o certificado esteja próximo do vencimento (< 30 dias) ou expirado.
  - Realiza requisições mTLS com o certificado do cliente.
  - Funciona também em **Modo Sonda Direta** caso nenhum certificado seja anexado.
- 📊 **3 Visões de Gráficos Analíticos:**
  - **Tempo de resposta (Linha em tempo real):** Mostra oscilações minuto a minuto com pontos de medição.
  - **Tempo médio de resposta por hora (Barras):** Exibe a média horária (`05-00`, `05-01`, etc.) com cores dinâmicas.
  - **Tempo médio de resposta por dia (Barras):** Visão histórica dos últimos dias do mês.
- 🚦 **Classificação em 5 Níveis:**
  - 🟢 **Normal:** $\le$ 2s
  - 🟡 **Lento:** $\le$ 5s
  - 🟠 **Muito lento:** < 30s
  - 🔴 **Erro**
  - 🟣 **Timeout:** > 30s
- 💾 **Persistência de Histórico:** Armazena o histórico em JSON (`data/history.json`) para que reinicializações não percam os dados coletados.

---

## 🛠️ Como Executar Localmente

### Opção 1: Atalho Rápido no Windows
Basta dar um duplo clique no arquivo [`start.bat`](file:///c:/Users/Del/Desktop/Nova%20pasta%20(6)/Fontes/monitor-sefaz-rs/start.bat). Ele instalará as dependências caso necessário, iniciará o servidor e abrirá o navegador em `http://localhost:3000`.

### Opção 2: Via Terminal (Node.js)
```bash
cd monitor-sefaz-rs
npm install
npm start
```
Acesse no seu navegador: `http://localhost:3000`

---

## ☁️ Como Hospedar na Web

Você pode hospedar este portal facilmente em qualquer serviço de nuvem:

### 1. Render (Recomendado - Gratuito)
1. Crie uma conta no [render.com](https://render.com).
2. Conecte seu repositório Git ou suba a pasta `monitor-sefaz-rs`.
3. Escolha **Web Service** -> Runtime: **Node**.
4. Build Command: `npm install`
5. Start Command: `npm start`

### 2. Railway
1. Acesse [railway.app](https://railway.app).
2. Crie um novo projeto a partir do repositório ou use o `Dockerfile` incluso.
3. A porta 3000 será exposta automaticamente com HTTPS público.

### 3. VPS ou Servidor Dedicado (Linux / Windows Server)
1. Instale o Node.js v18+.
2. Suba os arquivos e use o **PM2** para manter o serviço rodando 24/7:
   ```bash
   npm install -g pm2
   pm2 start server.js --name "monitor-sefaz-rs"
   pm2 startup
   pm2 save
   ```

---

## 📡 WebServices Monitorados
- **NFC-e RS (SVRS):** `https://nfce.svrs.rs.gov.br/ws/NfeStatusServico4/NfeStatusServico4.asmx`
- **NF-e RS:** `https://nfe.sefaz.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx`
- **Código UF:** `43` (Rio Grande do Sul)
- **Serviço SOAP:** `consStatServ` versão `4.00`
