export type NotificationKeyInput = {
  type:
    | 'EXPIRATION'
    | 'EXPIRED'
    | 'LOW_STOCK'
    | 'STOCK_REMOVED'
    | 'STOCK_RETURNED'
    | 'LIST_UPDATED'
    | 'BACKUP_COMPLETED'
    | 'SYNC_ERROR';
  productId?: string;
  expiryDate?: string;
  stage?: number;
  detail?: string;
  dedupKey?: string;
};

export type LowStockTransition = {
  shouldNotify: boolean;
  nextActive: boolean;
};

export function notificationKeyFor(event: NotificationKeyInput, now = new Date()): string {
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
      return `global:backup:${event.detail || now.toISOString().slice(0, 10)}`;
    case 'SYNC_ERROR':
      return `global:sync-error:${event.detail || now.toISOString().slice(0, 13)}`;
  }
}

export function daysUntilExpiry(expiryDate: string, now = new Date()): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiryDate)) return null;
  const [year, month, day] = expiryDate.split('-').map(Number);
  const expiry = new Date(year, month - 1, day);
  if (
    Number.isNaN(expiry.getTime()) ||
    expiry.getFullYear() !== year ||
    expiry.getMonth() !== month - 1 ||
    expiry.getDate() !== day
  ) return null;

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((expiry.getTime() - today.getTime()) / 86_400_000);
}

export function lowStockTransition(wasActive: boolean, isLowNow: boolean): LowStockTransition {
  if (!isLowNow) return { shouldNotify: false, nextActive: false };
  if (wasActive) return { shouldNotify: false, nextActive: true };
  return { shouldNotify: true, nextActive: true };
}
