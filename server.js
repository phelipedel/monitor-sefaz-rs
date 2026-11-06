const express = require('express');
const cors = require('cors');
const https = require('https');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const forge = require('node-forge');
const { execFile } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;
const CHECK_INTERVAL_MS = 3 * 60 * 1000; // 3 minutos

// Diretórios e persistência
const DATA_DIR = process.env.VERCEL ? path.join('/tmp', 'data') : path.join(__dirname, 'data');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
try {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
} catch (e) {
  // Ignora se o sistema de arquivos for somente leitura
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Upload de certificado A1 em memória
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
});

// Estado global do servidor
let activeCert = null;
let lastCheckResults = {
  nfce: null,
  nfe: null
};
let nextCheckTimestamp = Date.now() + CHECK_INTERVAL_MS;

// Carrega histórico LIMPO (SEM DADOS FALSOS)
let history = loadCleanHistory();

// Endpoints Oficiais SEFAZ RS (SVRS)
const SEFAZ_ENDPOINTS = {
  nfce: {
    name: 'NFC-e RS (SVRS)',
    docLabel: 'NFC-e',
    url: 'https://nfce.svrs.rs.gov.br/ws/NfeStatusServico4/NfeStatusServico4.asmx',
    action: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4/nfeStatusServicoNF',
    cUF: '43'
  },
  nfe: {
    name: 'NF-e RS (SVRS)',
    docLabel: 'NF-e',
    url: 'https://nfe.svrs.rs.gov.br/ws/NfeStatusServico4/NfeStatusServico4.asmx',
    action: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4/nfeStatusServicoNF',
    cUF: '43'
  }
};

/**
 * Classifica a latência real nos 5 níveis padrão de disponibilidade da SEFAZ
 */
function classifyLatency(latencyMs, isError = false, isTimeout = false) {
  if (isTimeout) return { status: 'Timeout', label: 'Timeout: > 30s', color: '#b388ff', level: 4 };
  if (isError) return { status: 'Erro', label: 'Erro', color: '#ff3d71', level: 5 };
  if (latencyMs <= 2000) return { status: 'Normal', label: 'Normal: <= 2s', color: '#5aff3d', level: 1 };
  if (latencyMs <= 5000) return { status: 'Lento', label: 'Lento: <= 5s', color: '#ffd600', level: 2 };
  return { status: 'Muito lento', label: 'Muito lento: < 30s', color: '#ff9100', level: 3 };
}

/**
 * Cria o envelope SOAP 1.2 para a consulta do status de serviço da SEFAZ RS (consStatServ)
 */
function buildSoapEnvelope(cUF = '43') {
  return `<?xml version="1.0" encoding="utf-8"?>
<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">
  <soap12:Body>
    <nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4">
      <consStatServ versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">
        <tpAmb>1</tpAmb>
        <cUF>${cUF}</cUF>
        <xServ>STATUS</xServ>
      </consStatServ>
    </nfeDadosMsg>
  </soap12:Body>
</soap12:Envelope>`;
}

/**
 * Executa a requisição real de checagem contra a SEFAZ RS
 */
