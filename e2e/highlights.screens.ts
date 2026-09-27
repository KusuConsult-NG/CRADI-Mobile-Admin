/**
 * SCREENSHOT RUN ONLY — walks the admin panel signed in as the seeded admin
 * and writes one PNG per screen to e2e/highlights/.
 *
 *   npx playwright test -c e2e/highlights.config.ts
 *
 * It uses the same in-memory mock as the e2e suite (e2e/mock-supabase.mjs);
 * no real Supabase project is ever contacted. It is not part of
 * `npm run test:e2e` — that config only matches `*.spec.ts`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, login } from './fixtures';
import type { Page } from '@playwright/test';

const OUT = path.resolve(__dirname, 'highlights');

test.beforeAll(() => {
    fs.rmSync(OUT, { recursive: true, force: true });
    fs.mkdirSync(OUT, { recursive: true });
});

/** Waits for any react-hot-toast notice to expire, so it never covers the UI. */
async function toastsGone(page: Page) {
    await page
        .getByRole('status')
        .last()
        .waitFor({ state: 'hidden', timeout: 8000 })
        .catch(() => {});
}

/** Full-page shot, with animations and the toast layer settled first. */
async function shot(page: Page, name: string, { fullPage = true, toasts = false } = {}) {
    if (!toasts) await toastsGone(page);
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage });
}

test('admin panel screens', async ({ page }) => {
    test.setTimeout(180_000);

    // The seeded report photos point at an external host that is never
    // contacted. The shared fixture answers it with a 1x1 pixel, which
    // stretches into a blank white box and reads as a broken thumbnail in a
    // screenshot, so serve a visible stand-in instead. Registered after the
    // fixture's route, which makes it win.
    const placeholder = (route: import('@playwright/test').Route) =>
        route.fulfill({
            contentType: 'image/svg+xml',
            body:
                '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="180">' +
                '<rect width="240" height="180" fill="#cbd5e1"/>' +
                '<text x="120" y="96" font-family="sans-serif" font-size="16" fill="#475569" ' +
                'text-anchor="middle">report photo</text></svg>',
        });
    await page.route('https://images.example/**', placeholder);
    // The other seeded photo is a Storage object path; the mock has no object
    // store behind /storage/v1/object/public, so stand in for it as well.
    await page.route('**/storage/v1/object/public/**', placeholder);

    // 01 — login
    await page.goto('/login');
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();
    await shot(page, '01-login');

    // 02 — dashboard
    await login(page);
    await expect(page.getByRole('heading', { name: 'Welcome back, Grace Admin!' })).toBeVisible();
    await shot(page, '02-dashboard');

    // 03/04 — users, then a row action open
    await page.goto('/dashboard/users');
    await expect(page.getByRole('heading', { name: 'User Management' })).toBeVisible();
    await expect(page.getByRole('table')).toBeVisible();
    await shot(page, '03-users');

    // The Actions column is a row of icon buttons, not a dropdown; opening the
    // role editor is the row action that shows what those icons lead to.
    const changeRole = page.getByRole('button', { name: /^Change role of / }).first();
    await expect(changeRole).toBeVisible();
    await changeRole.click();
    await expect(page.getByRole('dialog', { name: 'Change Role' })).toBeVisible();
    await shot(page, '04-users-row-action-open');
    await page.keyboard.press('Escape');

    // 05 — reports
    await page.goto('/dashboard/reports');
    await expect(page.getByRole('heading', { name: 'Report Management' })).toBeVisible();
    await shot(page, '05-reports');

    // 06 — knowledge base
    await page.goto('/dashboard/knowledge');
    await expect(page.getByRole('heading', { name: 'Knowledge Base' })).toBeVisible();
    await shot(page, '06-knowledge');

    // 07 — news links
    await page.goto('/dashboard/news');
    await expect(page.getByRole('heading', { name: 'News Links' })).toBeVisible();
    await shot(page, '07-news');

    // 08 — community alerts
    await page.goto('/dashboard/alerts');
    await expect(page.getByRole('heading', { name: 'Community Alerts' })).toBeVisible();
    await shot(page, '08-alerts');

    // 09 — authorities
    await page.goto('/dashboard/authorities');
    await expect(page.getByRole('heading', { name: 'Authorities' })).toBeVisible();
    await shot(page, '09-authorities');

    // 10 — app settings
    await page.goto('/dashboard/settings');
    await expect(page.getByRole('heading', { name: 'App Settings' })).toBeVisible();
    await shot(page, '10-settings');

    // 11 — /reset-password with a valid recovery link
    await page.goto('/reset-password?token_hash=recovery-admin-ok&type=recovery');
    await expect(page.getByRole('heading', { name: 'Set a New Password' })).toBeVisible();
    await shot(page, '11-reset-password-form');

    // 12 — the same form refusing a password that fails the rules
    await page.getByLabel('New Password', { exact: true }).fill('short');
    await page.getByLabel('Confirm New Password').fill('short');
    await page.getByRole('button', { name: 'Update Password' }).click();
    await expect(page.locator('.glass-card [role="alert"]')).toBeVisible();
    await shot(page, '12-reset-password-weak');

    // 13 — /reset-password reached without a link at all
    await page.goto('/reset-password');
    await expect(page.getByRole('heading', { name: 'Reset link problem' })).toBeVisible();
    await shot(page, '13-reset-password-no-token');
});
