import {
  collection,
  doc,
  getDocsFromServer,
  onSnapshot,
  writeBatch,
  type DocumentData,
  type QuerySnapshot,
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

const LEGACY_DB_NAME = 'quimstock-db';
const USER_DB_PREFIX = 'quimstock-user-db-v2:';
const DB_VERSION = 1;
const PRODUCTS_STORE = 'products';
const PENDING_STORE = 'pendingOperations';
const FIRESTORE_BATCH_LIMIT = 450;
const SYNC_PROTOCOL_VERSION = 2;

export type BatchSaveResult = {
  saved: number;
  syncState: 'local' | 'synced' | 'pending';
};

export type CloudBootstrapResult = {
  products: Product[];
  cloudEmpty: boolean;
  legacyLocalCount: number;
  discardedStaleUpdates: number;
};

type PendingOperation = {
  id: string;
  kind: 'upsert' | 'delete';
  intent: 'create' | 'update' | 'delete';
  product?: Product;
  baseUpdatedAt?: string;
  queuedAt: string;
};

function userDatabaseName(userId: string): string {
  return `${USER_DB_PREFIX}${userId}`;
}

function createProductsStore(db: IDBDatabase): void {
  const store = db.createObjectStore(PRODUCTS_STORE, { keyPath: 'id' });
  store.createIndex('ecode', 'ecode', { unique: false });
  store.createIndex('expiryDate', 'expiryDate', { unique: false });
  store.createIndex('updatedAt', 'updatedAt', { unique: false });
}

function openDatabase(name: string, includePending: boolean): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PRODUCTS_STORE)) createProductsStore(db);
      if (includePending && !db.objectStoreNames.contains(PENDING_STORE)) {
        db.createObjectStore(PENDING_STORE, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Não foi possível abrir o banco local.'));
  });
}

function openLegacyDatabase(): Promise<IDBDatabase> {
  return openDatabase(LEGACY_DB_NAME, false);
}

function openUserDatabase(userId: string): Promise<IDBDatabase> {
  return openDatabase(userDatabaseName(userId), true);
}

function sortProducts(products: Product[]): Product[] {
  return [...products].sort((a, b) => {
    const createdOrder = (b.createdAt || '').localeCompare(a.createdAt || '');
    if (createdOrder !== 0) return createdOrder;
    return a.name.localeCompare(b.name, 'pt-BR');
  });
}

async function listProductsFromDatabase(open: () => Promise<IDBDatabase>): Promise<Product[]> {
  const db = await open();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(PRODUCTS_STORE, 'readonly');
    const request = transaction.objectStore(PRODUCTS_STORE).getAll();

    request.onsuccess = () => {
      const products = (request.result as Product[]).filter((product) => product.id !== STOCK_STATE_DOCUMENT_ID);
      resolve(sortProducts(products));
    };
    request.onerror = () => reject(request.error ?? new Error('Falha ao carregar o estoque local.'));
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => reject(transaction.error ?? new Error('Falha na transação local.'));
  });
}

async function listLegacyLocalProducts(): Promise<Product[]> {
  return listProductsFromDatabase(openLegacyDatabase);
}

async function listUserLocalProducts(userId: string): Promise<Product[]> {
  return listProductsFromDatabase(() => openUserDatabase(userId));
}

async function saveLegacyLocalProduct(product: Product): Promise<IDBValidKey> {
  const db = await openLegacyDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(PRODUCTS_STORE, 'readwrite');
    const request = transaction.objectStore(PRODUCTS_STORE).put(product);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Falha ao salvar no banco local.'));
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => reject(transaction.error ?? new Error('Falha na transação local.'));
  });
}

async function saveUserProductAndQueue(
  userId: string,
  product: Product,
  previous?: Product,
): Promise<IDBValidKey> {
  const db = await openUserDatabase(userId);

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([PRODUCTS_STORE, PENDING_STORE], 'readwrite');
    const productRequest = transaction.objectStore(PRODUCTS_STORE).put(product);
    const operation: PendingOperation = {
      id: product.id,
      kind: 'upsert',
      intent: previous ? 'update' : 'create',
      product,
      baseUpdatedAt: previous?.updatedAt,
      queuedAt: new Date().toISOString(),
    };
    transaction.objectStore(PENDING_STORE).put(operation);

    productRequest.onsuccess = () => resolve(productRequest.result);
    productRequest.onerror = () => reject(productRequest.error ?? new Error('Falha ao salvar no banco local.'));
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => reject(transaction.error ?? new Error('Falha ao registrar a alteração local.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('A alteração local foi cancelada.'));
  });
}

