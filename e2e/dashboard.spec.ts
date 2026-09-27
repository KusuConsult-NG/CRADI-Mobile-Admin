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

    const heads = await mock.requests({ method: 'HEAD' });
    expect(heads).toHaveLength(7);
    for (const r of heads) expect(r.prefer).toContain('count=exact');
    expect(heads.map((r) => `${r.path}?${decodeURIComponent(r.query)}`)).toEqual(
        expect.arrayContaining([
            '/rest/v1/reports?select=*&status=eq.pending',
            '/rest/v1/reports?select=*&status=in.(approved,verified)',
            '/rest/v1/alerts?select=*&is_active=eq.true',
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
