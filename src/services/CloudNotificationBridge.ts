import { onAuthStateChanged } from 'firebase/auth';
import { firebaseAuth } from '../lib/firebase';
import { refreshPushToken, syncStoredPushToken } from './PushService';
import { syncSettingsToCloud } from './SettingsService';

let started = false;
let unsubscribeAuth: (() => void) | null = null;

async function syncCloudNotificationState(): Promise<void> {
  if (!firebaseAuth?.currentUser || !navigator.onLine) return;

  await syncSettingsToCloud().catch((error) => {
    console.warn('Não foi possível sincronizar as preferências de notificação:', error);
  });

  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  const registered = await syncStoredPushToken().catch(() => false);
  if (!registered) {
    await refreshPushToken().catch((error) => {
      console.warn('Não foi possível registrar o token FCM para push em background:', error);
    });
  }
}

export function startCloudNotificationBridge(): () => void {
  if (started) return stopCloudNotificationBridge;
  started = true;

  if (firebaseAuth) {
    unsubscribeAuth = onAuthStateChanged(firebaseAuth, (user) => {
      if (user) void syncCloudNotificationState();
    });
  }

  const handleOnline = () => { void syncCloudNotificationState(); };
  window.addEventListener('online', handleOnline);

  return () => {
    window.removeEventListener('online', handleOnline);
    stopCloudNotificationBridge();
  };
}

export function stopCloudNotificationBridge(): void {
  unsubscribeAuth?.();
  unsubscribeAuth = null;
  started = false;
}