async function saveUserProductsAndQueue(
  userId: string,
  products: Product[],
  previousById: Map<string, Product>,
): Promise<void> {
  const db = await openUserDatabase(userId);

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([PRODUCTS_STORE, PENDING_STORE], 'readwrite');
    const productStore = transaction.objectStore(PRODUCTS_STORE);
    const pendingStore = transaction.objectStore(PENDING_STORE);
    const queuedAt = new Date().toISOString();

    products.forEach((product) => {
      const previous = previousById.get(product.id);
      productStore.put(product);
      const operation: PendingOperation = {
        id: product.id,
        kind: 'upsert',
        intent: previous ? 'update' : 'create',
        product,
        baseUpdatedAt: previous?.updatedAt,
        queuedAt,
      };
      pendingStore.put(operation);
    });

    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => reject(transaction.error ?? new Error('Falha ao atualizar o inventário local.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('A atualização do inventário foi cancelada pelo banco local.'));
  });
}

async function removeUserProductAndQueue(userId: string, product: Product | undefined, id: string): Promise<void> {
  const db = await openUserDatabase(userId);

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([PRODUCTS_STORE, PENDING_STORE], 'readwrite');
    transaction.objectStore(PRODUCTS_STORE).delete(id);
    const operation: PendingOperation = {
      id,
      kind: 'delete',
      intent: 'delete',
      baseUpdatedAt: product?.updatedAt,
      queuedAt: new Date().toISOString(),
    };
    transaction.objectStore(PENDING_STORE).put(operation);

    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => reject(transaction.error ?? new Error('Falha ao excluir do banco local.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('A exclusão local foi cancelada.'));
  });
}

async function replaceUserLocalProducts(userId: string, products: Product[]): Promise<void> {
  const db = await openUserDatabase(userId);

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(PRODUCTS_STORE, 'readwrite');
    const store = transaction.objectStore(PRODUCTS_STORE);
    store.clear();
    products.forEach((product) => store.put(product));

    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => reject(transaction.error ?? new Error('Falha ao atualizar o cache local.'));
  });
}

async function removeUserLocalProducts(userId: string, ids: string[]): Promise<void> {
  if (!ids.length) return;
  const db = await openUserDatabase(userId);

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(PRODUCTS_STORE, 'readwrite');
    const store = transaction.objectStore(PRODUCTS_STORE);
    ids.forEach((id) => store.delete(id));

    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => reject(transaction.error ?? new Error('Falha ao excluir produtos do banco local.'));
  });
}

async function listPendingOperations(userId: string): Promise<PendingOperation[]> {
  const db = await openUserDatabase(userId);

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(PENDING_STORE, 'readonly');
    const request = transaction.objectStore(PENDING_STORE).getAll();

    request.onsuccess = () => resolve(request.result as PendingOperation[]);
    request.onerror = () => reject(request.error ?? new Error('Falha ao ler alterações offline pendentes.'));
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => reject(transaction.error ?? new Error('Falha ao ler alterações offline pendentes.'));
  });
}

async function removePendingOperations(userId: string, ids: string[]): Promise<void> {
  if (!ids.length) return;
  const db = await openUserDatabase(userId);

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(PENDING_STORE, 'readwrite');
    const store = transaction.objectStore(PENDING_STORE);
    ids.forEach((id) => store.delete(id));

    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => reject(transaction.error ?? new Error('Falha ao concluir alterações offline.'));
  });
}

function cleanProduct(product: Product): DocumentData {
  const cleaned = Object.fromEntries(
    Object.entries(product).filter(([, value]) => value !== undefined),
  );
  return { ...cleaned, _syncProtocol: SYNC_PROTOCOL_VERSION };
}

function cloudProductsCollection(userId: string) {
  if (!firebaseDb) throw new Error('Firebase não configurado.');
  return collection(firebaseDb, 'users', userId, 'products');
}

function cloudProductDocument(userId: string, productId: string) {
  if (!firebaseDb) throw new Error('Firebase não configurado.');
  return doc(firebaseDb, 'users', userId, 'products', productId);
}

function documentToProduct(item: QuerySnapshot<DocumentData>['docs'][number]): Product {
  const data = item.data();
  const { _syncProtocol: _ignoredProtocol, ...productData } = data;
  void _ignoredProtocol;
  return {
    ...(productData as Product),
    id: String((productData as Product).id || item.id),
  };
}

function snapshotProducts(snapshot: QuerySnapshot<DocumentData>): Product[] {
  return sortProducts(
    snapshot.docs
      .filter((item) => item.id !== STOCK_STATE_DOCUMENT_ID)
      .map(documentToProduct),
  );
}

async function getServerProducts(userId: string): Promise<Product[]> {
  if (!firebaseDb) return [];
  const snapshot = await getDocsFromServer(cloudProductsCollection(userId));
  return snapshotProducts(snapshot);
}

