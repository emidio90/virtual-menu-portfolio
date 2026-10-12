export function configuration(env = process.env) {
  const mode = env.APP_MODE || 'demo';
  if (!['demo', 'live'].includes(mode)) throw new Error('APP_MODE must be demo or live');
  const base = { mode, port: Number(env.PORT || 8080), host: env.HOST || '127.0.0.1' };
  if (!Number.isInteger(base.port) || base.port < 1 || base.port > 65535) throw new Error('Invalid PORT');
  if (mode === 'demo') return base; // No credential reads, SDK imports, or provider initialization.
  const required = ['FIREBASE_PROJECT_ID', 'FIREBASE_STORAGE_BUCKET', 'GEMINI_API_KEY', 'GEMINI_PARSE_MODEL', 'GEMINI_IMAGE_MODEL', 'APP_ORIGIN', 'LIVE_ALLOWED_UIDS'];
  for (const name of required) if (!env[name] || env[name].includes('replace-me')) throw new Error(`Live mode requires ${name}`);
  const allowedUids = [...new Set(env.LIVE_ALLOWED_UIDS.split(',').map(uid => uid.trim()))];
  if (!allowedUids.length || allowedUids.length > 20 || allowedUids.some(uid => !/^[a-zA-Z0-9_-]{1,128}$/.test(uid))) throw new Error('LIVE_ALLOWED_UIDS must be 1–20 valid Firebase UIDs, comma separated');
  const origin = new URL(env.APP_ORIGIN);
  if (origin.origin !== env.APP_ORIGIN || !['https:', 'http:'].includes(origin.protocol) || (origin.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(origin.hostname))) throw new Error('APP_ORIGIN must be an HTTPS origin (HTTP only on localhost)');
  const paymentsEnabled = env.ENABLE_TEST_PAYMENTS === 'true';
  if (paymentsEnabled && (!env.STRIPE_SECRET_KEY?.startsWith('sk_test_') || !env.STRIPE_WEBHOOK_SECRET?.startsWith('whsec_'))) throw new Error('Test payments require a Stripe test key and webhook signing secret');
  return { ...base, allowedUids, projectId: env.FIREBASE_PROJECT_ID, bucket: env.FIREBASE_STORAGE_BUCKET, apiKey: env.GEMINI_API_KEY, parseModel: env.GEMINI_PARSE_MODEL, imageModel: env.GEMINI_IMAGE_MODEL, origin: origin.origin, paymentsEnabled, stripeKey: paymentsEnabled ? env.STRIPE_SECRET_KEY : undefined, webhookSecret: paymentsEnabled ? env.STRIPE_WEBHOOK_SECRET : undefined };
}

export function allowlistedVerifier(verifyToken, allowedUids) {
  return async token => {
    const identity = await verifyToken(token);
    if (!identity || typeof identity.uid !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(identity.uid) || !Array.isArray(allowedUids) || !allowedUids.includes(identity.uid)) throw new Error('This development account is not allowlisted');
    return identity;
  };
}
