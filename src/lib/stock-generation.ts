import { doc, getDoc, setDoc } from 'firebase/firestore';
import { firebaseDb } from './firebase';

const LOCAL_GENERATION_PREFIX = 'quimstock-stock-generation-v1:';
const BOOTSTRAP_GENERATION = 'legacy-v1';
export const STOCK_STATE_DOCUMENT_ID = '__quimstock_stock_state__';

export type CloudStockGeneration = {
  generation: string;
  created: boolean;
};

function localGenerationKey(userId: string): string {
  return `${LOCAL_GENERATION_PREFIX}${userId}`;
}

function stockStateDocument(userId: string) {
  if (!firebaseDb) throw new Error('Firebase não configurado.');
  // Usa a coleção products porque as regras atuais do Firestore já autorizam
  // somente esse caminho. O documento técnico é filtrado das listas de produto.
  return doc(firebaseDb, 'users', userId, 'products', STOCK_STATE_DOCUMENT_ID);
}

function createGeneration(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `stock-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function getLocalStockGeneration(userId: string): string | null {
  return window.localStorage.getItem(localGenerationKey(userId));
}

export function setLocalStockGeneration(userId: string, generation: string): void {
  window.localStorage.setItem(localGenerationKey(userId), generation);
}

export async function getOrCreateCloudStockGeneration(userId: string): Promise<CloudStockGeneration> {
  if (!firebaseDb) return { generation: BOOTSTRAP_GENERATION, created: false };

  const reference = stockStateDocument(userId);
  const snapshot = await getDoc(reference);
  const generation = snapshot.exists() ? String(snapshot.data().generation ?? '').trim() : '';

  if (generation) return { generation, created: false };

  const now = new Date().toISOString();
  await setDoc(reference, {
    __quimstockMeta: 'stock-state',
    generation: BOOTSTRAP_GENERATION,
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
  }, { merge: true });

  return { generation: BOOTSTRAP_GENERATION, created: true };
}

export async function rotateStockGeneration(userId: string): Promise<string> {
  if (!firebaseDb) throw new Error('Firebase não configurado.');

  const generation = createGeneration();
  const now = new Date().toISOString();

  await setDoc(stockStateDocument(userId), {
    __quimstockMeta: 'stock-state',
    generation,
    schemaVersion: 1,
    resetAt: now,
    updatedAt: now,
  }, { merge: true });

  setLocalStockGeneration(userId, generation);
  return generation;
}
