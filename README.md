# Virtual Menu · Food Image Studio

A full-stack portfolio project that turns restaurant menu text into an editable food-image shot list. Choose an aesthetic and resolution, preview a dish illustration, and manage the generation workflow.

**Try it without an account:** the default mode runs entirely in your browser using synthetic menus, locally authored SVG food illustrations, and simulated credits. It makes no Firebase, Gemini, or Stripe calls. The illustrations are design fixtures, not evidence of AI generation quality.

## Quick start

Requires **Node.js 24.x** and npm. No `.env` file is needed for the demo.

```sh
npm ci
npm run dev
```

Open the local URL Vite prints. For a production-style local preview:

```sh
npm run build
npm start
```

Open `http://127.0.0.1:8080`. The Express server rejects all provider/payment endpoints in demo mode. `npm run dev` serves the same isolated browser demo without requiring the server.

## Optional free static hosting

The [published isolated demo](https://virtual-menu-portfolio.web.app) uses Firebase Hosting on Spark within its limits, with billing disabled. A hosting-only configuration forces a demo build. Pushes to `main` are rebuilt and deployed by GitHub Actions only after all checks pass; the keyless identity link is limited to this repository and workflow. See [the static hosting and CI/CD guide](docs/STATIC_HOSTING.md).

## The product

- Paste a menu, or load a clearly labeled synthetic example
- Parse menu lines into a shot list; edit the source and create another list
- Choose **Rustic/Dark**, **Bright/Modern**, or **Social Media** aesthetics
- Select **1K / 2K / 4K** with visible 1 / 2 / 4-credit costs
- Generate a labeled demo illustration, inspect it in a preview, download it, or delete a card
- Explore the architecture from the interface

Demo parsing is deterministic, and demo “generation” selects an existing local SVG. It does not infer arbitrary dishes or produce new photography. Real Google Gemini parsing and image generation adapters remain in the server source for a separately configured development project. Resolution settings are requests to that provider; the fixtures are SVGs and have no corresponding raster-generation claim.

This is a food-image studio. Public menu hosting, QR menus, restaurant ordering, and delivery-platform integrations are not implemented.

## Architecture

| Layer | Implementation |
| --- | --- |
| Interface | React 19, TypeScript, Vite, locally bundled CSS |
| Default demo | Browser-local state, deterministic mock service, original SVG fixtures |
| Integration API | One Express 5 backend, Firebase Admin ID-token verification |
| Accounts and data | Firebase Auth, server-only Firestore transactions |
| Images | Gemini SDK, private Firebase Storage objects, owner-authorized image streaming |
| Checkout | Stripe **test mode only**, signed webhook, server-created catalog/order |
| Verification | Node test runner, Playwright browser tests, Firebase emulator tests, CI |

The original project used React, Gemini, Firebase and Stripe, with both an Express server and a separate Functions implementation. This portfolio edition deliberately consolidates those backends. It does **not** include the original Functions credit listeners or Firebase Stripe extension workflow.

### Boundaries worth reviewing

1. The API derives identity from a verified Firebase ID token, including revocation checking, then requires membership in an explicit development UID allowlist. Body fields such as `userId`, `requesterId`, `cost`, `credits` and payment status cannot authorize work.
2. Firestore and Storage rules deny direct browser access. All data access goes through owner-scoped server routes. Admin status comes from a signed custom claim, never an editable profile.
3. A transaction reserves the server-calculated cost and records a unique job before invoking an image provider. Concurrent clicks cannot spend the same balance or start the same dish twice. Completion and refund are guarded state transitions.
4. Provider failure refunds the application credit reservation once. A crash or database failure after provider success leaves an explicit reservation for operator reconciliation; it does not silently repeat a potentially billed request.
5. Stripe checkout uses a server-owned package catalog, persisted order, idempotency key, signature-verified webhook, current session retrieval, amount/currency/line-item validation, and transactional deduplication by both session and payment intent.
6. The browser never awards credits based on a redirect or writes billing fields. Real-money checkout is intentionally unsupported in this edition.

See [Architecture and failure handling](docs/ARCHITECTURE.md), [Optional integration setup](docs/LIVE_SETUP.md), and [Verification record](docs/VERIFICATION.md).

## Run the checks

```sh
npm run check                 # TypeScript, production build, unit/API tests, release scan
npx playwright install chromium
npm run test:browser          # Desktop + mobile demo journeys
npm run test:rules            # Firestore/Storage emulator checks; Java 21 required
```

The rules command uses the explicit fake project `demo-virtual-menu`. It refuses to run without emulator host variables. Provider adapters are mocked in tests; no API credentials or payment accounts are required. [GitHub Actions](https://github.com/emidio90/virtual-menu-portfolio/actions) repeats these checks, including desktop/mobile browser journeys and emulator tests, before an authorized `main` deployment. Developer-tool dependency advisories remain; see the verification record.

## Origin and contribution disclosure

This is a **history-free, AI-assisted portfolio refactor** of the repository owner's Virtual Menu prototype. The original concept, product flow, provider choices, slate/indigo visual direction, aesthetic names and resolution controls are preserved. The interface and service boundaries were substantially rewritten to make a reviewable, no-cost demo and address authorization, credit integrity, setup and testing gaps. This is not a claim that the owner independently authored every refactor or test.

The private original repository was read only. Its Git history, deployment configuration, service-account/project metadata, contact details, stock-photo URLs and legal/company copy are not included. A current-source check is not a secret-history audit or confirmation of the deployed original's security.

## Scope and limitations

- Tests demonstrate the included code paths using mocks and local emulators. The published Firebase deployment serves only the isolated static demo; live Gemini generation, Firebase app integrations and Stripe payments have not been exercised
- Generated images may misrepresent the food a restaurant actually serves. Review every output; do not use this tool to infer ingredient, allergy, nutrition or dietary-safety information
- Live parsing is limited to ten requests per authenticated user per hour and twenty dishes per request. Image jobs require an explicitly allowlisted development account, email verification and simulated/test application credits. Test Stripe payments do not cover real Gemini costs
- The server uses synchronous provider requests, not a durable worker queue. Recovery, account lifecycle, retention, privacy notices, refunds/disputes and operational abuse protections need additional work before commercial deployment
- Card deletion removes the menu record; it does not delete historical job/payment evidence or automatically erase Storage objects. See the retention notes before hosting real data
- The legacy destructive admin controls are intentionally not exposed. A claim-protected read-only jobs endpoint supports diagnosis; stale-credit recovery is an explicit operator script

## Assets and license

The bundled food illustrations are self-contained SVGs authored for this portfolio and described in [ASSETS.md](ASSETS.md). No external images, fonts or CDN scripts are required. Do not describe these fixtures as real restaurant photos or actual Gemini outputs.

**UNLICENSED.** No open-source license was verified in the source project. The owner must select a license and confirm rights before public reuse/publication. Third-party dependency licenses remain applicable. No fabricated corporate terms or privacy policy are supplied.
