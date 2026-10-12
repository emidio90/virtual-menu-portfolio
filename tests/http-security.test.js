import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server/app.js';
import { allowlistedVerifier } from '../server/config.js';
import { MenuService, keyFor } from '../server/domain.js';
import { MemoryStore } from '../server/store.js';

const ALICE = 'alice-user', BOB = 'bob-user', DISH = 'dish-alice-001', PRIVATE_DISH = 'dish-bobby-001';
const generateInput = { requestId: 'request-http-001', style: 'Bright/Modern', size: '2K' };
const parseInput = { requestId: 'parse-http-0001', text: 'Tomato soup with basil' };
const checkoutInput = { requestId: 'checkout-http-0001', packageId: 'starter' };
const defer = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
function createFixture(overrides = {}) {
  const calls = { verify: [], parse: [], generate: [], checkout: [], readImage: [], webhook: [], retrieve: [] };
  const store = new MemoryStore({
    [`users/${ALICE}`]: { id: ALICE, name: 'Alice', credits: 10, role: 'admin', admin: true },
    [`users/${BOB}`]: { id: BOB, name: 'Bob', credits: 50 },
    [`dishes/${DISH}`]: { id: DISH, ownerId: ALICE, name: 'Soup', description: 'Basil', status: 'pending' },
    [`dishes/${PRIVATE_DISH}`]: { id: PRIVATE_DISH, ownerId: BOB, name: 'Private dish', description: 'Not public', status: 'completed', imagePath: 'users/bob-user/private.png', imageUrl: `/api/dishes/${PRIVATE_DISH}/image` },
    'jobs/reserved-fixture': { id: 'reserved-fixture', ownerId: BOB, status: 'reserved' },
  });
  const identities = {
    'alice-token': { uid: ALICE, email: 'alice@example.test', email_verified: true },
    'bob-token': { uid: BOB, email: 'bob@example.test', email_verified: true },
    'admin-token': { uid: ALICE, email_verified: true, admin: true },
    'string-admin-token': { uid: ALICE, email_verified: true, admin: 'true' },
    'unverified-token': { uid: ALICE, email_verified: false },
    'string-verified-token': { uid: ALICE, email_verified: 'true' },
    'missing-verified-token': { uid: ALICE },
    'bad-uid-token': { uid: '../users/bob' },
    'missing-uid-token': { email: 'missing@example.test' },
    'numeric-uid-token': { uid: 12345 },
    'null-uid-token': { uid: null },
    'blank-uid-token': { uid: '' },
    'long-uid-token': { uid: 'a'.repeat(129) },
  };
  const sessions = new Map();
  const payments = {
    async createCheckout(order) { calls.checkout.push(structuredClone(order)); return { id: 'cs_test_http001', url: 'https://checkout.stripe.com/c/pay/local-fixture' }; },
    verifyWebhook(raw, signature) {
      calls.webhook.push({ raw, signature });
      if (signature !== 'valid-local-fixture') throw new Error('Signature does not match private fixture');
      return JSON.parse(raw.toString('utf8'));
    },
    async retrieveSession(id) { calls.retrieve.push(id); if (!sessions.has(id)) throw new Error('Unknown fixture session'); return structuredClone(sessions.get(id)); },
  };
  let parsed = 0;
  const service = new MenuService({ store, payments, now: () => 1_900_000_000_000, uuid: () => `parsed-http-${++parsed}`, ai: {
    async parse(text) { calls.parse.push(text); return [{ name: 'Tomato soup', description: 'Basil' }]; },
    async generate(input) { calls.generate.push(input); return { imageUrl: `/api/dishes/${input.dishId}/image`, imagePath: `users/${input.uid}/${input.dishId}/output.png` }; },
  } });
  const options = {
    mode: 'live', service, payments,
    verifyToken: async token => { calls.verify.push(token); if (!identities[token]) throw new Error('Invalid Firebase token'); return identities[token]; },
    readImage: async imagePath => { calls.readImage.push(imagePath); return { bytes: Buffer.from('fixture-png-bytes'), mimeType: 'image/png' }; },
    ...overrides,
  };
  return { app: createApp(options), service, store, calls, identities, payments, sessions, options };
}
async function serve(t, app) {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  return async (path, { method = 'GET', token = 'alice-token', body, raw, headers = {} } = {}) => {
    const requestHeaders = { ...headers };
    if (token !== null) requestHeaders.authorization = `Bearer ${token}`;
    if (body !== undefined || raw !== undefined) requestHeaders['content-type'] ||= 'application/json';
    const response = await fetch(`${origin}${path}`, { method, headers: requestHeaders, body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    const data = response.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : text;
    return { status: response.status, headers: response.headers, data, text };
  };
}
function sessionFor(order) {
  return {
    id: order.sessionId, metadata: { orderId: order.id, credits: '9000000', uid: BOB },
    client_reference_id: order.ownerId, payment_intent: 'pi_httpfixture001', mode: 'payment', payment_status: 'paid', amount_total: order.amount, currency: 'usd', livemode: false,
    line_items: { has_more: false, data: [{ quantity: 1, amount_total: order.amount, price: { unit_amount: order.amount, currency: 'usd' } }] },
  };
}
const eventFor = (type = 'checkout.session.completed', id = 'evt_fixture001', sessionId = 'cs_test_http001') => ({ id, type, data: { object: { id: sessionId, payment_status: 'paid', amount_total: 1, metadata: { credits: '9000000', uid: BOB } } } });

test('demo API is isolated even when provider and auth objects are supplied', async t => {
  let invoked = 0;
  const forbidden = () => { invoked++; throw new Error('Demo must never use provider credentials'); };
  const app = createApp({ mode: 'demo', service: new Proxy({}, { get: forbidden }), payments: new Proxy({}, { get: forbidden }), verifyToken: forbidden, readImage: forbidden });
  const request = await serve(t, app);
  for (const [path, method] of [['/api/me', 'GET'], ['/api/dishes', 'GET'], ['/api/parse-menu', 'POST'], [`/api/dishes/${DISH}/generate`, 'POST'], ['/api/checkout', 'POST'], ['/api/stripe/webhook', 'POST'], ['/api/admin/jobs', 'GET']]) {
    const response = await request(path, { method, ...(method === 'POST' ? { body: { anything: true } } : {}) });
    assert.equal(response.status, 503); assert.equal(response.data.code, 'DEMO_ISOLATED');
  }
  assert.equal(invoked, 0);
  const health = await request('/api/health', { token: null });
  assert.deepEqual(health.data, { mode: 'demo', providersEnabled: false });
});
test('createApp defaults to isolated demo without integrations', async t => {
  const request = await serve(t, createApp());
  assert.equal((await request('/api/checkout', { method: 'POST', body: checkoutInput })).status, 503);
  assert.deepEqual((await request('/api/health', { token: null })).data, { mode: 'demo', providersEnabled: false });
});
for (const [path, method, body] of [
  ['/api/me', 'GET'], ['/api/dishes', 'GET'], ['/api/parse-menu', 'POST', parseInput],
  [`/api/dishes/${DISH}/generate`, 'POST', generateInput], [`/api/dishes/${DISH}`, 'DELETE'],
  [`/api/dishes/${PRIVATE_DISH}/image`, 'GET'], ['/api/catalog', 'GET'], ['/api/checkout', 'POST', checkoutInput], ['/api/admin/jobs', 'GET'],
]) {
  test(`${method} ${path} requires verified authentication`, async t => {
    const f = createFixture(); const request = await serve(t, f.app); const before = structuredClone(f.store.data);
    const response = await request(path, { method, body, token: null });
    assert.equal(response.status, 401); assert.equal(response.data.code, 'UNAUTHENTICATED');
    assert.deepEqual(f.store.data, before); assert.equal(f.calls.verify.length, 0);
    assert.equal(f.calls.parse.length + f.calls.generate.length + f.calls.checkout.length + f.calls.readImage.length, 0);
  });
}
test('invalid, expired and malformed token identities receive 401', async t => {
  const f = createFixture(); const request = await serve(t, f.app);
  for (const token of ['invalid-token', 'bad-uid-token', 'missing-uid-token', 'numeric-uid-token', 'null-uid-token', 'blank-uid-token', 'long-uid-token']) {
    const response = await request('/api/me', { token }); assert.equal(response.status, 401); assert.equal(response.data.code, 'UNAUTHENTICATED');
  }
  for (const authorization of ['Basic alice-token', 'Bearer', 'Bearer token another', 'bearer alice-token']) {
    const response = await request('/api/me', { token: null, headers: { authorization } }); assert.equal(response.status, 401);
  }
});
test('synchronous token-verification failures also return 401 without leaking verifier details', async t => {
  const f = createFixture({ verifyToken: () => { throw new Error('private verifier details'); } });
  const request = await serve(t, f.app);
  const response = await request('/api/me'); assert.equal(response.status, 401); assert.equal(response.data.code, 'UNAUTHENTICATED');
  assert.equal(response.text.includes('private verifier details'), false);
});
test('me identity and role derive from verified token, ignoring query, headers and stored role', async t => {
  const f = createFixture(); const request = await serve(t, f.app);
  const response = await request(`/api/me?uid=${BOB}&admin=true`, { headers: { 'x-user-id': BOB, 'x-admin': 'true' } });
  assert.equal(response.status, 200); assert.equal(response.data.user.id, ALICE); assert.equal(response.data.user.role, 'user');
  assert.equal(response.data.user.email, 'alice@example.test'); assert.equal(response.data.user.credits, 10);
  assert.deepEqual(f.calls.verify, ['alice-token']);
});
test('signed boolean admin claim is the only authorization for admin endpoint', async t => {
  const f = createFixture(); const request = await serve(t, f.app);
  for (const token of ['alice-token', 'string-admin-token']) {
    const response = await request('/api/admin/jobs?admin=true', { token, headers: { 'x-admin': 'true' } });
    assert.equal(response.status, 403); assert.equal(response.data.code, 'FORBIDDEN');
  }
  const allowed = await request('/api/admin/jobs', { token: 'admin-token' });
  assert.equal(allowed.status, 200); assert.equal(allowed.data.jobs.length, 1);
  assert.equal((await request('/api/me', { token: 'admin-token' })).data.user.role, 'admin');
});
test('provider routes require a boolean verified-email claim', async t => {
  const f = createFixture(); const request = await serve(t, f.app);
  for (const token of ['unverified-token', 'string-verified-token', 'missing-verified-token']) {
    for (const [path, body] of [['/api/parse-menu', parseInput], [`/api/dishes/${DISH}/generate`, generateInput], ['/api/checkout', checkoutInput]]) {
      const response = await request(path, { token, method: 'POST', body });
      assert.equal(response.status, 403); assert.equal(response.data.code, 'EMAIL_UNVERIFIED');
    }
  }
  assert.equal(f.calls.parse.length + f.calls.generate.length + f.calls.checkout.length, 0);
  assert.equal((await request('/api/me', { token: 'unverified-token' })).status, 200);
});
test('body UID, credits, cost and role cannot override server-authorized generation', async t => {
  const f = createFixture(); const request = await serve(t, f.app);
  const response = await request(`/api/dishes/${DISH}/generate`, { method: 'POST', body: { ...generateInput, uid: BOB, ownerId: BOB, admin: true, role: 'admin', cost: 0, credits: 100000 } });
  assert.equal(response.status, 200); assert.equal(response.data.credits, 8);
  assert.equal(f.calls.generate[0].uid, ALICE); assert.equal(f.calls.generate[0].size, '2K');
  assert.equal(f.store.data[`users/${BOB}`].credits, 50);
  for (const field of ['ownerId', 'activeJobId', 'imagePath']) assert.equal(Object.hasOwn(response.data.dish, field), false);
});
test('spoofed parse owner and checkout package amounts remain server-controlled', async t => {
  const f = createFixture(); const request = await serve(t, f.app);
  const parsed = await request('/api/parse-menu', { method: 'POST', body: { ...parseInput, uid: BOB, ownerId: BOB } });
  assert.equal(parsed.status, 200); assert.equal(f.store.data[`dishes/${parsed.data.dishes[0].id}`].ownerId, ALICE);
  const checkout = await request('/api/checkout', { method: 'POST', body: { ...checkoutInput, uid: BOB, amount: 1, credits: 1_000_000, currency: 'eur' } });
  assert.equal(checkout.status, 200); assert.equal(f.calls.checkout[0].ownerId, ALICE);
  assert.equal(f.calls.checkout[0].amount, 1000); assert.equal(f.calls.checkout[0].credits, 10); assert.equal(f.calls.checkout[0].currency, 'usd');
});
test('cross-user list, generate, delete and private image access are denied', async t => {
  const f = createFixture(); const request = await serve(t, f.app); const before = structuredClone(f.store.data);
  const list = await request(`/api/dishes?uid=${BOB}`);
  assert.deepEqual(list.data.dishes.map(d => d.id), [DISH]);
  for (const [path, method, body] of [[`/api/dishes/${PRIVATE_DISH}/generate`, 'POST', generateInput], [`/api/dishes/${PRIVATE_DISH}`, 'DELETE'], [`/api/dishes/${PRIVATE_DISH}/image`, 'GET']]) {
    const response = await request(path, { method, body }); assert.equal(response.status, 404); assert.equal(response.data.code, 'NOT_FOUND');
  }
  assert.equal(f.calls.generate.length, 0); assert.equal(f.calls.readImage.length, 0); assert.deepEqual(f.store.data, before);
});
test('private image route reads stored path only after owner verification and sends no-store', async t => {
  const f = createFixture(); const request = await serve(t, f.app);
  const response = await request(`/api/dishes/${PRIVATE_DISH}/image?path=users/alice-user/secret`, { token: 'bob-token' });
  assert.equal(response.status, 200); assert.equal(response.text, 'fixture-png-bytes');
  assert.equal(response.headers.get('content-type'), 'image/png'); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(f.calls.readImage, ['users/bob-user/private.png']);
});
test('in-progress duplicate generation returns 202 and only one provider call', async t => {
  const f = createFixture(); const gate = defer(), entered = defer();
  f.service.ai.generate = async input => { f.calls.generate.push(input); entered.resolve(); return gate.promise; };
  const request = await serve(t, f.app);
  const first = request(`/api/dishes/${DISH}/generate`, { method: 'POST', body: generateInput });
  await entered.promise;
  const second = await request(`/api/dishes/${DISH}/generate`, { method: 'POST', body: generateInput });
  assert.equal(second.status, 202); assert.equal(second.data.pending, true); assert.equal(second.data.credits, 8);
  gate.resolve({ imageUrl: `/api/dishes/${DISH}/image`, imagePath: 'local-fixture.png' });
  assert.equal((await first).status, 200); assert.equal(f.calls.generate.length, 1);
});
test('null, array, missing and primitive JSON bodies fail safely on provider routes', async t => {
  const f = createFixture(); const request = await serve(t, f.app);
  for (const path of ['/api/parse-menu', `/api/dishes/${DISH}/generate`, '/api/checkout']) {
    for (const raw of ['null', '[]', '{}', 'false', '42', '"text"', '']) {
      const response = await request(path, { method: 'POST', raw });
      assert.equal(response.status, 400, `${path} received ${raw}`);
    }
  }
  assert.equal(f.calls.parse.length + f.calls.generate.length + f.calls.checkout.length, 0);
});
test('malformed and oversized JSON are bounded and do not reach provider', async t => {
  const f = createFixture(); const request = await serve(t, f.app);
  const malformed = await request('/api/parse-menu', { method: 'POST', raw: '{"text":' });
  assert.equal(malformed.status, 400); assert.equal(malformed.data.code, 'REQUEST_FAILED');
  const oversized = await request('/api/parse-menu', { method: 'POST', body: { ...parseInput, text: 'x'.repeat(25_000) } });
  assert.equal(oversized.status, 413); assert.equal(f.calls.parse.length, 0);
});
test('API errors redact stack traces and provider failures while refunding once', async t => {
  const f = createFixture(); const request = await serve(t, f.app);
  f.service.ai.generate = async () => { throw new Error('PRIVATE_PROVIDER_DETAIL_DO_NOT_LEAK'); };
  const response = await request(`/api/dishes/${DISH}/generate`, { method: 'POST', body: generateInput });
  assert.equal(response.status, 502); assert.equal(response.data.code, 'GENERATION_FAILED');
  assert.equal(response.text.includes('PRIVATE_PROVIDER_DETAIL'), false); assert.equal(response.data.stack, undefined);
  assert.equal(f.store.data[`users/${ALICE}`].credits, 10);
  f.service.list = async () => { throw new Error('PRIVATE_DATABASE_DETAIL_DO_NOT_LEAK'); };
  const generic = await request('/api/dishes'); assert.equal(generic.status, 500); assert.equal(generic.data.code, 'REQUEST_FAILED');
  assert.equal(generic.text.includes('PRIVATE_DATABASE_DETAIL'), false);
});
test('hardening headers prohibit framing, sniffing and external execution', async t => {
  const f = createFixture(); const request = await serve(t, f.app);
  const response = await request('/api/me');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(response.headers.get('x-powered-by'), null);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const csp = response.headers.get('content-security-policy');
  assert.match(csp, /script-src 'self'/); assert.match(csp, /object-src 'none'/); assert.match(csp, /frame-ancestors 'none'/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
});
test('unknown live API endpoints return JSON 404 rather than the frontend document', async t => {
  const f = createFixture(); const request = await serve(t, f.app);
  const response = await request('/api/not-a-real-route'); assert.equal(response.status, 404); assert.equal(response.data.code, 'NOT_FOUND');
});

test('webhook missing or invalid signature is rejected before retrieval or account writes', async t => {
  const f = createFixture(); const request = await serve(t, f.app); const before = structuredClone(f.store.data);
  for (const signature of [undefined, 'invalid-signature']) {
    const response = await request('/api/stripe/webhook', { token: null, method: 'POST', body: eventFor(), headers: signature ? { 'stripe-signature': signature } : {} });
    assert.equal(response.status, 400); assert.equal(response.data.code, 'INVALID_SIGNATURE');
  }
  assert.equal(f.calls.retrieve.length, 0); assert.deepEqual(f.store.data, before);
});
test('webhook verifier receives exact raw body before JSON middleware', async t => {
  const f = createFixture(); const request = await serve(t, f.app);
  const raw = '{  "type" : "unhandled.fixture",\n  "data" : {"object": {"id":"fixture"}} }';
  const response = await request('/api/stripe/webhook', { token: null, method: 'POST', raw, headers: { 'stripe-signature': 'valid-local-fixture' } });
  assert.equal(response.status, 200); assert.deepEqual(response.data, { received: true });
  assert.ok(Buffer.isBuffer(f.calls.webhook[0].raw)); assert.equal(f.calls.webhook[0].raw.toString(), raw);
  assert.equal(f.calls.retrieve.length, 0);
});
test('webhook uses canonical retrieved session and never credits event-body metadata', async t => {
  const f = createFixture(); const request = await serve(t, f.app);
  await f.service.checkout(ALICE, checkoutInput);
  const order = f.store.data[`orders/${keyFor(ALICE, 'checkout', checkoutInput.requestId)}`];
  f.sessions.set(order.sessionId, sessionFor(order));
  const response = await request('/api/stripe/webhook', { token: null, method: 'POST', body: eventFor(), headers: { 'stripe-signature': 'valid-local-fixture' } });
  assert.equal(response.status, 200); assert.equal(f.store.data[`users/${ALICE}`].credits, 20); assert.equal(f.store.data[`users/${BOB}`].credits, 50);
  assert.deepEqual(f.calls.retrieve, [order.sessionId]);
});
test('different signed event IDs/types concurrently credit one canonical session/payment intent once', async t => {
  const f = createFixture(); const request = await serve(t, f.app);
  await f.service.checkout(ALICE, checkoutInput);
  const order = f.store.data[`orders/${keyFor(ALICE, 'checkout', checkoutInput.requestId)}`];
  f.sessions.set(order.sessionId, sessionFor(order));
  const responses = await Promise.all(Array.from({ length: 20 }, (_, i) => request('/api/stripe/webhook', { token: null, method: 'POST', body: eventFor(i % 2 ? 'checkout.session.completed' : 'checkout.session.async_payment_succeeded', `evt_unique_${i}`), headers: { 'stripe-signature': 'valid-local-fixture' } })));
  assert.ok(responses.every(r => r.status === 200)); assert.equal(f.store.data[`users/${ALICE}`].credits, 20);
  assert.equal(Object.keys(f.store.data).filter(p => p.startsWith('payments/')).length, 1);
  assert.equal(Object.keys(f.store.data).filter(p => p.startsWith('paymentSessions/')).length, 1);
});
test('signed event cannot bypass server amount, owner, line-item and test-mode validation', async t => {
  const f = createFixture(); const request = await serve(t, f.app); await f.service.checkout(ALICE, checkoutInput);
  const order = f.store.data[`orders/${keyFor(ALICE, 'checkout', checkoutInput.requestId)}`];
  for (const mutation of [s => { s.amount_total = 1; }, s => { s.client_reference_id = BOB; }, s => { s.line_items.data[0].price.unit_amount = 1; }, s => { s.livemode = true; }]) {
    const session = sessionFor(order); mutation(session); f.sessions.set(order.sessionId, session);
    const response = await request('/api/stripe/webhook', { token: null, method: 'POST', body: eventFor(), headers: { 'stripe-signature': 'valid-local-fixture' } });
    assert.equal(response.status, 400); assert.equal(response.data.code, 'INVALID_PAYMENT');
  }
  assert.equal(f.store.data[`users/${ALICE}`].credits, 10);
});
test('completed but unpaid canonical sessions are acknowledged without granting credits', async t => {
  const f = createFixture(); const request = await serve(t, f.app); await f.service.checkout(ALICE, checkoutInput);
  const order = f.store.data[`orders/${keyFor(ALICE, 'checkout', checkoutInput.requestId)}`];
  f.sessions.set(order.sessionId, { ...sessionFor(order), payment_status: 'unpaid' });
  const response = await request('/api/stripe/webhook', { token: null, method: 'POST', body: eventFor(), headers: { 'stripe-signature': 'valid-local-fixture' } });
  assert.equal(response.status, 200); assert.equal(f.store.data[`users/${ALICE}`].credits, 10);
});
test('webhook retrieval failure remains retryable and does not leak provider internals', async t => {
  const f = createFixture(); const request = await serve(t, f.app);
  const response = await request('/api/stripe/webhook', { token: null, method: 'POST', body: eventFor(), headers: { 'stripe-signature': 'valid-local-fixture' } });
  assert.equal(response.status, 500); assert.equal(response.data.code, 'REQUEST_FAILED'); assert.equal(response.text.includes('Unknown fixture'), false);
  assert.equal(f.store.data[`users/${ALICE}`].credits, 10);
});
test('disabled payments webhook fails closed and oversized webhook body is rejected', async t => {
  const disabled = createFixture({ payments: null }); const requestDisabled = await serve(t, disabled.app);
  const unavailable = await requestDisabled('/api/stripe/webhook', { token: null, method: 'POST', body: eventFor() });
  assert.equal(unavailable.status, 503); assert.equal(unavailable.data.code, 'PAYMENTS_DISABLED');
  const f = createFixture(); const request = await serve(t, f.app);
  const oversized = await request('/api/stripe/webhook', { token: null, method: 'POST', raw: 'x'.repeat(270_000), headers: { 'stripe-signature': 'valid-local-fixture' } });
  assert.equal(oversized.status, 413); assert.equal(f.calls.webhook.length, 0);
});


test('live allowlist rejection returns 401 before provider calls even for signed administrators', async t => {
  const f = createFixture();
  const verifier = allowlistedVerifier(f.options.verifyToken, [BOB]);
  const request = await serve(t, createApp({ ...f.options, verifyToken: verifier }));
  const before = structuredClone(f.store.data);
  for (const token of ['alice-token', 'admin-token']) {
    for (const [path, method, body] of [['/api/me', 'GET'], ['/api/parse-menu', 'POST', parseInput], [`/api/dishes/${DISH}/generate`, 'POST', generateInput], ['/api/checkout', 'POST', checkoutInput], ['/api/admin/jobs', 'GET']]) {
      const response = await request(path, { token, method, body });
      assert.equal(response.status, 401); assert.equal(response.data.code, 'UNAUTHENTICATED');
      assert.equal(response.text.includes('allowlisted'), false);
    }
  }
  assert.deepEqual(f.store.data, before);
  assert.equal(f.calls.parse.length + f.calls.generate.length + f.calls.checkout.length, 0);
  const permitted = await request('/api/me', { token: 'bob-token' });
  assert.equal(permitted.status, 200); assert.equal(permitted.data.user.id, BOB);
});
