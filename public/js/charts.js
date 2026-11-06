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
  if (isTimeout) return 4;
  if (isError) return 5;
  if (latencyMs <= 2000) return 1;
  if (latencyMs <= 5000) return 2;
  if (latencyMs < 30000) return 3;
  return 4;
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
 * 1. Gráfico de Linha em Tempo Real
 */
function renderLineChart(ctx, points, docName) {
  const chartTitle = document.getElementById('chartTitle');
  if (chartTitle) {
    chartTitle.innerText = `Tempo de resposta - ${docName} (RS)`;
  }

  const labels = points.map(p => p.label);
  const values = points.map(p => {
    return latencyToLevel(p.latencyMs, p.cStat === 'ERROR', p.cStat === 'TIMEOUT');
  });
  const rawLatencies = points.map(p => p.latencyMs);

  myChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels.length ? labels : ['Aguardando primeira medição...'],
      datasets: [{
        label: `Tempo de resposta ${docName}`,
        data: values.length ? values : [null],
        borderColor: '#29b6f6',
        backgroundColor: 'rgba(41, 182, 246, 0.1)',
        borderWidth: 2.5,
        tension: 0.1,
        pointBackgroundColor: '#29b6f6',
        pointBorderColor: '#1b213b',
        pointBorderWidth: 2,
        pointRadius: 5,
        pointHoverRadius: 8,
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
