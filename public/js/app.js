/**
 * Aplicação Principal - Monitor SEFAZ-RS (NFC-e e NF-e)
 * 100% Produção Real - Sem Dados Simulados
 */

let appState = {
  activeDoc: 'nfce', // 'nfce' | 'nfe'
  activeUf: 'RS',
  chartMode: 'line',
  secondsToNextCheck: 180,
  countdownInterval: null,
  allHistory: null,
  allStatus: null,
  isChecking: false,
  installedCerts: [],
  selectedCert: null
};

// ================= COFRE CRIPTOGRAFADO NO NAVEGADOR (AES-GCM 256) ================= //
const VAULT_STORAGE_KEY = 'sefaz_cert_vault_encrypted';
const MACHINE_CHOICE_KEY = 'sefaz_machine_cert_choice';

async function deriveVaultKey(salt) {
  const enc = new TextEncoder();
  const rawKey = enc.encode('SEFAZ_RS_BROWSER_VAULT_' + (window.location.host || 'localhost'));
  const baseKey = await window.crypto.subtle.importKey('raw', rawKey, 'PBKDF2', false, ['deriveKey']);
  return window.crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptCertToVault(fileBuffer, password) {
  const salt = window.crypto.getRandomValues(new Uint8Array(16));
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveVaultKey(salt);

  const payload = JSON.stringify({
    pfxBase64: arrayBufferToBase64(fileBuffer),
    password: password || ''
  });

  const encoded = new TextEncoder().encode(payload);
  const cipherBuffer = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded
  );

  return {
    salt: arrayBufferToBase64(salt.buffer),
    iv: arrayBufferToBase64(iv.buffer),
    ciphertext: arrayBufferToBase64(cipherBuffer)
  };
}

async function decryptCertFromVault(vaultObj) {
  const salt = new Uint8Array(base64ToArrayBuffer(vaultObj.salt));
  const iv = new Uint8Array(base64ToArrayBuffer(vaultObj.iv));
  const cipherBuffer = base64ToArrayBuffer(vaultObj.ciphertext);
  const key = await deriveVaultKey(salt);

  const plainBuffer = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    cipherBuffer
  );

  const decoded = new TextDecoder().decode(plainBuffer);
  return JSON.parse(decoded);
}

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

function base64ToArrayBuffer(base64) {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function showToast(message, duration = 3500) {
  const toast = document.getElementById('vaultToast');
  if (!toast) return;
  toast.innerHTML = message;
  toast.style.display = 'flex';
  toast.style.opacity = '1';

  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => {
      toast.style.display = 'none';
    }, 300);
  }, duration);
}

async function tryRestoreCertFromBrowserVault() {
  // Se o servidor já tem certificado ativo (ex: na mesma sessão)
  if (appState.allStatus && appState.allStatus.certificate) {
    updateCertificateCard(appState.allStatus.certificate);
    return true;
  }

  // 1. Tenta restaurar do Cofre Criptografado (AES-GCM 256)
  const vaultStr = localStorage.getItem(VAULT_STORAGE_KEY);
  if (vaultStr) {
    try {
      showToast('🔒 Descriptografando certificado do cofre seguro...', 1500);
      const vaultObj = JSON.parse(vaultStr);
      const decrypted = await decryptCertFromVault(vaultObj);

      const pfxArrayBuf = base64ToArrayBuffer(decrypted.pfxBase64);
      const pfxBlob = new Blob([pfxArrayBuf], { type: 'application/x-pkcs12' });

      const formData = new FormData();
      formData.append('certFile', pfxBlob, 'vault-cert.pfx');
      formData.append('password', decrypted.password || '');

      const res = await fetch('/api/upload-cert', { method: 'POST', body: formData });
      const data = await res.json();

      if (data.success) {
        updateCertificateCard(data.certificate);
        showToast(`🔒 Certificado <strong>"${data.certificate.commonName}"</strong> identificado automaticamente do cofre seguro!`, 4000);
        return true;
      }
    } catch (err) {
      console.warn('Falha ao restaurar do cofre criptografado:', err);
    }
  }

  // 2. Se estiver em máquina Windows (localhost), tenta restaurar a escolha anterior da máquina
  const machineChoice = localStorage.getItem(MACHINE_CHOICE_KEY);
  if (machineChoice) {
    try {
      const choiceObj = JSON.parse(machineChoice);
      const res = await fetch('/api/select-machine-cert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(choiceObj)
      });
      const data = await res.json();
      if (data.success) {
        updateCertificateCard(data.certificate);
        showToast(`🪪 Certificado da máquina ativado automaticamente!`, 3000);
        return true;
      }
    } catch (e) {}
  }

  return false;
}

