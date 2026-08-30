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
import {
  getLocalStockGeneration,
  getOrCreateCloudStockGeneration,
  setLocalStockGeneration,
  STOCK_STATE_DOCUMENT_ID,
} from './stock-generation';

const DB_NAME = 'quimstock-db';
const DB_VERSION = 1;
const STORE_NAME = 'products';
const FIRESTORE_BATCH_LIMIT = 450;

export type BatchSaveResult = {
  saved: number;
  syncState: 'local' | 'synced' | 'pending';
};

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
  return products.sort((a, b) => {
    const createdOrder = b.createdAt.localeCompare(a.createdAt);
    if (createdOrder !== 0) return createdOrder;
    return a.name.localeCompare(b.name, 'pt-BR');
  });
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

async function saveLocalProducts(products: Product[]): Promise<void> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    products.forEach((product) => store.put(product));

    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => reject(transaction.error ?? new Error('Falha ao atualizar o inventário local.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('A atualização do inventário foi cancelada pelo banco local.'));
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

async function removeLocalProducts(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    ids.forEach((id) => store.delete(id));

    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => reject(transaction.error ?? new Error('Falha ao excluir produtos do banco local.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('A limpeza local foi cancelada pelo banco.'));
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

function snapshotProducts(snapshot: Awaited<ReturnType<typeof getDocs>>): Product[] {
  return sortProducts(
    snapshot.docs
      .filter((item) => item.id !== STOCK_STATE_DOCUMENT_ID)
      .map((item) => item.data() as Product),
  );
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

export async function saveProductsBatch(products: Product[]): Promise<BatchSaveResult> {
  const uniqueProducts = [...new Map(products.map((product) => [product.id, product])).values()];
  if (!uniqueProducts.length) return { saved: 0, syncState: 'local' };

  await saveLocalProducts(uniqueProducts);

  const user = firebaseAuth?.currentUser;
  if (!user || !firebaseDb) {
    return { saved: uniqueProducts.length, syncState: 'local' };
  }

  try {
    for (let start = 0; start < uniqueProducts.length; start += FIRESTORE_BATCH_LIMIT) {
      const cloudBatch = writeBatch(firebaseDb);
      uniqueProducts.slice(start, start + FIRESTORE_BATCH_LIMIT).forEach((product) => {
        cloudBatch.set(cloudProductDocument(user.uid, product.id), cleanProduct(product));
      });
      await cloudBatch.commit();
    }

    return { saved: uniqueProducts.length, syncState: 'synced' };
  } catch (error) {
    console.error('Inventário atualizado localmente, mas a sincronização em lote ficou pendente:', error);
    return { saved: uniqueProducts.length, syncState: 'pending' };
  }
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

export async function deleteProductsPermanently(ids: string[]): Promise<number> {
  const uniqueIds = [...new Set(ids.filter((id) => id && id !== STOCK_STATE_DOCUMENT_ID))];
  if (!uniqueIds.length) return 0;

  const user = firebaseAuth?.currentUser;
  if (!user || !firebaseDb) {
    throw new Error('É necessário estar conectado à nuvem para fazer esta limpeza com segurança.');
  }

  for (let start = 0; start < uniqueIds.length; start += FIRESTORE_BATCH_LIMIT) {
    const batch = writeBatch(firebaseDb);
    uniqueIds.slice(start, start + FIRESTORE_BATCH_LIMIT).forEach((id) => {
      batch.delete(cloudProductDocument(user.uid, id));
    });
    await batch.commit();
  }

  await removeLocalProducts(uniqueIds);
  return uniqueIds.length;
}

export async function clearLocalProducts(): Promise<void> {
  await replaceLocalProducts([]);
}

export async function migrateLocalProductsToCloud(userId: string): Promise<Product[]> {
  if (!firebaseDb) return listLocalProducts();

  const [localProducts, cloudSnapshot, stockGeneration] = await Promise.all([
    listLocalProducts(),
    getDocs(cloudProductsCollection(userId)),
    getOrCreateCloudStockGeneration(userId),
  ]);

  const cloudProducts = snapshotProducts(cloudSnapshot);
  const localGeneration = getLocalStockGeneration(userId);

  // Se a nuvem já possui um inventário quando o controle de geração é criado,
  // ela é adotada imediatamente como fonte oficial. Isso evita que o primeiro
  // aparelho antigo a abrir a nova versão faça mais um merge indesejado.
  const cloudAlreadyAuthoritative = stockGeneration.created && cloudProducts.length > 0;
  const staleLocalGeneration = !stockGeneration.created && localGeneration !== stockGeneration.generation;

  if (cloudAlreadyAuthoritative || staleLocalGeneration) {
    await replaceLocalProducts(cloudProducts);
    setLocalStockGeneration(userId, stockGeneration.generation);
    return cloudProducts;
  }

  // A migração local só é mantida na primeira ativação quando a nuvem está
  // realmente vazia, ou em funcionamento offline dentro da mesma geração.
  const merged = new Map<string, Product>();
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
  setLocalStockGeneration(userId, stockGeneration.generation);
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
      const products = sortProducts(
        snapshot.docs
          .filter((item) => item.id !== STOCK_STATE_DOCUMENT_ID)
          .map((item) => item.data() as Product),
      );
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
