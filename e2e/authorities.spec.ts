import type { Page } from '@playwright/test';
import { test, expect, openAsAdmin, toast } from './fixtures';
import { LGAS } from '../lib/lgas';

type AuthorityRow = { id: string; name: string; phone: string; coverage_lga: string; organization: string | null };

function row(page: Page, name: string) {
    return page.getByRole('row').filter({ hasText: name });
}

const gaps = (page: Page) => page.getByRole('region', { name: 'LGAs without an authority' });

test.describe('authorities', () => {
    test.beforeEach(async ({ page }) => {
        await openAsAdmin(page, '/dashboard/authorities');
        await expect(page.getByRole('heading', { name: 'Authorities', exact: true })).toBeVisible();
        await expect(page.getByText('Showing 1–3 of 3 authorities')).toBeVisible();
    });

    test('lists authorities with invalid-number / unknown-LGA flags and a coverage gap panel', async ({ page }) => {
        await expect(row(page, 'Old Contact').getByText('Invalid number')).toBeVisible();
        await expect(row(page, 'Old Contact').getByText('Unknown LGA')).toBeVisible();
        await expect(row(page, 'Ado Emergency Desk').getByText('Invalid number')).toHaveCount(0);
        await expect(row(page, "Qua'an Pan Desk")).toContainText("Qua'an Pan");

        const panel = gaps(page);
        await expect(panel).toContainText(`${LGAS.length - 2} of ${LGAS.length} LGAs have no contact`);
        await expect(panel.getByRole('button', { name: 'Ado', exact: true })).toHaveCount(0);
        await expect(panel.getByRole('button', { name: "Qua'an Pan", exact: true })).toHaveCount(0);
        await expect(panel.getByRole('button', { name: 'Agatu', exact: true })).toBeVisible();
        await expect(panel).toContainText('“Nowhere”');

        // A gap chip opens the form with that LGA chosen.
        await panel.getByRole('button', { name: 'Agatu', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Add Authority' });
        await expect(dialog.getByLabel('Coverage LGA')).toHaveValue('Agatu');
    });

    test('creates an authority with the phone normalised to E.164', async ({ page, mock }) => {
        await page.getByRole('button', { name: 'Add Authority' }).click();
        const dialog = page.getByRole('dialog', { name: 'Add Authority' });
        await dialog.getByLabel('Name').fill('  Agatu Desk ');
        await dialog.getByLabel(/Organisation/).fill('SEMA Benue');
        await dialog.getByLabel('Phone').fill('0803 123 4568');
        await expect(dialog.getByText('Will be saved as +2348031234568')).toBeVisible();
        await dialog.getByLabel('Coverage LGA').selectOption('Agatu');
        await dialog.getByRole('button', { name: 'Add Authority' }).click();

        await expect(toast(page, 'Authority added')).toBeVisible();
        await expect(dialog).toBeHidden();
        await expect(row(page, 'Agatu Desk')).toContainText('+2348031234568');
        const post = (await mock.requests({ method: 'POST', path: '/rest/v1/authorities' })).at(-1)!;
        expect(post.body).toEqual({
            name: 'Agatu Desk',
            organization: 'SEMA Benue',
            phone: '+2348031234568',
            coverage_lga: 'Agatu',
        });
        // Duplicate check ran first, on the normalised number.
        const dupCheck = (await mock.requests({ method: 'GET', path: '/rest/v1/authorities' })).find((r) =>
            r.query.includes('phone='),
        );
        expect(decodeURIComponent(dupCheck!.query)).toContain('coverage_lga=eq.Agatu&phone=eq.+2348031234568');
        await expect(gaps(page).getByRole('button', { name: 'Agatu', exact: true })).toHaveCount(0);
    });

    test('accepts other Nigerian spellings of a number', async ({ page, mock }) => {
        const cases: [string, string][] = [
            ['+234 (0)803 123 4569', '+2348031234569'],
            ['002348031234570', '+2348031234570'],
            ['803-123-4571', '+2348031234571'],
        ];
        for (const [input, saved] of cases) {
            await page.getByRole('button', { name: 'Add Authority' }).click();
            const dialog = page.getByRole('dialog', { name: 'Add Authority' });
            await dialog.getByLabel('Name').fill(`Desk ${saved}`);
            await dialog.getByLabel('Phone').fill(input);
            await expect(dialog.getByText(`Will be saved as ${saved}`)).toBeVisible();
            await dialog.getByLabel('Coverage LGA').selectOption('Makurdi');
            await dialog.getByRole('button', { name: 'Add Authority' }).click();
            await expect(dialog).toBeHidden();
        }
        const phones = (await mock.table<AuthorityRow>('authorities')).map((a) => a.phone);
        expect(phones).toEqual(expect.arrayContaining(cases.map(([, saved]) => saved)));
    });

    test('rejects invalid phone numbers, a missing LGA and duplicates', async ({ page, mock }) => {
        await page.getByRole('button', { name: 'Add Authority' }).click();
        const dialog = page.getByRole('dialog', { name: 'Add Authority' });
        await dialog.getByLabel('Name').fill('Bad Number');
        await dialog.getByLabel('Coverage LGA').selectOption('Ado');
        for (const bad of ['12345', '+44 20 7946 0958', '0803 123 456', '08031234567890']) {
            await dialog.getByLabel('Phone').fill(bad);
            await expect(dialog.getByText('Not a valid Nigerian phone number.')).toBeVisible();
            await expect(dialog.getByLabel('Phone')).toHaveAttribute('aria-invalid', 'true');
            await dialog.getByRole('button', { name: 'Add Authority' }).click();
            await expect(toast(page, 'Enter a valid Nigerian phone number')).toBeVisible();
        }

        await dialog.getByLabel('Phone').fill('08031234567');
        await dialog.getByLabel('Coverage LGA').selectOption('');
        await dialog.getByRole('button', { name: 'Add Authority' }).click();
        await expect(toast(page, 'Choose the LGA this contact covers.')).toBeVisible();

        // Same number already listed for Ado.
        await dialog.getByLabel('Coverage LGA').selectOption('Ado');
        await dialog.getByRole('button', { name: 'Add Authority' }).click();
        await expect(toast(page, '+2348031234567 is already listed for Ado.')).toBeVisible();
        await expect(dialog).toBeVisible();
        expect(await mock.requests({ method: 'POST', path: '/rest/v1/authorities' })).toHaveLength(0);
    });

    test('edits an authority', async ({ page, mock }) => {
        await row(page, 'Ado Emergency Desk').getByRole('button', { name: 'Edit Ado Emergency Desk' }).click();
        const dialog = page.getByRole('dialog', { name: 'Edit Authority' });
        await expect(dialog.getByLabel('Phone')).toHaveValue('+2348031234567');
        await expect(dialog.getByLabel('Coverage LGA')).toHaveValue('Ado');
        await dialog.getByLabel('Phone').fill('0803 123 4000');
        await dialog.getByLabel(/Organisation/).fill('');
        await dialog.getByRole('button', { name: 'Save Changes' }).click();
        await expect(toast(page, 'Authority updated')).toBeVisible();
        await expect(row(page, 'Ado Emergency Desk')).toContainText('+2348031234000');

        const patch = (await mock.requests({ method: 'PATCH', path: '/rest/v1/authorities' })).at(-1)!;
        expect(patch.body).toEqual({ name: 'Ado Emergency Desk', organization: null, phone: '+2348031234000', coverage_lga: 'Ado' });
        const id = (await mock.table<AuthorityRow>('authorities')).find((a) => a.name === 'Ado Emergency Desk')!.id;
        expect(patch.query).toContain(`id=eq.${id}`);
        // The duplicate check excludes the row being edited.
        const dupCheck = (await mock.requests({ method: 'GET', path: '/rest/v1/authorities' })).find((r) =>
            r.query.includes('phone='),
        );
        expect(dupCheck!.query).toContain(`id=neq.${id}`);
    });

    test('an authority with an unknown LGA must be given a listed LGA when edited', async ({ page }) => {
        await row(page, 'Old Contact').getByRole('button', { name: 'Edit Old Contact' }).click();
        const dialog = page.getByRole('dialog', { name: 'Edit Authority' });
        await expect(dialog.getByLabel('Coverage LGA')).toHaveValue('');
        await dialog.getByLabel('Phone').fill('08035550000');
        await dialog.getByRole('button', { name: 'Save Changes' }).click();
        await expect(toast(page, 'Choose the LGA this contact covers.')).toBeVisible();
        await dialog.getByLabel('Coverage LGA').selectOption('Agatu');
        await dialog.getByRole('button', { name: 'Save Changes' }).click();
        await expect(toast(page, 'Authority updated')).toBeVisible();
        await expect(row(page, 'Old Contact').getByText('Unknown LGA')).toHaveCount(0);
        await expect(gaps(page)).not.toContainText('Nowhere');
    });

    test('deletes an authority after confirmation', async ({ page, mock }) => {
        await row(page, 'Old Contact').getByRole('button', { name: 'Delete Old Contact' }).click();
        const dialog = page.getByRole('dialog', { name: 'Delete Authority' });
        await expect(dialog).toContainText('Delete Old Contact (12345) for Nowhere?');
        await dialog.getByRole('button', { name: 'Delete' }).click();
        await expect(toast(page, 'Authority deleted')).toBeVisible();
        await expect(row(page, 'Old Contact')).toHaveCount(0);
        await expect(page.getByText('Showing 1–2 of 2 authorities')).toBeVisible();
        const del = await mock.requests({ method: 'DELETE', path: '/rest/v1/authorities' });
        expect(del).toHaveLength(1);
        expect((await mock.table<AuthorityRow>('authorities')).map((a) => a.name)).not.toContain('Old Contact');
    });

    test('search and LGA filter', async ({ page }) => {
        await page.getByLabel('Filter authorities by LGA').selectOption("Qua'an Pan");
        await expect(page.getByText('Showing 1–1 of 1 authorities')).toBeVisible();
        await expect(row(page, "Qua'an Pan Desk")).toBeVisible();
        await page.getByLabel('Filter authorities by LGA').selectOption('all');
        await page.getByLabel('Search authorities').fill('sema');
        await expect(page.getByText('Showing 1–1 of 1 authorities')).toBeVisible();
        await expect(row(page, 'Ado Emergency Desk')).toBeVisible();
    });
});
