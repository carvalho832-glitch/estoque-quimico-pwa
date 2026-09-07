import test from 'node:test';
import assert from 'node:assert/strict';
import {
  daysUntilExpiry,
  lowStockTransition,
  notificationKeyFor,
} from '../.test-dist/NotificationRules.js';

test('vencimento mantém a mesma chave no mesmo estágio e muda ao avançar de estágio', () => {
  const base = {
    type: 'EXPIRATION',
    productId: 'ATR1000',
    expiryDate: '2026-10-01',
  };

  const stage30 = notificationKeyFor({ ...base, stage: 30 });
  const repeated30 = notificationKeyFor({ ...base, stage: 30 });
  const stage15 = notificationKeyFor({ ...base, stage: 15 });
  const stage7 = notificationKeyFor({ ...base, stage: 7 });

  assert.equal(stage30, repeated30);
  assert.notEqual(stage30, stage15);
  assert.notEqual(stage15, stage7);
});

test('uma validade diferente gera uma nova sequência de chaves', () => {
  const firstExpiry = notificationKeyFor({
    type: 'EXPIRATION',
    productId: 'ATR1000',
    expiryDate: '2026-10-01',
    stage: 7,
  });
  const secondExpiry = notificationKeyFor({
    type: 'EXPIRATION',
    productId: 'ATR1000',
    expiryDate: '2027-02-01',
    stage: 7,
  });

  assert.notEqual(firstExpiry, secondExpiry);
});

test('dedupKey explícita prevalece para eventos de sincronização', () => {
  assert.equal(
    notificationKeyFor({
      type: 'LIST_UPDATED',
      detail: 'Estoque sincronizado.',
      dedupKey: 'cloud-list:user:abc123',
    }),
    'cloud-list:user:abc123',
  );
});

test('calcula dias até o vencimento e rejeita datas inválidas', () => {
  const now = new Date(2026, 8, 1, 12, 0, 0);
  assert.equal(daysUntilExpiry('2026-09-08', now), 7);
  assert.equal(daysUntilExpiry('2026-09-01', now), 0);
  assert.equal(daysUntilExpiry('2026-08-31', now), -1);
  assert.equal(daysUntilExpiry('2026-02-31', now), null);
  assert.equal(daysUntilExpiry('31/12/2026', now), null);
});

test('estoque baixo notifica uma vez, normaliza e permite novo alerta', () => {
  let active = false;

  let transition = lowStockTransition(active, false);
  assert.deepEqual(transition, { shouldNotify: false, nextActive: false });
  active = transition.nextActive;

  transition = lowStockTransition(active, true);
  assert.deepEqual(transition, { shouldNotify: true, nextActive: true });
  active = transition.nextActive;

  transition = lowStockTransition(active, true);
  assert.deepEqual(transition, { shouldNotify: false, nextActive: true });
  active = transition.nextActive;

  transition = lowStockTransition(active, false);
  assert.deepEqual(transition, { shouldNotify: false, nextActive: false });
  active = transition.nextActive;

  transition = lowStockTransition(active, true);
  assert.deepEqual(transition, { shouldNotify: true, nextActive: true });
});
