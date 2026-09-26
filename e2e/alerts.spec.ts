import type { Page } from '@playwright/test';
import { test, expect, openAsAdmin, toast, IDS } from './fixtures';
import { LGAS } from '../lib/lgas';

type AlertRow = { id: string; title: string; target_lga: string; is_active: boolean; severity: string };

function alertCard(page: Page, title: string) {
    return page.locator('div.bg-white.rounded-xl').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
}

test.describe('alerts', () => {
    test.beforeEach(async ({ page }) => {
        await openAsAdmin(page, '/dashboard/alerts');
        await expect(page.getByRole('heading', { name: 'Community Alerts' })).toBeVisible();
        await expect(alertCard(page, 'Flood warning')).toBeVisible();
    });

    test('lists active alerts by default; filter shows inactive ones', async ({ page }) => {
        await expect(page.locator('h3')).toHaveCount(1);
        await page.getByLabel('Filter alerts by status').selectOption('inactive');
        await expect(alertCard(page, 'Old drill')).toContainText('Inactive');
        await expect(alertCard(page, 'Old drill')).toContainText('All LGAs');
        await expect(alertCard(page, 'Old drill').getByRole('button', { name: /Deactivate/ })).toHaveCount(0);
        await page.getByLabel('Filter alerts by status').selectOption('all');
        await expect(page.locator('h3')).toHaveCount(2);
    });

    test("creates an alert targeted at Qua'an Pan", async ({ page, mock }) => {
        await page.getByRole('button', { name: 'New Alert' }).click();
        const dialog = page.getByRole('dialog', { name: 'New Alert' });
        const lga = dialog.getByLabel('Target LGA');
        await expect(lga).toHaveValue('All');

        // Suggestions: "All" plus every LGA, including names with apostrophes.
        const options = page.locator('#alert-lga-options option');
        await expect(options).toHaveCount(LGAS.length + 1);
        await expect(page.locator('#alert-lga-options option[value="Qua\'an Pan"]')).toHaveCount(1);

        await dialog.getByLabel('Title').fill('Windstorm alert');
        await dialog.getByLabel('Severity').selectOption('critical');
        await lga.fill("Qua'an Pan");
        await dialog.getByLabel('Message').fill('Stay indoors tonight.');
        await dialog.getByRole('button', { name: 'Publish Alert' }).click();
        await expect(toast(page, 'Alert published')).toBeVisible();

        const created = alertCard(page, 'Windstorm alert');
        await expect(created).toContainText("Qua'an Pan");
        await expect(created).toContainText('Critical');
        await expect(created).toContainText('Active');
        const post = (await mock.requests({ method: 'POST', path: '/rest/v1/alerts' })).at(-1)!;
        expect(post.body).toEqual({
            title: 'Windstorm alert',
            message: 'Stay indoors tonight.',
            severity: 'critical',
            target_lga: "Qua'an Pan",
            is_active: true,
            created_by: IDS.admin,
        });
    });

    test('a blank target LGA is stored as "All"', async ({ page, mock }) => {
        await page.getByRole('button', { name: 'New Alert' }).click();
        const dialog = page.getByRole('dialog', { name: 'New Alert' });
        await dialog.getByLabel('Title').fill('Everyone');
        await dialog.getByLabel('Target LGA').fill('   ');
        await dialog.getByLabel('Message').fill('Hello all');
        await dialog.getByRole('button', { name: 'Publish Alert' }).click();
        await expect(toast(page, 'Alert published')).toBeVisible();
        await expect(alertCard(page, 'Everyone')).toContainText('All LGAs');
        const post = (await mock.requests({ method: 'POST', path: '/rest/v1/alerts' })).at(-1)!;
        expect(post.body).toMatchObject({ target_lga: 'All', severity: 'info' });
    });

    test('deactivates an alert after confirmation', async ({ page, mock }) => {
        await alertCard(page, 'Flood warning').getByRole('button', { name: 'Deactivate alert Flood warning' }).click();
        const dialog = page.getByRole('dialog', { name: 'Deactivate Alert' });
        await dialog.getByRole('button', { name: 'Deactivate' }).click();
        await expect(toast(page, 'Alert deactivated')).toBeVisible();
        await expect(page.getByText('No alerts found')).toBeVisible();
        const patch = (await mock.requests({ method: 'PATCH', path: '/rest/v1/alerts' })).at(-1)!;
        expect(patch.body).toEqual({ is_active: false });
        const row = (await mock.table<AlertRow>('alerts')).find((a) => a.title === 'Flood warning');
        expect(row?.is_active).toBe(false);
        expect(patch.query).toContain(`id=eq.${row!.id}`);

        await page.getByLabel('Filter alerts by status').selectOption('inactive');
        await expect(alertCard(page, 'Flood warning')).toContainText('Inactive');
    });
});
