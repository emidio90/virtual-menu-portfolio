# Static Firebase Hosting demo

The isolated demo is published at https://virtual-menu-portfolio.web.app using Firebase Hosting on Spark. The project is `virtual-menu-portfolio`; billing is not enabled. Hosting has usage limits, and repeated deployments retain release files. Consult [Firebase Hosting usage and pricing](https://firebase.google.com/docs/hosting/usage-quotas-pricing).

This hosting route uses no Functions, Cloud Run, Firestore database, Cloud Storage bucket, Firebase Auth, Gemini key or Stripe account. The public demo is static: provider integrations are unavailable, and its simulated state stays in the browser.

## Automatic deployment

The `Verify and deploy portfolio` GitHub Actions workflow:

1. Runs TypeScript/build, unit/API tests, release scan, Playwright desktop/mobile tests and Firestore/Storage emulator tests on pushes and pull requests.
2. Deploys only a push to `main` in `emidio90/virtual-menu-portfolio`, after both test jobs succeed. Pull requests never receive a deployment credential.
3. Skips an older commit when a newer `main` commit already exists, and serializes publishing.
4. Runs `build:demo` through the Hosting predeploy hook, forcing `VITE_APP_MODE=demo` and checking the generated bundle for integration code.
5. Deploys only `dist` through `firebase.hosting.json` with the project and `--only hosting` explicitly selected, then compares the public HTML with the local build.

Authentication uses Google Workload Identity Federation and short-lived credentials. A dedicated service account has the Firebase Hosting Admin role only on this project. Trust is restricted to this repository's immutable repository/owner IDs, the `main` branch, a push event, and `.github/workflows/ci.yml`. No permanent service-account key or Firebase refresh token is stored in GitHub. The IAM, STS and IAM Credentials APIs support this identity link; they do not enable live app integrations or billing.

GitHub Actions runs in a private repository consume the account's included minutes and storage. Keep account spending controls appropriate; the workflow does not change them or enable paid overages. Failed tests or authentication prevent publication. Firebase continues serving the existing release while new files are uploaded.

## Local preview

```sh
npm ci
npm run build:demo
```

`build:demo` forces demo mode even if a local `.env` is configured for integrations. The output is just `dist/`. Review it with a static preview server or `npm start` in default backend demo mode.

## Explicit manual deployment

After signing in with the official Firebase CLI, an authorized owner can deliberately run the locked local CLI:

```sh
npx --no-install firebase deploy --config firebase.hosting.json --only hosting --project virtual-menu-portfolio
```

Use this only for an approved publication. The isolated `firebase.hosting.json`:

- Includes only Hosting and serves `dist`
- Runs `build:demo` before deployment
- Rewrites browser routes to `index.html`, with no Functions or Cloud Run rewrites
- Supplies restrictive security headers
- Does not deploy Firestore/Storage rules

`firebase.json` is the separate configuration for local security-rule emulators. Do not substitute a broad `firebase deploy` command. A static host does not run the Express server.

## Integration mode is a different deployment

The live adapters require a server runtime, Firebase services, private image storage and Gemini access. Those are not included here and may require billing-enabled services. Never bundle secrets into `VITE_*`, add API rewrites to the static configuration, or switch the public portfolio to live mode without a separate review. See [LIVE_SETUP.md](LIVE_SETUP.md).