async function hydrateTrustedLegacyCacheForOffline(userId: string): Promise<Product[]> {
  const current = await listUserLocalProducts(userId);
  if (current.length) return current;

  // O marcador de geração só existe para um UID que já sincronizou neste aparelho.
  // Assim podemos usar o banco legado como cache offline sem tratá-lo como fonte da nuvem.
  if (!getLocalStockGeneration(userId)) return current;

  const legacy = await listLegacyLocalProducts();
  if (!legacy.length) return current;
  await replaceUserLocalProducts(userId, legacy);
  return legacy;
}

export async function listProducts(): Promise<Product[]> {
  const user = firebaseAuth?.currentUser;
  return user ? listUserLocalProducts(user.uid) : listLegacyLocalProducts();
}

export async function flushPendingOperations(userId: string): Promise<{ processed: number; discardedStaleUpdates: number }> {
  if (!firebaseDb || !navigator.onLine) return { processed: 0, discardedStaleUpdates: 0 };

  const operations = await listPendingOperations(userId);
  if (!operations.length) return { processed: 0, discardedStaleUpdates: 0 };

  const serverProducts = await getServerProducts(userId);
  const serverById = new Map(serverProducts.map((product) => [product.id, product]));
  let processed = 0;
  let discardedStaleUpdates = 0;

  for (let start = 0; start < operations.length; start += FIRESTORE_BATCH_LIMIT) {
    const chunk = operations.slice(start, start + FIRESTORE_BATCH_LIMIT);
    const batch = writeBatch(firebaseDb);
    const resolvedIds: string[] = [];
    const locallyRemovedIds: string[] = [];
    let writes = 0;

    chunk.forEach((operation) => {
      const cloudProduct = serverById.get(operation.id);

      if (operation.kind === 'delete') {
        if (cloudProduct) {
          batch.delete(cloudProductDocument(userId, operation.id));
          writes += 1;
          serverById.delete(operation.id);
        }
        resolvedIds.push(operation.id);
        return;
      }

      if (!operation.product) {
        resolvedIds.push(operation.id);
        return;
      }

      // Uma alteração offline de um registro que foi excluído em outro aparelho
      // NÃO pode recriá-lo. Somente uma operação explicitamente criada como CREATE
      // tem autorização para criar um documento ausente.
      if (operation.intent === 'update' && !cloudProduct) {
        resolvedIds.push(operation.id);
        locallyRemovedIds.push(operation.id);
        discardedStaleUpdates += 1;
        return;
      }

      batch.set(cloudProductDocument(userId, operation.id), cleanProduct(operation.product));
      serverById.set(operation.id, operation.product);
      resolvedIds.push(operation.id);
      writes += 1;
    });

    if (writes) await batch.commit();
    if (locallyRemovedIds.length) await removeUserLocalProducts(userId, locallyRemovedIds);
    await removePendingOperations(userId, resolvedIds);
    processed += resolvedIds.length;
  }

  return { processed, discardedStaleUpdates };
}

export async function saveProduct(product: Product): Promise<IDBValidKey> {
  const user = firebaseAuth?.currentUser;
  if (!user || !firebaseDb) return saveLegacyLocalProduct(product);

  const previous = (await listUserLocalProducts(user.uid)).find((item) => item.id === product.id);
  const localKey = await saveUserProductAndQueue(user.uid, product, previous);

  if (navigator.onLine) {
    try {
      await flushPendingOperations(user.uid);
    } catch (error) {
      console.error('Produto salvo localmente; a alteração ficou na fila offline:', error);
    }
  }

  return localKey;
}

export async function saveProductsBatch(products: Product[]): Promise<BatchSaveResult> {
  const uniqueProducts = [...new Map(products.map((product) => [product.id, product])).values()];
  if (!uniqueProducts.length) return { saved: 0, syncState: 'local' };

  const user = firebaseAuth?.currentUser;
  if (!user || !firebaseDb) {
    for (const product of uniqueProducts) await saveLegacyLocalProduct(product);
    return { saved: uniqueProducts.length, syncState: 'local' };
  }

  const previousById = new Map((await listUserLocalProducts(user.uid)).map((product) => [product.id, product]));
  await saveUserProductsAndQueue(user.uid, uniqueProducts, previousById);

  if (!navigator.onLine) return { saved: uniqueProducts.length, syncState: 'pending' };

  try {
    await flushPendingOperations(user.uid);
    return { saved: uniqueProducts.length, syncState: 'synced' };
  } catch (error) {
    console.error('Inventário salvo localmente; a sincronização ficou pendente:', error);
    return { saved: uniqueProducts.length, syncState: 'pending' };
  }
}

