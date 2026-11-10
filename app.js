(() => {
  const cities = {
    almaty: { name: 'Алматы', latitude: 43.2389, longitude: 76.8897 },
    astana: { name: 'Астана', latitude: 51.1694, longitude: 71.4491 },
    shymkent: { name: 'Шымкент', latitude: 42.3417, longitude: 69.5901 },
  };
  const metrics = {
    us_aqi: { label: 'US AQI', unit: '', step: 25 },
    pm2_5: { label: 'PM₂.₅', unit: 'мкг/м³', step: 10 },
    pm10: { label: 'PM₁₀', unit: 'мкг/м³', step: 10 },
  };
  const $ = (selector) => document.querySelector(selector);
  const numberFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
  const apiCache = new Map();
  const cacheLifetime = 15 * 60 * 1000;
  let activeData = null;
  let activeCityKey = 'almaty';
  let activeHours = 24;
  let activeMetric = 'us_aqi';
  let requestSequence = 0;
  let toastTimer;

  function formatNumber(value) {
    return Number.isFinite(value) ? numberFormat.format(value) : '—';
  }

  function formatCityTime(unixSeconds, timeZone, withDate = false) {
    if (!Number.isFinite(unixSeconds)) return 'время не указано';
    const options = withDate
      ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone }
      : { hour: '2-digit', minute: '2-digit', timeZone };
    return new Intl.DateTimeFormat('ru-RU', options).format(new Date(unixSeconds * 1000));
  }

  function announce(message) {
    const toast = $('#toast');
    toast.textContent = message;
    toast.classList.add('visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('visible'), 3200);
  }

  function setConnectionState(state, message) {
    const status = $('#connection-status');
    status.classList.toggle('state-error', state === 'error');
    status.classList.toggle('state-loading', state === 'loading');
    $('#connection-label').textContent = message;
  }

  function setLoading(isLoading) {
    $('#refresh-button').disabled = isLoading;
    $('#city-select').disabled = isLoading;
    if (isLoading) setConnectionState('loading', 'ПОЛУЧАЕМ МОДЕЛЬ');
  }

  function makeApiUrl(city) {
    const url = new URL('https://air-quality-api.open-meteo.com/v1/air-quality');
    url.search = new URLSearchParams({
      latitude: city.latitude,
      longitude: city.longitude,
      current: 'us_aqi,pm2_5,pm10,nitrogen_dioxide,ozone',
      hourly: 'us_aqi,pm2_5,pm10',
      past_hours: '23',
      forecast_hours: '1',
      timezone: 'auto',
      timeformat: 'unixtime',
      domains: 'cams_global',
    }).toString();
    return url;
  }

  function setKpi(id, value, unit = '') {
    $(`#${id}`).innerHTML = `${formatNumber(value)} <small>${unit}</small>`;
  }

  function renderCurrent(data) {
    const current = data.current;
    const city = cities[activeCityKey];
    $('#aqi-value').innerHTML = `${formatNumber(current.us_aqi)} <small>US AQI</small>`;
    setKpi('pm25-value', current.pm2_5, 'мкг/м³');
    setKpi('pm10-value', current.pm10, 'мкг/м³');
    setKpi('no2-value', current.nitrogen_dioxide, 'мкг/м³');
    $('#aqi-note').textContent = 'Индекс рассчитан моделью CAMS';
    $('#updated-at').textContent = `${city.name} · ${formatCityTime(current.time, data.timezone, true)}`;
  }

  function niceMaximum(value, step) {
    return Math.max(step, Math.ceil(value / step) * step);
  }

  function renderChart() {
    const chartEmpty = $('#chart-empty');
    const hourly = activeData?.hourly;
    const definition = metrics[activeMetric];
    if (!hourly || !Array.isArray(hourly[activeMetric])) {
      $('#chart-line').setAttribute('d', '');
      $('#chart-area').setAttribute('d', '');
      $('#x-axis').innerHTML = '';
      $('#chart-total').textContent = '—';
      chartEmpty.hidden = false;
      return;
    }

    const allPoints = hourly.time.map((time, index) => ({
      time,
      value: hourly[activeMetric][index],
      pm25: hourly.pm2_5?.[index],
      pm10: hourly.pm10?.[index],
      aqi: hourly.us_aqi?.[index],
    })).filter((point) => Number.isFinite(point.time) && Number.isFinite(point.value));
    const points = allPoints.slice(-activeHours);
    if (!points.length) {
      chartEmpty.hidden = false;
      return;
    }
    chartEmpty.hidden = true;

    const values = points.map((point) => point.value);
    const topValue = niceMaximum(Math.max(...values) * 1.08, definition.step);
    const bottom = 246;
    const top = 18;
    const coordinates = values.map((value, index) => ({
      x: 2 + 796 * (index / Math.max(values.length - 1, 1)),
      y: bottom - (Math.max(value, 0) / topValue) * (bottom - top),
    }));
    const linePath = coordinates.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
    const areaPath = `${linePath} L798 ${bottom} L2 ${bottom} Z`;
    const last = coordinates.at(-1);
    $('#chart-line').setAttribute('d', linePath);
    $('#chart-area').setAttribute('d', areaPath);
    $('#chart-point').setAttribute('cx', last.x.toFixed(1));
    $('#chart-point').setAttribute('cy', last.y.toFixed(1));
    $('#chart-total').textContent = `${formatNumber(values.at(-1))}${definition.unit ? ` ${definition.unit}` : ''}`;
    $('#chart-unit').textContent = `${definition.label} · модельная оценка`;
    $('#legend-label').textContent = `${definition.label}${definition.unit ? ` · ${definition.unit}` : ''}`;
    $('#main-chart').setAttribute('aria-label', `Почасовой график ${definition.label} за последние ${activeHours} часов`);
    $('#axis-top').textContent = formatNumber(topValue);
    $('#axis-mid').textContent = formatNumber(topValue * .75);
    $('#axis-lower').textContent = formatNumber(topValue * .5);
    $('#axis-quarter').textContent = formatNumber(topValue * .25);

    const tickIndices = [...new Set([0, Math.floor((points.length - 1) / 3), Math.floor((points.length - 1) * 2 / 3), points.length - 1])];
    const timeFormatter = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: activeData.timezone || 'Asia/Almaty' });
    $('#x-axis').innerHTML = tickIndices.map((index) => `<span>${timeFormatter.format(new Date(points[index].time * 1000))}</span>`).join('');
  }

  function renderHourlyTable(data) {
    const hourly = data.hourly;
    const records = hourly.time.map((time, index) => ({
      time,
      aqi: hourly.us_aqi?.[index],
      pm25: hourly.pm2_5?.[index],
      pm10: hourly.pm10?.[index],
    })).filter((row) => Number.isFinite(row.time)).slice(-24).reverse();
    const rows = records.map((row) => `<tr>
      <td>${formatCityTime(row.time, data.timezone, true)}</td>
      <td>${formatNumber(row.aqi)}</td>
      <td>${formatNumber(row.pm25)}</td>
      <td>${formatNumber(row.pm10)}</td>
      <td><span class="status-badge model-badge">CAMS · модель</span></td>
    </tr>`).join('');
    $('#hourly-rows').innerHTML = rows;
    $('#empty-state').hidden = records.length > 0;
    $('#empty-state').textContent = records.length ? '' : 'Для этого города пока нет часовых значений.';
    $('#table-count').textContent = records.length ? `Показано ${records.length} часовых значений` : 'Нет строк данных';
    $('#export-button').disabled = records.length === 0;
  }

  function renderData(data) {
    activeData = data;
    renderCurrent(data);
    renderChart();
    renderHourlyTable(data);
    setConnectionState('ready', 'МОДЕЛЬНЫЕ ДАННЫЕ');
  }

  function showError(error) {
    activeData = null;
    setConnectionState('error', 'НЕТ СВЯЗИ С API');
    $('#updated-at').textContent = 'Не удалось получить данные';
    $('#aqi-value').innerHTML = '— <small>US AQI</small>';
    for (const id of ['pm25-value', 'pm10-value', 'no2-value']) $(`#${id}`).innerHTML = '— <small>мкг/м³</small>';
    $('#aqi-note').textContent = 'Источник временно недоступен';
    $('#chart-line').setAttribute('d', '');
    $('#chart-area').setAttribute('d', '');
    $('#chart-point').setAttribute('cx', '0');
    $('#chart-point').setAttribute('cy', '0');
    $('#chart-empty').hidden = false;
    $('#chart-total').textContent = '—';
    $('#chart-unit').textContent = 'Данные не загружены';
    $('#hourly-rows').innerHTML = '';
    $('#empty-state').hidden = false;
    $('#empty-state').textContent = 'Не удалось загрузить данные. Проверьте подключение и попробуйте обновить.';
    $('#table-count').textContent = 'Данные не загружены';
    $('#export-button').disabled = true;
    console.error('CityPulse data request failed:', error);
  }

  let currentController = null;
  async function loadCity(cityKey, force = false) {
    const cityChanged = cityKey !== activeCityKey;
    activeCityKey = cityKey;
    const sequence = ++requestSequence;
    if (currentController) currentController.abort();
    const controller = new AbortController();
    currentController = controller;
    setLoading(true);
    const city = cities[cityKey];
    if (cityChanged) {
      activeData = null;
      $('#updated-at').textContent = `${city.name} · получаем модельные данные…`;
      $('#aqi-value').innerHTML = '— <small>US AQI</small>';
      for (const id of ['pm25-value', 'pm10-value', 'no2-value']) $(`#${id}`).innerHTML = '— <small>мкг/м³</small>';
      $('#chart-line').setAttribute('d', '');
      $('#chart-area').setAttribute('d', '');
      $('#chart-point').setAttribute('cx', '0');
      $('#chart-point').setAttribute('cy', '0');
      $('#chart-empty').hidden = false;
      $('#chart-total').textContent = '—';
      $('#chart-unit').textContent = 'Получаем данные';
      $('#hourly-rows').innerHTML = '';
      $('#empty-state').hidden = false;
      $('#empty-state').textContent = 'Загружаем почасовые данные для выбранного города…';
      $('#table-count').textContent = 'Загрузка данных';
      $('#export-button').disabled = true;
    }
    const cached = apiCache.get(cityKey);
    if (!force && cached && Date.now() - cached.fetchedAt < cacheLifetime) {
      renderData(cached.data);
      currentController = null;
      setLoading(false);
      return;
    }
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(makeApiUrl(city), { signal: controller.signal, headers: { Accept: 'application/json' }, cache: 'no-store' });
      if (!response.ok) throw new Error(`Источник ответил с кодом ${response.status}`);
      const data = await response.json();
      if (data.error) throw new Error(data.reason || 'Источник вернул ошибку');
      if (sequence !== requestSequence) return;
      if (!data.current || !data.hourly || !Array.isArray(data.hourly.time)) throw new Error('В ответе API не хватает данных');
      apiCache.set(cityKey, { data, fetchedAt: Date.now() });
      renderData(data);
    } catch (error) {
      if (sequence !== requestSequence) return;
      if (error.name !== 'AbortError') showError(error);
      else showError(new Error('Время ожидания ответа истекло'));
    } finally {
      window.clearTimeout(timeout);
      if (sequence === requestSequence) {
        currentController = null;
        setLoading(false);
      }
    }
  }

  function exportCsv() {
    if (!activeData) return;
    const hourly = activeData.hourly;
    const city = cities[activeCityKey];
    const rows = [
      ['Город', 'Местное время', 'US AQI', 'PM2.5 (мкг/м³)', 'PM10 (мкг/м³)', 'Источник'],
      ...hourly.time.map((time, index) => [
        city.name,
        formatCityTime(time, activeData.timezone, true),
        formatNumber(hourly.us_aqi?.[index]),
        formatNumber(hourly.pm2_5?.[index]),
        formatNumber(hourly.pm10?.[index]),
        'CAMS Global через Open-Meteo; модельная оценка',
      ]),
    ];
    const csv = `\uFEFF${rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(';')).join('\r\n')}`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `citypulse-air-quality-${activeCityKey}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    announce('Часовые значения сохранены в CSV');
  }

  $('#city-select').addEventListener('change', (event) => loadCity(event.target.value));
  $('#refresh-button').addEventListener('click', () => loadCity(activeCityKey, true));
  $('#export-button').addEventListener('click', exportCsv);
  $('#metric-select').addEventListener('change', (event) => {
    activeMetric = event.target.value;
    renderChart();
  });
  document.querySelectorAll('.period-switch button').forEach((button) => {
    button.addEventListener('click', () => {
      activeHours = Number(button.dataset.hours);
      document.querySelectorAll('.period-switch button').forEach((candidate) => {
        const selected = candidate === button;
        candidate.classList.toggle('selected', selected);
        candidate.setAttribute('aria-pressed', String(selected));
      });
      renderChart();
    });
  });

  $('#theme-toggle').addEventListener('click', () => {
    document.body.classList.toggle('dark');
    const isDark = document.body.classList.contains('dark');
    try { localStorage.setItem('citypulse-theme', isDark ? 'dark' : 'light'); } catch { /* Storage is optional. */ }
    announce(isDark ? 'Включена тёмная тема' : 'Включена светлая тема');
  });
  try {
    if (localStorage.getItem('citypulse-theme') === 'dark') document.body.classList.add('dark');
  } catch { /* Storage is optional. */ }

  const menuButton = $('#menu-toggle');
  const sidebar = $('#sidebar');
  menuButton.addEventListener('click', () => {
    const isOpen = sidebar.classList.toggle('open');
    menuButton.setAttribute('aria-expanded', String(isOpen));
  });
  sidebar.querySelectorAll('a.nav-link').forEach((link) => {
    link.addEventListener('click', () => {
      sidebar.querySelectorAll('.nav-link').forEach((item) => {
        const isCurrent = item === link;
        item.classList.toggle('active', isCurrent);
        if (isCurrent) item.setAttribute('aria-current', 'page');
        else item.removeAttribute('aria-current');
      });
      sidebar.classList.remove('open');
      menuButton.setAttribute('aria-expanded', 'false');
    });
  });

  loadCity(activeCityKey);
})();
