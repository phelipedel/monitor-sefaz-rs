/**
 * Gerenciador de Gráficos (Chart.js) - Monitor SEFAZ-RS
 * 100% PRODUÇÃO REAL - SEM DADOS FALSOS
 */

let myChartInstance = null;
let currentChartMode = 'line'; // 'line' | 'hourly' | 'daily'

const CATEGORY_LEVELS = {
  1: 'Normal: <= 2s',
  2: 'Lento: <= 5s',
  3: 'Muito lento: < 30s',
  4: 'Timeout: > 30s',
  5: 'Erro'
};

function latencyToLevel(latencyMs, isError = false, isTimeout = false) {
  if (isTimeout) return 4.0;
  if (isError) return 5.0;
  // Variação proporcional suave dentro de cada faixa para refletir oscilações reais na linha
  if (latencyMs <= 2000) {
    return 1.0 + (Math.min(latencyMs, 2000) / 2000) * 0.35; // entre 1.0 e 1.35
  }
  if (latencyMs <= 5000) {
    return 2.0 + ((latencyMs - 2000) / 3000) * 0.4; // entre 2.0 e 2.4
  }
  if (latencyMs < 30000) {
    return 3.0 + ((latencyMs - 5000) / 25000) * 0.4; // entre 3.0 e 3.4
  }
  return 4.0;
}

function getStatusColor(level) {
  switch (level) {
    case 1: return '#5aff3d'; // Normal
    case 2: return '#ffd600'; // Lento
    case 3: return '#ff9100'; // Muito lento
    case 4: return '#b388ff'; // Timeout
    case 5: return '#ff3d71'; // Erro
    default: return '#5aff3d';
  }
}

/**
 * Renderiza o gráfico com dados reais do documento ativo (NFC-e ou NF-e)
 */
function renderChart(mode, data, docType = 'nfce') {
  currentChartMode = mode;
  const canvas = document.getElementById('sefazChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  if (myChartInstance) {
    myChartInstance.destroy();
  }

  const docName = docType === 'nfe' ? 'NF-e' : 'NFC-e';

  if (mode === 'line') {
    renderLineChart(ctx, data?.realtime || [], docName);
  } else if (mode === 'hourly') {
    renderHourlyBarChart(ctx, data?.hourly || [], docName);
  } else if (mode === 'daily') {
    renderDailyBarChart(ctx, data?.daily || [], docName);
  }
}

/**
 * 1. Gráfico de Linha em Tempo Real (Janela em torno das últimas 2 horas)
 */
function renderLineChart(ctx, points, docName) {
  const chartTitle = document.getElementById('chartTitle');
  if (chartTitle) {
    chartTitle.innerHTML = `Tempo de resposta - <strong>${docName}</strong> (RS) <span style="font-size:12px; font-weight:normal; color:#94a3b8; margin-left:8px;">[Janela: Últimas 2h]</span>`;
  }

  // Filtra as medições ocorridas dentro da janela das últimas 2 horas (120 minutos)
  const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
  const now = Date.now();
  const pointsIn2h = (points || []).filter(p => (now - new Date(p.timestamp).getTime()) <= TWO_HOURS_MS);

  // Usa as medições das últimas 2h ou as últimas 40 medições
  const displayPoints = pointsIn2h.length ? pointsIn2h : (points || []).slice(-40);

  const labels = displayPoints.map(p => p.label);
  const values = displayPoints.map(p => {
    return latencyToLevel(p.latencyMs, p.cStat === 'ERROR', p.cStat === 'TIMEOUT');
  });
  const rawLatencies = displayPoints.map(p => p.latencyMs);

  myChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels.length ? labels : ['Aguardando medições (Janela de 2h)...'],
      datasets: [{
        label: `Tempo de resposta ${docName} (Últimas 2h)`,
        data: values.length ? values : [null],
        borderColor: '#29b6f6',
        backgroundColor: 'rgba(41, 182, 246, 0.1)',
        borderWidth: 2.5,
        tension: 0.1,
        pointBackgroundColor: values.map(v => Math.floor(v) >= 2 ? getStatusColor(Math.floor(v)) : '#29b6f6'),
        pointBorderColor: '#1b213b',
        pointBorderWidth: 2,
        pointRadius: values.map(v => Math.floor(v) >= 2 ? 7.5 : 5),
        pointHoverRadius: 9,
        fill: false
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1b213b',
          titleColor: '#f8fafc',
          bodyColor: '#5aff3d',
          borderColor: '#2a3359',
          borderWidth: 1,
          padding: 10,
          callbacks: {
            title: (items) => `Horário: ${items[0].label}`,
            label: (item) => {
              const idx = item.dataIndex;
              const pt = points[idx];
              if (!pt) return 'Sem dados';
              return [
                `Documento: ${docName} (RS)`,
                `Latência Real: ${rawLatencies[idx]} ms`,
                `Classificação: ${CATEGORY_LEVELS[item.raw] || 'Normal'}`,
                `SEFAZ: ${pt.xMotivo || 'Serviço em Operação'}`
              ];
            }
          }
        }
      },
      scales: {
        x: {
          grid: {
            color: 'rgba(255, 255, 255, 0.04)',
            borderColor: '#2a3359'
          },
          ticks: {
            color: '#64748b',
            font: { size: 11 },
            maxRotation: 45
          }
        },
        y: {
          min: 0.8,
          max: 5.2,
          grid: {
            color: 'rgba(255, 255, 255, 0.05)',
            borderColor: '#2a3359'
          },
          ticks: {
            stepSize: 1,
            color: '#94a3b8',
            font: { size: 12, weight: '600' },
            callback: (val) => CATEGORY_LEVELS[val] || ''
          }
        }
      }
    }
  });
}

