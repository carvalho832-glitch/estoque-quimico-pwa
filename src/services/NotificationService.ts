import { getSettings } from './SettingsService';

export type NotificationEventType =
  | 'EXPIRATION'
  | 'EXPIRED'
  | 'LOW_STOCK'
  | 'STOCK_REMOVED'
  | 'STOCK_RETURNED'
  | 'LIST_UPDATED'
  | 'BACKUP_COMPLETED'
  | 'SYNC_ERROR';

export type QuimStockNotificationEvent = {
  type: NotificationEventType;
  productId?: string;
  productName?: string;
  expiryDate?: string;
  stage?: number;
  quantity?: number;
  route?: string;
  detail?: string;
  dedupKey?: string;
};

type NotificationLedger = Record<string, string>;
type LowStockState = Record<string, boolean>;

const LEDGER_KEY = 'quimstock:notification-ledger:v1';
const LOW_STOCK_KEY = 'quimstock:low-stock-state:v1';
const ICON_URL = './icon.svg';

function readJsonRecord<T extends Record<string, unknown>>(key: string): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : {} as T;
  } catch {
    return {} as T;
  }
}

function writeJsonRecord(key: string, value: Record<string, unknown>): void {
  localStorage.setItem(key, JSON.stringify(value));
}

function eventEnabled(type: NotificationEventType): boolean {
  const settings = getSettings();
  const map: Record<NotificationEventType, boolean> = {
    EXPIRATION: settings.notifyExpiration,
    EXPIRED: settings.notifyExpired,
    LOW_STOCK: settings.notifyLowStock,
    STOCK_REMOVED: settings.notifyStockRemoval,
    STOCK_RETURNED: settings.notifyStockReturn,
    LIST_UPDATED: settings.notifyListUpdate,
    BACKUP_COMPLETED: settings.notifyBackup,
    SYNC_ERROR: settings.notifySyncError,
  };
  return map[type];
}

export function notificationKey(event: QuimStockNotificationEvent): string {
  if (event.dedupKey) return event.dedupKey;

  const product = event.productId || 'global';
  switch (event.type) {
    case 'EXPIRATION':
      return `${product}:expiration:${event.expiryDate || 'unknown'}:${event.stage ?? 'stage'}`;
    case 'EXPIRED':
      return `${product}:expired:${event.expiryDate || 'unknown'}`;
    case 'LOW_STOCK':
      return `${product}:low-stock`;
    case 'STOCK_REMOVED':
      return `${product}:stock-removed:${event.detail || 'transition'}`;
    case 'STOCK_RETURNED':
      return `${product}:stock-returned:${event.detail || 'transition'}`;
    case 'LIST_UPDATED':
      return `global:list-updated:${event.detail || 'update'}`;
    case 'BACKUP_COMPLETED':
      return `global:backup:${event.detail || new Date().toISOString().slice(0, 10)}`;
    case 'SYNC_ERROR':
      return `global:sync-error:${event.detail || new Date().toISOString().slice(0, 13)}`;
  }
}

function buildMessage(event: QuimStockNotificationEvent): { title: string; body: string } {
  const name = event.productName || event.productId || 'Produto';
  switch (event.type) {
    case 'EXPIRATION':
      return { title: '⚠ Validade próxima', body: `${name} vence em ${event.stage} dia${event.stage === 1 ? '' : 's'}.` };
    case 'EXPIRED':
      return { title: '🔴 Produto vencido', body: `${name} venceu.` };
    case 'LOW_STOCK':
      return { title: '📦 Estoque baixo', body: `${name} está com ${event.quantity ?? 0} unidade(s).` };
    case 'STOCK_REMOVED':
      return { title: '📤 Produto retirado', body: `${name} foi retirado do estoque.` };
    case 'STOCK_RETURNED':
      return { title: '📥 Produto devolvido', body: `${name} foi devolvido ao estoque.` };
    case 'LIST_UPDATED':
      return { title: '☁ Estoque sincronizado', body: event.detail || 'A lista do QuimStock foi atualizada.' };
    case 'BACKUP_COMPLETED':
      return { title: '✅ Backup realizado', body: event.detail || 'O backup do QuimStock foi concluído.' };
    case 'SYNC_ERROR':
      return { title: '⚠ Erro de sincronização', body: event.detail || 'O QuimStock encontrou um erro de sincronização.' };
  }
}

function hasBeenSent(key: string): boolean {
  const ledger = readJsonRecord<NotificationLedger>(LEDGER_KEY);
  return Boolean(ledger[key]);
}

function markSent(key: string): void {
  const ledger = readJsonRecord<NotificationLedger>(LEDGER_KEY);
  ledger[key] = new Date().toISOString();
  writeJsonRecord(LEDGER_KEY, ledger);
}

export function normalizeLowStockState(productId: string): void {
  const state = readJsonRecord<LowStockState>(LOW_STOCK_KEY);
  if (!state[productId]) return;
  delete state[productId];
  writeJsonRecord(LOW_STOCK_KEY, state);
}

function lowStockAlreadyActive(productId: string): boolean {
  return Boolean(readJsonRecord<LowStockState>(LOW_STOCK_KEY)[productId]);
}

function markLowStockActive(productId: string): void {
  const state = readJsonRecord<LowStockState>(LOW_STOCK_KEY);
  state[productId] = true;
  writeJsonRecord(LOW_STOCK_KEY, state);
}

export async function sendSystemNotification(event: QuimStockNotificationEvent): Promise<boolean> {
  if (!eventEnabled(event.type)) return false;
  if (!('Notification' in window) || Notification.permission !== 'granted') return false;
  if (!('serviceWorker' in navigator)) return false;

  const key = notificationKey(event);
  if (event.type === 'LOW_STOCK' && event.productId && lowStockAlreadyActive(event.productId)) return false;
  if (event.type !== 'LOW_STOCK' && hasBeenSent(key)) return false;

  const registration = await navigator.serviceWorker.ready;
  const message = buildMessage(event);
  await registration.showNotification(message.title, {
    body: message.body,
    icon: ICON_URL,
    badge: ICON_URL,
    tag: key,
    data: {
      url: event.route || './',
      notificationKey: key,
      type: event.type,
      productId: event.productId,
    },
  });

  if (event.type === 'LOW_STOCK' && event.productId) markLowStockActive(event.productId);
  else markSent(key);
  return true;
}

export function getNotificationLedger(): Array<{ key: string; sentAt: string }> {
  const ledger = readJsonRecord<NotificationLedger>(LEDGER_KEY);
  return Object.entries(ledger).map(([key, sentAt]) => ({ key, sentAt }));
}
