import express from 'express';
import path from 'node:path';
import { AppError, fail, identifier } from './domain.js';

export function createApp({ mode = 'demo', service, verifyToken, payments, readImage, dist = path.resolve('dist') } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'no-referrer');
    res.set('X-Frame-Options', 'DENY');
    res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    const connect = mode === 'live' ? "'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com" : "'self'";
    res.set('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src ${connect}; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`);
    next();
  });
  app.get('/api/health', (_req, res) => res.json({ mode, providersEnabled: mode === 'live' }));
  const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
  if (mode === 'live') {
    app.post('/api/stripe/webhook', express.raw({ type: 'application/json', limit: '256kb' }), wrap(async (req, res) => {
      if (!payments) fail(503, 'PAYMENTS_DISABLED', 'Payments are disabled');
      let event;
      try { event = payments.verifyWebhook(req.body, req.headers['stripe-signature']); }
      catch { fail(400, 'INVALID_SIGNATURE', 'Invalid webhook signature'); }
      if (['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)) {
        // Retrieve Stripe's current object, including line items. Never trust browser-supplied status or metadata credits.
        const session = await payments.retrieveSession(event.data.object.id);
        if (session.payment_status === 'paid') await service.creditPayment(session);
      }
      res.json({ received: true });
    }));
    app.use('/api', express.json({ limit: '20kb' }));
    app.use('/api', (req, res, next) => {
      const header = req.headers.authorization;
      if (!header || !/^Bearer [^\s]+$/.test(header)) return next(new AppError(401, 'UNAUTHENTICATED', 'Sign in to continue'));
      Promise.resolve().then(() => verifyToken(header.slice(7))).then(identity => {
        if (!identity || typeof identity.uid !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(identity.uid)) throw new Error('Invalid identity');
        req.identity = identity; res.set('Cache-Control', 'no-store'); next();
      }).catch(() => next(new AppError(401, 'UNAUTHENTICATED', 'Your sign-in expired. Sign in again.')));
    });
    app.get('/api/me', wrap(async (req, res) => res.json({ user: await service.me(req.identity) })));
    app.get('/api/dishes', wrap(async (req, res) => res.json({ dishes: await service.list(req.identity.uid) })));
    const verified = (req, _res, next) => req.identity.email_verified === true ? next() : next(new AppError(403, 'EMAIL_UNVERIFIED', 'Verify your email before using paid providers'));
    app.post('/api/parse-menu', verified, wrap(async (req, res) => res.json({ dishes: await service.parse(req.identity.uid, req.body) })));
    app.post('/api/dishes/:id/generate', verified, wrap(async (req, res) => {
      const result = await service.generate(req.identity.uid, req.params.id, req.body);
      res.status(result.pending ? 202 : 200).json(result);
    }));
    app.delete('/api/dishes/:id', wrap(async (req, res) => { await service.delete(req.identity.uid, req.params.id); res.sendStatus(204); }));
    app.get('/api/dishes/:id/image', wrap(async (req, res) => {
      identifier(req.params.id, 'dish ID');
      const dish = await service.store.transact(tx => tx.get(`dishes/${req.params.id}`));
      if (!dish || dish.ownerId !== req.identity.uid || !dish.imagePath) fail(404, 'NOT_FOUND', 'Image not found');
      const image = await readImage(dish.imagePath);
      res.type(image.mimeType).send(image.bytes);
    }));
    app.get('/api/catalog', wrap(async (_req, res) => {
      const { CATALOG } = await import('./domain.js');
      res.json({ packages: Object.values(CATALOG), enabled: Boolean(payments) });
    }));
    app.post('/api/checkout', verified, wrap(async (req, res) => res.json(await service.checkout(req.identity.uid, req.body))));
    // Admin status is a signed Firebase custom claim; a client profile cannot grant it.
    app.get('/api/admin/jobs', wrap(async (req, res) => {
      if (req.identity.admin !== true) fail(403, 'FORBIDDEN', 'Administrator access required');
      res.json({ jobs: await service.store.list('jobs', 'status', 'reserved') });
    }));
  }
  app.use('/api', (_req, res) => res.status(mode === 'demo' ? 503 : 404).json({ code: mode === 'demo' ? 'DEMO_ISOLATED' : 'NOT_FOUND', error: mode === 'demo' ? 'Demo mode has no provider or payment API' : 'Endpoint not found' }));
  app.use(express.static(dist));
  app.use((req, res, next) => req.method === 'GET' && req.accepts('html') ? res.sendFile(path.join(dist, 'index.html'), error => error && next(error)) : next());
  app.use((error, _req, res, _next) => {
    const status = error instanceof AppError ? error.status : error.type === 'entity.too.large' ? 413 : error instanceof SyntaxError ? 400 : 500;
    res.status(status).json({ code: error instanceof AppError ? error.code : 'REQUEST_FAILED', error: error instanceof AppError ? error.message : 'Request could not be completed. Refresh the studio before retrying.' });
  });
  return app;
}
