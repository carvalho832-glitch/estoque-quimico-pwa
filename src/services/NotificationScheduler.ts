import type { Product } from '../types';
import { listProducts } from '../lib/db';
import { getSettings, subscribeToSettings } from './SettingsService';
import { normalizeLowStockState, sendSystemNotification } from './NotificationService';

const SCHEDULER_RUNS_KEY = 'quimstock:notification-scheduler-runs:v1';
let intervalId: number | null = null;
let unsubscribeSettings: (() => void) | null = null;

function localDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function currentTime(date = new Date()): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function daysUntil(expiryDate: string, now = new Date()): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiryDate)) return null;
  const [year, month, day] = expiryDate.split('-').map(Number);
  const expiry = new Date(year, month - 1, day);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (Number.isNaN(expiry.getTime())) return null;
  return Math.round((expiry.getTime() - today.getTime()) / 86_400_000);
}

function readRuns(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(SCHEDULER_RUNS_KEY);
    return raw ? JSON.parse(raw) as Record<string, boolean> : {};
  } catch {
    return {};
  }
}

function markRun(slot: string): void {
  const runs = readRuns();
  runs[slot] = true;
  const today = localDateKey();
  Object.keys(runs).forEach((key) => {
    if (!key.startsWith(today)) delete runs[key];
  });
  localStorage.setItem(SCHEDULER_RUNS_KEY, JSON.stringify(runs));
}

async function checkProduct(product: Product): Promise<void> {
  const settings = getSettings();
  const days = daysUntil(product.expiryDate);
  const route = './';

  if (days !== null) {
    if (days < 0 && settings.notifyExpired) {
      await sendSystemNotification({
        type: 'EXPIRED',
        productId: product.id,
        productName: product.name || product.ecode,
        expiryDate: product.expiryDate,
        route,
      });
    } else if (days >= 0 && settings.notifyExpiration && settings.expirationDays.includes(days)) {
      await sendSystemNotification({
        type: 'EXPIRATION',
        productId: product.id,
        productName: product.name || product.ecode,
        expiryDate: product.expiryDate,
        stage: days,
        route,
      });
    }
  }

  const threshold = product.lowStockThreshold ?? settings.lowStockThreshold;
  if (product.quantity <= threshold) {
    await sendSystemNotification({
      type: 'LOW_STOCK',
      productId: product.id,
      productName: product.name || product.ecode,
      quantity: product.quantity,
      route,
    });
  } else {
    normalizeLowStockState(product.id);
  }
}

export async function runNotificationChecks(): Promise<void> {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const products = await listProducts();
  for (const product of products) await checkProduct(product);
}

async function schedulerTick(force = false): Promise<void> {
  const settings = getSettings();
  const now = new Date();
  const time = currentTime(now);
  const slot = `${localDateKey(now)}T${time}`;
  const shouldRun = force || settings.checkTimes.includes(time);
  if (!shouldRun || (!force && readRuns()[slot])) return;

  try {
    await runNotificationChecks();
    if (!force) markRun(slot);
  } catch (error) {
    console.error('Falha na verificação de notificações do QuimStock:', error);
  }
}

export function startNotificationScheduler(): () => void {
  if (intervalId !== null) return stopNotificationScheduler;

  void schedulerTick(false);
  intervalId = window.setInterval(() => { void schedulerTick(false); }, 30_000);
  const productsChanged = () => { void schedulerTick(true); };
  window.addEventListener('quimstock:products-changed', productsChanged);

  unsubscribeSettings = subscribeToSettings(() => { void schedulerTick(true); });

  const stop = () => {
    window.removeEventListener('quimstock:products-changed', productsChanged);
    stopNotificationScheduler();
  };
  return stop;
}

export function stopNotificationScheduler(): void {
  if (intervalId !== null) window.clearInterval(intervalId);
  intervalId = null;
  unsubscribeSettings?.();
  unsubscribeSettings = null;
}
