import './location-weather.css';

type WeatherPayload = {
  current?: {
    temperature_2m?: number;
    relative_humidity_2m?: number;
    time?: string;
  };
  timezone?: string;
};

const STORAGE_KEY = 'quimstock:weather-location';
const REFRESH_INTERVAL = 30 * 60 * 1000;

function createWidget(): HTMLElement {
  const widget = document.createElement('section');
  widget.className = 'location-weather location-weather-neutral';
  widget.setAttribute('aria-label', 'Relógio, temperatura e umidade externas');
  widget.innerHTML = `
    <div class="location-weather-clock">
      <span>🕒</span>
      <div><strong class="location-weather-time">--:--</strong><small class="location-weather-date">Aguardando</small></div>
    </div>
    <div class="location-weather-reading">
      <span>🌡️</span>
      <div><strong class="location-weather-temp">--°C</strong><small>Temperatura</small></div>
    </div>
    <div class="location-weather-reading">
      <span>💧</span>
      <div><strong class="location-weather-humidity">--%</strong><small>Umidade</small></div>
    </div>
    <div class="location-weather-condition">
      <span class="location-weather-dot"></span>
      <div><strong class="location-weather-condition-label">Aguardando dados</strong><small class="location-weather-status">Localização do aparelho</small></div>
    </div>
    <button type="button" class="location-weather-refresh" aria-label="Atualizar clima pela localização">↻</button>
  `;
  return widget;
}

function readSavedLocation(): { latitude: number; longitude: number } | null {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (typeof saved?.latitude === 'number' && typeof saved?.longitude === 'number') return saved;
  } catch {
    // Ignora dados antigos ou inválidos.
  }
  return null;
}

function saveLocation(latitude: number, longitude: number): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    latitude: Number(latitude.toFixed(3)),
    longitude: Number(longitude.toFixed(3)),
  }));
}

async function fetchWeather(latitude: number, longitude: number): Promise<WeatherPayload> {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: 'temperature_2m,relative_humidity_2m',
    timezone: 'auto',
  });
  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`, { cache: 'no-store' });
  if (!response.ok) throw new Error('Falha ao consultar o clima.');
  return response.json() as Promise<WeatherPayload>;
}

function requestLocation(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Localização não disponível neste aparelho.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      timeout: 12000,
      maximumAge: 15 * 60 * 1000,
    });
  });
}

function isPermissionDenied(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && Number((error as { code?: number }).code) === 1;
}

function setCondition(widget: HTMLElement, temperature: number, humidity: number): void {
  widget.classList.remove('location-weather-ok', 'location-weather-warning', 'location-weather-danger', 'location-weather-neutral');
  const label = widget.querySelector<HTMLElement>('.location-weather-condition-label')!;

  if (temperature >= 18 && temperature <= 26 && humidity >= 40 && humidity <= 70) {
    widget.classList.add('location-weather-ok');
    label.textContent = 'Condição externa OK';
  } else if (temperature >= 15 && temperature <= 30 && humidity >= 30 && humidity <= 80) {
    widget.classList.add('location-weather-warning');
    label.textContent = 'Condição externa: atenção';
  } else {
    widget.classList.add('location-weather-danger');
    label.textContent = 'Condição externa fora da faixa';
  }
}

function installLocationWeather(): void {
  const header = document.querySelector<HTMLElement>('.app-header');
  if (!header || document.querySelector('.location-weather')) return;

  const widget = createWidget();
  header.insertAdjacentElement('afterend', widget);

  const time = widget.querySelector<HTMLElement>('.location-weather-time')!;
  const date = widget.querySelector<HTMLElement>('.location-weather-date')!;
  const temp = widget.querySelector<HTMLElement>('.location-weather-temp')!;
  const humidity = widget.querySelector<HTMLElement>('.location-weather-humidity')!;
  const status = widget.querySelector<HTMLElement>('.location-weather-status')!;
  const refresh = widget.querySelector<HTMLButtonElement>('.location-weather-refresh')!;

  let timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  let currentLocation = readSavedLocation();

  const updateClock = () => {
    const now = new Date();
    time.textContent = new Intl.DateTimeFormat('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: timezone,
    }).format(now);
    date.textContent = new Intl.DateTimeFormat('pt-BR', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      timeZone: timezone,
    }).format(now).replace('.', '');
  };

  const loadWeather = async (forceLocation = false) => {
    refresh.disabled = true;
    widget.classList.add('location-weather-loading');
    status.textContent = forceLocation ? 'Obtendo localização…' : 'Atualizando…';

    try {
      if (!currentLocation || forceLocation) {
        const position = await requestLocation();
        currentLocation = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };
        saveLocation(currentLocation.latitude, currentLocation.longitude);
      }

      const data = await fetchWeather(currentLocation.latitude, currentLocation.longitude);
      timezone = data.timezone || timezone;
      const currentTemperature = Math.round(data.current?.temperature_2m ?? 0);
      const currentHumidity = Math.round(data.current?.relative_humidity_2m ?? 0);
      temp.textContent = `${currentTemperature}°C`;
      humidity.textContent = `${currentHumidity}%`;
      status.textContent = `Atualizado às ${new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: timezone }).format(new Date())}`;
      setCondition(widget, currentTemperature, currentHumidity);
      updateClock();
    } catch (error) {
      widget.classList.remove('location-weather-ok', 'location-weather-warning', 'location-weather-danger');
      widget.classList.add('location-weather-neutral');
      widget.querySelector<HTMLElement>('.location-weather-condition-label')!.textContent = 'Dados indisponíveis';
      status.textContent = isPermissionDenied(error)
        ? 'Permita a localização no navegador'
        : error instanceof Error ? error.message : 'Não foi possível atualizar';
    } finally {
      refresh.disabled = false;
      widget.classList.remove('location-weather-loading');
    }
  };

  refresh.addEventListener('click', () => void loadWeather(true));
  updateClock();
  window.setInterval(updateClock, 1000);
  if (currentLocation) void loadWeather();
  window.setInterval(() => {
    if (currentLocation) void loadWeather();
  }, REFRESH_INTERVAL);
}

function observeHeader(): void {
  installLocationWeather();
  const observer = new MutationObserver(() => installLocationWeather());
  observer.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', observeHeader, { once: true });
} else {
  observeHeader();
}
