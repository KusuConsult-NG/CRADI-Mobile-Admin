import path from 'node:path';
import base from './playwright.config';

/**
 * SCREENSHOT RUN ONLY — same app + in-memory mock as the e2e suite, but it
 * runs `highlights.screens.ts` instead of the specs and keeps what it takes.
 *
 *   npx playwright test -c e2e/highlights.config.ts
 *   E2E_SKIP_BUILD=1 npx playwright test -c e2e/highlights.config.ts
 *
 * Output: e2e/highlights/NN-<screen>.png
 */
const config = {
    ...base,
    testMatch: /highlights\.screens\.ts$/,
    outputDir: path.resolve(__dirname, '..', 'test-results-highlights'),
    use: { ...base.use, screenshot: 'off' as const },
    // Project-level `use` wins over the top-level one, so the wider viewport
    // has to be set on the project itself.
    projects: (base.projects ?? []).map((p) => ({
        ...p,
        use: { ...p.use, viewport: { width: 1440, height: 1000 } },
    })),
};

export default config;