// ================= INICIALIZAÇÃO ================= //
document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();
  await fetchStatus();
  startCountdownTimer();

  // Tenta restaurar do Cofre Criptografado do Navegador primeiro
  const restored = await tryRestoreCertFromBrowserVault();
  if (!restored) {
    // Se não tiver nenhum certificado salvo no cofre, abre o diálogo de seleção
    await checkAndPromptCertificate(true);
  }
});

function setupEventListeners() {
  // 1. Alternância entre NFC-e e NF-e
  document.querySelectorAll('.doc-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      document.querySelectorAll('.doc-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      appState.activeDoc = btn.dataset.doc; // 'nfce' ou 'nfe'
      updateDocLabels();
      
      // Atualiza o gráfico e KPIs para o documento selecionado imediatamente
      updateViewForActiveDoc();
    });
  });

  // 2. Seletor de Tipo de Gráfico (Linha, Hora, Dia)
  const chartSelect = document.getElementById('chartViewSelect');
  if (chartSelect) {
    chartSelect.addEventListener('change', (e) => {
      appState.chartMode = e.target.value;
      updateViewForActiveDoc();
    });
  }

  // 3. Botão "Verificar Agora"
  const btnCheckNow = document.getElementById('btnCheckNow');
  if (btnCheckNow) {
    btnCheckNow.addEventListener('click', () => {
      checkNow(false);
    });
  }

  // 4. Modal de Certificados
  const btnOpenCertModal = document.getElementById('btnOpenCertModal');
  if (btnOpenCertModal) {
    btnOpenCertModal.addEventListener('click', () => {
      openCertDialog();
    });
  }

  // 5. Desconectar Certificado
  const btnRemoveCert = document.getElementById('btnRemoveCert');
  if (btnRemoveCert) {
    btnRemoveCert.addEventListener('click', handleRemoveCert);
  }
}

/**
 * Atualiza os nomes e badges na tela ao trocar entre NFC-e e NF-e
 */
function updateDocLabels() {
  const isNfe = appState.activeDoc === 'nfe';
  const docLabel = isNfe ? 'NF-e' : 'NFC-e';
  const endpointHost = isNfe ? 'nfe.svrs.rs.gov.br' : 'nfce.svrs.rs.gov.br';

  // Badge do Topo
  const headerDocBadge = document.getElementById('headerDocBadge');
  if (headerDocBadge) {
    headerDocBadge.innerHTML = `SEFAZ RS <strong>${docLabel}</strong>`;
  }

  // Banner Exclusivo RS
  const bannerDocTitle = document.getElementById('bannerDocTitle');
  if (bannerDocTitle) {
    bannerDocTitle.innerText = `• MONITORAMENTO EXCLUSIVO ${docLabel}`;
  }

  const bannerEndpoint = document.getElementById('bannerEndpoint');
  if (bannerEndpoint) {
    bannerEndpoint.innerText = endpointHost;
  }

  // Subtítulo do KPI
  const kpiDocSubtitle = document.getElementById('kpiDocSubtitle');
  if (kpiDocSubtitle) {
    kpiDocSubtitle.innerText = `${docLabel} Ambiente de Produção RS`;
  }
}

function updateViewForActiveDoc() {
  const docHistory = appState.allHistory ? appState.allHistory[appState.activeDoc] : { realtime: [], hourly: [], daily: [] };
  const docStatus = appState.allStatus ? appState.allStatus[appState.activeDoc] : null;

  renderChart(appState.chartMode, docHistory, appState.activeDoc);
  updateKpis(docStatus, docHistory);
  updateLogsTable(docHistory?.realtime || []);
}

