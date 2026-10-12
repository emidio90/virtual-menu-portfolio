# Verification record

Prepared on 2026-10-12 with Node.js 24.19.0 and npm 11.9.0 in an isolated cloud workspace. The private original repository remains unchanged. The separate portfolio repository and isolated static demo were subsequently published; live application integrations remain disabled.

## Photographic sample update

- All nine ChatGPT-generated source images were visually reviewed, and the optimized 1024 × 1024 WebP copies were verified against their hashes, dimensions and 250 kB per-image limit
- `npm run check`: production build, strict TypeScript checking, **198 tests** and release scan passed
- `VITE_APP_MODE=live npm run build:demo`: forced-demo build and integration-isolation scan passed
- Firestore/Storage emulator suite: **8 tests passed** on the updated source
- Four desktop/mobile browser scenarios now check photographic asset loading, representative labels for custom dishes, distinct styles, and actual 1024 / 2048 / 4096 PNG export dimensions
- Local browser execution remains blocked before any application assertions by the runtime’s denied Chromium process-singleton socket. Browser assertions for this photo revision require the GitHub Actions run; a successful local browser pass is not claimed

The checks below also document the original security refactor. Dependency versions and server integration code were not changed for the photographic update.

## Passed

- Fresh, history-free source copy: `npm ci --ignore-scripts` followed by `npm run check` passed, including the production build, all 190 tests and release scan. `npm ci --ignore-scripts --dry-run` also confirmed lockfile consistency
- Strict TypeScript checking and Vite production build in default demo mode
- Separate live-mode frontend build (compilation only; no runtime service calls)
- `VITE_APP_MODE=live npm run build:demo`: explicitly overrides an operator live-mode environment to demo and scans built JavaScript for integration markers
- `npm test`: **190 tests**, zero failures, skips or cancellations
- Firebase Firestore and Storage emulator suite: **8 tests**, including default-deny client access, real transaction debit/refund races and sixteen concurrent payment deliveries with one credit increment
- Release credential-pattern scan: no matches in the included source
- `npm audit --omit=dev`: zero known vulnerabilities in the locked production dependency graph at the time checked

Tests use synthetic identities, in-memory fixtures, mocked provider responses and the explicit emulator-only project `demo-virtual-menu`. Actual Stripe SDK signature/tampering verification and Gemini SDK request/response mapping are tested against mocked network boundaries, without provider calls.

The emulator tests required a temporary writable HOME and XDG_CONFIG_HOME in this managed workspace. The complete rerun exited zero. Ordinary developer machines and the included Java 21 CI job should not need that workspace-specific adjustment.

## Browser verification boundaries

Four Playwright scenario/project combinations are included for desktop/mobile: the main demo journey, parsing, style/resolution choices, credit changes, preview/download, cancellation/deletion/reset, modal dismissal, browser navigation, offline isolation and session reset.

The local system Chromium process was unable to start because this environment denied its process-singleton socket. A supported permission retry with a temporary profile encountered the same runtime restriction. The failure occurred before any application assertions. **No local visual review, successful browser scenario or screenshot is claimed.** Do not treat a passing build as browser validation.

The baseline portfolio passed its GitHub browser suite before this photo revision. The updated photo assertions must pass again for the exact new commit. The current workflow checks unit/API tests, emulators and desktop/mobile browser journeys before deploying the forced-demo artifact to Firebase Hosting; see [CI/CD setup](STATIC_HOSTING.md).

## Dependency caveat

The complete dependency audit, including developer tooling, reports **11 advisories: 7 high and 4 moderate** in the pinned Firebase CLI's transitive graph (`braces`/`chokidar`, FTP/proxy helpers, OpenTelemetry and `uuid`). These development tools are not in the static demo's browser bundle and are excluded by production-only installation. One advisory has no patched `braces` version listed in the audit response. No unverified major-version overrides were forced into the CLI solely to hide findings.

The production graph's grpc dependency is explicitly overridden to patched `@grpc/grpc-js` 1.14.6 and was rechecked with the emulator tests. Re-audit all dependencies before use/publication, especially when invoking developer tools against untrusted inputs. Zero production audit findings is not a claim of complete security.

## Not performed

- Real Firebase Auth, Firestore or Storage project smoke tests
- Real Gemini menu parsing, image generation, quotas, models, cost or quality checks
- Real Stripe account/webhook delivery or even test-card checkout against Stripe servers
- Live application deployment, load testing, accessibility audit, credential-history scan or penetration testing. Static demo publication is separate and does not validate live services
- Legal/commercial review, customer data migration, account deletion or storage retention implementation

## Review-driven changes

The clean copy replaces client-asserted identity/roles, browser credit mutation, mutable ownership and client-writable checkout status with server-enforced authorization and transactional accounting. Additional reviews caught and fixed prototype-key/type-coercion input handling, absent UID acceptance, synchronous token errors, corrupted credit arithmetic, cross-account stale async UI completion, and ambiguous retry identity handling. The live integration additionally requires an explicit development UID allowlist; Stripe test credits are not protection against real Gemini charges.
