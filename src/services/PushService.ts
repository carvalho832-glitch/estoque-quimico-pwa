import { getApp, getApps } from 'firebase/app';
import { deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { deleteToken, getMessaging, getToken, isSupported, onMessage, type Messaging } from 'firebase/messaging';
import { firebaseAuth, firebaseDb } from '../lib/firebase';

export type PushStatus = {
  supported: boolean;
  permission: NotificationPermission | 'unsupported';
  token: string | null;
  configured: boolean;
  registeredInCloud: boolean;
};

const TOKEN_KEY = 'quimstock:fcm-token:v1';
const FUNCTIONS_REGION = 'southamerica-east1';
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

async function tokenDocumentId(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function registerTokenInCloud(token: string): Promise<boolean> {
  const user = firebaseAuth?.currentUser;
  if (!user || !firebaseDb || !navigator.onLine) return false;

  const registration = await serviceWorkerRegistration();
  const tokenId = await tokenDocumentId(token);
  await setDoc(
    doc(firebaseDb, 'users', user.uid, 'pushTokens', tokenId),
    {
      token,
      platform: 'web',
      enabled: true,
      serviceWorkerScope: registration?.scope || null,
      userAgent: navigator.userAgent.slice(0, 500),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
  return true;
}

async function removeTokenFromCloud(token: string): Promise<void> {
  const user = firebaseAuth?.currentUser;
  if (!user || !firebaseDb || !navigator.onLine) return;
  const tokenId = await tokenDocumentId(token);
  await deleteDoc(doc(firebaseDb, 'users', user.uid, 'pushTokens', tokenId));
}

export async function getPushStatus(): Promise<PushStatus> {
  const supported = 'Notification' in window && 'serviceWorker' in navigator && await isSupported().catch(() => false);
  const token = localStorage.getItem(TOKEN_KEY);
  let registeredInCloud = false;
  if (token && firebaseAuth?.currentUser && navigator.onLine) {
    try {
      registeredInCloud = await registerTokenInCloud(token);
    } catch {
      registeredInCloud = false;
    }
  }

  return {
    supported,
    permission: supported ? Notification.permission : 'unsupported',
    token,
    configured: Boolean(vapidKey() && getApps().length),
    registeredInCloud,
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

  const previousToken = localStorage.getItem(TOKEN_KEY);
  const token = await getToken(messaging, {
    vapidKey: key,
    serviceWorkerRegistration: registration,
  });

  if (!token) return null;

  localStorage.setItem(TOKEN_KEY, token);
  await registerTokenInCloud(token);

  if (previousToken && previousToken !== token) {
    await removeTokenFromCloud(previousToken).catch((error) => {
      console.warn('Token FCM anterior não pôde ser removido da nuvem:', error);
    });
  }

  return token;
}

export async function syncStoredPushToken(): Promise<boolean> {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return false;
  return registerTokenInCloud(token);
}

export async function disablePushToken(): Promise<void> {
  const storedToken = localStorage.getItem(TOKEN_KEY);
  if (storedToken) {
    await removeTokenFromCloud(storedToken).catch((error) => {
      console.warn('Não foi possível remover o token FCM do Firestore:', error);
    });
  }

  const messaging = await messagingInstance();
  if (messaging) {
    try { await deleteToken(messaging); } catch (error) { console.warn('Não foi possível invalidar o token FCM:', error); }
  }
  localStorage.removeItem(TOKEN_KEY);
}

export async function sendRemotePushTest(): Promise<void> {
  if (!firebaseAuth?.currentUser) throw new Error('Faça login no QuimStock para testar o push remoto.');
  if (!getApps().length) throw new Error('Firebase não configurado.');
  const callable = httpsCallable(getFunctions(getApp(), FUNCTIONS_REGION), 'sendPushTest');
  await callable();
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
