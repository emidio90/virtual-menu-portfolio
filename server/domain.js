import { createHash, randomUUID } from 'node:crypto';

export class AppError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
export const fail = (status, code, message) => { throw new AppError(status, code, message); };
const COSTS = Object.freeze({ '1K': 1, '2K': 2, '4K': 4 });
export const costFor = size => typeof size === 'string' && Object.hasOwn(COSTS, size) ? COSTS[size] : undefined;
export const STYLES = ['Rustic/Dark', 'Bright/Modern', 'Social Media'];
export const CATALOG = Object.freeze({
  starter: Object.freeze({ id: 'starter', label: 'Starter', credits: 10, amount: 1000, currency: 'usd' }),
  studio: Object.freeze({ id: 'studio', label: 'Studio', credits: 25, amount: 2000, currency: 'usd' }),
});
export const keyFor = (...parts) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');
export function identifier(value, label = 'ID') {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{8,128}$/.test(value)) fail(400, 'INVALID_INPUT', `Invalid ${label}`);
  return value;
}
export function boundedText(value, max, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(400, 'INVALID_INPUT', `${label} must contain 1–${max} characters`);
  return value.trim();
}
export function cleanDish(dish) {
  const { ownerId, activeJobId, createdAt, imagePath, ...visible } = dish;
  return visible;
}
export class MenuService {
  constructor({ store, ai, payments, now = Date.now, uuid = randomUUID }) {
    Object.assign(this, { store, ai, payments, now, uuid });
  }
  async me(identity) {
    const path = `users/${identity.uid}`;
    return this.store.transact(async tx => {
      let user = await tx.get(path);
      if (!user) { user = { id: identity.uid, name: 'Menu creator', credits: 0, createdAt: this.now() }; tx.set(path, user); }
      return { id: identity.uid, name: user.name, email: identity.email || '', credits: user.credits, role: identity.admin === true ? 'admin' : 'user' };
    });
  }
  async list(uid) { return (await this.store.list('dishes', 'ownerId', uid)).map(cleanDish); }
  async parse(uid, input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400, 'INVALID_INPUT', 'JSON object required');
    const text = boundedText(input.text, 12000, 'Menu');
    const requestId = identifier(input.requestId, 'request ID');
    const id = keyFor(uid, 'parse', requestId), path = `parseJobs/${id}`, fingerprint = keyFor(text);
    const hour = Math.floor(this.now() / 3600000), quotaPath = `quotas/${keyFor(uid, hour)}`;
    const reserved = await this.store.transact(async tx => {
      const existing = await tx.get(path);
      if (existing) {
        if (existing.fingerprint !== fingerprint) fail(409, 'REQUEST_REUSED', 'Request ID was already used for another menu');
        return { existing };
      }
      const quota = await tx.get(quotaPath) || { count: 0 };
      if (quota.count >= 10) fail(429, 'RATE_LIMITED', 'Hourly parsing limit reached. Try again later.');
      tx.set(quotaPath, { ownerId: uid, count: quota.count + 1, hour });
      tx.set(path, { id, ownerId: uid, fingerprint, status: 'running', createdAt: this.now() });
      return {};
    });
    if (reserved.existing) {
      if (reserved.existing.status === 'completed') return reserved.existing.dishes;
      if (reserved.existing.status === 'failed') fail(409, 'PARSE_FAILED_PREVIOUSLY', 'The previous parse failed. Start a new request to try again.');
      fail(409, 'PARSE_PENDING', 'This request has already started. Refresh your dish list before trying a new request.');
    }
    try {
      const items = await this.ai.parse(text);
      if (!Array.isArray(items) || items.length < 1 || items.length > 20) fail(502, 'INVALID_AI_OUTPUT', 'Provider returned an invalid dish list');
      const dishes = items.map(item => ({ id: this.uuid(), ownerId: uid, name: boundedText(item.name, 120, 'Dish name'), description: typeof item.description === 'string' && item.description.length <= 1200 ? item.description.trim() : fail(502, 'INVALID_AI_OUTPUT', 'Invalid dish description'), status: 'pending', createdAt: this.now() }));
      await this.store.transact(async tx => {
        const job = await tx.get(path);
        if (job.status !== 'running') fail(409, 'JOB_CHANGED', 'Parse job already resolved');
        dishes.forEach(dish => tx.set(`dishes/${dish.id}`, dish));
        tx.set(path, { ...job, status: 'completed', dishes: dishes.map(cleanDish) });
      });
      return dishes.map(cleanDish);
    } catch (error) {
      const committed = await this.store.transact(async tx => {
        const job = await tx.get(path);
        // A successful commit can lose its acknowledgement. Recover the durable
        // result instead of classifying it as a terminal provider failure.
        if (job.status === 'completed') return job.dishes;
        if (job.status === 'running') tx.set(path, { ...job, status: 'failed' });
        return null;
      });
      if (committed) return committed;
      if (error instanceof AppError) throw error;
      fail(502, 'PARSE_FAILED', 'Menu parsing failed. No credits were charged.');
    }
  }
  async generate(uid, dishId, input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400, 'INVALID_INPUT', 'JSON object required');
    identifier(dishId, 'dish ID');
    const requestId = identifier(input.requestId, 'request ID');
    const { style, size } = input, cost = costFor(size);
    if (!STYLES.includes(style) || !cost) fail(400, 'INVALID_INPUT', 'Choose a supported style and resolution');
    const jobId = keyFor(uid, 'image', requestId), jobPath = `jobs/${jobId}`, dishPath = `dishes/${dishId}`, userPath = `users/${uid}`;
    const fingerprint = keyFor(dishId, style, size);
    const reservation = await this.store.transact(async tx => {
      const [dish, user, job] = await Promise.all([tx.get(dishPath), tx.get(userPath), tx.get(jobPath)]);
      if (!dish || dish.ownerId !== uid) fail(404, 'NOT_FOUND', 'Dish not found');
      if (job) {
        if (job.fingerprint !== fingerprint) fail(409, 'REQUEST_REUSED', 'Request ID was already used for another generation');
        return { existing: true, dish, credits: user?.credits || 0, status: job.status };
      }
      if (dish.activeJobId) fail(409, 'ALREADY_GENERATING', 'This dish already has a generation in progress');
      if (!user || !Number.isSafeInteger(user.credits) || user.credits < cost) fail(402, 'INSUFFICIENT_CREDITS', 'Not enough credits for this resolution');
      const updated = { ...dish, status: 'generating', activeJobId: jobId, error: '', styleConfig: { style, size }, lastCost: cost };
      tx.set(userPath, { ...user, credits: user.credits - cost });
      tx.set(dishPath, updated);
      tx.set(jobPath, { id: jobId, ownerId: uid, dishId, fingerprint, status: 'reserved', cost, createdAt: this.now(), deadline: this.now() + 180000 });
      return { dish: updated, credits: user.credits - cost };
    });
    if (reservation.existing) return { dish: cleanDish(reservation.dish), credits: reservation.credits, pending: reservation.status === 'reserved' };
    let result;
    try {
      result = await this.ai.generate({ uid, dishId, jobId, name: reservation.dish.name, description: reservation.dish.description, style, size });
    } catch {
      await this.refund(jobId, 'Image provider failed. Credits returned.');
      fail(502, 'GENERATION_FAILED', 'Image generation failed. Credits were returned once.');
    }
    // Persistence errors after provider success must NOT start another provider call or issue a blind refund.
    // Keep the reservation for operator reconciliation if this transaction fails.
    return this.store.transact(async tx => {
      const [job, dish, user] = await Promise.all([tx.get(jobPath), tx.get(dishPath), tx.get(userPath)]);
      if (job.status !== 'reserved' || dish.activeJobId !== jobId) return { dish: cleanDish(dish), credits: user.credits };
      const updated = { ...dish, status: 'completed', activeJobId: null, imageUrl: result.imageUrl, imagePath: result.imagePath || null, error: '' };
      tx.set(dishPath, updated);
      tx.set(jobPath, { ...job, status: 'completed', completedAt: this.now(), imagePath: result.imagePath || null });
      return { dish: cleanDish(updated), credits: user.credits };
    });
  }
  async refund(jobId, reason, { staleOnly = false } = {}) {
    return this.store.transact(async tx => {
      const jobPath = `jobs/${jobId}`, job = await tx.get(jobPath);
      if (!job || job.status !== 'reserved') return false;
      if (staleOnly && job.deadline > this.now()) fail(409, 'JOB_ACTIVE', 'Job has not reached its reconciliation deadline');
      const [user, dish] = await Promise.all([tx.get(`users/${job.ownerId}`), tx.get(`dishes/${job.dishId}`)]);
      if (!user || !Number.isSafeInteger(user.credits) || user.credits < 0 || !Number.isSafeInteger(job.cost) || job.cost < 1 || !Number.isSafeInteger(user.credits + job.cost)) fail(409, 'INVALID_BALANCE', 'Manual accounting reconciliation required');
      tx.set(`users/${job.ownerId}`, { ...user, credits: user.credits + job.cost });
      tx.set(jobPath, { ...job, status: 'refunded', completedAt: this.now(), reason });
      if (dish?.activeJobId === jobId) tx.set(`dishes/${job.dishId}`, { ...dish, status: 'error', activeJobId: null, error: reason });
      return true;
    });
  }
  async delete(uid, dishId) {
    identifier(dishId, 'dish ID');
    await this.store.transact(async tx => {
      const path = `dishes/${dishId}`, dish = await tx.get(path);
      if (!dish || dish.ownerId !== uid) fail(404, 'NOT_FOUND', 'Dish not found');
      if (dish.activeJobId) fail(409, 'JOB_ACTIVE', 'Wait for generation to finish before deleting');
      tx.delete(path);
    });
    // Storage retention is operator-controlled; deleting a card does not erase accounting evidence.
  }
  async checkout(uid, input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400, 'INVALID_INPUT', 'JSON object required');
    if (!this.payments) fail(503, 'PAYMENTS_DISABLED', 'Payments are disabled');
    const pack = typeof input.packageId === 'string' && Object.hasOwn(CATALOG, input.packageId) ? CATALOG[input.packageId] : undefined;
    if (!pack) fail(400, 'INVALID_PACKAGE', 'Unknown credit package');
    const requestId = identifier(input.requestId, 'request ID'), orderId = keyFor(uid, 'checkout', requestId), path = `orders/${orderId}`;
    const order = await this.store.transact(async tx => {
      const old = await tx.get(path);
      if (old) {
        if (old.packageId !== pack.id) fail(409, 'REQUEST_REUSED', 'Request ID was already used for another package');
        return old;
      }
      const next = { id: orderId, ownerId: uid, packageId: pack.id, credits: pack.credits, amount: pack.amount, currency: pack.currency, status: 'created', createdAt: this.now() };
      tx.set(path, next); return next;
    });
    if (order.status === 'paid') fail(409, 'ALREADY_PAID', 'This order is already paid');
    if (order.url) return { url: order.url };
    // Never repeat creation outside Stripe's idempotency window after an ambiguous failure.
    if (this.now() - order.createdAt > 23 * 3600000) fail(409, 'ORDER_EXPIRED', 'Start a new checkout request');
    const session = await this.payments.createCheckout(order);
    await this.store.transact(async tx => {
      const current = await tx.get(path);
      if (current.sessionId && current.sessionId !== session.id) fail(409, 'SESSION_MISMATCH', 'Checkout reconciliation required');
      tx.set(path, { ...current, sessionId: session.id, url: session.url });
    });
    return { url: session.url };
  }
  async creditPayment(session) {
    const orderId = session.metadata?.orderId;
    if (!orderId || !/^[a-f0-9]{64}$/.test(orderId)) fail(400, 'INVALID_PAYMENT', 'Payment has no recognized order');
    const paymentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
    if (!paymentId || !/^pi_[A-Za-z0-9]+$/.test(paymentId)) fail(400, 'INVALID_PAYMENT', 'Payment intent missing');
    return this.store.transact(async tx => {
      const orderPath = `orders/${orderId}`, order = await tx.get(orderPath);
      if (!order) fail(400, 'INVALID_PAYMENT', 'Unknown order');
      if (!order.sessionId) fail(503, 'ORDER_PENDING', 'Order is still being recorded. Retry delivery.');
      const items = session.line_items?.data;
      if (session.id !== order.sessionId || session.client_reference_id !== order.ownerId || session.mode !== 'payment' || session.payment_status !== 'paid' || session.amount_total !== order.amount || session.currency !== order.currency || session.livemode !== false || !items || items.length !== 1 || session.line_items.has_more || items[0].quantity !== 1 || items[0].amount_total !== order.amount || items[0].price?.unit_amount !== order.amount || items[0].price?.currency !== order.currency) fail(400, 'INVALID_PAYMENT', 'Payment does not match the server-created order');
      const ledgerPath = `payments/${paymentId}`, sessionPath = `paymentSessions/${session.id}`;
      const [ledger, creditedSession, user] = await Promise.all([tx.get(ledgerPath), tx.get(sessionPath), tx.get(`users/${order.ownerId}`)]);
      if (ledger || creditedSession || order.status === 'paid') return { duplicate: true };
      if (!user || !Number.isSafeInteger(user.credits) || user.credits < 0 || !Number.isSafeInteger(order.credits) || order.credits < 1 || !Number.isSafeInteger(user.credits + order.credits)) fail(409, 'INVALID_BALANCE', 'Account reconciliation required');
      tx.set(`users/${order.ownerId}`, { ...user, credits: user.credits + order.credits });
      tx.set(ledgerPath, { ownerId: order.ownerId, orderId, sessionId: session.id, credits: order.credits, createdAt: this.now() });
      tx.set(sessionPath, { paymentId, orderId });
      tx.set(orderPath, { ...order, status: 'paid', paymentId });
      return { duplicate: false, credits: order.credits };
    });
  }
}
