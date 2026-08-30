import { collection, getDocs, writeBatch } from 'firebase/firestore';
import { clearLocalProducts, listProducts } from './db';
import { firebaseAuth, firebaseDb } from './firebase';
import { rotateStockGeneration, STOCK_STATE_DOCUMENT_ID } from './stock-generation';

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
  const cloudProductDocs = cloudSnapshot.docs.filter((snapshot) => snapshot.id !== STOCK_STATE_DOCUMENT_ID);

  // A geração é trocada antes da exclusão. Qualquer aparelho que ainda tenha
  // a geração anterior será tratado como cache antigo no próximo login e não
  // poderá reenviar o inventário apagado para a nuvem.
  await rotateStockGeneration(user.uid);

  for (let start = 0; start < cloudProductDocs.length; start += FIRESTORE_BATCH_LIMIT) {
    const batch = writeBatch(firebaseDb);
    cloudProductDocs.slice(start, start + FIRESTORE_BATCH_LIMIT).forEach((snapshot) => {
      batch.delete(snapshot.ref);
    });
    await batch.commit();
  }

  await clearLocalProducts();

  window.localStorage.removeItem('quimstock-temporary-inventory-v1');
  window.dispatchEvent(new CustomEvent('quimstock:products-changed'));

  return { removed: Math.max(localProducts.length, cloudProductDocs.length) };
}
