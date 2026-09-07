export type NotificationSettings = {
  settingsVersion: 1;
  notifyExpiration: boolean;
  notifyExpired: boolean;
  notifyLowStock: boolean;
  notifyStockRemoval: boolean;
  notifyStockReturn: boolean;
  notifyListUpdate: boolean;
  notifyBackup: boolean;
  notifySyncError: boolean;
  expirationDays: number[];
  checkTimes: string[];
  lowStockThreshold: number;
};

const SETTINGS_KEY = 'quimstock:admin-settings:v1';
const SETTINGS_EVENT = 'quimstock:settings-changed';
const ALLOWED_EXPIRATION_DAYS = [90, 60, 30, 15, 7, 3, 1] as const;
const DEFAULT_CHECK_TIMES = ['08:00', '12:00', '18:00', '22:00'];

export const DEFAULT_SETTINGS: NotificationSettings = {
  settingsVersion: 1,
  notifyExpiration: true,
  notifyExpired: true,
  notifyLowStock: true,
  notifyStockRemoval: true,
  notifyStockReturn: true,
  notifyListUpdate: true,
  notifyBackup: true,
  notifySyncError: true,
  expirationDays: [...ALLOWED_EXPIRATION_DAYS],
  checkTimes: [...DEFAULT_CHECK_TIMES],
  lowStockThreshold: 3,
};

function normalizeTime(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  return match ? `${match[1]}:${match[2]}` : null;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeSettings(value: unknown): NotificationSettings {
  const source = value && typeof value === 'object' ? value as Partial<NotificationSettings> : {};
  const days = Array.isArray(source.expirationDays)
    ? source.expirationDays
      .map(Number)
      .filter((day): day is number => ALLOWED_EXPIRATION_DAYS.includes(day as typeof ALLOWED_EXPIRATION_DAYS[number]))
    : DEFAULT_SETTINGS.expirationDays;

  const times = Array.isArray(source.checkTimes)
    ? source.checkTimes.map(normalizeTime).filter((time): time is string => Boolean(time))
    : DEFAULT_SETTINGS.checkTimes;

  const threshold = Number(source.lowStockThreshold);

  return {
    settingsVersion: 1,
    notifyExpiration: normalizeBoolean(source.notifyExpiration, DEFAULT_SETTINGS.notifyExpiration),
    notifyExpired: normalizeBoolean(source.notifyExpired, DEFAULT_SETTINGS.notifyExpired),
    notifyLowStock: normalizeBoolean(source.notifyLowStock, DEFAULT_SETTINGS.notifyLowStock),
    notifyStockRemoval: normalizeBoolean(source.notifyStockRemoval, DEFAULT_SETTINGS.notifyStockRemoval),
    notifyStockReturn: normalizeBoolean(source.notifyStockReturn, DEFAULT_SETTINGS.notifyStockReturn),
    notifyListUpdate: normalizeBoolean(source.notifyListUpdate, DEFAULT_SETTINGS.notifyListUpdate),
    notifyBackup: normalizeBoolean(source.notifyBackup, DEFAULT_SETTINGS.notifyBackup),
    notifySyncError: normalizeBoolean(source.notifySyncError, DEFAULT_SETTINGS.notifySyncError),
    expirationDays: [...new Set(days)].sort((a, b) => b - a),
    checkTimes: [...new Set(times)].sort(),
    lowStockThreshold: Number.isFinite(threshold) && threshold >= 0 && threshold <= 9999
      ? Math.trunc(threshold)
      : DEFAULT_SETTINGS.lowStockThreshold,
  };
}

export function getSettings(): NotificationSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? normalizeSettings(JSON.parse(raw)) : { ...DEFAULT_SETTINGS, expirationDays: [...DEFAULT_SETTINGS.expirationDays], checkTimes: [...DEFAULT_SETTINGS.checkTimes] };
  } catch {
    return { ...DEFAULT_SETTINGS, expirationDays: [...DEFAULT_SETTINGS.expirationDays], checkTimes: [...DEFAULT_SETTINGS.checkTimes] };
  }
}

export function saveSettings(settings: NotificationSettings): NotificationSettings {
  const normalized = normalizeSettings(settings);
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalized));
  window.dispatchEvent(new CustomEvent(SETTINGS_EVENT, { detail: normalized }));
  return normalized;
}

export function updateSettings(patch: Partial<NotificationSettings>): NotificationSettings {
  return saveSettings({ ...getSettings(), ...patch });
}

export function exportSettings(): string {
  return JSON.stringify(getSettings(), null, 2);
}

export function importSettings(raw: string): NotificationSettings {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Arquivo de configurações inválido.');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Arquivo de configurações inválido.');
  }

  return saveSettings(normalizeSettings(parsed));
}

export function subscribeToSettings(listener: (settings: NotificationSettings) => void): () => void {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<NotificationSettings>).detail;
    listener(detail ?? getSettings());
  };
  window.addEventListener(SETTINGS_EVENT, handler);
  return () => window.removeEventListener(SETTINGS_EVENT, handler);
}

export function isValidCheckTime(value: string): boolean {
  return normalizeTime(value) !== null;
}