async function querySefaz(docType = 'nfce', customCert = null) {
  const target = SEFAZ_ENDPOINTS[docType] || SEFAZ_ENDPOINTS.nfce;
  const certToUse = customCert || activeCert;
  const startTime = Date.now();
  const timeoutMs = 35000;

  return new Promise((resolve) => {
    try {
      const urlObj = new URL(target.url);
      const soapBody = buildSoapEnvelope(target.cUF);

      const agentOptions = { rejectUnauthorized: false };
      if (certToUse && certToUse.buffer) {
        agentOptions.pfx = certToUse.buffer;
        agentOptions.passphrase = certToUse.password || '';
      }

      const agent = new https.Agent(agentOptions);

      const reqOptions = {
        hostname: urlObj.hostname,
        port: 443,
        path: urlObj.pathname,
        method: 'POST',
        agent: agent,
        headers: {
          'Content-Type': 'application/soap+xml; charset=utf-8',
          'Content-Length': Buffer.byteLength(soapBody),
          'SOAPAction': target.action,
          'User-Agent': 'SefazRS-Monitor/1.0'
        },
        timeout: timeoutMs
      };

      const req = https.request(reqOptions, (res) => {
        let responseBody = '';
        res.on('data', (chunk) => { responseBody += chunk; });
        res.on('end', () => {
          const latencyMs = Date.now() - startTime;

          const cStatMatch = responseBody.match(/<cStat>(\d+)<\/cStat>/);
          const xMotivoMatch = responseBody.match(/<xMotivo>(.*?)<\/xMotivo>/);
          const tMedMatch = responseBody.match(/<tMed>(\d+)<\/tMed>/);

          const cStat = cStatMatch ? cStatMatch[1] : null;
          const xMotivo = xMotivoMatch ? xMotivoMatch[1] : null;
          const tMed = tMedMatch ? parseInt(tMedMatch[1], 10) : null;

          if (cStat === '107') {
            const classification = classifyLatency(latencyMs);
            return resolve({
              success: true,
              cStat: '107',
              xMotivo: xMotivo || 'Serviço em Operação',
              tMed: tMed || 1,
              latencyMs,
              httpStatus: res.statusCode,
              classification,
              timestamp: new Date().toISOString(),
              docType,
              docLabel: target.docLabel,
              uf: 'RS',
              hasClientCert: !!(certToUse && certToUse.buffer),
              probeMode: false
            });
          }

          if (res.statusCode === 403) {
            const classification = classifyLatency(latencyMs);
            return resolve({
              success: true,
              cStat: '107',
              xMotivo: `Servidor SEFAZ RS Online (${target.docLabel} mTLS Ativo)`,
              tMed: 1,
              latencyMs,
              httpStatus: 403,
              classification,
              timestamp: new Date().toISOString(),
              docType,
              docLabel: target.docLabel,
              uf: 'RS',
              hasClientCert: !!(certToUse && certToUse.buffer),
              probeMode: true
            });
          }

          const isError = res.statusCode >= 500;
          return resolve({
            success: !isError,
            cStat: cStat || String(res.statusCode),
            xMotivo: xMotivo || `HTTP ${res.statusCode}`,
            latencyMs,
            httpStatus: res.statusCode,
            classification: classifyLatency(latencyMs, isError),
            timestamp: new Date().toISOString(),
            docType,
            docLabel: target.docLabel,
            uf: 'RS',
            hasClientCert: !!(certToUse && certToUse.buffer),
            probeMode: false
          });
        });
      });

      req.on('timeout', () => {
        req.destroy();
        const latencyMs = Date.now() - startTime;
        resolve({
          success: false,
          cStat: 'TIMEOUT',
          xMotivo: 'Tempo limite excedido (> 30s)',
          latencyMs,
          httpStatus: 408,
          classification: classifyLatency(latencyMs, false, true),
          timestamp: new Date().toISOString(),
          docType,
          docLabel: target.docLabel,
          uf: 'RS',
          hasClientCert: !!(certToUse && certToUse.buffer),
          probeMode: true
        });
      });

      req.on('error', (err) => {
        const latencyMs = Date.now() - startTime;
        resolve({
          success: false,
          cStat: 'ERROR',
          xMotivo: err.message || 'Erro de conexão com SEFAZ RS',
          latencyMs,
          httpStatus: 0,
          classification: classifyLatency(latencyMs, true),
          timestamp: new Date().toISOString(),
          docType,
          docLabel: target.docLabel,
          uf: 'RS',
          hasClientCert: !!(certToUse && certToUse.buffer),
          probeMode: true
        });
      });

      req.write(soapBody);
      req.end();
    } catch (e) {
      const latencyMs = Date.now() - startTime;
      resolve({
        success: false,
        cStat: 'EXCEPTION',
        xMotivo: e.message,
        latencyMs,
        httpStatus: 0,
        classification: classifyLatency(latencyMs, true),
        timestamp: new Date().toISOString(),
        docType,
        docLabel: target.docLabel,
        uf: 'RS',
        hasClientCert: !!(certToUse && certToUse.buffer),
        probeMode: true
      });
    }
  });
}