export async function removeProduct(id: string): Promise<void> {
  const user = firebaseAuth?.currentUser;
  if (!user || !firebaseDb) {
    const db = await openLegacyDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(PRODUCTS_STORE, 'readwrite');
      transaction.objectStore(PRODUCTS_STORE).delete(id);
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error ?? new Error('Falha ao excluir do banco local.'));
    });
    return;
  }

  const previous = (await listUserLocalProducts(user.uid)).find((product) => product.id === id);
  await removeUserProductAndQueue(user.uid, previous, id);

  if (navigator.onLine) {
    try {
      await flushPendingOperations(user.uid);
    } catch (error) {
      console.error('Produto excluído localmente; a exclusão ficou na fila offline:', error);
    }
  }
}

export async function deleteProductsPermanently(ids: string[]): Promise<number> {
  const uniqueIds = [...new Set(ids.filter((id) => id && id !== STOCK_STATE_DOCUMENT_ID))];
  if (!uniqueIds.length) return 0;

  const user = firebaseAuth?.currentUser;
  if (!user || !firebaseDb || !navigator.onLine) {
    throw new Error('É necessário estar conectado à nuvem para fazer esta limpeza com segurança.');
  }

  for (let start = 0; start < uniqueIds.length; start += FIRESTORE_BATCH_LIMIT) {
    const batch = writeBatch(firebaseDb);
    uniqueIds.slice(start, start + FIRESTORE_BATCH_LIMIT).forEach((id) => {
      batch.delete(cloudProductDocument(user.uid, id));
    });
    await batch.commit();
  }

  await removeUserLocalProducts(user.uid, uniqueIds);
  await removePendingOperations(user.uid, uniqueIds);
  return uniqueIds.length;
}

export async function clearLocalProducts(): Promise<void> {
  const user = firebaseAuth?.currentUser;
  if (user) {
    await replaceUserLocalProducts(user.uid, []);
    return;
  }

  const db = await openLegacyDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(PRODUCTS_STORE, 'readwrite');
    transaction.objectStore(PRODUCTS_STORE).clear();
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => reject(transaction.error ?? new Error('Falha ao limpar o cache local.'));
  });
}

export async function bootstrapCloudProducts(userId: string): Promise<CloudBootstrapResult> {
  if (!firebaseDb) {
    const products = await listUserLocalProducts(userId);
    return { products, cloudEmpty: products.length === 0, legacyLocalCount: 0, discardedStaleUpdates: 0 };
  }

  if (!navigator.onLine) {
    const products = await hydrateTrustedLegacyCacheForOffline(userId);
    return { products, cloudEmpty: products.length === 0, legacyLocalCount: 0, discardedStaleUpdates: 0 };
  }

  const stockGeneration = await getOrCreateCloudStockGeneration(userId);
  const pendingResult = await flushPendingOperations(userId);
  const cloudProducts = await getServerProducts(userId);
  await replaceUserLocalProducts(userId, cloudProducts);
  setLocalStockGeneration(userId, stockGeneration.generation);

  const legacyLocalCount = cloudProducts.length === 0
    ? (await listLegacyLocalProducts()).length
    : 0;

  return {
    products: cloudProducts,
    cloudEmpty: cloudProducts.length === 0,
    legacyLocalCount,
    discardedStaleUpdates: pendingResult.discardedStaleUpdates,
  };
}

export async function importLegacyProductsToCloud(userId: string): Promise<number> {
  if (!firebaseDb || !navigator.onLine) {
    throw new Error('Conecte este aparelho à internet para importar os dados locais.');
  }

  const cloudProducts = await getServerProducts(userId);
  if (cloudProducts.length) {
    throw new Error('A nuvem já possui produtos. A importação local foi bloqueada para evitar duplicações.');
  }

  const legacyProducts = await listLegacyLocalProducts();
  if (!legacyProducts.length) return 0;

  const uniqueProducts = [...new Map(legacyProducts.map((product) => [product.id, product])).values()];
  for (let start = 0; start < uniqueProducts.length; start += FIRESTORE_BATCH_LIMIT) {
    const batch = writeBatch(firebaseDb);
    uniqueProducts.slice(start, start + FIRESTORE_BATCH_LIMIT).forEach((product) => {
      batch.set(cloudProductDocument(userId, product.id), cleanProduct(product));
    });
    await batch.commit();
  }

  await replaceUserLocalProducts(userId, uniqueProducts);
  const stockGeneration = await getOrCreateCloudStockGeneration(userId);
  setLocalStockGeneration(userId, stockGeneration.generation);
  return uniqueProducts.length;
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
      const products = snapshotProducts(snapshot);
      try {
        await replaceUserLocalProducts(userId, products);
        onProducts(products);
      } catch (error) {
        onError(error instanceof Error ? error : new Error('Falha ao atualizar o estoque local.'));
      }
    },
    (error) => onError(error),
  );
}