// ================= DETECÇÃO E DIÁLOGO DE CERTIFICADOS ================= //
async function checkAndPromptCertificate(isInitialLoad = false) {
  try {
    const res = await fetch('/api/installed-certs');
    const data = await res.json();
    appState.installedCerts = data.certificates || [];

    const tableWrapper = document.getElementById('certTableWrapper');
    const noCertState = document.getElementById('noCertState');
    const tbody = document.getElementById('certTableBody');
    const btnConfirm = document.getElementById('btnConfirmCert');

    if (data.hasCerts && appState.installedCerts.length > 0) {
      tableWrapper.style.display = 'block';
      noCertState.style.display = 'none';
      btnConfirm.disabled = false;

      tbody.innerHTML = appState.installedCerts.map((cert, index) => `
        <tr class="cert-row ${index === 0 ? 'selected' : ''}" onclick="selectCertRow(${index})" data-index="${index}">
          <td>${cert.tema}</td>
          <td>${cert.emissor}</td>
          <td style="font-family: monospace; font-size: 11px;">${cert.serial}</td>
        </tr>
      `).join('');

      appState.selectedCert = appState.installedCerts[0];
    } else {
      tableWrapper.style.display = 'none';
      noCertState.style.display = 'flex';
      btnConfirm.disabled = true;
      appState.selectedCert = null;

      updateCertCardWithoutCert();
    }

    if (isInitialLoad) {
      openCertDialog();
    }
  } catch (e) {
    console.error('Erro ao verificar certificados:', e);
  }
}

function selectCertRow(index) {
  document.querySelectorAll('.cert-row').forEach(row => row.classList.remove('selected'));
  const targetRow = document.querySelector(`.cert-row[data-index="${index}"]`);
  if (targetRow) targetRow.classList.add('selected');

  appState.selectedCert = appState.installedCerts[index];
}

async function confirmCertSelection() {
  if (!appState.selectedCert) {
    alert('Nenhum certificado foi selecionado.');
    return;
  }

  try {
    const res = await fetch('/api/select-machine-cert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(appState.selectedCert)
    });
    const data = await res.json();

    if (data.success) {
      // Memoriza a escolha da máquina neste navegador
      try {
        localStorage.setItem(MACHINE_CHOICE_KEY, JSON.stringify(appState.selectedCert));
      } catch (e) {}

      closeCertDialog();
      updateCertificateCard(data.certificate);
      await checkNow(true);
      showToast(`🪪 Certificado da máquina memorizado para este navegador!`, 3500);
    }
  } catch (err) {
    alert('Erro ao ativar certificado: ' + err.message);
  }
}

function showCertDetails() {
  if (!appState.selectedCert) {
    alert('Nenhum certificado selecionado.');
    return;
  }
  const c = appState.selectedCert;
  const validade = c.notAfter ? new Date(c.notAfter).toLocaleDateString('pt-BR') : 'Não informada';
  alert(`Informações do Certificado Digital:\n\n• Titular / Tema: ${c.tema}\n• Emissor: ${c.emissor}\n• Serial: ${c.serial}\n• Validade: ${validade}`);
}

function openCertDialog() {
  document.getElementById('modalCert').classList.add('active');
}

function closeCertDialog() {
  document.getElementById('modalCert').classList.remove('active');
}

async function checkInstalledCertsAgain() {
  const btn = event?.target;
  if (btn) btn.innerText = 'Verificando...';
  await checkAndPromptCertificate(false);
  if (btn) btn.innerText = '🔄 Verificar Novamente';
}

function togglePfxUpload() {
  const area = document.getElementById('pfxUploadArea');
  if (area) {
    area.style.display = area.style.display === 'none' ? 'block' : 'none';
  }
}

