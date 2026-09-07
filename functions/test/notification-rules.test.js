'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeSettings,
  isWithinCheckWindow,
  daysUntilExpiry,
  lowStockThreshold,
  expirationEvent,
  lowStockEvent,
  usageTransitionEvent,
} = require('../notification-rules');

test('normaliza configurações e preserva horários personalizados válidos', () => {
  const settings = normalizeSettings({
    checkTimes: ['22:00', '08:03', '08:03', '99:99'],
    expirationDays: [90, 7, 7, 5],
    lowStockThreshold: 5,
    timezone: 'America/Sao_Paulo',
  });
  assert.deepEqual(settings.checkTimes, ['08:03', '22:00']);
  assert.deepEqual(settings.expirationDays, [90, 7]);
  assert.equal(settings.lowStockThreshold, 5);
});

test('janela de cinco minutos aceita horário personalizado e virada de dia', () => {
  assert.equal(isWithinCheckWindow(['08:03'], new Date('2026-09-07T11:05:00Z'), 'America/Sao_Paulo', 5), true);
  assert.equal(isWithinCheckWindow(['08:03'], new Date('2026-09-07T11:08:00Z'), 'America/Sao_Paulo', 5), false);
  assert.equal(isWithinCheckWindow(['23:59'], new Date('2026-09-07T03:02:00Z'), 'America/Sao_Paulo', 5), true);
});

test('calcula validade pela data local de São Paulo', () => {
  const now = new Date('2026-09-07T15:00:00Z');
  assert.equal(daysUntilExpiry('2026-09-14', now, 'America/Sao_Paulo'), 7);
  assert.equal(daysUntilExpiry('2026-09-07', now, 'America/Sao_Paulo'), 0);
  assert.equal(daysUntilExpiry('2026-09-06', now, 'America/Sao_Paulo'), -1);
  assert.equal(daysUntilExpiry('2026-02-31', now, 'America/Sao_Paulo'), null);
});

test('gera estágios de validade sem repetir a mesma chave', () => {
  const settings = normalizeSettings({ expirationDays: [7, 3, 1] });
  const product = { name: 'ATR1000', expiryDate: '2026-09-14' };
  const event = expirationEvent('p1', product, settings, new Date('2026-09-07T15:00:00Z'));
  assert.equal(event.key, 'p1:expiration:2026-09-14:7');
  assert.match(event.body, /7 dias/);
});

test('estoque baixo respeita limite específico do produto', () => {
  const settings = normalizeSettings({ lowStockThreshold: 3 });
  const product = { name: 'Fastbond', quantity: 4, lowStockThreshold: 5 };
  assert.equal(lowStockThreshold(product, settings), 5);
  assert.equal(lowStockEvent('p2', product, settings).key, 'p2:low-stock');
});

test('detecta retirada e devolução reais', () => {
  const settings = normalizeSettings({});
  const removed = usageTransitionEvent(
    'p3',
    { availabilityStatus: 'stock' },
    { name: 'Hardener', availabilityStatus: 'in-use', currentUsage: { startedAt: '2026-09-07T12:00:00Z' } },
    settings,
  );
  assert.equal(removed.type, 'STOCK_REMOVED');

  const returned = usageTransitionEvent(
    'p3',
    { availabilityStatus: 'in-use', currentUsage: { startedAt: '2026-09-07T12:00:00Z' } },
    { name: 'Hardener', availabilityStatus: 'stock', updatedAt: '2026-09-07T13:00:00Z' },
    settings,
  );
  assert.equal(returned.type, 'STOCK_RETURNED');
});
