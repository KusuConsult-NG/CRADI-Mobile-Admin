import { test as base, expect, type Page } from '@playwright/test';

export { expect };

export const MOCK_URL = `http://127.0.0.1:${process.env.MOCK_SUPABASE_PORT || 54321}`;

/** Seeded user ids (see e2e/mock-supabase.mjs). */
export const IDS = {
    admin: '00000000-0000-4000-8000-000000000001',
    pendingConfirmed: '00000000-0000-4000-8000-000000000002',
    pendingUnconfirmed: '00000000-0000-4000-8000-000000000003',
    approved: '00000000-0000-4000-8000-000000000004',
    blocked: '00000000-0000-4000-8000-000000000005',
} as const;

const PNG_1PX =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

export const ADMIN = { email: 'admin@cradi.test', password: 'admin-pass' };

export interface LoggedRequest {
    method: string;
    path: string;
    query: string;
    prefer: string | null;
    body: unknown;
    status: number;
}

export interface MockApi {
    /** Requests the mock received (browser and Next server), optionally filtered. */
    requests(filter?: { method?: string; path?: string | RegExp }): Promise<LoggedRequest[]>;
    /** Current rows of a table. */
    table<T = Record<string, unknown>>(name: string): Promise<T[]>;
}

export interface ConsoleGuard {
    /** Tolerate console errors matching `pattern` in this test (e.g. an expected 409). */
    allow(pattern: RegExp): void;
}

async function mockFetch(path: string, init?: RequestInit): Promise<unknown> {
    const res = await fetch(`${MOCK_URL}${path}`, init);
    if (!res.ok) throw new Error(`mock ${path} → ${res.status}`);
    return res.json();
}

export const test = base.extend<{ mock: MockApi; consoleGuard: ConsoleGuard }>({
    mock: [
        async ({}, use) => {
            await mockFetch('/__mock/reset', { method: 'POST' });
            await use({
                async requests(filter) {
                    const all = (await mockFetch('/__mock/requests')) as LoggedRequest[];
                    return all.filter(
                        (r) =>
                            (!filter?.method || r.method === filter.method) &&
                            (!filter?.path ||
                                (typeof filter.path === 'string' ? r.path === filter.path : filter.path.test(r.path))),
                    );
                },
                async table<T>(name: string) {
                    return (await mockFetch(`/__mock/table/${name}`)) as T[];
                },
            });
        },
        { auto: true },
    ],

    // Fails the test on any console error, uncaught exception or CSP violation
    // that the test did not explicitly allow.
    consoleGuard: [
        async ({ page }, use) => {
            const allowed: RegExp[] = [];
            const problems: string[] = [];
            page.on('console', (msg) => {
                if (msg.type() !== 'error') return;
                const where = msg.location()?.url;
                problems.push(`console.error: ${msg.text()}${where ? ` (${where})` : ''}`);
            });
            page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
            // External image host used by a seeded report (never hit the network).
            await page.route('https://images.example/**', (route) =>
                route.fulfill({ contentType: 'image/png', body: Buffer.from(PNG_1PX, 'base64') }),
            );
            await page.addInitScript(() => {
                document.addEventListener('securitypolicyviolation', (e) => {
                    console.error(`CSP violation: ${e.violatedDirective} blocked ${e.blockedURI || '(inline)'}`);
                });
            });
            await use({ allow: (pattern) => allowed.push(pattern) });
            const unexpected = problems.filter((p) => !allowed.some((re) => re.test(p)));
            expect(unexpected, 'unexpected console errors / CSP violations').toEqual([]);
        },
        { auto: true },
    ],
});

/** Signs in through the login form and waits for `expectedPath` (default /dashboard). */
export async function login(page: Page, opts: { path?: string; expectedPath?: string } = {}) {
    await page.goto(opts.path ?? '/login');
    await page.getByLabel('Email Address').fill(ADMIN.email);
    await page.getByLabel('Password', { exact: true }).fill(ADMIN.password);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page).toHaveURL(new RegExp(`${escapeRegExp(opts.expectedPath ?? '/dashboard')}$`));
}

/** Signs in, then opens `path` (full navigation, session restored from storage). */
export async function openAsAdmin(page: Page, path: string) {
    await login(page);
    await page.goto(path);
}

export function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A toast message with this text (the newest when an identical one is still shown). */
export function toast(page: Page, text: string | RegExp) {
    return page.getByRole('status').filter({ hasText: text }).last();
}
