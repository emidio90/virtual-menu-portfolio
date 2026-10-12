import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { ref, uploadBytes, getBytes } from 'firebase/storage';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { FirestoreStore } from '../../server/store.js';
import { MenuService, keyFor } from '../../server/domain.js';
let env, admin, store;
const projectId = 'demo-virtual-menu';
before(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_STORAGE_EMULATOR_HOST) throw new Error('Emulators required; refusing any live connection');
  env = await initializeTestEnvironment({ projectId,
    firestore: { host: '127.0.0.1', port: 8085, rules: await readFile('firestore.rules', 'utf8') },
    storage: { host: '127.0.0.1', port: 9199, rules: await readFile('storage.rules', 'utf8') },
  });
  await env.clearFirestore();
  admin = initializeApp({ projectId }, 'rules-tests');
  store = new FirestoreStore(getFirestore(admin));
});
after(async () => { await env?.cleanup(); if (admin) await deleteApp(admin); });
for (const auth of [null, 'alice', 'bob']) {
  test(`Firestore rejects all direct protected-data reads/writes for ${auth || 'anonymous'}`, async () => {
    const client = auth ? env.authenticatedContext(auth).firestore() : env.unauthenticatedContext().firestore();
    for (const path of ['users/alice', 'dishes/example-dish', 'jobs/example-job', 'orders/example-order', 'payments/pi_example', 'users/alice/checkout_sessions/example']) {
      await assertFails(setDoc(doc(client, path), { credits: 999, role: 'admin', userId: auth, payment_status: 'paid' }));
      await assertFails(getDoc(doc(client, path)));
      await assertFails(updateDoc(doc(client, path), { ownerId: 'alice' }));
      await assertFails(deleteDoc(doc(client, path)));
    }
  });
  test(`Storage rejects direct reads/uploads for ${auth || 'anonymous'}`, async () => {
    const client = auth ? env.authenticatedContext(auth).storage() : env.unauthenticatedContext().storage();
    const location = ref(client, 'users/alice/dishes/example/image');
    await assertFails(uploadBytes(location, new Uint8Array([1, 2, 3])));
    await assertFails(getBytes(location));
  });
}
test('real Firestore transactions serialize competing debits and refunds', async () => {
  await store.transact(async tx => {
    tx.set('users/alice', { id: 'alice', credits: 1 });
    for (const id of ['dish-first', 'dish-second']) tx.set(`dishes/${id}`, { id, ownerId: 'alice', name: 'Pasta', description: 'Tomato', status: 'pending' });
  });
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const service = new MenuService({ store, ai: { generate: () => pending } });
  const one = service.generate('alice', 'dish-first', { requestId: 'request-first', style: 'Bright/Modern', size: '1K' });
  // Wait for reservation without sleeping for a guessed provider duration.
  for (let n = 0; n < 100; n++) {
    const job = await store.transact(tx => tx.get(`jobs/${keyFor('alice', 'image', 'request-first')}`));
    if (job) break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  await assert.rejects(service.generate('alice', 'dish-second', { requestId: 'request-second', style: 'Bright/Modern', size: '1K' }), error => error.code === 'INSUFFICIENT_CREDITS');
  const jobId = keyFor('alice', 'image', 'request-first');
  const outcomes = await Promise.all([service.refund(jobId, 'Test recovery'), service.refund(jobId, 'Duplicate recovery')]);
  assert.equal(outcomes.filter(Boolean).length, 1);
  release({ imageUrl: '/api/dishes/dish-first/image' });
  await one;
  const user = await store.transact(tx => tx.get('users/alice'));
  assert.equal(user.credits, 1);
});

test('real Firestore transactions credit concurrent duplicate payment deliveries once', async () => {
  const uid = 'payment-emulator-user';
  await store.transact(async tx => {
    tx.set(`users/${uid}`, { id: uid, credits: 7 });
    tx.set('users/payment-other-user', { id: 'payment-other-user', credits: 91 });
  });
  // A deterministic local adapter stands in for Stripe. No provider is called.
  const payments = { createCheckout: async order => ({ id: `cs_test_${order.id}`, url: 'https://checkout.stripe.com/fixture-never-opened' }) };
  const service = new MenuService({ store, payments });
  const requestId = 'checkout-emulator-duplicate';
  await service.checkout(uid, { packageId: 'starter', requestId });
  const orderId = keyFor(uid, 'checkout', requestId);
  const order = await store.transact(tx => tx.get(`orders/${orderId}`));
  const session = {
    id: order.sessionId, metadata: { orderId, credits: '999999', uid: 'payment-other-user' },
    client_reference_id: uid, payment_intent: 'pi_emulatorDuplicate123', mode: 'payment',
    payment_status: 'paid', amount_total: order.amount, currency: order.currency, livemode: false,
    line_items: { has_more: false, data: [{ quantity: 1, amount_total: order.amount, price: { unit_amount: order.amount, currency: order.currency } }] },
  };
  const outcomes = await Promise.all(Array.from({ length: 16 }, () => service.creditPayment(session)));
  assert.equal(outcomes.filter(result => !result.duplicate).length, 1);
  assert.equal(outcomes.filter(result => result.duplicate).length, 15);
  const [user, other, paidOrder, ledger, marker] = await Promise.all([
    store.transact(tx => tx.get(`users/${uid}`)),
    store.transact(tx => tx.get('users/payment-other-user')),
    store.transact(tx => tx.get(`orders/${orderId}`)),
    store.transact(tx => tx.get(`payments/${session.payment_intent}`)),
    store.transact(tx => tx.get(`paymentSessions/${session.id}`)),
  ]);
  assert.equal(user.credits, 17);
  assert.equal(other.credits, 91);
  assert.equal(paidOrder.status, 'paid');
  assert.equal(ledger.ownerId, uid);
  assert.equal(ledger.credits, 10);
  assert.deepEqual(marker, { paymentId: session.payment_intent, orderId });
  assert.equal((await service.creditPayment(session)).duplicate, true);
  assert.equal((await store.transact(tx => tx.get(`users/${uid}`))).credits, 17);
});
