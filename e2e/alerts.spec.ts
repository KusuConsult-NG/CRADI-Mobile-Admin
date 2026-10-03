import type { Page } from '@playwright/test';
import { test, expect, openAsAdmin, toast } from './fixtures';
import { STATES, lgasForState } from '../lib/wards';

type AlertRow = { $id: string; title: string; targetLga: string; targetState: string | null; isActive: boolean; severity: string };

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
        const post = (await mock.writes({ collection: 'alerts', op: 'create' })).at(-1)!;
        // No `createdBy`: the `write` Function stamps it from the caller's
        // session, so sending it would be a value the server ignores.
        expect(post.data).toEqual({
            title: 'Windstorm alert',
            message: 'Stay indoors tonight.',
            severity: 'critical',
            targetLga: 'Obi',
            targetState: 'Nasarawa',
            isActive: true,
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
        let post = (await mock.writes({ collection: 'alerts', op: 'create' })).at(-1)!;
        expect(post.data).toMatchObject({ targetLga: 'All', targetState: 'Plateau' });

        await page.getByRole('button', { name: 'New Alert' }).click();
        dialog = page.getByRole('dialog', { name: 'New Alert' });
        await dialog.getByLabel('Target state').selectOption('Plateau');
        await dialog.getByLabel('Target LGA').selectOption("Qua'an Pan");
        await dialog.getByLabel('Title').fill('Bwall flood');
        await dialog.getByLabel('Message').fill('River rising');
        await dialog.getByRole('button', { name: 'Publish Alert' }).click();
        await expect(toast(page, 'Alert published')).toBeVisible();
        await expect(alertCard(page, 'Bwall flood')).toContainText("Qua'an Pan, Plateau");
        post = (await mock.writes({ collection: 'alerts', op: 'create' })).at(-1)!;
        expect(post.data).toMatchObject({ targetLga: "Qua'an Pan", targetState: 'Plateau' });
        const row = (await mock.table<AlertRow>('alerts')).find((a) => a.title === 'Bwall flood');
        expect(row).toMatchObject({ targetLga: "Qua'an Pan", targetState: 'Plateau' });
    });

    test('the default target is everyone: "All" with no state', async ({ page, mock }) => {
        await page.getByRole('button', { name: 'New Alert' }).click();
        const dialog = page.getByRole('dialog', { name: 'New Alert' });
        await dialog.getByLabel('Title').fill('Everyone');
        await dialog.getByLabel('Message').fill('Hello all');
        await dialog.getByRole('button', { name: 'Publish Alert' }).click();
        await expect(toast(page, 'Alert published')).toBeVisible();
        await expect(alertCard(page, 'Everyone')).toContainText('All LGAs');
        const post = (await mock.writes({ collection: 'alerts', op: 'create' })).at(-1)!;
        expect(post.data).toMatchObject({ targetLga: 'All', targetState: null, severity: 'info' });
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
        expect(await mock.writes({ collection: 'alerts' })).toHaveLength(0);
    });

    // alerts.targetState is required by the database (migration 20260927080000:
    // check alerts_target_lga_needs_state), because an LGA name alone can mean
    // two places. The form must make that shape unreachable, not rely on the
    // insert being rejected.
    test('an LGA can never be submitted without a state', async ({ page, mock }) => {
        await page.getByRole('button', { name: 'New Alert' }).click();
        const dialog = page.getByRole('dialog', { name: 'New Alert' });

        // With no state chosen the LGA picker is disabled and offers only 'All'.
        const lga = dialog.getByLabel('Target LGA');
        await expect(lga).toBeDisabled();
        expect(await lga.locator('option').allInnerTexts()).toEqual(['All LGAs']);

        // Choosing a state enables it; choosing an LGA and then going back to
        // "All states" resets the LGA, so the pair can never be (LGA, no state).
        await dialog.getByLabel('Target state').selectOption('Nasarawa');
        await expect(lga).toBeEnabled();
        await lga.selectOption('Obi');
        await dialog.getByLabel('Target state').selectOption('');
        await expect(lga).toBeDisabled();
        await expect(lga).toHaveValue('All');

        // Even a stale/injected DOM that forces an LGA with no state is refused
        // client-side, so nothing is sent.
        await page.locator('#alert-lga').evaluate((el: HTMLSelectElement) => {
            el.disabled = false;
            const opt = document.createElement('option');
            opt.value = 'Obi';
            opt.textContent = 'Obi';
            el.appendChild(opt);
            el.value = 'Obi';
            el.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await dialog.getByLabel('Title').fill('Which Obi?');
        await dialog.getByLabel('Message').fill('Ambiguous');
        await dialog.getByRole('button', { name: 'Publish Alert' }).click();
        await expect(toast(page, 'Choose the state of the target LGA.')).toBeVisible();
        await expect(dialog).toBeVisible();
        expect(await mock.writes({ collection: 'alerts' })).toHaveLength(0);
    });

    test('deactivates an alert after confirmation', async ({ page, mock }) => {
        await alertCard(page, 'Flood warning').getByRole('button', { name: 'Deactivate alert Flood warning' }).click();
        const dialog = page.getByRole('dialog', { name: 'Deactivate Alert' });
        await dialog.getByRole('button', { name: 'Deactivate' }).click();
        await expect(toast(page, 'Alert deactivated')).toBeVisible();
        await expect(page.getByText('No alerts found')).toBeVisible();
        const patch = (await mock.writes({ collection: 'alerts', op: 'update' })).at(-1)!;
        expect(patch.data).toEqual({ isActive: false });
        const row = (await mock.table<AlertRow>('alerts')).find((a) => a.title === 'Flood warning');
        expect(row?.isActive).toBe(false);
        expect(patch.documentId).toBe(row!.$id);

        await page.getByLabel('Filter alerts by status').selectOption('inactive');
        await expect(alertCard(page, 'Flood warning')).toContainText('Inactive');
    });
});
