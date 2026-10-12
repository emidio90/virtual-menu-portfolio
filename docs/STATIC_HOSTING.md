# Optional static Firebase Hosting demo

The default demo can be served as static files from Firebase Hosting on Spark, within its current free limits. It needs no Functions, Cloud Run, Firestore database, Storage bucket, billing account, Firebase Auth, Gemini key or Stripe account. Consult [Firebase Hosting usage and pricing](https://firebase.google.com/docs/hosting/usage-quotas-pricing) before choosing a plan; quotas and product policies can change.

This document prepares an owner-run publishing route. **No Firebase project/account changes or deployment were performed.** Publishing makes the selected demo assets accessible to its public audience. Confirm rights, license choice and the intended project/site before doing it.

## Preview before publishing

```sh
npm ci
npm run build:demo
```

`build:demo` forces the browser mode to demo even if a local `.env` was configured for integrations. It also checks generated JavaScript for key integration markers. The output is just `dist/`. Review it with a static preview server or `npm start` in default backend demo mode.

## Owner-run hosting-only deployment

After the owner has selected a Firebase project and signed in with the official CLI, they can deliberately run:

```sh
npx firebase deploy --config firebase.hosting.json --only hosting --project YOUR_DEMO_PROJECT_ID
```

Do not run this command until publication is approved. Replace the project placeholder yourself. There is no project ID, site binding, `.firebaserc`, account credential, or automatic deploy workflow in this copy.

The separate `firebase.hosting.json`:

- Includes **only Hosting** and serves `dist/`
- Runs `build:demo` before deployment
- Rewrites browser routes to `index.html`, with no Functions or Cloud Run rewrite
- Supplies restrictive security headers
- Does not deploy Firestore/Storage rules or create API infrastructure

`firebase.json` is a different file for local security-rule emulators. Do not substitute a broad `firebase deploy` command. A static host does not run the Express server; its `/api` integration endpoints are unavailable by design. Demo assets and state remain local to the browser.

## Integration mode is a different deployment

The live adapters require a server runtime, Firebase services, private image storage and Gemini access. Those are not included in the free static hosting route and may require billing-enabled services. Never bundle server secrets into `VITE_*`, add API rewrites to this static configuration, or switch the public portfolio to live mode casually. See [LIVE_SETUP.md](LIVE_SETUP.md) for the separately reviewed integration setup.