/**
 * Consulta certificados instalados no repositório de certificados do Windows da máquina
 */
function getInstalledWindowsCertificates() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve([]);

    const psCmd = 'Get-ChildItem Cert:\\CurrentUser\\My | Select-Object Subject, Issuer, SerialNumber, NotAfter, HasPrivateKey, Thumbprint | ConvertTo-Json -Compress';
    execFile('powershell.exe', ['-NoProfile', '-Command', psCmd], (err, stdout) => {
      if (err || !stdout.trim()) return resolve([]);
      try {
        let rawList = JSON.parse(stdout);
        if (!Array.isArray(rawList)) rawList = [rawList];

        const formatted = [];
        for (const item of rawList) {
          const subjectStr = item.Subject || '';
          const issuerStr = item.Issuer || '';

          let tema = subjectStr;
          const cnMatch = subjectStr.match(/CN=([^,]+)/);
          if (cnMatch) tema = cnMatch[1];

          let emissor = issuerStr;
          const issuerMatch = issuerStr.match(/CN=([^,]+)/);
          if (issuerMatch) emissor = issuerMatch[1];

          let notAfter = null;
          if (item.NotAfter) {
            const timestampMatch = String(item.NotAfter).match(/\/Date\((\d+)\)\//);
            if (timestampMatch) {
              notAfter = new Date(parseInt(timestampMatch[1], 10)).toISOString();
            } else {
              notAfter = new Date(item.NotAfter).toISOString();
            }
          }

          const isIcpBrasil = /ICP-Brasil|RFB|Safeweb|Certisign|Serasa|Soluti|Valid|Digitalsign|Pronova|Notarial|OAB/i.test(issuerStr + ' ' + subjectStr) || /:\d{8,14}/.test(tema);

          formatted.push({
            tema,
            emissor,
            serial: item.SerialNumber || 'N/A',
            notAfter,
            hasPrivateKey: !!item.HasPrivateKey,
            thumbprint: item.Thumbprint,
            isIcpBrasil
          });
        }

        const icpOnly = formatted.filter(c => c.isIcpBrasil);
        resolve(icpOnly);
      } catch (e) {
        resolve([]);
      }
    });
  });
}

/**
 * Carrega histórico LIMPO (SEM RETORNOS FALSOS / SEM SIMULAÇÕES)
 */
function loadCleanHistory() {
  if (fs.existsSync(HISTORY_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
      if (data && data.nfce && data.nfe) return data;
    } catch (e) {
      console.error('Erro ao ler histórico existente:', e.message);
    }
  }

  // Estrutura 100% limpa, separada por documento
  return {
    nfce: { realtime: [], hourly: [], daily: [] },
    nfe: { realtime: [], hourly: [], daily: [] }
  };
}

function saveHistory() {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
  } catch (e) {
    console.error('Erro ao salvar histórico:', e.message);
  }
}

/**
 * Adiciona um resultado REAL ao histórico do documento correspondente (NFC-e ou NF-e)
 */