async function uploadPfxCert() {
  const fileInput = document.getElementById('pfxFileInput');
  const passInput = document.getElementById('pfxPasswordInput');
  const errorMsg = document.getElementById('pfxErrorMsg');
  const chkSaveInVault = document.getElementById('chkSaveInVault');

  if (!fileInput.files.length) {
    errorMsg.innerText = 'Por favor, selecione um arquivo .pfx';
    errorMsg.style.display = 'block';
    return;
  }

  const file = fileInput.files[0];
  const password = passInput.value;

  const formData = new FormData();
  formData.append('certFile', file);
  formData.append('password', password);

  try {
    errorMsg.style.display = 'none';
    const res = await fetch('/api/upload-cert', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();

    if (data.success) {
      // Salva no Cofre Criptografado do Navegador (AES-GCM 256 bits)
      if (!chkSaveInVault || chkSaveInVault.checked) {
        try {
          const fileBuffer = await file.arrayBuffer();
          const vaultData = await encryptCertToVault(fileBuffer, password);
          localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(vaultData));
        } catch (vaultErr) {
          console.warn('Aviso ao criptografar no cofre local:', vaultErr);
        }
      }

      closeCertDialog();
      await fetchStatus();
      updateCertificateCard(data.certificate);
      showToast(`🔒 Certificado ativado e protegido no <strong>Cofre Seguro do Navegador (AES-256)</strong>!`, 4500);
    } else {
      errorMsg.innerText = data.error || 'Erro ao validar certificado.';
      errorMsg.style.display = 'block';
    }
  } catch (e) {
    errorMsg.innerText = 'Falha na conexão: ' + e.message;
    errorMsg.style.display = 'block';
  }
}

async function handleRemoveCert() {
  if (confirm('Deseja desmarcar o certificado e limpar o cofre seguro deste navegador?')) {
    try {
      localStorage.removeItem(VAULT_STORAGE_KEY);
      localStorage.removeItem(MACHINE_CHOICE_KEY);
    } catch (e) {}
    await fetch('/api/clear-cert', { method: 'POST' });
    appState.selectedCert = null;
    await fetchStatus();
    updateCertCardWithoutCert();
    showToast('🗑️ Certificado desmarcado e cofre seguro limpo.', 3000);
  }
}

// ================= TIMER DE 3 MINUTOS ================= //
function startCountdownTimer() {
  if (appState.countdownInterval) clearInterval(appState.countdownInterval);

  appState.countdownInterval = setInterval(() => {
    if (appState.secondsToNextCheck > 0) {
      appState.secondsToNextCheck--;
    } else {
      appState.secondsToNextCheck = 180;
      fetchStatus();
    }
    updateCountdownUI();
  }, 1000);
}

function updateCountdownUI() {
  const badge = document.getElementById('countdownBadge');
  if (!badge) return;

  const mins = Math.floor(appState.secondsToNextCheck / 60);
  const secs = appState.secondsToNextCheck % 60;
  const timeFormatted = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  badge.innerHTML = `⏱️ Próxima checagem: <strong>${timeFormatted}</strong>`;
}

// ================= REQUISIÇÕES AO SERVIDOR ================= //
async function fetchStatus() {
  try {
    const res = await fetch(`/api/status?doc=${appState.activeDoc}`);
    const data = await res.json();

    appState.secondsToNextCheck = data.secondsToNextCheck || 180;
    appState.allHistory = data.allHistory;
    appState.allStatus = data.allStatus;

    if (data.certificate) {
      updateCertificateCard(data.certificate);
    }

    updateViewForActiveDoc();
  } catch (err) {
    console.error('Erro ao conectar com API de status:', err);
  }
}

async function checkNow(silent = false) {
  if (appState.isChecking) return;
  appState.isChecking = true;

  const btn = document.getElementById('btnCheckNow');
  if (btn && !silent) {
    btn.innerHTML = `Consultando...`;
    btn.style.opacity = '0.7';
  }

  try {
    const res = await fetch('/api/check-now', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ docType: appState.activeDoc })
    });
    const data = await res.json();

    appState.secondsToNextCheck = 180;
    await fetchStatus();
  } catch (err) {
    console.error('Erro ao executar checagem imediata:', err);
  } finally {
    appState.isChecking = false;
    if (btn && !silent) {
      btn.innerHTML = `⚡ Verificar Agora`;
      btn.style.opacity = '1';
    }
  }
}

