import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/**
 * The admin panel against a **real Appwrite**, not `mock-appwrite.mjs`.
 *
 *   # in CRADI-mobile: ./infra/appwrite/local/up.sh && bootstrap && provision && deploy
 *   source ../CRADI-mobile/infra/appwrite/local/.env.local
 *   node e2e/live-seed.mjs
 *   npm run build            # with the live NEXT_PUBLIC_* values
 *   npx playwright test -c e2e/live.config.ts
 *
 * The mock answers the shape of Appwrite; this answers Appwrite. The
 * difference is everything the mock deliberately does not implement —
 * document permissions, the `write` Function's authorisation, real
 * session cookies across two origins — which is where the bugs it cannot
 * see live.
 *
 * It assumes the app is already built and served (the panel's build
 * inlines NEXT_PUBLIC_*, so it must be built against the same endpoint).
 */
const ROOT = path.resolve(__dirname, '..');
const APP_PORT = Number(process.env.E2E_APP_PORT || 3100);
const APP_URL = `http://localhost:${APP_PORT}`;

export default defineConfig({
    testDir: __dirname,
    testMatch: /live\.spec\.ts$/,
    fullyParallel: false,
    workers: 1,
    forbidOnly: !!process.env.CI,
    retries: 0,
    timeout: 90_000,
    expect: { timeout: 15_000 },
    reporter: [['list']],
    outputDir: path.join(ROOT, 'test-results-live'),
    use: {
        baseURL: APP_URL,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },
    projects: [
        {
            name: 'chromium',
            use: {
                ...devices['Desktop Chrome'],
                launchOptions: process.env.PW_CHROMIUM_EXECUTABLE
                    ? { executablePath: process.env.PW_CHROMIUM_EXECUTABLE }
                    : {},
            },
        },
    ],
});
