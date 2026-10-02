import { test as base, expect, type Page } from '@playwright/test';

export { expect };

export const MOCK_URL = `http://127.0.0.1:${process.env.MOCK_APPWRITE_PORT || 54321}`;

/**
 * Seeded user ids (see e2e/mock-appwrite.mjs).
 *
 * Appwrite ids, not UUIDs: accounts made through the `auth` Function use
 * `unique()`, which answers with a 20-character id, and only the accounts
 * carried over from Supabase still have one.
 */
export const IDS = {
    admin: 'adminaccount00000001',
    pendingConfirmed: 'pendingconfirmed0002',
    pendingUnconfirmed: 'pendingunconfirm0003',
    approved: 'approvedaccount00004',
    blocked: 'blockedaccount000005',
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

/** A payload the panel sent to the `write` Function. */
export interface WriteCall {
    op: 'create' | 'update' | 'upsert' | 'delete';
    collection: string;
    documentId: string;
    data: Record<string, unknown>;
    /** The optimistic lock, when the caller asked for one. */
    expect?: Record<string, unknown>;
}

export interface MockApi {
    /** Requests the mock received (browser and Next server), optionally filtered. */
    requests(filter?: { method?: string; path?: string | RegExp }): Promise<LoggedRequest[]>;
    /** Current rows of a table. */
    table<T = Record<string, unknown>>(name: string): Promise<T[]>;
    /**
     * Calls the panel made to the `write` Function, in order.
     *
     * Every write goes through it — the collections are closed to
     * clients — so "what did the panel try to write?" is one question
     * about one endpoint rather than a POST/PATCH/DELETE per table.
     */
    writes(filter?: { collection?: string; op?: WriteCall['op'] }): Promise<WriteCall[]>;
    /** Reads the panel made of a table, as logged requests. */
    reads(table: string): Promise<LoggedRequest[]>;
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
                async writes(filter) {
                    const all = (await mockFetch('/__mock/requests')) as LoggedRequest[];
                    return all
                        .filter((r) => r.method === 'POST' && r.path === '/functions/write/executions')
                        .map((r) => JSON.parse((r.body as { body: string }).body) as WriteCall)
                        .filter(
                            (w) =>
                                (!filter?.collection || w.collection === filter.collection) &&
                                (!filter?.op || w.op === filter.op),
                        );
                },
                async reads(table: string) {
                    const all = (await mockFetch('/__mock/requests')) as LoggedRequest[];
                    const path = `/tablesdb/cradi/tables/${table}/rows`;
                    return all.filter((r) => r.method === 'GET' && r.path === path);
                },
            });
        },
        { auto: true },
    ],

    // Fails the test on any console error, uncaught exception or CSP violation
    // that the test did not explicitly allow.
    consoleGuard: [
        async ({ page }, use) => {
            // Asking Appwrite "is anyone signed in?" is a request, and for a
            // guest it answers 401 — which the browser logs. Supabase read
            // that from localStorage and made no call, so this is new, and
            // it is the session check working rather than anything failing.
            const allowed: RegExp[] = [/status of 401 .*\/v1\/account\)/];
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
    // Wait for the "Logged in successfully" toast to clear. It is rendered in an
    // overlay above the page, so while it is up it intercepts pointer events for
    // whatever sits beneath it — which made any test that clicked near the top of
    // the screen (Logout, most often) retry until it timed out. Waiting here is
    // deterministic and costs a second; every caller gets it.
    await expect(toast(page, 'Logged in successfully')).toBeHidden({ timeout: 15_000 });
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
