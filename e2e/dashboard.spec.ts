import { test, expect, login, COORDINATOR } from './fixtures';

test('dashboard shows exact counts from HEAD count requests', async ({ page, mock }) => {
    await login(page);
    const expected: Record<string, string> = {
        'Total Users': '6',
        'Total Reports': '11',
        'Pending Reports': '8',
        'Approved / Verified Reports': '2',
        'Emergency Contacts': '3',
        'Knowledge Articles': '2',
        'Active Alerts': '1',
    };
    for (const [label, value] of Object.entries(expected)) {
        await expect(
            page.getByText(label, { exact: true }).locator('xpath=preceding-sibling::h3'),
            label,
        ).toHaveText(value);
    }

    // Appwrite has no HEAD count: a list reports the total for its query
    // whatever the page size, so each card asks for one row and reads it.
    const counts = (await mock.requests({ method: 'GET' })).filter((r) =>
        decodeURIComponent(r.query).includes('"method":"limit","values":[1]'),
    );
    // The stat cards issue exactly these seven; the operations panel below them
    // issues more, so assert on the cards' own queries rather than a page total.
    expect(counts.length).toBeGreaterThanOrEqual(7);
    const asked = counts.map((r) => `${r.path}?${decodeURIComponent(r.query)}`);
    const reports = '/tablesdb/cradi/tables/reports/rows';
    const alerts = '/tablesdb/cradi/tables/alerts/rows';
    expect(asked).toEqual(
        expect.arrayContaining([
            `${reports}?queries[0]={"method":"equal","attribute":"status","values":["pending"]}&queries[1]={"method":"limit","values":[1]}`,
            `${reports}?queries[0]={"method":"equal","attribute":"status","values":["approved","verified"]}&queries[1]={"method":"limit","values":[1]}`,
            `${alerts}?queries[0]={"method":"equal","attribute":"isActive","values":[true]}&queries[1]={"method":"limit","values":[1]}`,
        ]),
    );
});

test('every dashboard page renders without console errors or CSP violations', async ({ page }) => {
    await login(page);
    const pages: [string, string][] = [
        ['Users', 'User Management'],
        ['Reports', 'Report Management'],
        ['Knowledge', 'Knowledge Base'],
        ['News', 'News Links'],
        ['Alerts', 'Community Alerts'],
        ['Authorities', 'Authorities'],
        ['Settings', 'App Settings'],
        ['Dashboard', 'Welcome back, Grace Admin!'],
    ];
    const nav = page.getByRole('navigation', { name: 'Main' });
    for (const [link, heading] of pages) {
        await nav.getByRole('link', { name: link, exact: true }).click();
        await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
        await expect(nav.getByRole('link', { name: link, exact: true })).toHaveAttribute('aria-current', 'page');
    }
    // Full reloads restore the session from storage on every page.
    for (const path of ['/dashboard/users', '/dashboard/reports', '/dashboard/settings']) {
        await page.goto(path);
        await expect(page).toHaveURL(new RegExp(`${path}$`));
        await expect(page.getByRole('button', { name: 'Logout' })).toBeVisible();
        // Let the page finish loading so leaving it does not abort requests mid-flight.
        await page.waitForLoadState('networkidle');
    }
});

// Every stat card advertised a click with `hover:shadow-md` but was a plain
// <div>, so the whole grid looked interactive and did nothing. The cards that
// have somewhere to go are links now; the one that does not (Emergency
// Contacts counts public.contacts, which has no admin screen) must not offer
// the hover lift either.
test('stat cards with a destination navigate there', async ({ page }) => {
    const cards: [string, string][] = [
        ['Total Users', '/dashboard/users'],
        ['Total Reports', '/dashboard/reports'],
        ['Pending Reports', '/dashboard/reports?status=pending'],
        ['Approved / Verified Reports', '/dashboard/reports?status=approved'],
        ['Knowledge Articles', '/dashboard/knowledge'],
        ['Active Alerts', '/dashboard/alerts'],
    ];
    await login(page);
    for (const [label, href] of cards) {
        await page.goto('/dashboard');
        await page.getByText(label, { exact: true }).click();
        await expect(page, label).toHaveURL(new RegExp(`${href.replace('?', '\\?')}$`));
        // Let the destination finish loading before the next hard navigation.
        // page.goto() tears the document down mid-request, which aborts any
        // in-flight fetch before React can run its cleanup — the page logs that
        // as an error, and it is an artifact of the hard nav, not something a
        // user clicking through the app would ever hit.
        await page.waitForLoadState('networkidle');
    }
});