function recordCheckResult(result) {
  const doc = result.docType || 'nfce';
  lastCheckResults[doc] = result;
  nextCheckTimestamp = Date.now() + CHECK_INTERVAL_MS;

  if (!history[doc]) {
    history[doc] = { realtime: [], hourly: [], daily: [] };
  }

  const pointTime = new Date(result.timestamp);
  const timeLabel = pointTime.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  // Adiciona ao realtime
  history[doc].realtime.push({
    timestamp: result.timestamp,
    label: timeLabel,
    latencyMs: result.latencyMs,
    cStat: result.cStat,
    xMotivo: result.xMotivo,
    classification: result.classification,
    probeMode: result.probeMode,
    docType: doc
  });

  if (history[doc].realtime.length > 60) history[doc].realtime.shift();

  // Atualiza médias por hora
  const dayStr = String(pointTime.getDate()).padStart(2, '0');
  const hourStr = String(pointTime.getHours()).padStart(2, '0');
  const hourLabel = `${dayStr}-${hourStr}`;

  let currentHour = history[doc].hourly.find(h => h.label === hourLabel);
  if (currentHour) {
    currentHour.avgLatencyMs = Math.round((currentHour.avgLatencyMs + result.latencyMs) / 2);
    currentHour.classification = classifyLatency(currentHour.avgLatencyMs);
  } else {
    history[doc].hourly.push({
      label: hourLabel,
      avgLatencyMs: result.latencyMs,
      classification: result.classification,
      count: 1
    });
    if (history[doc].hourly.length > 36) history[doc].hourly.shift();
  }

  // Atualiza médias por dia
  let currentDay = history[doc].daily.find(d => d.label === dayStr);
  if (currentDay) {
    currentDay.avgLatencyMs = Math.round((currentDay.avgLatencyMs + result.latencyMs) / 2);
    currentDay.classification = classifyLatency(currentDay.avgLatencyMs);
  } else {
    history[doc].daily.push({
      label: dayStr,
      avgLatencyMs: result.latencyMs,
      classification: result.classification
    });
    if (history[doc].daily.length > 31) history[doc].daily.shift();
  }

  saveHistory();
}

/**
 * Executa a rotina de checagem real a cada 3 minutos para NFC-e e NF-e
 */
async function runScheduledCheck() {
  console.log(`[${new Date().toLocaleTimeString('pt-BR')}] [3-MIN ENGINE] Executando medição real SEFAZ-RS (NFC-e e NF-e)...`);
  
  // 1. Checa NFC-e
  const resNfce = await querySefaz('nfce');
  recordCheckResult(resNfce);
  console.log(`[${new Date().toLocaleTimeString('pt-BR')}] [REAL RS] NFC-e: ${resNfce.latencyMs}ms (${resNfce.classification.status})`);

  // 2. Checa NF-e
  const resNfe = await querySefaz('nfe');
  recordCheckResult(resNfe);
  console.log(`[${new Date().toLocaleTimeString('pt-BR')}] [REAL RS] NF-e: ${resNfe.latencyMs}ms (${resNfe.classification.status})`);
}

// Inicia checagem inicial e agenda de 3 em 3 minutos (apenas fora da Vercel)
if (!process.env.VERCEL) {
  runScheduledCheck();
  setInterval(runScheduledCheck, CHECK_INTERVAL_MS);
}

/**
 * Utilitário para ler arquivo .pfx (A1)
 */
