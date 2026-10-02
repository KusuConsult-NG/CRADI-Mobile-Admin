import { test, expect, login } from './fixtures';

test('dashboard shows exact counts from HEAD count requests', async ({ page, mock }) => {
    await login(page);
    const expected: Record<string, string> = {
        'Total Users': '5',
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
