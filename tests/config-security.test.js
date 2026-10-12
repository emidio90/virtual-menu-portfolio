import test from 'node:test';
import assert from 'node:assert/strict';
import { allowlistedVerifier, configuration } from '../server/config.js';

// Configuration-only fixtures are deliberately unusable as real credentials.
function liveEnvironment(overrides = {}) {
  return {
    APP_MODE: 'live', FIREBASE_PROJECT_ID: 'demo-menu-fixture', FIREBASE_STORAGE_BUCKET: 'demo-menu-fixture.invalid',
    GEMINI_API_KEY: 'fixture-unusable', GEMINI_PARSE_MODEL: 'fixture-parse-model', GEMINI_IMAGE_MODEL: 'fixture-image-model',
    APP_ORIGIN: 'https://menu.example.test', LIVE_ALLOWED_UIDS: 'alice-user,bob-user', ...overrides,
  };
}

test('default configuration is local demo with no credentials', () => {
  assert.deepEqual(configuration({}), { mode: 'demo', host: '127.0.0.1', port: 8080 });
});
test('demo configuration does not even read credential or provider environment variables', () => {
  const accessed = [];
  const environment = new Proxy({ APP_MODE: 'demo' }, { get(target, key) {
    accessed.push(key);
    if (!['APP_MODE', 'HOST', 'PORT'].includes(key)) throw new Error(`Demo attempted provider access: ${String(key)}`);
    return target[key];
  } });
  assert.deepEqual(configuration(environment), { mode: 'demo', host: '127.0.0.1', port: 8080 });
  assert.deepEqual(accessed.sort(), ['APP_MODE', 'HOST', 'PORT']);
});
test('demo ignores payment enablement and accidental provider credentials', () => {
  const config = configuration(liveEnvironment({ APP_MODE: 'demo', ENABLE_TEST_PAYMENTS: 'true', STRIPE_SECRET_KEY: 'invalid-fixture', STRIPE_WEBHOOK_SECRET: 'invalid-fixture' }));
  assert.deepEqual(config, { mode: 'demo', host: '127.0.0.1', port: 8080 });
});
test('unknown application mode fails closed instead of starting with integrations', () => {
  for (const APP_MODE of ['production', 'LIVE', 'development', 'false']) assert.throws(() => configuration(liveEnvironment({ APP_MODE })), /APP_MODE must be demo or live/);
});
test('server port must be a valid integer in the TCP range', () => {
  for (const PORT of ['-1', '0', '65536', '8080.5', 'NaN', 'Infinity', 'port']) assert.throws(() => configuration({ PORT }), /Invalid PORT/);
  assert.equal(configuration({ PORT: '3000' }).port, 3000);
});
for (const name of ['FIREBASE_PROJECT_ID', 'FIREBASE_STORAGE_BUCKET', 'GEMINI_API_KEY', 'GEMINI_PARSE_MODEL', 'GEMINI_IMAGE_MODEL', 'APP_ORIGIN', 'LIVE_ALLOWED_UIDS']) {
  test(`live configuration requires explicit ${name} and rejects template placeholders`, () => {
    for (const value of [undefined, '', 'replace-me', 'prefix-replace-me-suffix']) assert.throws(() => configuration(liveEnvironment({ [name]: value })), new RegExp(`Live mode requires ${name}`));
  });
}
test('live configuration with missing required settings never silently falls back to demo', () => {
  assert.throws(() => configuration({ APP_MODE: 'live' }), /Live mode requires FIREBASE_PROJECT_ID/);
});
test('valid live configuration exposes selected models but payments stay disabled by default', () => {
  const config = configuration(liveEnvironment({ STRIPE_SECRET_KEY: 'unused-fixture', STRIPE_WEBHOOK_SECRET: 'unused-fixture' }));
  assert.equal(config.mode, 'live'); assert.equal(config.projectId, 'demo-menu-fixture');
  assert.equal(config.parseModel, 'fixture-parse-model'); assert.equal(config.imageModel, 'fixture-image-model');
  assert.deepEqual(config.allowedUids, ['alice-user', 'bob-user']);
  assert.equal(config.paymentsEnabled, false); assert.equal(config.stripeKey, undefined); assert.equal(config.webhookSecret, undefined);
});
test('payment enablement requires literal true and valid test-mode prefix', () => {
  for (const ENABLE_TEST_PAYMENTS of [undefined, 'false', 'TRUE', '1', true]) assert.equal(configuration(liveEnvironment({ ENABLE_TEST_PAYMENTS })).paymentsEnabled, false);
  for (const STRIPE_SECRET_KEY of [undefined, '', 'sk_live_fixture', 'pk_test_fixture', 'fixture']) {
    assert.throws(() => configuration(liveEnvironment({ ENABLE_TEST_PAYMENTS: 'true', STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET: 'whsec_fixture' })), /Test payments require/);
  }
});
test('test payment configuration requires webhook signing secret as well as test key', () => {
  for (const STRIPE_WEBHOOK_SECRET of [undefined, '', 'fixture']) assert.throws(() => configuration(liveEnvironment({ ENABLE_TEST_PAYMENTS: 'true', STRIPE_SECRET_KEY: 'sk_test_fixture', STRIPE_WEBHOOK_SECRET })), /Test payments require/);
  const config = configuration(liveEnvironment({ ENABLE_TEST_PAYMENTS: 'true', STRIPE_SECRET_KEY: 'sk_test_fixture', STRIPE_WEBHOOK_SECRET: 'whsec_fixture' }));
  assert.equal(config.paymentsEnabled, true); assert.equal(config.stripeKey, 'sk_test_fixture');
});
test('public app origins require HTTPS and cannot include credentials, paths, queries or fragments', () => {
  for (const APP_ORIGIN of ['http://menu.example.test', 'javascript:alert(1)', 'file:///tmp/index.html', 'ftp://menu.example.test', 'https://menu.example.test/', 'https://menu.example.test/path', 'https://menu.example.test?redirect=evil', 'https://menu.example.test#fragment', 'https://user:password@menu.example.test', 'not-a-url']) {
    assert.throws(() => configuration(liveEnvironment({ APP_ORIGIN })), undefined, APP_ORIGIN);
  }
});
test('only explicit loopback HTTP origins are accepted for local development', () => {
  for (const APP_ORIGIN of ['http://localhost:8080', 'http://127.0.0.1:8080']) assert.equal(configuration(liveEnvironment({ APP_ORIGIN })).origin, APP_ORIGIN);
  for (const APP_ORIGIN of ['http://localhost.attacker.example', 'http://127.0.0.1.attacker.example', 'http://0.0.0.0:8080', 'http://192.168.0.1']) assert.throws(() => configuration(liveEnvironment({ APP_ORIGIN })), /APP_ORIGIN must be/);
});