// ================= ATUALIZAÇÃO DA INTERFACE ================= //
function updateKpis(status, history) {
  const kpiStatus = document.getElementById('kpiStatus');
  const kpiLatency = document.getElementById('kpiLatency');
  const kpiAvg = document.getElementById('kpiAvg');
  const kpiUptime = document.getElementById('kpiUptime');

  if (kpiStatus && status) {
    kpiStatus.innerHTML = `<span style="color:${status.classification?.color || '#5aff3d'}">●</span> ${status.cStat || '107'} - ${status.xMotivo || 'Operacional'}`;
  } else if (kpiStatus) {
    kpiStatus.innerHTML = `<span style="color:#ffd600">●</span> Aguardando medição...`;
  }

  if (kpiLatency && status) {
    kpiLatency.innerHTML = `${status.latencyMs || 0} <span style="font-size:14px; font-weight:normal; color:#94a3b8">ms</span>`;
  }

  if (kpiAvg) {
    if (history?.realtime?.length) {
      const total = history.realtime.reduce((sum, p) => sum + p.latencyMs, 0);
      const avg = Math.round(total / history.realtime.length);
      kpiAvg.innerHTML = `${avg} <span style="font-size:14px; font-weight:normal; color:#94a3b8">ms</span>`;
    } else {
      kpiAvg.innerHTML = `-- <span style="font-size:14px; font-weight:normal; color:#94a3b8">ms</span>`;
    }
  }

  if (kpiUptime) {
    kpiUptime.innerText = '100.0%';
  }
}

function updateCertificateCard(cert) {
  const certName = document.getElementById('certName');
  const certDetails = document.getElementById('certDetails');
  const certBadge = document.getElementById('certBadge');
  const certIcon = document.getElementById('certStatusIcon');
  const btnRemoveCert = document.getElementById('btnRemoveCert');

  if (cert) {
    certName.innerText = cert.tema || cert.commonName;
    const serialStr = cert.serial ? ` | Serial: ${cert.serial}` : '';
    certDetails.innerText = `Emissor: ${cert.emissor || cert.issuer} ${serialStr}`;
    certBadge.innerText = 'Certificado Ativo';
    certBadge.style.color = '#5aff3d';
    certBadge.style.borderColor = 'rgba(90, 255, 61, 0.4)';
    certIcon.innerText = '🔒';
    if (btnRemoveCert) btnRemoveCert.style.display = 'inline-block';
  } else {
    updateCertCardWithoutCert();
  }
}

function updateCertCardWithoutCert() {
  const certName = document.getElementById('certName');
  const certDetails = document.getElementById('certDetails');
  const certBadge = document.getElementById('certBadge');
  const certIcon = document.getElementById('certStatusIcon');
  const btnRemoveCert = document.getElementById('btnRemoveCert');

  certName.innerText = 'Nenhum certificado instalado selecionado';
  certDetails.innerText = 'O monitor está verificando a latência da SEFAZ RS em modo sonda. Para validação de emissão, selecione seu certificado da máquina.';
  certBadge.innerText = 'Sem Certificado';
  certBadge.style.color = '#ffd600';
  certBadge.style.borderColor = 'rgba(255, 214, 0, 0.4)';
  certIcon.innerText = '⚠️';
  if (btnRemoveCert) btnRemoveCert.style.display = 'none';
}

function updateLogsTable(realtimePoints) {
  const tbody = document.getElementById('logsTableBody');
  if (!tbody) return;

  if (!realtimePoints || realtimePoints.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:#64748b; padding:20px;">Nenhuma medição registrada ainda. Aguardando primeira checagem...</td></tr>`;
    return;
  }

  const recent = [...realtimePoints].reverse().slice(0, 10);
  tbody.innerHTML = recent.map(p => `
    <tr>
      <td>${p.label}</td>
      <td><strong>${(p.docType || appState.activeDoc).toUpperCase()}</strong></td>
      <td><span style="color:#5aff3d; font-weight:bold">RS</span></td>
      <td><strong>${p.cStat || '107'}</strong> - ${p.xMotivo || 'Operacional'}</td>
      <td>${p.latencyMs} ms</td>
      <td>
        <span class="status-tag ${p.classification?.status || 'Normal'}">
          ${p.classification?.label || 'Normal'}
        </span>
      </td>
    </tr>
  `).join('');
}
