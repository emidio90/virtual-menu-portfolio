# Optional integration setup

The review copy works without this setup. These steps are for the owner to perform later in a **new development project**. They were not executed during preparation. Do not point this copy at the original project's data or credentials.

## 1. Understand the boundary

`APP_MODE=live` enables real Firebase and Gemini integration. Gemini requests can consume paid quota. `ENABLE_TEST_PAYMENTS=true` enables only Stripe test checkout. A live Stripe key is rejected. Test-card credit purchases do not protect against real Gemini charges. Access is restricted to at most 20 developer UIDs in `LIVE_ALLOWED_UIDS`, and the server defaults to loopback. Keep this integration environment private; set provider project budgets/quotas separately. The portfolio is not commercially deployable just by filling in environment values.

## 2. Firebase

- Create/select a development Firebase project, enable email/password Auth, Firestore and Storage
- Add only the intended development web origin to Firebase Auth's authorized domains
- Copy `.env.example` to `.env`, replace the project/bucket placeholders and set `APP_ORIGIN` to the exact origin, without a trailing slash
- Use Application Default Credentials or workload identity with narrowly scoped project access. Do not commit service-account JSON or put Admin credentials in `VITE_*`
- Set public Firebase web config fields: `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`
- Apply the supplied Firestore and Storage rules to that development project using its console or authorized CLI. The rules deny direct browser access; all application data is routed through Express
- Enable email verification. Provider-backed operations require the verified-email ID-token claim. Refresh sign-in after verification
- Add only approved development account UIDs to `LIVE_ALLOWED_UIDS` after creating the accounts in Firebase. Unlisted accounts cannot access the API, even if they have an admin claim. There is no open signup-to-paid-provider path.
- New accounts receive zero application credits. Test checkout can add credits, or an operator can seed a small development balance through authorized Admin tooling. Never allow users to set their own balance

No Firestore composite index is required by the included queries. The copy does not require the Firebase Stripe extension or the original Cloud Functions.

## 3. Gemini

Set a new `GEMINI_API_KEY` server-side and explicit `GEMINI_PARSE_MODEL` / `GEMINI_IMAGE_MODEL` identifiers available to your project. Verify model support, region, current API/SDK compatibility, quotas and pricing in [Google's documentation](https://ai.google.dev/gemini-api/docs/image-generation). No model is silently selected by this copy.

The image adapter requests 1K/2K/4K and style-specific aspect ratios. A configured model must support these options. Provider outputs and timeouts are validated; no image generation is retried automatically. Do not use actual customer menus until privacy and operational review is complete.

## 4. Optional Stripe test checkout

Set `ENABLE_TEST_PAYMENTS=true`, your new `sk_test_…` key and the webhook signing secret. Register a test-mode snapshot webhook at `/api/stripe/webhook` for `checkout.session.completed` and `checkout.session.async_payment_succeeded`; use the [official Stripe webhook guide](https://docs.stripe.com/webhooks?lang=node).

The backend uses inline one-time test prices from `server/domain.js`: Starter 10 credits / USD 10; Studio 25 credits / USD 20. These are sample package economics, not a verified profitable pricing model. No tax, discounts, subscriptions, optional quantities, address collection, or live purchases are enabled. Any future commercial pricing change must be reviewed with matching tests, refund/dispute handling, legal terms and current costs.

## 5. Run locally

Set both `APP_MODE=live` and `VITE_APP_MODE=live` only after you intend to exercise real providers.

```sh
npm run build
npm start
```

For iterative development, run `npm run dev:server` and `npm run dev` in separate terminals. The Vite proxy forwards `/api` to `127.0.0.1:8080`. Choose a consistent origin for auth/checkout. Use the browser's built-in email/password flow; no production credentials are included.

The frontend mode is a **build-time** value. Changing `.env` after a build does not rebuild it. Rebuild when changing mode. The backend checks its mode independently and fails closed when required settings are missing.

## Before any public integration deployment

Complete rules and transaction emulator tests, real development-project smoke tests, CSP/origin testing, provider model compatibility checks, abuse prevention, durable job recovery, cleanup/retention, monitoring, backup/account lifecycle procedures, and privacy/legal review. A server-side admin SDK is a powerful trust boundary. Do not expose an internet-accessible Admin credential or development emulator.

This copy deliberately does not provide a deployment command that publishes the application or changes repository visibility.
