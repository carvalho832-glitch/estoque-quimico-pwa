import type { Product } from '../types';

const DB_NAME = 'quimstock-db';
const DB_VERSION = 1;
const STORE_NAME = 'products';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('ecode', 'ecode', { unique: false });
        store.createIndex('expiryDate', 'expiryDate', { unique: false });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Não foi possível abrir o banco local.'));
  });
}

async function runRequest<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const request = action(transaction.objectStore(STORE_NAME));

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Falha ao acessar o banco local.'));
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => reject(transaction.error ?? new Error('Falha na transação do banco local.'));
  });
}

export async function listProducts(): Promise<Product[]> {
  const products = await runRequest<Product[]>('readonly', (store) => store.getAll());
  return products.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function saveProduct(product: Product): Promise<IDBValidKey> {
  return runRequest('readwrite', (store) => store.put(product));
}

export function removeProduct(id: string): Promise<undefined> {
  return runRequest('readwrite', (store) => store.delete(id)) as Promise<undefined>;
}
