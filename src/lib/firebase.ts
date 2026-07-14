import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY?.trim() || 'AIzaSyAzVLSEHl7zfsfZ3STpRI4j1457kmNLDas',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN?.trim() || 'quimstock.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID?.trim() || 'quimstock',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET?.trim() || 'quimstock.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID?.trim() || '589751287615',
  appId: import.meta.env.VITE_FIREBASE_APP_ID?.trim() || '1:589751287615:web:63f69601a0424d3684dd8a',
};

export const firebaseConfigured = Boolean(
  firebaseConfig.apiKey &&
  firebaseConfig.authDomain &&
  firebaseConfig.projectId &&
  firebaseConfig.appId,
);

let authInstance: Auth | null = null;
let firestoreInstance: Firestore | null = null;

if (firebaseConfigured) {
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  authInstance = getAuth(app);
  firestoreInstance = getFirestore(app);
}

export const firebaseAuth = authInstance;
export const firebaseDb = firestoreInstance;