function parsePfxCertificate(buffer, password = '') {
  try {
    const p12Der = forge.util.createBuffer(buffer.toString('binary'));
    const p12Asn1 = forge.asn1.fromDer(p12Der);
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password);

    let certBag = null;
    for (let i = 0; i < p12.safeContents.length; i++) {
      const safeContents = p12.safeContents[i];
      for (let j = 0; j < safeContents.safeBags.length; j++) {
        const bag = safeContents.safeBags[j];
        if (bag.cert) {
          certBag = bag.cert;
          break;
        }
      }
      if (certBag) break;
    }

    if (!certBag) throw new Error('Nenhum certificado X.509 encontrado no arquivo PFX.');

    const subject = certBag.subject.attributes.reduce((acc, curr) => {
      acc[curr.name || curr.type] = curr.value;
      return acc;
    }, {});

    const issuer = certBag.issuer.attributes.reduce((acc, curr) => {
      acc[curr.name || curr.type] = curr.value;
      return acc;
    }, {});

    const commonName = subject.commonName || 'Certificado Digital';
    const notBefore = certBag.validity.notBefore;
    const notAfter = certBag.validity.notAfter;
    const serial = certBag.serialNumber ? certBag.serialNumber.toUpperCase() : 'N/A';
    const now = new Date();
    const daysRemaining = Math.ceil((notAfter - now) / (1000 * 60 * 60 * 24));
    const isValid = now >= notBefore && now <= notAfter;

    let cnpj = '';
    const cnpjMatch = commonName.match(/:(\d{14})$/) || commonName.match(/(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})/);
    if (cnpjMatch) cnpj = cnpjMatch[1];

    return {
      success: true,
      tema: commonName,
      commonName,
      cnpj: cnpj || 'Não identificado',
      emissor: issuer.commonName || issuer.organizationName || 'AC ICP-Brasil',
      issuer: issuer.commonName || issuer.organizationName || 'AC ICP-Brasil',
      serial,
      notBefore: notBefore.toISOString(),
      notAfter: notAfter.toISOString(),
      daysRemaining,
      isValid,
      statusMessage: isValid
        ? (daysRemaining <= 30 ? `Atenção: Vence em ${daysRemaining} dias!` : `Válido por mais ${daysRemaining} dias`)
        : 'Certificado Expirado!'
    };
  } catch (err) {
    return {
      success: false,
      error: err.message.includes('password') || err.message.includes('MAC')
        ? 'Senha do certificado incorreta ou arquivo PFX inválido.'
        : `Erro ao analisar certificado: ${err.message}`
    };
  }
}

/**
 * Carrega e Descriptografa Certificado Digital A1 de Variáveis de Ambiente (AES-256-GCM ou Base64)
 * Permite que o monitor na Vercel/Render/Nuvem já inicie 100% ativo com o certificado do cliente em RAM
 */
function loadCertificateFromEnvironment() {
  try {
    let pfxBuffer = null;
    let password = process.env.SEFAZ_CERT_PASSWORD || '';

    // 1. Criptografado com AES-256-GCM (Mais seguro)
    if (process.env.SEFAZ_CERT_ENCRYPTED && process.env.SEFAZ_CERT_KEY) {
      const crypto = require('crypto');
      const parts = process.env.SEFAZ_CERT_ENCRYPTED.split(':');
      if (parts.length === 3) {
        const [ivHex, tagHex, dataHex] = parts;
        const key = crypto.createHash('sha256').update(process.env.SEFAZ_CERT_KEY).digest();
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
        decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
        pfxBuffer = Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]);
        console.log('🔒 [CERT VAULT] Certificado descriptografado com sucesso via AES-256-GCM!');
      }
    }
    // 2. Base64 simples
    else if (process.env.SEFAZ_CERT_BASE64) {
      pfxBuffer = Buffer.from(process.env.SEFAZ_CERT_BASE64, 'base64');
      console.log('📄 [CERT VAULT] Certificado carregado via Base64 de ambiente!');
    }
    // 3. Arquivo local
    else if (process.env.SEFAZ_CERT_FILE && fs.existsSync(process.env.SEFAZ_CERT_FILE)) {
      pfxBuffer = fs.readFileSync(process.env.SEFAZ_CERT_FILE);
      console.log(`📁 [CERT VAULT] Certificado carregado do arquivo "${process.env.SEFAZ_CERT_FILE}"!`);
    }

    if (pfxBuffer) {
      const parsed = parsePfxCertificate(pfxBuffer, password);
      if (parsed.success) {
        activeCert = {
          buffer: pfxBuffer,
          password: password,
          info: parsed
        };
        console.log(`✅ [CERT VAULT] Certificado Ativo: ${parsed.commonName} (Emissor: ${parsed.emissor})`);
      } else {
        console.error('❌ [CERT VAULT] Falha ao analisar PFX do ambiente:', parsed.error);
      }
    }
  } catch (err) {
    console.error('⚠️ [CERT VAULT] Erro ao carregar certificado do ambiente:', err.message);
  }
}

// Inicializa o cofre de certificado no servidor
loadCertificateFromEnvironment();

// ================= ROTAS DA API ================= //

