'use strict';

const crypto = require('node:crypto');
const { initializeApp } = require('firebase-admin/app');
const { FieldValue, Timestamp, getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');
const { logger } = require('firebase-functions');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { HttpsError, onCall } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const {
  normalizeSettings,
  isWithinCheckWindow,
  lowStockThreshold,
  expirationEvent,
  lowStockEvent,
  usageTransitionEvent,
} = require('./notification-rules');

initializeApp();

const db = getFirestore();
const messaging = getMessaging();
const REGION = 'southamerica-east1';
const STOCK_STATE_DOCUMENT_ID = 'quimstock-stock-state';
const PENDING_RESERVATION_MS = 10 * 60 * 1000;
const MAX_MULTICAST_TOKENS = 500;
const INVALID_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

function deliveryDocumentId(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

function deliveryRef(userId, key) {
  return db.doc(`users/${userId}/notificationDelivery/${deliveryDocumentId(key)}`);
}

async function reserveDelivery(userId, event) {
  const ref = deliveryRef(userId, event.key);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (snapshot.exists) {
      const current = snapshot.data() || {};
      if (current.status === 'sent') return false;
      const reservedAt = current.reservedAt instanceof Timestamp ? current.reservedAt.toMillis() : 0;
      if (current.status === 'pending' && Date.now() - reservedAt < PENDING_RESERVATION_MS) return false;
    }

    transaction.set(ref, {
      key: event.key,
      type: event.type,
      status: 'pending',
      reservedAt: Timestamp.now(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return true;
  });
}

async function markDelivered(userId, event, successCount) {
  await deliveryRef(userId, event.key).set({
    key: event.key,
    type: event.type,
    title: event.title,
    body: event.body,
    status: 'sent',
    successCount,
    sentAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

async function releaseDelivery(userId, key) {
  await deliveryRef(userId, key).delete().catch(() => undefined);
}

async function clearLowStockDelivery(userId, productId) {
  await releaseDelivery(userId, `${productId}:low-stock`);
}

function userIdFromTokenDoc(tokenDoc) {
  const userRef = tokenDoc.ref.parent.parent;
  return userRef ? userRef.id : null;
}

function tokenValue(tokenDoc) {
  const token = tokenDoc.data()?.token;
  return typeof token === 'string' && token.length > 20 ? token : null;
}

async function getUserTokenDocs(userId) {
  const snapshot = await db.collection(`users/${userId}/pushTokens`).where('enabled', '==', true).get();
  return snapshot.docs.filter((doc) => Boolean(tokenValue(doc)));
}

async function deleteInvalidTokenDocs(invalidDocs) {
  if (!invalidDocs.length) return;
  const batch = db.batch();
  invalidDocs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
}

async function sendUserNotification(userId, tokenDocs, event) {
  if (!tokenDocs.length) return { sent: false, successCount: 0, invalidCount: 0 };
  if (!(await reserveDelivery(userId, event))) return { sent: false, successCount: 0, invalidCount: 0 };

  let successCount = 0;
  const invalidDocs = [];

  try {
    for (let start = 0; start < tokenDocs.length; start += MAX_MULTICAST_TOKENS) {
      const chunkDocs = tokenDocs.slice(start, start + MAX_MULTICAST_TOKENS);
      const tokens = chunkDocs.map(tokenValue).filter(Boolean);
      if (!tokens.length) continue;

      const response = await messaging.sendEachForMulticast({
        tokens,
        data: {
          title: String(event.title),
          body: String(event.body),
          url: './',
          notificationKey: String(event.key),
          type: String(event.type),
        },
        webpush: {
          headers: {
            Urgency: event.type === 'EXPIRED' || event.type === 'LOW_STOCK' ? 'high' : 'normal',
          },
        },
      });

      successCount += response.successCount;
      response.responses.forEach((item, index) => {
        if (!item.success && INVALID_TOKEN_CODES.has(item.error?.code)) invalidDocs.push(chunkDocs[index]);
      });
    }

    await deleteInvalidTokenDocs(invalidDocs);

    if (successCount > 0) {
      await markDelivered(userId, event, successCount);
      return { sent: true, successCount, invalidCount: invalidDocs.length };
    }

    await releaseDelivery(userId, event.key);
    return { sent: false, successCount: 0, invalidCount: invalidDocs.length };
  } catch (error) {
    await releaseDelivery(userId, event.key);
    throw error;
  }
}

async function getUserSettings(userId) {
  const snapshot = await db.doc(`users/${userId}/settings/notifications`).get();
  return normalizeSettings(snapshot.exists ? snapshot.data() : {});
}

async function processScheduledUser(userId, tokenDocs, now) {
  const settings = await getUserSettings(userId);
  if (!isWithinCheckWindow(settings.checkTimes, now, settings.timezone, 5)) return;

  const products = await db.collection(`users/${userId}/products`).get();
  for (const productDoc of products.docs) {
    if (productDoc.id === STOCK_STATE_DOCUMENT_ID) continue;
    const product = productDoc.data() || {};

    const expiry = expirationEvent(productDoc.id, product, settings, now);
    if (expiry) await sendUserNotification(userId, tokenDocs, expiry);

    const threshold = lowStockThreshold(product, settings);
    const quantity = Number(product.quantity);
    if (Number.isFinite(quantity) && quantity > threshold) {
      await clearLowStockDelivery(userId, productDoc.id);
    } else {
      const lowStock = lowStockEvent(productDoc.id, product, settings);
      if (lowStock) await sendUserNotification(userId, tokenDocs, lowStock);
    }
  }
}

exports.backgroundNotificationSweep = onSchedule({
  schedule: 'every 5 minutes',
  timeZone: 'America/Sao_Paulo',
  region: REGION,
  memory: '256MiB',
  timeoutSeconds: 300,
  maxInstances: 1,
}, async () => {
  const now = new Date();
  const tokenSnapshot = await db.collectionGroup('pushTokens').where('enabled', '==', true).get();
  const users = new Map();

  tokenSnapshot.docs.forEach((tokenDoc) => {
    const userId = userIdFromTokenDoc(tokenDoc);
    if (!userId || !tokenValue(tokenDoc)) return;
    const current = users.get(userId) || [];
    current.push(tokenDoc);
    users.set(userId, current);
  });

  let processedUsers = 0;
  for (const [userId, tokenDocs] of users.entries()) {
    try {
      await processScheduledUser(userId, tokenDocs, now);
      processedUsers += 1;
    } catch (error) {
      logger.error('Falha ao processar notificações agendadas do usuário.', { userId, error });
    }
  }

  logger.info('Varredura de notificações do QuimStock concluída.', {
    usersWithTokens: users.size,
    processedUsers,
  });
});

exports.productNotificationBridge = onDocumentWritten({
  document: 'users/{userId}/products/{productId}',
  region: REGION,
  memory: '256MiB',
  timeoutSeconds: 60,
  maxInstances: 10,
}, async (event) => {
  const { userId, productId } = event.params;
  if (productId === STOCK_STATE_DOCUMENT_ID) return;

  const before = event.data?.before.exists ? event.data.before.data() : null;
  const after = event.data?.after.exists ? event.data.after.data() : null;

  if (!after) {
    await clearLowStockDelivery(userId, productId);
    return;
  }

  const [settings, tokenDocs] = await Promise.all([
    getUserSettings(userId),
    getUserTokenDocs(userId),
  ]);
  if (!tokenDocs.length) return;

  const usageEvent = usageTransitionEvent(productId, before, after, settings, event.id);
  if (usageEvent) await sendUserNotification(userId, tokenDocs, usageEvent);

  const threshold = lowStockThreshold(after, settings);
  const quantity = Number(after.quantity);
  if (Number.isFinite(quantity) && quantity > threshold) {
    await clearLowStockDelivery(userId, productId);
  } else {
    const lowStock = lowStockEvent(productId, after, settings);
    if (lowStock) await sendUserNotification(userId, tokenDocs, lowStock);
  }
});

exports.sendPushTest = onCall({
  region: REGION,
  memory: '256MiB',
  timeoutSeconds: 30,
}, async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Faça login no QuimStock para testar o push.');
  const userId = request.auth.uid;
  const tokenDocs = await getUserTokenDocs(userId);
  if (!tokenDocs.length) throw new HttpsError('failed-precondition', 'Nenhum dispositivo com push registrado.');

  const event = {
    type: 'TEST',
    key: `test:${userId}:${Date.now()}`,
    title: '✅ Push remoto do QuimStock',
    body: 'O envio em background está configurado corretamente.',
  };
  const result = await sendUserNotification(userId, tokenDocs, event);
  if (!result.sent) throw new HttpsError('unavailable', 'O Firebase não confirmou a entrega para nenhum dispositivo.');
  return result;
});
