import { collection, getDocs, writeBatch } from 'firebase/firestore';
import { listProducts, removeProduct } from './db';
import { firebaseAuth, firebaseDb } from './firebase';

const FIRESTORE_BATCH_LIMIT = 450;

export type ResetStockResult = {
  removed: number;
};

export async function resetAllStockProducts(): Promise<ResetStockResult> {
  const user = firebaseAuth?.currentUser;

  if (!user || !firebaseDb) {
    throw new Error('É necessário estar conectado à conta do QuimStock para reiniciar o estoque.');
  }

  const localProducts = await listProducts();
  const cloudCollection = collection(firebaseDb, 'users', user.uid, 'products');
  const cloudSnapshot = await getDocs(cloudCollection);

  for (let start = 0; start < cloudSnapshot.docs.length; start += FIRESTORE_BATCH_LIMIT) {
    const batch = writeBatch(firebaseDb);
    cloudSnapshot.docs.slice(start, start + FIRESTORE_BATCH_LIMIT).forEach((snapshot) => {
      batch.delete(snapshot.ref);
    });
    await batch.commit();
  }

  for (const product of localProducts) {
    await removeProduct(product.id);
  }

  window.localStorage.removeItem('quimstock-temporary-inventory-v1');
  window.dispatchEvent(new CustomEvent('quimstock:products-changed'));

  return { removed: Math.max(localProducts.length, cloudSnapshot.size) };
}
