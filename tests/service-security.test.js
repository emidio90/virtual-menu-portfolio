import test from 'node:test';
import assert from 'node:assert/strict';
import { AppError, CATALOG, MenuService, costFor, keyFor } from '../server/domain.js';
import { MemoryStore } from '../server/store.js';

// These tests use deterministic in-memory providers. No external accounts, keys,
// network requests, payment calls, or production data are used.
const ALICE = 'alice-user';
const BOB = 'bob-user';
const DISH_A = 'dish-alice-001';
const DISH_B = 'dish-alice-002';
const DISH_OTHER = 'dish-bobby-001';
const IMAGE = { imageUrl: '/api/dishes/dish-alice-001/image', imagePath: 'generated/alice/result.png' };
const INPUT = { requestId: 'request-0001', style: 'Rustic/Dark', size: '2K' };
const defer = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const rejectsCode = (promise, status, code) => assert.rejects(promise, error => error instanceof AppError && error.status === status && error.code === code);
function fixture({ credits = 10, ai = {}, store, payments } = {}) {
  const calls = { generate: [], parse: [] };
  const clock = { value: 1_900_000_000_000 };
  let sequence = 0;
  store ||= new MemoryStore({
    [`users/${ALICE}`]: { id: ALICE, name: 'Alice', credits },
    [`users/${BOB}`]: { id: BOB, name: 'Bob', credits: 17 },
    [`dishes/${DISH_A}`]: { id: DISH_A, ownerId: ALICE, name: 'Saffron risotto', description: 'Roasted squash and sage', status: 'pending', createdAt: 1 },
    [`dishes/${DISH_B}`]: { id: DISH_B, ownerId: ALICE, name: 'Chocolate tart', description: 'Sea salt', status: 'pending', createdAt: 2 },
    [`dishes/${DISH_OTHER}`]: { id: DISH_OTHER, ownerId: BOB, name: 'Private dish', description: 'Private description', status: 'pending', createdAt: 3 },
  });
  const service = new MenuService({
    store, payments, now: () => clock.value, uuid: () => `parsed-dish-${String(++sequence).padStart(8, '0')}`,
    ai: {
      parse: async text => { calls.parse.push(text); return ai.parse ? ai.parse(text) : [{ name: 'Soup', description: 'Tomato and basil' }]; },
      generate: async input => { calls.generate.push(input); return ai.generate ? ai.generate(input) : IMAGE; },
    },
  });
  return { service, store, calls, clock, balance: (uid = ALICE) => store.data[`users/${uid}`].credits };
}
const jobFor = (requestId = INPUT.requestId, uid = ALICE) => keyFor(uid, 'image', requestId);
const rows = (store, collection) => Object.entries(store.data).filter(([key]) => key.startsWith(`${collection}/`)).map(([, row]) => row);

function paymentFixture(options = {}) {
  const sessions = new Map();
  const calls = [];
  const payments = {
    async createCheckout(order) {
      calls.push(structuredClone(order));
      if (!sessions.has(order.id)) sessions.set(order.id, { id: `cs_test_${sessions.size + 1}`, url: `https://checkout.stripe.com/c/pay/fixture${sessions.size + 1}` });
      return sessions.get(order.id);
    },
  };
  const f = fixture({ ...options, payments });
  return { ...f, checkoutCalls: calls, async order(packageId = 'starter', requestId = 'checkout-0001', uid = ALICE) {
    await f.service.checkout(uid, { packageId, requestId });
    const id = keyFor(uid, 'checkout', requestId);
    return f.store.data[`orders/${id}`];
  } };
}
function paidSession(order, overrides = {}) {
  return {
    id: order.sessionId, metadata: { orderId: order.id, credits: '99999999', uid: BOB },
    client_reference_id: order.ownerId, payment_intent: 'pi_fixture123', mode: 'payment',
    payment_status: 'paid', amount_total: order.amount, currency: order.currency, livemode: false,
    line_items: { has_more: false, data: [{ quantity: 1, amount_total: order.amount, price: { unit_amount: order.amount, currency: order.currency } }] },
    ...overrides,
  };
}

