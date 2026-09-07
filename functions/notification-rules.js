'use strict';

const DEFAULT_SETTINGS = Object.freeze({
  settingsVersion: 1,
  notifyExpiration: true,
  notifyExpired: true,
  notifyLowStock: true,
  notifyStockRemoval: true,
  notifyStockReturn: true,
  notifyListUpdate: true,
  notifyBackup: true,
  notifySyncError: true,
  expirationDays: [90, 60, 30, 15, 7, 3, 1],
  checkTimes: ['08:00', '12:00', '18:00', '22:00'],
  lowStockThreshold: 3,
  timezone: 'America/Sao_Paulo',
});

const ALLOWED_EXPIRATION_DAYS = new Set(DEFAULT_SETTINGS.expirationDays);
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function normalizeBoolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeSettings(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const days = Array.isArray(source.expirationDays)
    ? source.expirationDays.map(Number).filter((day) => ALLOWED_EXPIRATION_DAYS.has(day))
    : DEFAULT_SETTINGS.expirationDays;
  const times = Array.isArray(source.checkTimes)
    ? source.checkTimes.filter((time) => typeof time === 'string' && TIME_RE.test(time))
    : DEFAULT_SETTINGS.checkTimes;
  const threshold = Number(source.lowStockThreshold);
  const timezone = typeof source.timezone === 'string' && source.timezone.trim()
    ? source.timezone.trim()
    : DEFAULT_SETTINGS.timezone;

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
    timezone,
  };
}

function zonedParts(date = new Date(), timezone = DEFAULT_SETTINGS.timezone) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

function isWithinCheckWindow(checkTimes, date = new Date(), timezone = DEFAULT_SETTINGS.timezone, windowMinutes = 5) {
  const { hour, minute } = zonedParts(date, timezone);
  const nowMinutes = hour * 60 + minute;
  return checkTimes.some((time) => {
    const match = TIME_RE.exec(time);
    if (!match) return false;
    const targetMinutes = Number(match[1]) * 60 + Number(match[2]);
    const difference = (nowMinutes - targetMinutes + 1440) % 1440;
    return difference >= 0 && difference < windowMinutes;
  });
}

function daysUntilExpiry(expiryDate, date = new Date(), timezone = DEFAULT_SETTINGS.timezone) {
  if (typeof expiryDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(expiryDate)) return null;
  const [year, month, day] = expiryDate.split('-').map(Number);
  const expiryUtc = Date.UTC(year, month - 1, day);
  const check = new Date(expiryUtc);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;

  const local = zonedParts(date, timezone);
  const todayUtc = Date.UTC(local.year, local.month - 1, local.day);
  return Math.round((expiryUtc - todayUtc) / 86_400_000);
}

function lowStockThreshold(product, settings) {
  const productThreshold = Number(product?.lowStockThreshold);
  if (Number.isFinite(productThreshold) && productThreshold >= 0) return Math.trunc(productThreshold);
  return settings.lowStockThreshold;
}

function productName(product, fallbackId = 'Produto') {
  return String(product?.name || product?.ecode || fallbackId);
}

function expirationEvent(productId, product, settings, date = new Date()) {
  const days = daysUntilExpiry(product?.expiryDate, date, settings.timezone);
  if (days === null) return null;
  const name = productName(product, productId);

  if (days < 0 && settings.notifyExpired) {
    return {
      type: 'EXPIRED',
      key: `${productId}:expired:${product.expiryDate}`,
      title: '🔴 Produto vencido',
      body: `${name} venceu.`,
    };
  }

  if (days >= 0 && settings.notifyExpiration && settings.expirationDays.includes(days)) {
    return {
      type: 'EXPIRATION',
      key: `${productId}:expiration:${product.expiryDate}:${days}`,
      title: '⚠ Validade próxima',
      body: `${name} vence em ${days} dia${days === 1 ? '' : 's'}.`,
    };
  }

  return null;
}

function lowStockEvent(productId, product, settings) {
  const threshold = lowStockThreshold(product, settings);
  const quantity = Number(product?.quantity);
  if (!Number.isFinite(quantity) || quantity > threshold || !settings.notifyLowStock) return null;
  const name = productName(product, productId);
  return {
    type: 'LOW_STOCK',
    key: `${productId}:low-stock`,
    title: '📦 Estoque baixo',
    body: `${name} está com ${Math.trunc(quantity)} unidade(s).`,
  };
}

function usageTransitionEvent(productId, before, after, settings, fallbackId = '') {
  if (!after) return null;
  const beforeStatus = before?.availabilityStatus === 'in-use' ? 'in-use' : 'stock';
  const afterStatus = after?.availabilityStatus === 'in-use' ? 'in-use' : 'stock';
  const name = productName(after, productId);

  if (beforeStatus !== 'in-use' && afterStatus === 'in-use' && settings.notifyStockRemoval) {
    const transitionId = after?.currentUsage?.startedAt || after?.updatedAt || fallbackId || 'transition';
    return {
      type: 'STOCK_REMOVED',
      key: `${productId}:stock-removed:${transitionId}`,
      title: '📤 Produto retirado',
      body: `${name} foi retirado do estoque.`,
    };
  }

  if (beforeStatus === 'in-use' && afterStatus !== 'in-use' && settings.notifyStockReturn) {
    const transitionId = after?.updatedAt || before?.currentUsage?.startedAt || fallbackId || 'transition';
    return {
      type: 'STOCK_RETURNED',
      key: `${productId}:stock-returned:${transitionId}`,
      title: '📥 Produto devolvido',
      body: `${name} foi devolvido ao estoque.`,
    };
  }

  return null;
}

module.exports = {
  DEFAULT_SETTINGS,
  normalizeSettings,
  zonedParts,
  isWithinCheckWindow,
  daysUntilExpiry,
  lowStockThreshold,
  expirationEvent,
  lowStockEvent,
  usageTransitionEvent,
};