/**
 * 2. Gráfico de Barras por Hora
 */
function renderHourlyBarChart(ctx, hourlyPoints, docName) {
  const chartTitle = document.getElementById('chartTitle');
  if (chartTitle) {
    chartTitle.innerText = `Tempo médio de resposta por hora - ${docName} (RS)`;
  }

  const labels = hourlyPoints.map(h => h.label);
  const values = hourlyPoints.map(h => latencyToLevel(h.avgLatencyMs));
  const barColors = values.map(val => getStatusColor(val));

  myChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels.length ? labels : ['Aguardando medições horárias...'],
      datasets: [{
        label: `Média por Hora ${docName}`,
        data: values.length ? values : [null],
        backgroundColor: barColors,
        borderRadius: 4,
        borderSkipped: false,
        maxBarThickness: 20
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1b213b',
          titleColor: '#f8fafc',
          bodyColor: '#5aff3d',
          borderColor: '#2a3359',
          borderWidth: 1,
          padding: 10,
          callbacks: {
            title: (items) => `Dia / Hora: ${items[0].label}`,
            label: (item) => {
              const pt = hourlyPoints[item.dataIndex];
              if (!pt) return 'Sem dados';
              return [
                `Documento: ${docName} (RS)`,
                `Latência Média: ${pt.avgLatencyMs} ms`,
                `Classificação: ${CATEGORY_LEVELS[item.raw]}`
              ];
            }
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            color: '#64748b',
            font: { size: 11 },
            maxRotation: 45
          }
        },
        y: {
          min: 0,
          max: 5.2,
          grid: {
            color: 'rgba(255, 255, 255, 0.05)'
          },
          ticks: {
            stepSize: 1,
            color: '#94a3b8',
            font: { size: 12, weight: '600' },
            callback: (val) => CATEGORY_LEVELS[val] || ''
          }
        }
      }
    }
  });
}

/**
 * 3. Gráfico de Barras por Dia
 */
function renderDailyBarChart(ctx, dailyPoints, docName) {
  const chartTitle = document.getElementById('chartTitle');
  if (chartTitle) {
    chartTitle.innerText = `Tempo médio de resposta por dia - ${docName} (RS)`;
  }

  const labels = dailyPoints.map(d => d.label);
  const values = dailyPoints.map(d => latencyToLevel(d.avgLatencyMs));
  const barColors = values.map(val => getStatusColor(val));

  myChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels.length ? labels : ['Aguardando medições diárias...'],
      datasets: [{
        label: `Média por Dia ${docName}`,
        data: values.length ? values : [null],
        backgroundColor: barColors,
        borderRadius: 4,
        borderSkipped: false,
        maxBarThickness: 24
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1b213b',
          titleColor: '#f8fafc',
          bodyColor: '#5aff3d',
          borderColor: '#2a3359',
          borderWidth: 1,
          padding: 10,
          callbacks: {
            title: (items) => `Dia do Mês: ${items[0].label}`,
            label: (item) => {
              const pt = dailyPoints[item.dataIndex];
              if (!pt) return 'Sem dados';
              return [
                `Documento: ${docName} (RS)`,
                `Latência Média: ${pt.avgLatencyMs} ms`,
                `Classificação: ${CATEGORY_LEVELS[item.raw]}`
              ];
            }
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            color: '#64748b',
            font: { size: 12 }
          }
        },
        y: {
          min: 0,
          max: 5.2,
          grid: {
            color: 'rgba(255, 255, 255, 0.05)'
          },
          ticks: {
            stepSize: 1,
            color: '#94a3b8',
            font: { size: 12, weight: '600' },
            callback: (val) => CATEGORY_LEVELS[val] || ''
          }
        }
      }
    }
  });
}