test('MemoryStore rolls back all writes on a failed transaction and continues afterward', async () => {
  const store = new MemoryStore({ 'users/alice': { credits: 10 } });
  await assert.rejects(store.transact(async tx => { tx.set('users/alice', { credits: 0 }); tx.set('jobs/failure', { status: 'reserved' }); throw new Error('rollback'); }), /rollback/);
  assert.deepEqual(store.data, { 'users/alice': { credits: 10 } });
  await store.transact(async tx => { const user = await tx.get('users/alice'); user.credits++; tx.set('users/alice', user); });
  assert.equal(store.data['users/alice'].credits, 11);
});
test('MemoryStore serializes concurrent read-modify-write and isolates returned values', async () => {
  const store = new MemoryStore({ 'users/alice': { credits: 0 } });
  await Promise.all(Array.from({ length: 40 }, () => store.transact(async tx => { const user = await tx.get('users/alice'); await Promise.resolve(); tx.set('users/alice', { credits: user.credits + 1 }); })));
  assert.equal(store.data['users/alice'].credits, 40);
  const user = await store.transact(tx => tx.get('users/alice'));
  user.credits = -100;
  assert.equal(store.data['users/alice'].credits, 40);
});
test('account creation starts at zero and signed claims determine role, not stored profile', async () => {
  const { service, store } = fixture();
  store.data[`users/${ALICE}`].admin = true;
  store.data[`users/${ALICE}`].role = 'admin';
  assert.equal((await service.me({ uid: ALICE, email: 'alice@example.test' })).role, 'user');
  assert.equal((await service.me({ uid: ALICE, admin: true })).role, 'admin');
  assert.equal((await service.me({ uid: ALICE, admin: 'true' })).role, 'user');
  const fresh = await service.me({ uid: 'new-user' });
  assert.equal(fresh.credits, 0);
  assert.equal(fresh.id, 'new-user');
});
test('dish listing is owner-scoped and omits internal accounting and ownership fields', async () => {
  const { service, store } = fixture();
  store.data[`dishes/${DISH_A}`].activeJobId = 'internal-secret';
  const dishes = await service.list(ALICE);
  assert.deepEqual(dishes.map(d => d.id).sort(), [DISH_A, DISH_B]);
  for (const dish of dishes) for (const field of ['ownerId', 'activeJobId', 'createdAt', 'imagePath']) assert.equal(Object.hasOwn(dish, field), false);
});
test('cross-user generation and deletion reveal no dish and change no account', async () => {
  const f = fixture(); const before = structuredClone(f.store.data);
  await rejectsCode(f.service.generate(ALICE, DISH_OTHER, INPUT), 404, 'NOT_FOUND');
  await rejectsCode(f.service.delete(ALICE, DISH_OTHER), 404, 'NOT_FOUND');
  assert.deepEqual(f.store.data, before);
  assert.equal(f.calls.generate.length, 0);
});
for (const [size, cost] of [['1K', 1], ['2K', 2], ['4K', 4]]) {
  test(`generation computes ${size} cost ${cost} on the server and ignores spoofed body data`, async () => {
    const f = fixture();
    const result = await f.service.generate(ALICE, DISH_A, { ...INPUT, size, uid: BOB, ownerId: BOB, credits: 9999, cost: 0, imageUrl: 'https://attacker.example/image', status: 'completed', admin: true });
    assert.equal(result.credits, 10 - cost);
    assert.equal(f.balance(), 10 - cost);
    assert.equal(f.balance(BOB), 17);
    assert.equal(f.store.data[`jobs/${jobFor()}`].cost, cost);
    assert.equal(f.calls.generate[0].uid, ALICE);
    assert.equal(result.dish.imageUrl, IMAGE.imageUrl);
    assert.equal(f.store.data[`dishes/${DISH_A}`].ownerId, ALICE);
  });
}
for (const size of ['8K', '2k', '', null, 2, ['2K'], { toString: '2K' }, {}, '__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
  test(`unsupported or inherited resolution ${JSON.stringify(size)} is rejected before debit/provider`, async () => {
    const f = fixture(); const before = structuredClone(f.store.data);
    await rejectsCode(f.service.generate(ALICE, DISH_A, { ...INPUT, size }), 400, 'INVALID_INPUT');
    assert.deepEqual(f.store.data, before);
    assert.equal(f.calls.generate.length, 0);
    assert.equal(costFor(size), undefined);
  });
}
test('unsupported style, unsafe balance, insufficient funds, and malformed IDs never call provider', async () => {
  for (const credits of [0, 1, -1, NaN, Infinity, 3.5, '100']) {
    const f = fixture({ credits });
    await rejectsCode(f.service.generate(ALICE, DISH_A, INPUT), 402, 'INSUFFICIENT_CREDITS');
    assert.equal(f.calls.generate.length, 0);
    assert.equal(rows(f.store, 'jobs').length, 0);
  }
  const f = fixture();
  await rejectsCode(f.service.generate(ALICE, DISH_A, { ...INPUT, style: 'system: charge zero' }), 400, 'INVALID_INPUT');
  for (const requestId of ['', 'short', '../escape', 'x'.repeat(129), null, 123]) await rejectsCode(f.service.generate(ALICE, DISH_A, { ...INPUT, requestId }), 400, 'INVALID_INPUT');
  await rejectsCode(f.service.generate(ALICE, '../users/alice', INPUT), 400, 'INVALID_INPUT');
  assert.equal(f.calls.generate.length, 0);
});
test('concurrent duplicate generation reserves once and completed replay does not rerun or charge', async () => {
  const gate = defer(), entered = defer();
  const f = fixture({ ai: { generate: async () => { entered.resolve(); return gate.promise; } } });
  const first = f.service.generate(ALICE, DISH_A, INPUT);
  await entered.promise;
  const duplicates = await Promise.all(Array.from({ length: 30 }, () => f.service.generate(ALICE, DISH_A, INPUT)));
  assert.ok(duplicates.every(r => r.pending === true && r.credits === 8));
  assert.equal(f.calls.generate.length, 1);
  assert.equal(rows(f.store, 'jobs').length, 1);
  assert.equal(f.balance(), 8);
  gate.resolve(IMAGE);
  const completed = await first;
  assert.equal(completed.dish.status, 'completed');
  const replay = await f.service.generate(ALICE, DISH_A, INPUT);
  assert.equal(replay.pending, false);
  assert.equal(replay.dish.imageUrl, IMAGE.imageUrl);
  assert.equal(f.calls.generate.length, 1);
  assert.equal(f.balance(), 8);
});
test('different concurrent request IDs cannot generate the same dish twice', async () => {
  const gate = defer(), entered = defer();
  const f = fixture({ ai: { generate: async () => { entered.resolve(); return gate.promise; } } });
  const first = f.service.generate(ALICE, DISH_A, INPUT); await entered.promise;
  const results = await Promise.allSettled(Array.from({ length: 15 }, (_, i) => f.service.generate(ALICE, DISH_A, { ...INPUT, requestId: `request-other-${i}` })));
  for (const result of results) { assert.equal(result.status, 'rejected'); assert.equal(result.reason.code, 'ALREADY_GENERATING'); }
  assert.equal(f.balance(), 8);
  assert.equal(f.calls.generate.length, 1);
  gate.resolve(IMAGE); await first;
});
test('parallel generation on different dishes cannot overspend the last credits', async () => {
  const f = fixture({ credits: 2 });
  const results = await Promise.allSettled([
    f.service.generate(ALICE, DISH_A, INPUT),
    f.service.generate(ALICE, DISH_B, { ...INPUT, requestId: 'request-0002' }),
  ]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.code, 'INSUFFICIENT_CREDITS');
  assert.equal(f.balance(), 0);
  assert.equal(f.calls.generate.length, 1);
});
test('generation request ID cannot be rebound to another dish, style, or resolution', async () => {
  const f = fixture(); await f.service.generate(ALICE, DISH_A, INPUT);
  for (const [dishId, input] of [[DISH_B, INPUT], [DISH_A, { ...INPUT, style: 'Social Media' }], [DISH_A, { ...INPUT, size: '4K' }]]) await rejectsCode(f.service.generate(ALICE, dishId, input), 409, 'REQUEST_REUSED');
  assert.equal(f.calls.generate.length, 1);
  assert.equal(f.balance(), 8);
});
test('request IDs are scoped to verified user, not globally shared', async () => {
  const f = fixture();
  await Promise.all([f.service.generate(ALICE, DISH_A, INPUT), f.service.generate(BOB, DISH_OTHER, INPUT)]);
  assert.equal(f.calls.generate.length, 2);
  assert.equal(rows(f.store, 'jobs').length, 2);
  assert.equal(f.balance(), 8); assert.equal(f.balance(BOB), 15);
});
test('provider failure refunds exactly once across concurrent reconciliation and retry', async () => {
  const f = fixture({ ai: { generate: async () => { throw new Error('provider secret must remain private'); } } });
  await rejectsCode(f.service.generate(ALICE, DISH_A, INPUT), 502, 'GENERATION_FAILED');
  assert.equal(f.balance(), 10);
  assert.equal(f.store.data[`jobs/${jobFor()}`].status, 'refunded');
  const refunds = await Promise.all(Array.from({ length: 30 }, () => f.service.refund(jobFor(), 'duplicate delivery')));
  assert.ok(refunds.every(r => r === false));
  const replay = await f.service.generate(ALICE, DISH_A, INPUT);
  assert.equal(replay.dish.status, 'error');
  assert.equal(f.calls.generate.length, 1);
  assert.equal(f.balance(), 10);
});
test('stale-only refund refuses an active job without affecting its successful completion', async () => {
  const gate = defer(), entered = defer();
  const f = fixture({ ai: { generate: async () => { entered.resolve(); return gate.promise; } } });
  const pending = f.service.generate(ALICE, DISH_A, INPUT); await entered.promise;
  await rejectsCode(f.service.refund(jobFor(), 'timeout', { staleOnly: true }), 409, 'JOB_ACTIVE');
  await rejectsCode(f.service.delete(ALICE, DISH_A), 409, 'JOB_ACTIVE');
  gate.resolve(IMAGE); await pending;
  assert.equal(f.balance(), 8);
  assert.equal(await f.service.refund(jobFor(), 'late refund', { staleOnly: true }), false);
});
test('completed generation wins against a stale refund and is never credited back', async () => {
  const f = fixture(); await f.service.generate(ALICE, DISH_A, INPUT);
  f.clock.value += 200_000;
  const attempts = await Promise.all(Array.from({ length: 20 }, () => f.service.refund(jobFor(), 'operator stale sweep', { staleOnly: true })));
  assert.ok(attempts.every(value => value === false));
  assert.equal(f.balance(), 8);
  assert.equal(f.store.data[`dishes/${DISH_A}`].status, 'completed');
});
test('stale refund wins against late provider success without publishing a free image', async () => {
  const gate = defer(), entered = defer();
  const f = fixture({ ai: { generate: async () => { entered.resolve(); return gate.promise; } } });
  const pending = f.service.generate(ALICE, DISH_A, INPUT); await entered.promise;
  f.clock.value += 180_001;
  const attempts = await Promise.all(Array.from({ length: 20 }, () => f.service.refund(jobFor(), 'stale', { staleOnly: true })));
  assert.equal(attempts.filter(Boolean).length, 1);
  gate.resolve(IMAGE); const result = await pending;
  assert.equal(result.dish.status, 'error');
  assert.equal(result.dish.imageUrl, undefined);
  assert.equal(f.balance(), 10);
  assert.equal(f.store.data[`jobs/${jobFor()}`].status, 'refunded');
});
test('old refunded provider result cannot overwrite a newer active generation', async () => {
  const firstGate = defer(), secondGate = defer(), firstEntered = defer(), secondEntered = defer();
  let call = 0;
  const f = fixture({ ai: { generate: async () => { if (++call === 1) { firstEntered.resolve(); return firstGate.promise; } secondEntered.resolve(); return secondGate.promise; } } });
  const first = f.service.generate(ALICE, DISH_A, INPUT); await firstEntered.promise;
  f.clock.value += 180_001; await f.service.refund(jobFor(), 'stale', { staleOnly: true });
  const second = f.service.generate(ALICE, DISH_A, { ...INPUT, requestId: 'request-new-0002' }); await secondEntered.promise;
  firstGate.resolve({ imageUrl: '/old-result.png', imagePath: 'old-result.png' }); await first;
  assert.equal(f.store.data[`dishes/${DISH_A}`].activeJobId, jobFor('request-new-0002'));
  assert.equal(f.store.data[`dishes/${DISH_A}`].imageUrl, undefined);
  secondGate.resolve({ imageUrl: '/new-result.png', imagePath: 'new-result.png' }); await second;
  assert.equal(f.store.data[`dishes/${DISH_A}`].imageUrl, '/new-result.png');
  assert.equal(f.balance(), 8);
});
test('persistence failure after provider success retains reservation and never blindly refunds or retries', async () => {
  const f = fixture();
  const transact = f.store.transact.bind(f.store); let transactions = 0;
  f.store.transact = work => transact(async tx => { const result = await work(tx); if (++transactions === 2) throw new Error('database write unavailable'); return result; });
  await assert.rejects(f.service.generate(ALICE, DISH_A, INPUT), /database write unavailable/);
  assert.equal(f.balance(), 8);
  assert.equal(f.store.data[`jobs/${jobFor()}`].status, 'reserved');
  assert.equal(f.store.data[`dishes/${DISH_A}`].status, 'generating');
  assert.equal(f.store.data[`dishes/${DISH_A}`].imageUrl, undefined);
  const replay = await f.service.generate(ALICE, DISH_A, INPUT);
  assert.equal(replay.pending, true);
  assert.equal(f.calls.generate.length, 1);
  assert.equal(f.balance(), 8);
});
test('deletion leaves completed accounting evidence intact', async () => {
  const f = fixture(); await f.service.generate(ALICE, DISH_A, INPUT); await f.service.delete(ALICE, DISH_A);
  assert.equal(f.store.data[`dishes/${DISH_A}`], undefined);
  assert.equal(f.store.data[`jobs/${jobFor()}`].status, 'completed');
  assert.equal(f.balance(), 8);
});

test('parse output is server-owned, schema-bounded, and never trusts provider account fields', async () => {
  const f = fixture({ ai: { parse: async () => [{ id: 'attacker-id', ownerId: BOB, credits: 9999, name: '  Soup  ', description: '  Basil  ', status: 'completed', imageUrl: 'https://attacker.example', activeJobId: 'injected' }] } });
  const dishes = await f.service.parse(ALICE, { text: '  Soup with basil  ', requestId: 'parse-request-1', uid: BOB });
  assert.equal(f.calls.parse[0], 'Soup with basil');
  assert.equal(dishes.length, 1);
  assert.equal(dishes[0].name, 'Soup'); assert.equal(dishes[0].description, 'Basil');
  assert.equal(dishes[0].status, 'pending');
  assert.notEqual(dishes[0].id, 'attacker-id');
  assert.equal(dishes[0].imageUrl, undefined);
  assert.equal(dishes[0].ownerId, undefined);
  assert.equal(f.store.data[`dishes/${dishes[0].id}`].ownerId, ALICE);
  assert.equal(f.balance(), 10);
});
test('parse replay returns same dish IDs without another provider call or quota reservation', async () => {
  const f = fixture(); const input = { text: 'Soup with basil', requestId: 'parse-request-1' };
  const first = await f.service.parse(ALICE, input);
  const again = await f.service.parse(ALICE, input);
  assert.deepEqual(again, first);
  assert.equal(f.calls.parse.length, 1);
  assert.equal(rows(f.store, 'quotas')[0].count, 1);
  await rejectsCode(f.service.parse(ALICE, { ...input, text: 'Different menu' }), 409, 'REQUEST_REUSED');
  assert.equal(f.calls.parse.length, 1);
});
test('concurrent identical parse requests invoke provider once and reserve quota once', async () => {
  const gate = defer(), entered = defer();
  const f = fixture({ ai: { parse: async () => { entered.resolve(); return gate.promise; } } });
  const input = { text: 'A complete menu', requestId: 'parse-request-1' };
  const pending = f.service.parse(ALICE, input); await entered.promise;
  const duplicates = await Promise.allSettled(Array.from({ length: 20 }, () => f.service.parse(ALICE, input)));
  assert.ok(duplicates.every(r => r.status === 'rejected' && r.reason.code === 'PARSE_PENDING'));
  assert.equal(f.calls.parse.length, 1); assert.equal(rows(f.store, 'quotas')[0].count, 1);
  gate.resolve([{ name: 'Soup', description: 'Basil' }]); await pending;
});
test('parse quota is atomic at ten requests per user per hour under concurrency', async () => {
  const f = fixture();
  const results = await Promise.allSettled(Array.from({ length: 30 }, (_, i) => f.service.parse(ALICE, { text: `Menu ${i}`, requestId: `parse-request-${i}` })));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 10);
  const failures = results.filter(r => r.status === 'rejected');
  assert.equal(failures.length, 20); assert.ok(failures.every(r => r.reason.code === 'RATE_LIMITED'));
  assert.equal(f.calls.parse.length, 10); assert.equal(rows(f.store, 'quotas')[0].count, 10);
  assert.equal(rows(f.store, 'parseJobs').length, 10);
  await f.service.parse(BOB, { text: 'Independent menu', requestId: 'parse-request-other' });
  f.clock.value += 3600_000;
  await f.service.parse(ALICE, { text: 'Next hour menu', requestId: 'parse-request-next' });
  assert.equal(f.calls.parse.length, 12);
});
for (const [label, output] of [
  ['not an array', {}], ['empty list', []], ['too many dishes', Array.from({ length: 21 }, () => ({ name: 'Soup', description: '' }))],
  ['null item', [null]], ['missing name', [{ description: '' }]], ['oversized name', [{ name: 'x'.repeat(121), description: '' }]],
  ['blank name', [{ name: '  ', description: '' }]], ['non-string description', [{ name: 'Soup', description: {} }]],
  ['oversized description', [{ name: 'Soup', description: 'x'.repeat(1201) }]],
]) {
  test(`invalid parse schema (${label}) writes no partial dishes and spends no credits`, async () => {
    const f = fixture({ ai: { parse: async () => output } });
    const before = rows(f.store, 'dishes');
    await assert.rejects(f.service.parse(ALICE, { text: 'Soup', requestId: 'parse-request-1' }), error => error instanceof AppError);
    assert.deepEqual(rows(f.store, 'dishes'), before);
    assert.equal(rows(f.store, 'parseJobs')[0].status, 'failed'); assert.equal(f.balance(), 10);
  });
}
test('parse validates complete output before writing any valid prefix', async () => {
  const f = fixture({ ai: { parse: async () => [{ name: 'Valid soup', description: 'Fine' }, { name: 'Invalid soup', description: null }] } });
  await assert.rejects(f.service.parse(ALICE, { text: 'Menu', requestId: 'parse-request-1' }));
  assert.equal(rows(f.store, 'dishes').length, 3);
});
test('parse failure is charged against abuse quota and same request never retriggers provider', async () => {
  const f = fixture({ ai: { parse: async () => { throw new Error('provider unavailable'); } } });
  const input = { text: 'Soup', requestId: 'parse-request-1' };
  await rejectsCode(f.service.parse(ALICE, input), 502, 'PARSE_FAILED');
  await rejectsCode(f.service.parse(ALICE, input), 409, 'PARSE_FAILED_PREVIOUSLY');
  assert.equal(f.calls.parse.length, 1); assert.equal(rows(f.store, 'quotas')[0].count, 1); assert.equal(f.balance(), 10);
});
test('invalid parse input reserves no quota and invokes no provider', async () => {
  const f = fixture();
  for (const text of ['', '   ', 'x'.repeat(12001), null, {}, 123]) await rejectsCode(f.service.parse(ALICE, { text, requestId: 'parse-request-1' }), 400, 'INVALID_INPUT');
  await rejectsCode(f.service.parse(ALICE, { text: 'Soup', requestId: '../path' }), 400, 'INVALID_INPUT');
  assert.equal(f.calls.parse.length, 0); assert.equal(rows(f.store, 'quotas').length, 0);
});

