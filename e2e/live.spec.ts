import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect, type Page } from '@playwright/test';

/**
 * The admin panel driven in a browser against a **real Appwrite**.
 *
 * `mock-appwrite.mjs` answers the shape of Appwrite and deliberately
 * implements neither document permissions nor the `write` Function's
 * authorisation. Everything that lives in that gap — a label that decides
 * whether a list has rows, a Function guard, a session cookie crossing
 * two origins — is unverified until something drives the real thing.
 * This does.
 *
 * Run it with `e2e/live.config.ts` after `e2e/live-seed.mjs`; see that
 * config's header for the whole sequence.
 */

interface Seed {
    endpoint: string;
    project: string;
    database: string;
    stamp: string;
    admin: { id: string; email: string; password: string };
    pending: { id: string; email: string };
    reportId: string;
    verifiedId: string;
}

const SETUP = 'Run `npm run test:e2e:live:seed` with the stack\'s .env.local sourced first.';

function readSeed(): Seed {
    try {
        return JSON.parse(readFileSync(resolve(__dirname, '.live.json'), 'utf8')) as Seed;
    } catch {
        throw new Error(`e2e/.live.json is missing or unreadable. ${SETUP}`);
    }
}

const seed = readSeed();
const API_KEY = (process.env.APPWRITE_API_KEY || '').trim();
if (!API_KEY) throw new Error(`APPWRITE_API_KEY is not set. ${SETUP}`);

/** Reads the server directly, with the API key, to check what the panel wrote. */
async function server(path: string, init: RequestInit = {}) {
    const res = await fetch(`${seed.endpoint}${path}`, {
        ...init,
        headers: {
            'content-type': 'application/json',
            'x-appwrite-project': seed.project,
            'x-appwrite-key': API_KEY,
            ...(init.headers ?? {}),
        },
    });
    const text = await res.text();
    let body: unknown = null;
    if (text) { try { body = JSON.parse(text); } catch { body = { message: text }; } }
    return { status: res.status, ok: res.ok, body: body as Record<string, unknown> };
}

const rowPath = (table: string, id = '') =>
    `/tablesdb/${seed.database}/tables/${table}/rows${id ? `/${encodeURIComponent(id)}` : ''}`;

async function rowOf(table: string, id: string) {
    const r = await server(rowPath(table, id));
    expect(r.ok, `read ${table}/${id}: ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`).toBe(true);
    return r.body;
}

async function labelsOf(userId: string): Promise<string[]> {
    const r = await server(`/users/${encodeURIComponent(userId)}`);
    expect(r.ok).toBe(true);
    return (r.body.labels as string[]) ?? [];
}

/**
 * A session secret for the seeded admin, for calls made as they would be.
 *
 * Read out of the `Set-Cookie` header rather than the response body: once
 * a project has a web platform registered, Appwrite answers
 * `/account/sessions/email` with `secret: ""` and puts the real one in
 * the cookie. Trusting the body gave an empty header and a guest.
 */
let adminSession: string | null = null;
async function asAdmin(): Promise<Record<string, string>> {
    if (!adminSession) {
        const r = await fetch(`${seed.endpoint}/account/sessions/email`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-appwrite-project': seed.project },
            body: JSON.stringify({ email: seed.admin.email, password: seed.admin.password }),
        });
        const body = (await r.json()) as { secret?: string };
        expect(r.ok, `admin sign-in: ${r.status} ${JSON.stringify(body).slice(0, 160)}`).toBe(true);
        const cookies = typeof r.headers.getSetCookie === 'function'
            ? r.headers.getSetCookie()
            : [r.headers.get('set-cookie') ?? ''];
        const fromCookie = cookies
            .map((c) => /^a_session_[A-Za-z0-9]+=([^;]+)/.exec(c)?.[1])
            .find((v): v is string => !!v);
        adminSession = body.secret || (fromCookie ? decodeURIComponent(fromCookie) : '');
        expect(adminSession, 'no session secret in the body or the cookies').not.toBe('');
    }
    return {
        'content-type': 'application/json',
        'x-appwrite-project': seed.project,
        'x-appwrite-session': adminSession,
    };
}

/** How many rows of `table` this admin may read — not how many exist. */
async function visibleTotal(table: string): Promise<number> {
    const query = encodeURIComponent(JSON.stringify({ method: 'limit', values: [1] }));
    const r = await fetch(`${seed.endpoint}${rowPath(table)}?queries[]=${query}`, { headers: await asAdmin() });
    const body = (await r.json()) as { total?: number };
    expect(r.ok, `read ${table} as the admin: ${r.status}`).toBe(true);
    return body.total ?? 0;
}