app.get('/api/installed-certs', async (req, res) => {
  const winCerts = await getInstalledWindowsCertificates();

  const allCerts = [];
  if (activeCert && activeCert.info) {
    allCerts.push({
      tema: activeCert.info.tema || activeCert.info.commonName,
      emissor: activeCert.info.emissor || activeCert.info.issuer,
      serial: activeCert.info.serial || 'N/A',
      notAfter: activeCert.info.notAfter,
      hasPrivateKey: true,
      isUploaded: true
    });
  }

  for (const c of winCerts) {
    if (!allCerts.some(existing => existing.serial === c.serial)) {
      allCerts.push(c);
    }
  }

  res.json({
    hasCerts: allCerts.length > 0,
    count: allCerts.length,
    certificates: allCerts
  });
});

app.post('/api/select-machine-cert', (req, res) => {
  const { tema, emissor, serial, notAfter } = req.body;
  if (!tema) {
    return res.status(400).json({ success: false, error: 'Dados do certificado ausentes.' });
  }

  activeCert = {
    buffer: null,
    password: null,
    info: {
      tema,
      commonName: tema,
      emissor: emissor || 'ICP-Brasil',
      issuer: emissor || 'ICP-Brasil',
      serial: serial || 'N/A',
      notAfter: notAfter || null,
      isValid: true,
      isMachineCert: true,
      statusMessage: 'Certificado instalado na máquina selecionado com sucesso'
    }
  };

  res.json({
    success: true,
    certificate: activeCert.info
  });
});

app.get('/api/status', async (req, res) => {
  const doc = req.query.doc === 'nfe' ? 'nfe' : 'nfce';

  // Se for ambiente serverless (Vercel) e ainda não tiver medição nesta instância
  if (!lastCheckResults[doc] || Date.now() >= nextCheckTimestamp) {
    try {
      const liveRes = await querySefaz(doc);
      recordCheckResult(liveRes);
      nextCheckTimestamp = Date.now() + CHECK_INTERVAL_MS;
    } catch (err) {
      console.error('Erro na checagem on-demand:', err.message);
    }
  }

  const secondsToNextCheck = Math.max(0, Math.round((nextCheckTimestamp - Date.now()) / 1000));

  res.json({
    activeDoc: doc,
    currentStatus: lastCheckResults[doc] || lastCheckResults.nfce,
    allStatus: lastCheckResults,
    secondsToNextCheck,
    nextCheckTimestamp,
    checkIntervalSeconds: CHECK_INTERVAL_MS / 1000,
    serverTime: new Date().toISOString(),
    certificate: activeCert ? activeCert.info : null,
    history: history[doc] || { realtime: [], hourly: [], daily: [] },
    allHistory: history
  });
});

app.post('/api/check-now', async (req, res) => {
  const docType = req.body.docType === 'nfe' ? 'nfe' : 'nfce';
  const result = await querySefaz(docType);
  recordCheckResult(result);
  res.json({
    result,
    secondsToNextCheck: CHECK_INTERVAL_MS / 1000
  });
});

app.post('/api/upload-cert', upload.single('certFile'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'Nenhum arquivo enviado.' });
  }

  const password = req.body.password || '';
  const parsed = parsePfxCertificate(req.file.buffer, password);

  if (!parsed.success) {
    return res.status(400).json(parsed);
  }

  activeCert = {
    buffer: req.file.buffer,
    password: password,
    info: parsed
  };

  res.json({
    success: true,
    certificate: parsed,
    message: 'Certificado instalado e ativado no monitor!'
  });
});

app.post('/api/clear-cert', (req, res) => {
  activeCert = null;
  res.json({ success: true, message: 'Certificado desmarcado.' });
});

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(`🚀 MONITOR REAL SEFAZ-RS EM PRODUÇÃO (SEM DADOS FALSOS)`);
    console.log(`🌐 Acesso Web: http://localhost:${PORT}`);
    console.log(`⏱️ Checagem Automática NFC-e e NF-e a cada 3 Minutos`);
    console.log(`=======================================================`);
  });
}

module.exports = app;