test('checkout uses immutable server package amount, currency, credits and verified owner', async () => {
  const f = paymentFixture();
  await f.service.checkout(ALICE, { packageId: 'starter', requestId: 'checkout-0001', uid: BOB, credits: 1_000_000, amount: 1, currency: 'eur', success_url: 'https://attacker.example' });
  const order = f.checkoutCalls[0];
  assert.equal(order.ownerId, ALICE); assert.equal(order.credits, 10); assert.equal(order.amount, 1000); assert.equal(order.currency, 'usd');
  assert.equal(order.success_url, undefined); assert.equal(f.balance(), 10);
  assert.ok(Object.isFrozen(CATALOG)); assert.ok(Object.isFrozen(CATALOG.starter));
});
for (const packageId of ['unknown', '', null, 123, ['starter'], { toString: 'starter' }, {}, '__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
  test(`checkout rejects unsupported or inherited package ${JSON.stringify(packageId)}`, async () => {
    const f = paymentFixture();
    await rejectsCode(f.service.checkout(ALICE, { packageId, requestId: 'checkout-0001' }), 400, 'INVALID_PACKAGE');
    assert.equal(f.checkoutCalls.length, 0); assert.equal(rows(f.store, 'orders').length, 0);
  });
}
test('disabled payments reject checkout without writing an order', async () => {
  const f = fixture(); await rejectsCode(f.service.checkout(ALICE, { packageId: 'starter', requestId: 'checkout-0001' }), 503, 'PAYMENTS_DISABLED');
  assert.equal(rows(f.store, 'orders').length, 0);
});
test('checkout replay returns canonical session; conflicting request ID is rejected', async () => {
  const f = paymentFixture(); const first = await f.order();
  const replay = await f.service.checkout(ALICE, { packageId: 'starter', requestId: 'checkout-0001' });
  assert.equal(replay.url, first.url); assert.equal(f.checkoutCalls.length, 1);
  await rejectsCode(f.service.checkout(ALICE, { packageId: 'studio', requestId: 'checkout-0001' }), 409, 'REQUEST_REUSED');
  assert.equal(rows(f.store, 'orders').length, 1);
});
test('ambiguous checkout creation retries with same order identity only within safe idempotency window', async () => {
  const f = paymentFixture(); const ids = [];
  f.service.payments.createCheckout = async order => { ids.push(order.id); throw new Error('network lost after create'); };
  const input = { packageId: 'starter', requestId: 'checkout-0001' };
  await assert.rejects(f.service.checkout(ALICE, input), /network lost/);
  await assert.rejects(f.service.checkout(ALICE, input), /network lost/);
  assert.equal(ids[0], ids[1]);
  f.clock.value += 23 * 3600_000 + 1;
  await rejectsCode(f.service.checkout(ALICE, input), 409, 'ORDER_EXPIRED');
  assert.equal(ids.length, 2);
});
test('checkout refuses a conflicting provider session for the same order', async () => {
  const f = paymentFixture(); const gate = defer(), entered = defer(); let call = 0;
  f.service.payments.createCheckout = async () => { if (++call === 1) { entered.resolve(); return gate.promise; } return { id: 'cs_test_second', url: 'https://checkout.stripe.com/c/pay/second' }; };
  const input = { packageId: 'starter', requestId: 'checkout-0001' };
  const first = f.service.checkout(ALICE, input); await entered.promise;
  await f.service.checkout(ALICE, input);
  gate.resolve({ id: 'cs_test_first', url: 'https://checkout.stripe.com/c/pay/first' });
  await rejectsCode(first, 409, 'SESSION_MISMATCH');
  assert.equal(rows(f.store, 'orders')[0].sessionId, 'cs_test_second');
});
test('concurrent valid payment deliveries credit canonical intent and session exactly once', async () => {
  const f = paymentFixture(); const order = await f.order(); const session = paidSession(order);
  const results = await Promise.all(Array.from({ length: 40 }, () => f.service.creditPayment(session)));
  assert.equal(results.filter(r => !r.duplicate).length, 1);
  assert.equal(results.filter(r => r.duplicate).length, 39);
  assert.equal(f.balance(), 20); assert.equal(f.balance(BOB), 17);
  assert.equal(rows(f.store, 'payments').length, 1); assert.equal(rows(f.store, 'paymentSessions').length, 1);
  assert.equal(f.store.data[`orders/${order.id}`].status, 'paid');
  await rejectsCode(f.service.checkout(ALICE, { packageId: 'starter', requestId: 'checkout-0001' }), 409, 'ALREADY_PAID');
});
test('expanded canonical PaymentIntent is accepted and metadata credits are ignored', async () => {
  const f = paymentFixture(); const order = await f.order('studio');
  await f.service.creditPayment(paidSession(order, { payment_intent: { id: 'pi_expanded123' } }));
  assert.equal(f.balance(), 35);
  assert.equal(rows(f.store, 'payments')[0].credits, 25);
});
test('one PaymentIntent cannot credit two separate sessions or orders even concurrently', async () => {
  const f = paymentFixture(); const orderA = await f.order('starter', 'checkout-0001'); const orderB = await f.order('starter', 'checkout-0002');
  const results = await Promise.all([f.service.creditPayment(paidSession(orderA)), f.service.creditPayment(paidSession(orderB))]);
  assert.equal(results.filter(r => !r.duplicate).length, 1);
  assert.equal(f.balance(), 20); assert.equal(rows(f.store, 'payments').length, 1);
});
test('one checkout session cannot credit again under a different PaymentIntent', async () => {
  const f = paymentFixture(); const order = await f.order();
  await f.service.creditPayment(paidSession(order));
  const duplicate = await f.service.creditPayment(paidSession(order, { payment_intent: 'pi_alternative123' }));
  assert.equal(duplicate.duplicate, true); assert.equal(f.balance(), 20); assert.equal(rows(f.store, 'payments').length, 1);
});
const invalidPaymentMutations = [
  ['session ID', s => { s.id = 'cs_test_unrecognized'; }],
  ['owner reference', s => { s.client_reference_id = BOB; }],
  ['mode', s => { s.mode = 'subscription'; }],
  ['unpaid status', s => { s.payment_status = 'unpaid'; }],
  ['missing amount', s => { delete s.amount_total; }],
  ['amount', s => { s.amount_total = 1; }],
  ['string amount', s => { s.amount_total = '1000'; }],
  ['currency', s => { s.currency = 'eur'; }],
  ['live payment', s => { s.livemode = true; }],
  ['missing test mode', s => { delete s.livemode; }],
  ['missing items', s => { delete s.line_items; }],
  ['empty items', s => { s.line_items.data = []; }],
  ['extra item', s => { s.line_items.data.push(structuredClone(s.line_items.data[0])); }],
  ['hidden extra items', s => { s.line_items.has_more = true; }],
  ['quantity', s => { s.line_items.data[0].quantity = 2; }],
  ['line total', s => { s.line_items.data[0].amount_total = 1; }],
  ['unit price', s => { s.line_items.data[0].price.unit_amount = 1; }],
  ['line currency', s => { s.line_items.data[0].price.currency = 'eur'; }],
  ['missing price', s => { delete s.line_items.data[0].price; }],
  ['missing payment intent', s => { delete s.payment_intent; }],
  ['invalid payment intent', s => { s.payment_intent = '../payments'; }],
  ['missing order metadata', s => { delete s.metadata; }],
  ['invalid order ID', s => { s.metadata.orderId = '../orders/anything'; }],
  ['unknown order', s => { s.metadata.orderId = 'f'.repeat(64); }],
];
for (const [label, mutate] of invalidPaymentMutations) {
  test(`payment validation rejects ${label} without changing credits or ledger`, async () => {
    const f = paymentFixture(); const order = await f.order(); const session = paidSession(order); mutate(session);
    const before = structuredClone(f.store.data);
    await rejectsCode(f.service.creditPayment(session), 400, 'INVALID_PAYMENT');
    assert.deepEqual(f.store.data, before);
  });
}
test('payment arriving before canonical session persistence is retryable and does not credit', async () => {
  const f = paymentFixture(); const order = await f.order(); const session = paidSession(order);
  delete f.store.data[`orders/${order.id}`].sessionId;
  await rejectsCode(f.service.creditPayment(session), 503, 'ORDER_PENDING');
  assert.equal(f.balance(), 10); assert.equal(rows(f.store, 'payments').length, 0);
});
test('payment without a valid user account fails atomically for operator reconciliation', async () => {
  for (const state of ['missing', 'invalid']) {
    const f = paymentFixture(); const order = await f.order();
    if (state === 'missing') delete f.store.data[`users/${ALICE}`]; else f.store.data[`users/${ALICE}`].credits = '10';
    await assert.rejects(f.service.creditPayment(paidSession(order)), error => error instanceof AppError && error.status === 409);
    assert.equal(rows(f.store, 'payments').length, 0); assert.equal(f.store.data[`orders/${order.id}`].status, 'created');
  }
});

for (const input of [undefined, null, [], 'invalid', 12, false]) {
  test(`all provider service entry points reject non-object input ${JSON.stringify(input)}`, async () => {
    const f = paymentFixture(); const before = structuredClone(f.store.data);
    await rejectsCode(f.service.parse(ALICE, input), 400, 'INVALID_INPUT');
    await rejectsCode(f.service.generate(ALICE, DISH_A, input), 400, 'INVALID_INPUT');
    await rejectsCode(f.service.checkout(ALICE, input), 400, 'INVALID_INPUT');
    assert.deepEqual(f.store.data, before);
    assert.equal(f.calls.parse.length + f.calls.generate.length + f.checkoutCalls.length, 0);
  });
}

test('reservation transaction failure never starts generation or spends credits', async () => {
  const f = fixture(); const before = structuredClone(f.store.data);
  const transact = f.store.transact.bind(f.store);
  f.store.transact = work => transact(async tx => { await work(tx); throw new Error('reservation commit failed'); });
  await assert.rejects(f.service.generate(ALICE, DISH_A, INPUT), /reservation commit failed/);
  assert.deepEqual(f.store.data, before); assert.equal(f.calls.generate.length, 0);
});
test('refund persistence failure retains a reconcilable reservation and no automatic provider retry', async () => {
  const f = fixture({ ai: { generate: async () => { throw new Error('provider failed'); } } });
  const transact = f.store.transact.bind(f.store); let transactions = 0;
  f.store.transact = work => transact(async tx => { const result = await work(tx); if (++transactions === 2) throw new Error('refund commit failed'); return result; });
  await assert.rejects(f.service.generate(ALICE, DISH_A, INPUT), /refund commit failed/);
  assert.equal(f.balance(), 8); assert.equal(f.store.data[`jobs/${jobFor()}`].status, 'reserved');
  const replay = await f.service.generate(ALICE, DISH_A, INPUT);
  assert.equal(replay.pending, true); assert.equal(f.calls.generate.length, 1);
  assert.equal(await f.service.refund(jobFor(), 'verified failed provider'), true);
  assert.equal(await f.service.refund(jobFor(), 'repeat reconciliation'), false);
  assert.equal(f.balance(), 10);
});
test('parse persistence failure rolls back every generated dish and retains failed request identity', async () => {
  const f = fixture(); const before = rows(f.store, 'dishes');
  const transact = f.store.transact.bind(f.store); let transactions = 0;
  f.store.transact = work => transact(async tx => { const result = await work(tx); if (++transactions === 2) throw new Error('parse commit failed'); return result; });
  const input = { text: 'Soup', requestId: 'parse-request-1' };
  await rejectsCode(f.service.parse(ALICE, input), 502, 'PARSE_FAILED');
  assert.deepEqual(rows(f.store, 'dishes'), before); assert.equal(rows(f.store, 'parseJobs')[0].status, 'failed');
  await rejectsCode(f.service.parse(ALICE, input), 409, 'PARSE_FAILED_PREVIOUSLY');
  assert.equal(f.calls.parse.length, 1); assert.equal(f.balance(), 10);
});
test('payment commit failure rolls back account and both ledgers, then delivery retry credits once', async () => {
  const f = paymentFixture(); const order = await f.order(); const before = structuredClone(f.store.data);
  const transact = f.store.transact.bind(f.store); let failOnce = true;
  f.store.transact = work => transact(async tx => { const result = await work(tx); if (failOnce) { failOnce = false; throw new Error('payment commit failed'); } return result; });
  await assert.rejects(f.service.creditPayment(paidSession(order)), /payment commit failed/);
  assert.deepEqual(f.store.data, before);
  const credited = await f.service.creditPayment(paidSession(order));
  const replay = await f.service.creditPayment(paidSession(order));
  assert.equal(credited.duplicate, false); assert.equal(replay.duplicate, true);
  assert.equal(f.balance(), 20); assert.equal(rows(f.store, 'payments').length, 1); assert.equal(rows(f.store, 'paymentSessions').length, 1);
});

function reservedRefundFixture(credits = 10, cost = 2) {
  const f = fixture({ credits });
  f.store.data[`jobs/${jobFor()}`] = { id: jobFor(), ownerId: ALICE, dishId: DISH_A, status: 'reserved', cost, deadline: f.clock.value - 1 };
  f.store.data[`dishes/${DISH_A}`] = { ...f.store.data[`dishes/${DISH_A}`], status: 'generating', activeJobId: jobFor() };
  return f;
}
const rejectsReconciliation = promise => assert.rejects(promise, error => error instanceof AppError && error.status === 409);
test('refund rejects corrupted account balances without changing account, job or dish', async () => {
  for (const credits of [-1, 1.5, NaN, Infinity, -Infinity, '10', null, undefined]) {
    const f = reservedRefundFixture(); f.store.data[`users/${ALICE}`].credits = credits;
    const before = structuredClone(f.store.data);
    await rejectsReconciliation(f.service.refund(jobFor(), 'reconcile corrupted balance', { staleOnly: true }));
    assert.deepEqual(f.store.data, before);
  }
});
test('refund requires a positive safe integer reserved charge and fails closed on corrupted costs', async () => {
  for (const cost of [0, -1, 1.5, NaN, Infinity, '2', null, undefined, Number.MAX_SAFE_INTEGER + 1]) {
    const f = reservedRefundFixture(); f.store.data[`jobs/${jobFor()}`].cost = cost;
    const before = structuredClone(f.store.data);
    await rejectsReconciliation(f.service.refund(jobFor(), 'reconcile corrupted cost', { staleOnly: true }));
    assert.deepEqual(f.store.data, before);
  }
});
test('refund rejects balance overflow while preserving its pending reconciliation evidence', async () => {
  for (const credits of [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER - 1]) {
    const f = reservedRefundFixture(credits, 2); const before = structuredClone(f.store.data);
    await rejectsReconciliation(f.service.refund(jobFor(), 'overflow check', { staleOnly: true }));
    assert.deepEqual(f.store.data, before);
  }
});
test('valid refund supports zero balances and the exact maximum safe integer boundary', async () => {
  for (const credits of [0, Number.MAX_SAFE_INTEGER - 2]) {
    const f = reservedRefundFixture(credits, 2);
    assert.equal(await f.service.refund(jobFor(), 'valid boundary', { staleOnly: true }), true);
    assert.equal(f.balance(), credits + 2); assert.ok(Number.isSafeInteger(f.balance()));
    assert.equal(await f.service.refund(jobFor(), 'duplicate boundary refund'), false);
  }
});
test('payment rejects corrupted balances and preserves all account/order/ledger state', async () => {
  for (const credits of [-1, 1.5, NaN, Infinity, -Infinity, '10', null, undefined]) {
    const f = paymentFixture(); const order = await f.order(); f.store.data[`users/${ALICE}`].credits = credits;
    const before = structuredClone(f.store.data);
    await rejectsReconciliation(f.service.creditPayment(paidSession(order)));
    assert.deepEqual(f.store.data, before);
  }
});
test('payment requires a positive safe integer server order credit quantity', async () => {
  for (const credits of [0, -1, 1.5, NaN, Infinity, '10', null, undefined, Number.MAX_SAFE_INTEGER + 1]) {
    const f = paymentFixture(); const order = await f.order(); f.store.data[`orders/${order.id}`].credits = credits;
    const before = structuredClone(f.store.data);
    await rejectsReconciliation(f.service.creditPayment(paidSession(order)));
    assert.deepEqual(f.store.data, before);
  }
});
test('payment rejects addition overflow and keeps the delivery retryable without a ledger entry', async () => {
  for (const credits of [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER - 9]) {
    const f = paymentFixture({ credits }); const order = await f.order(); const before = structuredClone(f.store.data);
    await rejectsReconciliation(f.service.creditPayment(paidSession(order)));
    assert.deepEqual(f.store.data, before);
  }
});
test('valid top-up supports zero balances and the exact maximum safe integer boundary', async () => {
  for (const credits of [0, Number.MAX_SAFE_INTEGER - 10]) {
    const f = paymentFixture({ credits }); const order = await f.order();
    const result = await f.service.creditPayment(paidSession(order));
    assert.equal(result.duplicate, false); assert.equal(f.balance(), credits + 10); assert.ok(Number.isSafeInteger(f.balance()));
    assert.equal((await f.service.creditPayment(paidSession(order))).duplicate, true);
  }
});

test('lost parse commit acknowledgement returns the durable result without a new provider call', async () => {
  const f = fixture();
  const transact = f.store.transact.bind(f.store); let transactions = 0;
  f.store.transact = async work => {
    const result = await transact(work);
    if (++transactions === 2) throw new Error('lost commit acknowledgement');
    return result;
  };
  const input = { text: 'Soup', requestId: 'parse-request-1' };
  const result = await f.service.parse(ALICE, input);
  assert.equal(rows(f.store, 'parseJobs')[0].status, 'completed');
  assert.deepEqual(await f.service.parse(ALICE, input), result);
  assert.equal(f.calls.parse.length, 1);
  assert.equal(rows(f.store, 'dishes').length, 4);
});
