# Architecture and failure handling

## Two deliberately distinct modes

`src/services/demo.ts` implements the safe browser-only experience. It is the default; a fresh clone needs no account, network provider, or environment file. `src/services/live.ts` is lazy-loaded only when the frontend is built with `VITE_APP_MODE=live`. The backend independently defaults to `APP_MODE=demo` and does not load provider SDKs or credentials in that mode.

The live request path is:

`React -> Firebase Auth ID token -> Express authorization -> MenuService -> FirestoreStore -> provider adapter`

The integration server only admits Firebase UIDs in its explicit development allowlist (maximum 20). Test Stripe credits are not payment for Gemini costs; operator budget/quota controls remain necessary. The browser has no Firestore/Storage write capability. Default-deny rules are intentional, not a missing permission fix. Firebase Admin bypasses these rules, so route and domain ownership checks are mandatory.

## Data model

- `users/{uid}`: server-created name and integer credit balance; role is not stored here
- `dishes/{id}`: immutable server-assigned owner, dish details, status, style, private image path, active job
- `jobs/{hash(uid,requestId)}`: image reservation, server cost, deadline, terminal state
- `parseJobs/{hash(uid,requestId)}`: parse deduplication and returned dish list
- `quotas/{hash(uid,hour)}`: transactional per-account parsing request count
- `orders/{hash(uid,requestId)}`: immutable package/amount/currency/credit snapshot and Stripe session binding
- `payments/{paymentIntentId}` and `paymentSessions/{sessionId}`: canonical exactly-once application-credit markers

All transaction reads precede writes. Network calls occur outside transaction callbacks because Firestore can retry the callbacks.

## Image state machine

`pending/error/completed -> reserved + generating -> completed OR refunded + error`

A new request ID reserves credit atomically with the dish lock. The same ID and arguments replays the existing state without another provider call. Reusing an ID with different arguments conflicts. A different ID cannot generate a locked dish. Insufficient balance fails before any provider call.

Provider failure triggers a transaction that refunds only a `reserved` job. Duplicate refund paths and a late completion are harmless. A normal provider result is stored in private Storage and then committed to Firestore. A persistence error after the provider returns keeps the reservation. The client must refresh/retry the same request ID; it cannot infer that nothing happened from a network failure.

A process crash can leave the job reserved. The operator can inspect `/api/admin/jobs` using an ID token with an `admin: true` custom claim, investigate provider/storage results, and explicitly refund a stale reservation with `npm run reconcile -- <jobId> --confirm-refund`. The command requires the configured development project's Admin access and will not touch jobs before their deadline. It is not an automatic scheduler and must not be used blindly while an operation is active.

This guarantees at-most-once application debit/refund under the tested transactions, not distributed exactly-once billing at Gemini. A timed-out provider may already have consumed provider quota. There is no automatic image-provider retry. A future durable queue, lease reconciliation, and provider-specific request tracking are required for a production service.

## Payment flow

Only Stripe test keys are accepted. Client input selects a known package; it cannot select a price or write credit metadata. The server records the order first, uses its hash as Stripe's idempotency key, then binds the returned session. Creation retries after 23 hours are rejected so an old idempotency key cannot accidentally create a second session after Stripe's retention window.

The raw-body webhook is mounted before JSON parsing. It verifies the Stripe signature and retrieves the current session with line items. Its metadata identifies an order only; it does not define a beneficiary or quantity. The persisted order binds session, owner, credits, amount and currency. The service validates paid status, payment mode, test mode, a single matching line item, and the payment intent. Deduplication reads and credit writes happen in one Firestore transaction.

A webhook racing session persistence returns a retryable error. Two event types for the same session/payment cannot double-credit it. Success/cancel URL query parameters are purely navigation signals. Refunds, disputes, asynchronous payment methods and real-money checkout are outside this portfolio's supported scope.

## Privacy and retention

Images use no public download token; Express streams bytes only after owner verification. The frontend turns them into temporary object URLs. Direct Firebase client access is denied. Local demo data is synthetic and never sent to an API.

Deleting a dish currently deletes its card record. Storage cleanup, account deletion, retention/TTL of quotas/jobs, customer data export and legal notices are not implemented as production workflows. Configure these before using real customer data. Never re-enable old client credit writes or copy the original payment listeners into this design.

## Primary implementation references

- [Firebase ID-token verification](https://firebase.google.com/docs/auth/admin/verify-id-tokens)
- [Firestore transactions](https://firebase.google.com/docs/firestore/manage-data/transactions)
- [Admin SDK and rules boundary](https://firebase.google.com/docs/firestore/security/get-started)
- [Stripe raw-body webhook signature verification](https://docs.stripe.com/webhooks?lang=node)
- [Gemini image generation](https://ai.google.dev/gemini-api/docs/image-generation)

## Dependency maintenance

The dependency lockfile pins the tested package graph. A direct npm override pins `@grpc/grpc-js` 1.14.6 because the current Firebase client graph otherwise selected an advisory-affected version. The corrected graph passed the local production dependency audit and emulator tests at preparation time. Recheck advisories and compatibility when updating dependencies; an audit result is not a security certification.
