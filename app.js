(() => {
  const datasets = [
    { name: 'Транспортные потоки', sub: 'Городские датчики', icon: '↗', type: 'Телеметрия', region: 'Центр', regionKey: 'center', quality: 99.2, updated: '2 мин назад', status: 'Активен' },
    { name: 'Городская мобильность', sub: 'Обезличенные GPS-треки', icon: '⌁', type: 'Геоданные', region: 'Север', regionKey: 'north', quality: 98.6, updated: '4 мин назад', status: 'Активен' },
    { name: 'Качество воздуха', sub: 'Станции мониторинга', icon: '⌖', type: 'Сенсорные данные', region: 'Центр', regionKey: 'center', quality: 99.8, updated: '1 мин назад', status: 'Активен' },
    { name: 'Пассажиропоток', sub: 'Умные остановки', icon: '⇄', type: 'Телеметрия', region: 'Юг', regionKey: 'south', quality: 97.4, updated: '7 мин назад', status: 'Активен' },
    { name: 'Погодные условия', sub: 'Метеостанции города', icon: '☼', type: 'Сенсорные данные', region: 'Север', regionKey: 'north', quality: 96.1, updated: '18 мин назад', status: 'Обслуживание' },
    { name: 'Городские события', sub: 'Обезличенная статистика', icon: '◌', type: 'Агрегированные', region: 'Юг', regionKey: 'south', quality: 99.4, updated: '5 мин назад', status: 'Активен' },
  ];

  const $ = (selector) => document.querySelector(selector);
  const numberFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
  const monthFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' });
  const dayMs = 24 * 60 * 60 * 1000;
  const today = new Date();
  const chartData = Array.from({ length: 90 }, (_, index) => {
    const date = new Date(today.getTime() - (89 - index) * dayMs);
    const wave = Math.sin(index * 0.29) * 6.1 + Math.sin(index * 0.73) * 2.6;
    const noise = ((index * 37 + 19) % 17) - 8;
    const value = Math.max(42, 61 + wave + noise * 0.75 + index * 0.025);
    const anomalyNoise = ((index * 29 + 11) % 51);
    const anomalies = Math.max(24, Math.round(103 + 43 * Math.sin(index * 0.32) + anomalyNoise));
    return { date, value, anomalies };
  });

  let activeDays = 30;
  let activeMetric = 'volume';
  let toastTimer;

  function formatVolume(millions) {
    if (millions >= 1000) return `${(millions / 1000).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} млрд`;
    return `${numberFormat.format(millions)} млн`;
  }

  function announce(message) {
    const toast = $('#toast');
    toast.textContent = message;
    toast.classList.add('visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('visible'), 3000);
  }

  function renderDatasets() {
    const query = $('#dataset-search').value.trim().toLocaleLowerCase('ru-RU');
    const region = $('#region-filter').value;
    const visible = datasets.filter((item) => {
      const matchesQuery = `${item.name} ${item.sub} ${item.type} ${item.region}`.toLocaleLowerCase('ru-RU').includes(query);
      return matchesQuery && (region === 'all' || item.regionKey === region);
    });
    const tbody = $('#dataset-rows');
    tbody.innerHTML = visible.map((item) => {
      const statusClass = item.status === 'Активен' ? '' : ' maintenance';
      return `<tr>
        <td><div class="source-cell"><span class="source-icon" aria-hidden="true">${item.icon}</span><span>${item.name}<small class="source-sub">${item.sub}</small></span></div></td>
        <td>${item.type}</td><td>${item.region}</td>
        <td><div class="quality-cell"><span class="quality-number">${item.quality.toLocaleString('ru-RU', { minimumFractionDigits: 1 })}%</span><span class="quality-bar"><i style="width:${item.quality}%"></i></span></div></td>
        <td>${item.updated}</td><td><span class="status-badge${statusClass}">${item.status}</span></td>
      </tr>`;
    }).join('');
    $('#empty-state').hidden = visible.length > 0;
    $('#dataset-count').textContent = `Показано ${visible.length} из ${datasets.length} наборов`;
  }

  function renderChart() {
    const points = chartData.slice(-activeDays);
    const anomalyMode = activeMetric === 'anomalies';
    const values = points.map((point) => anomalyMode ? point.anomalies : point.value);
    const total = values.reduce((sum, value) => sum + value, 0);
    const min = anomalyMode ? 0 : 0;
    const max = anomalyMode ? Math.ceil(Math.max(...values) / 100) * 100 : 80;
    const top = 18;
    const bottom = 246;
    const left = 2;
    const right = 798;
    const coordinates = values.map((value, index) => ({
      x: left + (right - left) * (index / Math.max(values.length - 1, 1)),
      y: bottom - ((value - min) / (max - min)) * (bottom - top),
    }));
    const linePath = coordinates.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
    const areaPath = `${linePath} L${right} ${bottom} L${left} ${bottom} Z`;
    const last = coordinates.at(-1);
    $('#chart-line').setAttribute('d', linePath);
    $('#chart-area').setAttribute('d', areaPath);
    $('#chart-point').setAttribute('cx', last.x.toFixed(1));
    $('#chart-point').setAttribute('cy', last.y.toFixed(1));
    $('#chart-total').textContent = anomalyMode ? `${numberFormat.format(total)} событий` : formatVolume(total);
    $('#total-events').innerHTML = anomalyMode
      ? `${numberFormat.format(total)} <small>событий</small>`
      : `${(total / 1000).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <small>млрд</small>`;
    $('#legend-label').textContent = anomalyMode ? 'Обнаружено аномалий' : 'Обработано событий';
    $('#main-chart').setAttribute('aria-label', `${anomalyMode ? 'График аномалий' : 'График объёма городских данных'} за последние ${activeDays} дней`);
    $('#axis-top').textContent = anomalyMode ? `${numberFormat.format(max)}` : `${max} млн`;
    $('#axis-mid').textContent = anomalyMode ? `${numberFormat.format(max * .5)}` : `${max * .75} млн`;
    $('#axis-lower').textContent = anomalyMode ? `${numberFormat.format(max * .25)}` : `${max * .5} млн`;
    $('#axis-quarter').textContent = anomalyMode ? `${numberFormat.format(max * .125)}` : `${max * .25} млн`;
    const ticks = [0, Math.floor((points.length - 1) / 3), Math.floor((points.length - 1) * 2 / 3), points.length - 1];
    $('#x-axis').innerHTML = [...new Set(ticks)].map((index) => `<span>${monthFormat.format(points[index].date).replace('.', '')}</span>`).join('');
  }

  function exportCsv() {
    const query = $('#dataset-search').value.trim().toLocaleLowerCase('ru-RU');
    const region = $('#region-filter').value;
    const visible = datasets.filter((item) => `${item.name} ${item.sub} ${item.type} ${item.region}`.toLocaleLowerCase('ru-RU').includes(query) && (region === 'all' || item.regionKey === region));
    const rows = [['Источник', 'Описание', 'Тип данных', 'Регион', 'Качество данных', 'Последнее обновление', 'Статус'], ...visible.map((item) => [item.name, item.sub, item.type, item.region, `${item.quality}%`, item.updated, item.status])];
    const csv = `\uFEFF${rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(';')).join('\r\n')}`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'citypulse-data-sources.csv';
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    announce(`Экспортировано наборов данных: ${visible.length}`);
  }

  $('#dataset-search').addEventListener('input', renderDatasets);
  $('#region-filter').addEventListener('change', renderDatasets);
  $('#export-button').addEventListener('click', exportCsv);
  $('#nav-export').addEventListener('click', exportCsv);
  $('#metric-select').addEventListener('change', (event) => {
    activeMetric = event.target.value;
    renderChart();
  });
  document.querySelectorAll('.period-switch button').forEach((button) => {
    button.addEventListener('click', () => {
      activeDays = Number(button.dataset.days);
      document.querySelectorAll('.period-switch button').forEach((candidate) => {
        const selected = candidate === button;
        candidate.classList.toggle('selected', selected);
        candidate.setAttribute('aria-pressed', String(selected));
      });
      renderChart();
    });
  });

  const themeToggle = $('#theme-toggle');
  themeToggle.addEventListener('click', () => {
    document.body.classList.toggle('dark');
    const isDark = document.body.classList.contains('dark');
    try { localStorage.setItem('citypulse-theme', isDark ? 'dark' : 'light'); } catch { /* Storage is optional. */ }
    announce(isDark ? 'Включена тёмная тема' : 'Включена светлая тема');
  });
  try {
    if (localStorage.getItem('citypulse-theme') === 'dark') document.body.classList.add('dark');
  } catch { /* Storage is optional. */ }

  $('#refresh-button').addEventListener('click', () => {
    $('#updated-at').textContent = 'только что';
    renderChart();
    announce('Демонстрационные данные обновлены');
  });
  $('#streams-more').addEventListener('click', () => announce('Источники данных показаны в демонстрационном режиме'));

  const menuButton = $('#menu-toggle');
  const sidebar = $('#sidebar');
  menuButton.addEventListener('click', () => {
    const isOpen = sidebar.classList.toggle('open');
    menuButton.setAttribute('aria-expanded', String(isOpen));
  });
  sidebar.querySelectorAll('a.nav-link').forEach((link) => {
    link.addEventListener('click', () => {
      sidebar.querySelectorAll('.nav-link').forEach((item) => {
        item.classList.toggle('active', item === link);
        if (item === link) item.setAttribute('aria-current', 'page');
        else item.removeAttribute('aria-current');
      });
      sidebar.classList.remove('open');
      menuButton.setAttribute('aria-expanded', 'false');
    });
  });

  renderDatasets();
  renderChart();
})();
