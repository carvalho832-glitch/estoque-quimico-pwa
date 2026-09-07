import { getApp, getApps } from 'firebase/app';
import { deleteToken, getMessaging, getToken, isSupported, onMessage, type Messaging } from 'firebase/messaging';
import '../lib/firebase';

export type PushStatus = {
  supported: boolean;
  permission: NotificationPermission | 'unsupported';
  token: string | null;
  configured: boolean;
};

const TOKEN_KEY = 'quimstock:fcm-token:v1';
let foregroundBridgeStarted = false;

function vapidKey(): string {
  return import.meta.env.VITE_FIREBASE_VAPID_KEY?.trim() || '';
}

async function messagingInstance(): Promise<Messaging | null> {
  if (!getApps().length || !(await isSupported())) return null;
  return getMessaging(getApp());
}

async function serviceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  return navigator.serviceWorker.ready;
}

export async function getPushStatus(): Promise<PushStatus> {
  const supported = 'Notification' in window && 'serviceWorker' in navigator && await isSupported().catch(() => false);
  return {
    supported,
    permission: supported ? Notification.permission : 'unsupported',
    token: localStorage.getItem(TOKEN_KEY),
    configured: Boolean(vapidKey() && getApps().length),
  };
}

export async function requestPushPermission(): Promise<NotificationPermission> {
  if (!('Notification' in window)) throw new Error('Notificações não são suportadas neste dispositivo.');
  const permission = await Notification.requestPermission();
  if (permission === 'granted') await refreshPushToken();
  return permission;
}

export async function refreshPushToken(): Promise<string | null> {
  if (!('Notification' in window) || Notification.permission !== 'granted') return null;
  const key = vapidKey();
  if (!key) return null;

  const messaging = await messagingInstance();
  const registration = await serviceWorkerRegistration();
  if (!messaging || !registration) return null;

  const token = await getToken(messaging, {
    vapidKey: key,
    serviceWorkerRegistration: registration,
  });

  if (token) localStorage.setItem(TOKEN_KEY, token);
  return token || null;
}

export async function disablePushToken(): Promise<void> {
  const messaging = await messagingInstance();
  if (messaging) {
    try { await deleteToken(messaging); } catch (error) { console.warn('Não foi possível invalidar o token FCM:', error); }
  }
  localStorage.removeItem(TOKEN_KEY);
}

export async function startForegroundPushBridge(): Promise<void> {
  if (foregroundBridgeStarted) return;
  const messaging = await messagingInstance();
  const registration = await serviceWorkerRegistration();
  if (!messaging || !registration) return;

  foregroundBridgeStarted = true;
  onMessage(messaging, (payload) => {
    if (Notification.permission !== 'granted') return;
    const title = payload.notification?.title || payload.data?.title || 'QuimStock';
    const body = payload.notification?.body || payload.data?.body || 'Há uma nova atualização.';
    const url = payload.data?.url || './';
    void registration.showNotification(title, {
      body,
      icon: './icon.svg',
      badge: './icon.svg',
      tag: payload.messageId || payload.data?.notificationKey || undefined,
      data: { url, ...payload.data },
    });
  });
}

export function notificationPermission(): NotificationPermission | 'unsupported' {
  return 'Notification' in window ? Notification.permission : 'unsupported';
}

export function androidSettingsGuidance(): string {
  return 'Abra as informações do app/PWA no Android e ative Notificações. O navegador não permite abrir essa tela diretamente com segurança.';
}