test('a stat card with no destination is not dressed as a link', async ({ page }) => {
    await login(page);
    const card = page
        .getByText('Emergency Contacts', { exact: true })
        .locator('xpath=ancestor::*[contains(@class,"rounded-xl")][1]');
    await expect(card).toHaveCount(1);
    // Not a link, and no hover lift promising one.
    expect(await card.evaluate((el) => el.tagName)).toBe('DIV');
    expect(await card.getAttribute('class')).not.toContain('hover:shadow-md');
});

test('the reports page honours ?status= and ignores a bogus one', async ({ page }) => {
    await login(page);
    await page.goto('/dashboard/reports?status=approved');
    await expect(page.getByLabel('Filter reports by status')).toHaveValue('approved');

    await page.goto('/dashboard/reports?status=not-a-status');
    await expect(page.getByLabel('Filter reports by status')).toHaveValue('all');
});

test.describe('dashboard tiers', () => {
    // Matrix 4.1 puts four roles in this panel at three levels. It had
    // one: `role === 'admin'` was the whole sign-in test, so the other
    // three could not get in at all — and every account that did get in
    // saw all eight nav links and the subtitle "Administrator".

    test('an administrator keeps the whole panel', async ({ page }) => {
        await login(page);
        const nav = page.getByRole('navigation', { name: 'Main' });
        for (const label of ['Dashboard', 'Users', 'Reports', 'Knowledge', 'News',
            'Alerts', 'Authorities', 'Settings']) {
            await expect(nav.getByRole('link', { name: label, exact: true })).toBeVisible();
        }
        await expect(page.getByRole('banner').getByText('Admin', { exact: true })).toBeVisible();
    });

    test('a coordinator gets in, without user administration or settings', async ({ page }) => {
        await login(page, { as: COORDINATOR });
        const nav = page.getByRole('navigation', { name: 'Main' });
        for (const label of ['Dashboard', 'Reports', 'Knowledge', 'News', 'Alerts', 'Authorities']) {
            await expect(nav.getByRole('link', { name: label, exact: true })).toBeVisible();
        }
        // The two the server refuses anyway: `requireAdmin` guards the user
        // routes, and `app_settings` is `label:admin` in the Appwrite plan.
        // Offering them would be offering a 403.
        for (const label of ['Users', 'Settings']) {
            await expect(nav.getByRole('link', { name: label, exact: true })).toHaveCount(0);
        }
        // And it says what the account actually is.
        await expect(
            page.getByRole('banner').getByText('LDP Coordinator', { exact: true }),
        ).toBeVisible();

        // No Total Users tile. The `profiles` read is scoped by document
        // permissions to the owner plus admin and tech support, so for a
        // coordinator it does not fail — it returns 1, their own row — and
        // the tile would report that as the number of users in the system.
        await expect(page.getByText('Total Users', { exact: true })).toHaveCount(0);
        // The counts it can compute are still there: these tables are
        // `read("any")`, so the numbers are the same for every role.
        await expect(page.getByText('Knowledge Articles', { exact: true })).toBeVisible();
        await expect(page.getByText('Active Alerts', { exact: true })).toBeVisible();
    });

    test('a section the role lacks is refused, not merely unlinked', async ({ page }) => {
        // Typed in directly, or a bookmark from a role that had it. Without
        // the guard the page renders and fires privileged requests that all
        // answer 403, which is a screen of failures rather than an answer.
        await login(page, { as: COORDINATOR });
        await page.goto('/dashboard/users');
        await expect(page.getByRole('heading', { name: 'Not available for your role' })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'User Management' })).toHaveCount(0);
        await page.getByRole('link', { name: 'Back to the dashboard' }).click();
        await expect(page).toHaveURL(/\/dashboard$/);
    });

    test('a role with no panel access cannot sign in at all', async ({ page, consoleGuard }) => {
        // Bola is an approved EW Verifier: a real account with a real
        // session, and nothing in this panel to do. An empty dashboard is
        // a worse answer than being told.
        consoleGuard.allow(/status of 401 .*\/account\/sessions\/email/);
        // Signed in by hand rather than through `login`, which asserts it
        // reached the dashboard. Wrapping that in a `catch` would make the
        // test pass whenever anything at all went wrong.
        await page.goto('/login');
        await page.getByLabel('Email Address').fill('bola@cradi.test');
        await page.getByLabel('Password', { exact: true }).fill('bola-pass');
        await page.getByRole('button', { name: 'Sign In' }).click();
        await expect(
            page.getByText('Access denied. This account does not have access to the admin panel.'),
        ).toBeVisible();
        await expect(page).toHaveURL(/\/login$/);
    });
});
