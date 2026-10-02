import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against a production build of the admin panel, with
 * Appwrite replaced by the in-memory mock in e2e/mock-appwrite.mjs.
 *
 *   npm run test:e2e                      # builds, starts mock + app, runs tests
 *   E2E_SKIP_BUILD=1 npm run test:e2e     # reuse an existing .next build made with the same env
 *
 * NEXT_PUBLIC_* values are inlined at build time, so the build must use the
 * mock URL (the CSP's connect-src is derived from it too).
 */
const ROOT = path.resolve(__dirname, '..');
const MOCK_PORT = Number(process.env.MOCK_APPWRITE_PORT || 54321);
const APP_PORT = Number(process.env.E2E_APP_PORT || 3100);
const MOCK_URL = `http://127.0.0.1:${MOCK_PORT}`;
// Appwrite's REST base. The panel's endpoint check requires the `/v1`,
// and so does the real server.
const MOCK_ENDPOINT = `${MOCK_URL}/v1`;
const APP_URL = `http://127.0.0.1:${APP_PORT}`;

const appEnv = {
    NEXT_PUBLIC_APPWRITE_ENDPOINT: MOCK_ENDPOINT,
    NEXT_PUBLIC_APPWRITE_PROJECT_ID: 'cradi',
    NEXT_PUBLIC_APPWRITE_DATABASE_ID: 'cradi',
    APPWRITE_ENDPOINT: MOCK_ENDPOINT,
    APPWRITE_API_KEY: 'test',
    NEXT_TELEMETRY_DISABLED: '1',
};

const start = `npx next start -p ${APP_PORT} -H 127.0.0.1`;

export default defineConfig({
    testDir: __dirname,
    testMatch: /.*\.spec\.ts$/,
    // One shared in-memory mock: run serially and reset it before each test.
    fullyParallel: false,
    workers: 1,
    forbidOnly: !!process.env.CI,
    retries: 0,
    timeout: 60_000,
    expect: { timeout: 10_000 },
    reporter: [['list']],
    outputDir: path.join(ROOT, 'test-results'),
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
                // Use a specific Chromium binary when the one matching this
                // @playwright/test version is not installed.
                launchOptions: process.env.PW_CHROMIUM_EXECUTABLE
                    ? { executablePath: process.env.PW_CHROMIUM_EXECUTABLE }
                    : {},
            },
        },
    ],
    webServer: [
        {
            command: 'node e2e/mock-appwrite.mjs',
            cwd: ROOT,
            url: `${MOCK_URL}/__mock/health`,
            env: { MOCK_APPWRITE_PORT: String(MOCK_PORT) },
            reuseExistingServer: false,
            stdout: 'ignore',
            stderr: 'pipe',
        },
        {
            command: process.env.E2E_SKIP_BUILD ? start : `npm run build && ${start}`,
            cwd: ROOT,
            url: `${APP_URL}/api/health`,
            env: appEnv,
            timeout: 300_000,
            reuseExistingServer: false,
            stdout: 'ignore',
            stderr: 'pipe',
        },
    ],
});
