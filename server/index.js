import { createApp } from './app.js';
import { configuration, allowlistedVerifier } from './config.js';
const config = configuration();
let options = { mode: config.mode };
if (config.mode === 'live') {
  const [{ initializeApp, applicationDefault }, { getAuth }, { getFirestore }, { getStorage }, { MenuService }, { FirestoreStore }, providers] = await Promise.all([
    import('firebase-admin/app'), import('firebase-admin/auth'), import('firebase-admin/firestore'), import('firebase-admin/storage'), import('./domain.js'), import('./store.js'), import('./providers.js'),
  ]);
  const firebase = initializeApp({ credential: applicationDefault(), projectId: config.projectId, storageBucket: config.bucket });
  const bucket = getStorage(firebase).bucket();
  const store = new FirestoreStore(getFirestore(firebase));
  const payments = config.paymentsEnabled ? providers.stripeAdapter({ secretKey: config.stripeKey, webhookSecret: config.webhookSecret, origin: config.origin }) : null;
  const service = new MenuService({ store, ai: providers.geminiAdapter({ apiKey: config.apiKey, parseModel: config.parseModel, imageModel: config.imageModel, bucket }), payments });
  options = { ...options, service, payments, verifyToken: allowlistedVerifier(token => getAuth(firebase).verifyIdToken(token, true), config.allowedUids), readImage: imagePath => providers.storageReader(bucket, imagePath) };
}
const server = createApp(options).listen(config.port, config.host, () => console.log(`Virtual Menu ${config.mode} server: http://${config.host}:${config.port}`));
server.requestTimeout = 180000;
server.headersTimeout = 20000;
