// Explicit operator action only; never runs as part of setup, tests, build, or demo.
import { configuration } from '../server/config.js';
const [jobId, confirmation] = process.argv.slice(2);
if (!/^[a-f0-9]{64}$/.test(jobId || '') || confirmation !== '--confirm-refund') throw new Error('Usage: npm run reconcile -- <jobId> --confirm-refund');
const config = configuration();
if (config.mode !== 'live') throw new Error('Reconciliation requires explicitly configured integration mode');
const [{ initializeApp, applicationDefault }, { getFirestore }, { MenuService }, { FirestoreStore }] = await Promise.all([import('firebase-admin/app'), import('firebase-admin/firestore'), import('../server/domain.js'), import('../server/store.js')]);
const app = initializeApp({ credential: applicationDefault(), projectId: config.projectId });
const service = new MenuService({ store: new FirestoreStore(getFirestore(app)) });
const changed = await service.refund(jobId, 'Operator reconciled a stale generation reservation.', { staleOnly: true });
console.log(changed ? 'Stale reservation refunded once.' : 'No change: job is absent or already terminal.');
