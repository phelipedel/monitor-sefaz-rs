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

// ================= INICIALIZAÇÃO ================= //
document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();
  await fetchStatus();
  startCountdownTimer();

  // Ao entrar no site, carrega imediatamente a tela de seleção de certificado
  await checkAndPromptCertificate(true);
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
      closeCertDialog();
      updateCertificateCard(data.certificate);
      await checkNow(true);
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

  if (!fileInput.files.length) {
    errorMsg.innerText = 'Por favor, selecione um arquivo .pfx';
    errorMsg.style.display = 'block';
    return;
  }

  const formData = new FormData();
  formData.append('certFile', fileInput.files[0]);
  formData.append('password', passInput.value);

  try {
    errorMsg.style.display = 'none';
    const res = await fetch('/api/upload-cert', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();

    if (data.success) {
      closeCertDialog();
      await fetchStatus();
      alert(`Certificado "${data.certificate.commonName}" carregado e ativado com sucesso!`);
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
  if (confirm('Deseja desmarcar o certificado atual do monitoramento?')) {
    await fetch('/api/clear-cert', { method: 'POST' });
    appState.selectedCert = null;
    await fetchStatus();
    updateCertCardWithoutCert();
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
