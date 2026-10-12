import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { geminiAdapter, stripeAdapter, storageReader } from '../server/providers.js';

// SDK boundary tests use deliberately unusable credentials, stub every Gemini
// fetch, and never invoke a Stripe network method or a real Storage bucket.
const aiFixture = bucket => geminiAdapter({
  apiKey: 'fixture-unusable', parseModel: 'fixture-parse', imageModel: 'fixture-image', bucket,
});
const imageInput = { uid: 'fixture-user', dishId: 'fixture-dish', jobId: 'fixture-job', name: 'Soup', description: 'Tomato', style: 'Bright/Modern', size: '1K' };
const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const imageResponse = (mimeType, data) => jsonResponse({ candidates: [{ content: { parts: [{ inlineData: { mimeType, data } }] } }] });

test('actual Stripe SDK verifies a locally signed raw payload and rejects tampering', () => {
  const webhookSecret = 'fixture-only-signing-secret';
  const payments = stripeAdapter({ secretKey: 'sk_test_fixture', webhookSecret, origin: 'http://localhost:8080' });
  const timestamp = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({ id: 'evt_fixture', type: 'checkout.session.completed', data: { object: { id: 'cs_test_fixture' } } });
  const signature = createHmac('sha256', webhookSecret).update(`${timestamp}.${payload}`).digest('hex');
  const header = `t=${timestamp},v1=${signature}`;
  assert.equal(payments.verifyWebhook(Buffer.from(payload), header).id, 'evt_fixture');
  assert.throws(() => payments.verifyWebhook(Buffer.from(`${payload} `), header));
  assert.throws(() => payments.verifyWebhook(Buffer.from(payload), `t=${timestamp},v1=${'0'.repeat(64)}`));
  assert.throws(() => payments.verifyWebhook(Buffer.from(payload), undefined));
});

test('Stripe adapter rejects a live key before constructing a payment client', () => {
  assert.throws(() => stripeAdapter({ secretKey: 'sk_live_fixture', webhookSecret: 'fixture-only-signing-secret', origin: 'http://localhost:8080' }), /Only Stripe test-mode/);
});

test('Gemini SDK maps parsing to the selected model and JSON output schema', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    return jsonResponse({ candidates: [{ content: { parts: [{ text: JSON.stringify([{ name: 'Soup', description: 'Tomato' }]) }] } }] });
  });
  assert.deepEqual(await aiFixture().parse('Soup with tomato'), [{ name: 'Soup', description: 'Tomato' }]);
  assert.equal(calls.length, 1);
  assert.match(new URL(calls[0].url).pathname, /\/models\/fixture-parse:generateContent$/);
  assert.equal(calls[0].body.generationConfig.responseMimeType, 'application/json');
  assert.equal(calls[0].body.generationConfig.responseSchema.type, 'ARRAY');
  assert.match(calls[0].body.contents[0].parts[0].text, /Soup with tomato/);
});

test('Gemini SDK maps image settings and stores bytes privately without a download token', async t => {
  const calls = [], saves = [];
  const bytes = Buffer.from('synthetic-local-image-fixture');
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    return imageResponse('image/png', bytes.toString('base64'));
  });
  const bucket = { file: path => ({ save: async (content, options) => saves.push({ path, content, options }) }) };
  const result = await aiFixture(bucket).generate({ ...imageInput, style: 'Social Media', size: '2K' });
  assert.equal(calls.length, 1);
  assert.match(new URL(calls[0].url).pathname, /\/models\/fixture-image:generateContent$/);
  assert.deepEqual(calls[0].body.generationConfig.imageConfig, { aspectRatio: '3:4', imageSize: '2K' });
  assert.equal(saves.length, 1);
  assert.equal(saves[0].path, 'users/fixture-user/dishes/fixture-dish/fixture-job');
  assert.deepEqual(saves[0].content, bytes);
  assert.deepEqual(saves[0].options, { resumable: false, metadata: { contentType: 'image/png', cacheControl: 'private, no-store' } });
  assert.deepEqual(result, { imagePath: saves[0].path, imageUrl: '/api/dishes/fixture-dish/image' });
});

test('Gemini adapter makes one SDK request on a retryable provider failure and never saves', async t => {
  let requests = 0, saves = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    requests++;
    return jsonResponse({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Synthetic transient error' } }, 429);
  });
  const bucket = { file: () => ({ save: async () => { saves++; } }) };
  await assert.rejects(aiFixture(bucket).generate(imageInput));
  assert.equal(requests, 1);
  assert.equal(saves, 0);
});

test('Gemini adapter rejects unsupported or empty image output before Storage writes', async t => {
  let output = imageResponse('image/svg+xml', Buffer.from('<svg/>').toString('base64'));
  let requests = 0, saves = 0;
  t.mock.method(globalThis, 'fetch', async () => { requests++; return output; });
  const adapter = aiFixture({ file: () => ({ save: async () => { saves++; } }) });
  await assert.rejects(adapter.generate(imageInput), /No supported image/);
  output = imageResponse('image/png', '');
  await assert.rejects(adapter.generate(imageInput), /No supported image/);
  assert.equal(requests, 2);
  assert.equal(saves, 0);
});

test('Storage reader rejects unsupported or oversized metadata before downloading', async () => {
  let downloads = 0;
  for (const metadata of [{ contentType: 'text/html', size: '12' }, { contentType: 'image/png', size: String(16 * 1024 * 1024) }]) {
    const bucket = { file: () => ({ getMetadata: async () => [metadata], download: async () => { downloads++; return [Buffer.from('fixture')]; } }) };
    await assert.rejects(storageReader(bucket, 'fixture-private-path'), /Unsupported image/);
  }
  assert.equal(downloads, 0);
});
