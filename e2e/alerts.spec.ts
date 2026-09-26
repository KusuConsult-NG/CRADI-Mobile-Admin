import type { Page } from '@playwright/test';
import { test, expect, openAsAdmin, toast, IDS } from './fixtures';
import { STATES, lgasForState } from '../lib/wards';

type AlertRow = { id: string; title: string; target_lga: string; target_state: string | null; is_active: boolean; severity: string };

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

    test('creates an alert for Obi in Nasarawa (state, then LGA of that state)', async ({ page, mock }) => {
        await page.getByRole('button', { name: 'New Alert' }).click();
        const dialog = page.getByRole('dialog', { name: 'New Alert' });
        const state = dialog.getByLabel('Target state');
        const lga = dialog.getByLabel('Target LGA');
        await expect(state).toHaveValue('');
        await expect(state.locator('option')).toHaveText(['All states', ...STATES]);
        // No free text: the LGA is picked from the chosen state's list.
        await expect(lga).toBeDisabled();
        await expect(lga).toHaveValue('All');

        await state.selectOption('Nasarawa');
        await expect(lga).toBeEnabled();
        await expect(lga.locator('option')).toHaveText(['All LGAs in Nasarawa', ...lgasForState('Nasarawa')]);
        await lga.selectOption('Obi');
        // Changing the state resets the LGA (Obi, Benue is a different place).
        await state.selectOption('Benue');
        await expect(lga).toHaveValue('All');
        await state.selectOption('Nasarawa');
        await lga.selectOption('Obi');

        await dialog.getByLabel('Title').fill('Windstorm alert');
        await dialog.getByLabel('Severity').selectOption('critical');
        await dialog.getByLabel('Message').fill('Stay indoors tonight.');
        await dialog.getByRole('button', { name: 'Publish Alert' }).click();
        await expect(toast(page, 'Alert published')).toBeVisible();

        const created = alertCard(page, 'Windstorm alert');
        await expect(created).toContainText('Obi, Nasarawa');
        await expect(created).toContainText('Critical');
        await expect(created).toContainText('Active');
        const post = (await mock.requests({ method: 'POST', path: '/rest/v1/alerts' })).at(-1)!;
        expect(post.body).toEqual({
            title: 'Windstorm alert',
            message: 'Stay indoors tonight.',
            severity: 'critical',
            target_lga: 'Obi',
            target_state: 'Nasarawa',
            is_active: true,
            created_by: IDS.admin,
        });
    });

    test("targets every LGA of a state, and LGA names with apostrophes (Qua'an Pan)", async ({ page, mock }) => {
        await page.getByRole('button', { name: 'New Alert' }).click();
        let dialog = page.getByRole('dialog', { name: 'New Alert' });
        await dialog.getByLabel('Target state').selectOption('Plateau');
        await dialog.getByLabel('Title').fill('Plateau heat');
        await dialog.getByLabel('Message').fill('Heatwave across the state');
        await dialog.getByRole('button', { name: 'Publish Alert' }).click();
        await expect(toast(page, 'Alert published')).toBeVisible();
        await expect(alertCard(page, 'Plateau heat')).toContainText('All LGAs in Plateau');
        let post = (await mock.requests({ method: 'POST', path: '/rest/v1/alerts' })).at(-1)!;
        expect(post.body).toMatchObject({ target_lga: 'All', target_state: 'Plateau' });

        await page.getByRole('button', { name: 'New Alert' }).click();
        dialog = page.getByRole('dialog', { name: 'New Alert' });
        await dialog.getByLabel('Target state').selectOption('Plateau');
        await dialog.getByLabel('Target LGA').selectOption("Qua'an Pan");
        await dialog.getByLabel('Title').fill('Bwall flood');
        await dialog.getByLabel('Message').fill('River rising');
        await dialog.getByRole('button', { name: 'Publish Alert' }).click();
        await expect(toast(page, 'Alert published')).toBeVisible();
        await expect(alertCard(page, 'Bwall flood')).toContainText("Qua'an Pan, Plateau");
        post = (await mock.requests({ method: 'POST', path: '/rest/v1/alerts' })).at(-1)!;
        expect(post.body).toMatchObject({ target_lga: "Qua'an Pan", target_state: 'Plateau' });
        const row = (await mock.table<AlertRow>('alerts')).find((a) => a.title === 'Bwall flood');
        expect(row).toMatchObject({ target_lga: "Qua'an Pan", target_state: 'Plateau' });
    });

    test('the default target is everyone: "All" with no state', async ({ page, mock }) => {
        await page.getByRole('button', { name: 'New Alert' }).click();
        const dialog = page.getByRole('dialog', { name: 'New Alert' });
        await dialog.getByLabel('Title').fill('Everyone');
        await dialog.getByLabel('Message').fill('Hello all');
        await dialog.getByRole('button', { name: 'Publish Alert' }).click();
        await expect(toast(page, 'Alert published')).toBeVisible();
        await expect(alertCard(page, 'Everyone')).toContainText('All LGAs');
        const post = (await mock.requests({ method: 'POST', path: '/rest/v1/alerts' })).at(-1)!;
        expect(post.body).toMatchObject({ target_lga: 'All', target_state: null, severity: 'info' });
    });

    test('refuses an LGA that is not in the chosen state\'s list', async ({ page, mock }) => {
        await page.getByRole('button', { name: 'New Alert' }).click();
        const dialog = page.getByRole('dialog', { name: 'New Alert' });
        await dialog.getByLabel('Target state').selectOption('Benue');
        // A value the list does not offer (e.g. injected / stale DOM): Lafia is in Nasarawa.
        await page.locator('#alert-lga').evaluate((el) => {
            const opt = document.createElement('option');
            opt.value = 'Lafia';
            opt.textContent = 'Lafia';
            el.appendChild(opt);
        });
        await dialog.getByLabel('Target LGA').selectOption('Lafia');
        await dialog.getByLabel('Title').fill('Wrong place');
        await dialog.getByLabel('Message').fill('Should not be sent');
        await dialog.getByRole('button', { name: 'Publish Alert' }).click();
        await expect(toast(page, 'Choose an LGA of Benue from the list.')).toBeVisible();
        await expect(dialog).toBeVisible();
        expect(await mock.requests({ method: 'POST', path: '/rest/v1/alerts' })).toHaveLength(0);
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
