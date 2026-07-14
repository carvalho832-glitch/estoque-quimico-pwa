import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  setDoc,
  writeBatch,
  type DocumentData,
  type Unsubscribe,
} from 'firebase/firestore';
import type { Product } from '../types';
import { firebaseAuth, firebaseDb } from './firebase';

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

function sortProducts(products: Product[]): Product[] {
  return products.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function listLocalProducts(): Promise<Product[]> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const request = transaction.objectStore(STORE_NAME).getAll();

    request.onsuccess = () => resolve(sortProducts(request.result as Product[]));
    request.onerror = () => reject(request.error ?? new Error('Falha ao carregar o estoque local.'));
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => reject(transaction.error ?? new Error('Falha na transação local.'));
  });
}

async function saveLocalProduct(product: Product): Promise<IDBValidKey> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const request = transaction.objectStore(STORE_NAME).put(product);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Falha ao salvar no banco local.'));
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => reject(transaction.error ?? new Error('Falha na transação local.'));
  });
}

async function removeLocalProduct(id: string): Promise<void> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).delete(id);

    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => reject(transaction.error ?? new Error('Falha ao excluir do banco local.'));
  });
}

async function replaceLocalProducts(products: Product[]): Promise<void> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    store.clear();
    products.forEach((product) => store.put(product));

    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => reject(transaction.error ?? new Error('Falha ao atualizar o cache local.'));
  });
}

function cleanProduct(product: Product): DocumentData {
  return Object.fromEntries(
    Object.entries(product).filter(([, value]) => value !== undefined),
  );
}

function cloudProductsCollection(userId: string) {
  if (!firebaseDb) throw new Error('Firebase não configurado.');
  return collection(firebaseDb, 'users', userId, 'products');
}

function cloudProductDocument(userId: string, productId: string) {
  if (!firebaseDb) throw new Error('Firebase não configurado.');
  return doc(firebaseDb, 'users', userId, 'products', productId);
}

export async function listProducts(): Promise<Product[]> {
  return listLocalProducts();
}

export async function saveProduct(product: Product): Promise<IDBValidKey> {
  const localKey = await saveLocalProduct(product);
  const user = firebaseAuth?.currentUser;

  if (user && firebaseDb) {
    void setDoc(cloudProductDocument(user.uid, product.id), cleanProduct(product)).catch((error) => {
      console.error('Produto salvo localmente, mas ainda não sincronizado:', error);
    });
  }

  return localKey;
}

export async function removeProduct(id: string): Promise<void> {
  await removeLocalProduct(id);
  const user = firebaseAuth?.currentUser;

  if (user && firebaseDb) {
    void deleteDoc(cloudProductDocument(user.uid, id)).catch((error) => {
      console.error('Produto excluído localmente, mas a exclusão ainda não foi sincronizada:', error);
    });
  }
}

export async function migrateLocalProductsToCloud(userId: string): Promise<Product[]> {
  if (!firebaseDb) return listLocalProducts();

  const [localProducts, cloudSnapshot] = await Promise.all([
    listLocalProducts(),
    getDocs(cloudProductsCollection(userId)),
  ]);

  const merged = new Map<string, Product>();
  const cloudProducts = cloudSnapshot.docs.map((snapshot) => snapshot.data() as Product);

  cloudProducts.forEach((product) => merged.set(product.id, product));

  const batch = writeBatch(firebaseDb);
  let pendingWrites = 0;

  localProducts.forEach((localProduct) => {
    const cloudProduct = merged.get(localProduct.id);
    if (!cloudProduct || localProduct.updatedAt > cloudProduct.updatedAt) {
      merged.set(localProduct.id, localProduct);
      batch.set(cloudProductDocument(userId, localProduct.id), cleanProduct(localProduct));
      pendingWrites += 1;
    }
  });

  if (pendingWrites) await batch.commit();

  const mergedProducts = sortProducts([...merged.values()]);
  await replaceLocalProducts(mergedProducts);
  return mergedProducts;
}

export function subscribeCloudProducts(
  userId: string,
  onProducts: (products: Product[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  if (!firebaseDb) return () => undefined;

  return onSnapshot(
    cloudProductsCollection(userId),
    async (snapshot) => {
      const products = sortProducts(snapshot.docs.map((item) => item.data() as Product));
      try {
        await replaceLocalProducts(products);
        onProducts(products);
      } catch (error) {
        onError(error instanceof Error ? error : new Error('Falha ao atualizar o estoque local.'));
      }
    },
    (error) => onError(error),
  );
}