function toast(page: Page, text: string | RegExp) {
    return page.getByRole('status').filter({ hasText: text }).last();
}

async function login(page: Page) {
    await page.goto('/login');
    await page.getByLabel('Email Address').fill(seed.admin.email);
    await page.getByLabel('Password', { exact: true }).fill(seed.admin.password);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(toast(page, 'Logged in successfully')).toBeHidden({ timeout: 20_000 });
}

async function openAsAdmin(page: Page, path: string) {
    await login(page);
    await page.goto(path);
}

const reportCard = (page: Page, description: string) =>
    page.locator('div.bg-white.rounded-xl').filter({ has: page.locator('h3'), hasText: description });

test.describe('the panel against a live Appwrite', () => {
    test('signs in with a real session and the dashboard counts load', async ({ page }) => {
        // Appwrite is on another origin (appwrite.local) from the panel
        // (localhost), so the session cookie is cross-site — which is also
        // true in production, where the panel and Cloud are two domains.
        // Whether the SDK's session survives that was unverified until
        // here; the Flutter client's cookie jar does not (see
        // CRADI-mobile/infra/appwrite/local/README.md).
        await login(page);
        await expect(page.getByText('Total Users', { exact: true })).toBeVisible();

        // A count rendered as a number is a read that was permitted. The
        // failure this catches is not an error — Appwrite answers a read
        // you may not make with 200 and zero rows — so "0" would look
        // exactly like an empty database.
        //
        // Compared against what *this admin* may read, not against every
        // row the API key can see: `profiles` carries per-row permissions,
        // and rows written straight at the collection by other test
        // scripts never granted the admin label, so the two numbers
        // legitimately differ.
        const visible = await visibleTotal('profiles');
        expect(visible).toBeGreaterThan(0);
        const card = page
            .locator('a,div')
            .filter({ has: page.getByText('Total Users', { exact: true }) })
            .last();
        await expect(card).not.toContainText('—');
        await expect(card).toContainText(String(visible));
    });

    test('the session is carried by the SDK fallback, not by a cookie', async ({ page, context }) => {
        // Appwrite and the panel are different sites, so the session
        // cookie is third-party and the browser drops it. The Web SDK
        // falls back to `localStorage.cookieFallback` plus an
        // `X-Fallback-Cookies` header, and that is what actually carries
        // every authenticated call. Asserted because it is load-bearing
        // and invisible: if an SDK upgrade changed it, every page would
        // go quietly empty rather than fail.
        //
        // It also decides the threat model. The session is readable by
        // any script on this origin, where an HttpOnly cookie would not
        // be — which is why `lib/csp.ts` allows no inline script.
        const authed: string[] = [];
        page.on('request', (r) => {
            if (!r.url().startsWith(seed.endpoint)) return;
            if (r.headers()['x-fallback-cookies']) authed.push(new URL(r.url()).pathname);
        });
        await login(page);
        await page.waitForLoadState('networkidle');

        expect(authed.length, 'requests carrying the fallback session').toBeGreaterThan(0);
        expect(await context.cookies()).toEqual([]);
        const stored = await page.evaluate(() => localStorage.getItem('cookieFallback'));
        expect(stored, 'the SDK stores the session here').toMatch(/a_session_/);

        // And it survives a reload, which is the whole point of storing it.
        await page.reload();
        await expect(page.getByText('Total Users', { exact: true })).toBeVisible();
    });

    test('reads reports, which only the admin label grants', async ({ page }) => {
        await openAsAdmin(page, '/dashboard/reports');
        await expect(page.getByRole('heading', { name: 'Report Management' })).toBeVisible();
        await expect(reportCard(page, `Live panel report ${seed.stamp}`)).toBeVisible();
    });

    test('approves a report through the write Function', async ({ page }) => {
        await openAsAdmin(page, '/dashboard/reports');
        const card = reportCard(page, `Live panel report ${seed.stamp}`);
        await card.getByRole('button', { name: 'Approve' }).click();
        await expect(toast(page, 'Report marked as approved')).toBeVisible();

        const row = await rowOf('reports', seed.reportId);
        expect(row.status).toBe('approved');
        expect(row.updatedBy).toBe(seed.admin.id);
        expect(typeof row.approvedAt).toBe('string');
        // Stamped by the Function, not sent by the panel: proof the write
        // went through it rather than straight at the collection.
        expect(row.previousStatus).toBe('pending');
    });

    test('a decision made elsewhere is refused by the optimistic lock', async ({ page }) => {
        await openAsAdmin(page, '/dashboard/reports');
        const card = reportCard(page, `Live panel report ${seed.stamp}`);
        await expect(card.getByText('Approved', { exact: true })).toBeVisible();

        // Another admin rejects it after this page loaded.
        const patched = await server(rowPath('reports', seed.reportId), {
            method: 'PATCH',
            body: JSON.stringify({ data: { status: 'rejected' } }),
        });
        expect(patched.ok).toBe(true);

        await card.getByRole('button', { name: 'Mark Verified' }).click();
        await expect(toast(page, 'This report changed since you loaded it — reloading')).toBeVisible();
        // The other admin's decision stands.
        expect((await rowOf('reports', seed.reportId)).status).toBe('rejected');
    });

    test('reopening runs the operation Function and clears the decision', async ({ page }) => {
        await openAsAdmin(page, '/dashboard/reports');
        const card = reportCard(page, `Live verified report ${seed.stamp}`);
        await card.getByRole('button', { name: 'Reset to Pending' }).click();
        await page
            .getByRole('dialog', { name: 'Reset to Pending' })
            .getByRole('button', { name: 'Reset to Pending' })
            .click();
        await expect(toast(page, 'Report marked as pending')).toBeVisible();

        const row = await rowOf('reports', seed.verifiedId);
        expect(row.status).toBe('pending');
        expect(row.verificationCount).toBe(0);
        expect(row.verifiedAt).toBe(null);
        // The reopen reschedules escalation; nothing else does.
        expect(row.escalationStatus).toBe('pending');
    });

    test('saves app settings into a string column', async ({ page }) => {
        await openAsAdmin(page, '/dashboard/settings');
        await expect(page.getByRole('heading', { name: 'App Settings' })).toBeVisible();
        // A value that differs from whatever is stored, so there is always
        // something to save (this suite runs against a server that keeps
        // what the last run wrote).
        const field = page.getByLabel('Escalation timeout');
        const next = (await field.inputValue()) === '47' ? '53' : '47';
        await field.fill(next);
        await page.getByRole('button', { name: /^Save/ }).click();
        await expect(toast(page, /^Saved \d+ setting/)).toBeVisible();

        const row = await rowOf('app_settings', 'escalation_timeout_minutes');
        // A string, because the column is one. Sending the number 47 is
        // refused with `Invalid document structure`.
        expect(row.value).toBe(next);
    });

    test('creates an authority, and the Function refuses one with no state', async ({ page }) => {
        await openAsAdmin(page, '/dashboard/authorities');
        await expect(page.getByRole('heading', { name: 'Authorities', exact: true })).toBeVisible();

        const name = `Live Desk ${seed.stamp}`;
        // Stamped, because a duplicate number for the same (state, LGA) is
        // refused — correctly — and a fixed one only works on the first run.
        // 11 digits, as a Nigerian mobile number is: 0 + 10.
        const phone = `080${String(Date.now()).slice(-8)}`;
        await page.getByRole('button', { name: 'Add Authority' }).click();
        const dialog = page.getByRole('dialog', { name: 'Add Authority' });
        await dialog.getByLabel('Name').fill(name);
        await dialog.getByLabel('Phone').fill(phone);
        await dialog.getByLabel('Coverage LGA').selectOption('Nasarawa|Obi');
        await dialog.getByRole('button', { name: 'Add Authority' }).click();
        await expect(toast(page, 'Authority added')).toBeVisible();

        const found = await server(
            `${rowPath('authorities')}?queries[]=${encodeURIComponent(JSON.stringify({ method: 'equal', attribute: 'name', values: [name] }))}`,
        );
        const rows = found.body.rows as Record<string, unknown>[];
        expect(rows).toHaveLength(1);
        expect(rows[0].phone).toBe(`+234${phone.slice(1)}`);
        expect(rows[0].coverageState).toBe('Nasarawa');
        expect(rows[0].coverageLga).toBe('Obi');
    });

    test('the write Function refuses a coverage LGA with no state, whatever the form does', async () => {
        // The panel's form will not submit one. This asks the Function
        // directly, signed in as the same admin — what a tampered page
        // would send. Postgres refused this with a CHECK constraint;
        // Appwrite has none, so the Function is the whole defence, and
        // an LGA with no state means an SMS contact for the wrong Obi.
        const documentId = `tampered-${Date.now()}`.slice(0, 36);
        const res = await fetch(`${seed.endpoint}/functions/client/executions`, {
            method: 'POST',
            headers: await asAdmin(),
            body: JSON.stringify({
                body: JSON.stringify({
                    op: 'create',
                    collection: 'authorities',
                    documentId,
                    data: { name: 'Tampered', phone: `+23480${String(Date.now()).slice(-8)}`, coverageLga: 'Obi' },
                }),
                path: '/write',
                async: false,
                method: 'POST',
            }),
        });
        const execution = (await res.json()) as {
            status: string;
            responseStatusCode: number;
            responseBody: string;
            errors?: string;
        };
        expect(res.status, JSON.stringify(execution).slice(0, 300)).toBe(201);
        expect(execution.status, execution.errors).toBe('completed');
        expect(execution.responseStatusCode).toBe(400);
        expect(execution.responseBody).toMatch(/must name its state/);

        // And nothing was written.
        expect((await server(rowPath('authorities', documentId))).status).toBe(404);
    });

    test('approving a user also gives their account the labels their role grants', async ({ page }) => {
        expect(await labelsOf(seed.pending.id)).toEqual([]);

        await openAsAdmin(page, '/dashboard/users');
        await expect(page.getByRole('heading', { name: 'User Management' })).toBeVisible();
        const row = page.getByRole('row').filter({ hasText: 'Live Pending' });
        await row.getByRole('button', { name: /^Approve/ }).click();
        const dialog = page.getByRole('dialog', { name: 'Approve User' });
        await dialog.getByRole('button', { name: 'Approve', exact: true }).click();
        await expect(toast(page, /approved/i)).toBeVisible();

        expect((await rowOf('profiles', seed.pending.id)).isApproved).toBe(true);
        // The half that decides what they can actually read. Approving
        // without it left an EWM who could see nothing, with no error.
        expect(await labelsOf(seed.pending.id)).toEqual(['ewm', 'approved']);
    });

    test('publishes an alert and deactivates it', async ({ page }) => {
        await openAsAdmin(page, '/dashboard/alerts');
        await expect(page.getByRole('heading', { name: 'Community Alerts' })).toBeVisible();
        const title = `Live alert ${seed.stamp}`;
        await page.getByRole('button', { name: 'New Alert' }).click();
        const dialog = page.getByRole('dialog', { name: 'New Alert' });
        await dialog.getByLabel('Title').fill(title);
        await dialog.getByLabel('Message').fill('Issued by the live panel check.');
        await dialog.getByLabel('Target state').selectOption('Benue');
        await dialog.getByLabel('Target LGA').selectOption('Makurdi');
        await dialog.getByRole('button', { name: 'Publish Alert' }).click();
        await expect(toast(page, 'Alert published')).toBeVisible();

        const found = await server(
            `${rowPath('alerts')}?queries[]=${encodeURIComponent(JSON.stringify({ method: 'equal', attribute: 'title', values: [title] }))}`,
        );
        const rows = found.body.rows as Record<string, unknown>[];
        expect(rows).toHaveLength(1);
        expect(rows[0].targetState).toBe('Benue');
        expect(rows[0].targetLga).toBe('Makurdi');
        expect(rows[0].createdBy).toBe(seed.admin.id);
        expect(rows[0].isActive).toBe(true);
    });

    test('writes a knowledge article and a news link', async ({ page }) => {
        const title = `Live article ${seed.stamp}`;
        await openAsAdmin(page, '/dashboard/knowledge');
        await page.getByRole('button', { name: /^(New Article|Add Article)/ }).click();
        const article = page.getByRole('dialog');
        await article.getByLabel('Title').fill(title);
        await article.getByLabel('Content').fill('What to do when the river rises.');
        await article.getByRole('button', { name: /^(Create|Save)/ }).click();
        await expect(toast(page, /saved|created|added/i)).toBeVisible();

        const kb = await server(
            `${rowPath('knowledge_base')}?queries[]=${encodeURIComponent(JSON.stringify({ method: 'equal', attribute: 'title', values: [title] }))}`,
        );
        expect((kb.body.rows as unknown[]).length).toBe(1);

        const linkTitle = `Live link ${seed.stamp}`;
        await page.goto('/dashboard/news');
        await page.getByRole('button', { name: /^(New Link|Add Link)/ }).click();
        const link = page.getByRole('dialog');
        await link.getByLabel('Title').fill(linkTitle);
        await link.getByLabel('URL').fill('https://nimet.gov.ng/');
        await link.getByRole('button', { name: /^(Create|Save|Add)/ }).click();
        await expect(toast(page, /saved|created|added/i)).toBeVisible();

        const news = await server(
            `${rowPath('news_links')}?queries[]=${encodeURIComponent(JSON.stringify({ method: 'equal', attribute: 'title', values: [linkTitle] }))}`,
        );
        const rows = news.body.rows as Record<string, unknown>[];
        expect(rows).toHaveLength(1);
        // `source` is optional in the schema; the mock wrongly required it.
        expect(rows[0].source).toBe('');
    });
});