test('live allowlist must contain at least one valid UID rather than an empty or wildcard audience', () => {
  for (const LIVE_ALLOWED_UIDS of [' ', ',', ',,', '*', 'alice-user,*', '../users/admin', 'alice-user,bad/uid', 'alice-user,uid with spaces', 'a'.repeat(129)]) {
    assert.throws(() => configuration(liveEnvironment({ LIVE_ALLOWED_UIDS })), undefined, JSON.stringify(LIVE_ALLOWED_UIDS));
  }
});
test('live allowlist trims surrounding whitespace and returns validated explicit UIDs', () => {
  const config = configuration(liveEnvironment({ LIVE_ALLOWED_UIDS: ' alice-user , bob-user ' }));
  assert.deepEqual(config.allowedUids, ['alice-user', 'bob-user']);
});
test('allowlisted verifier checks verified UID and preserves signed claims for permitted identity', async () => {
  const calls = [];
  const identity = { uid: 'alice-user', email_verified: true, admin: true, email: 'alice@example.test' };
  const verify = allowlistedVerifier(async token => { calls.push(token); return identity; }, ['alice-user']);
  assert.deepEqual(await verify('fixture-token'), identity);
  assert.deepEqual(calls, ['fixture-token']);
});
test('nonmember and signed-admin identities cannot bypass the live allowlist', async () => {
  for (const identity of [{ uid: 'mallory-user' }, { uid: 'mallory-user', admin: true }, { uid: 'alice-user-other' }]) {
    const verify = allowlistedVerifier(async () => identity, ['alice-user']);
    await assert.rejects(verify('fixture-token'));
  }
});
test('allowlisted verifier rejects missing and malformed UID identities', async () => {
  for (const identity of [undefined, null, {}, { uid: undefined }, { uid: null }, { uid: 123 }, { uid: ['alice-user'] }, { uid: '' }]) {
    const verify = allowlistedVerifier(async () => identity, ['alice-user']);
    await assert.rejects(verify('fixture-token'));
  }
});
test('empty allowlist cannot authorize any signed identity', async () => {
  const verify = allowlistedVerifier(async () => ({ uid: 'alice-user', admin: true }), []);
  await assert.rejects(verify('fixture-token'));
});
test('allowlisted verifier preserves asynchronous and synchronous authentication failures', async () => {
  const expired = new Error('expired fixture token');
  const asyncVerify = allowlistedVerifier(async () => { throw expired; }, ['alice-user']);
  await assert.rejects(asyncVerify('fixture-token'), error => error === expired);
  const syncVerify = allowlistedVerifier(() => { throw expired; }, ['alice-user']);
  await assert.rejects(syncVerify('fixture-token'), error => error === expired);
});


test('live allowlist is bounded to twenty distinct identities and deduplicates entries', () => {
  const identities = Array.from({ length: 20 }, (_, index) => `user-${index}`);
  assert.deepEqual(configuration(liveEnvironment({ LIVE_ALLOWED_UIDS: identities.join(',') })).allowedUids, identities);
  assert.throws(() => configuration(liveEnvironment({ LIVE_ALLOWED_UIDS: [...identities, 'user-over-limit'].join(',') })), /LIVE_ALLOWED_UIDS/);
  assert.deepEqual(configuration(liveEnvironment({ LIVE_ALLOWED_UIDS: 'alice-user, alice-user,bob-user' })).allowedUids, ['alice-user', 'bob-user']);
});
