import type { Page } from '@playwright/test';
import { test, expect, openAsAdmin, toast, MOCK_URL } from './fixtures';
import { LOCATIONS } from '../lib/wards';

type AuthorityRow = {
    id: string;
    name: string;
    phone: string;
    coverage_lga: string;
    coverage_state: string | null;
    organization: string | null;
};

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
        await expect(panel).toContainText(`${LOCATIONS.length - 2} of ${LOCATIONS.length} LGAs have no contact`);
        // Legacy rows (coverage_state NULL) are flagged in the list.
        await expect(row(page, 'Ado Emergency Desk').getByText('State not set')).toBeVisible();
        await expect(panel.getByRole('button', { name: 'Ado', exact: true })).toHaveCount(0);
        await expect(panel.getByRole('button', { name: "Qua'an Pan", exact: true })).toHaveCount(0);
        await expect(panel.getByRole('button', { name: 'Agatu', exact: true })).toBeVisible();
        await expect(panel).toContainText('“Nowhere”');

        // A gap chip opens the form with that LGA chosen.
        await panel.getByRole('button', { name: 'Agatu', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Add Authority' });
        await expect(dialog.getByLabel('Coverage LGA')).toHaveValue('Benue|Agatu');
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
            coverage_state: 'Benue',
        });
        // Duplicate check ran first: every contact of the (state, LGA), compared
        // after normalising the stored numbers too (not a raw phone=eq filter).
        const dupCheck = (await mock.requests({ method: 'GET', path: '/rest/v1/authorities' })).find((r) =>
            r.query.includes('coverage_lga=eq.Agatu'),
        );
        const dupQuery = decodeURIComponent(dupCheck!.query);
        expect(dupQuery).toContain('select=id,phone');
        expect(dupQuery).not.toContain('phone=eq.');
        expect(dupQuery).toContain('or=(coverage_state.eq."Benue",coverage_state.is.null)');
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

        // Same number already listed for Ado (a legacy row without a state counts for every state).
        await dialog.getByLabel('Coverage LGA').selectOption('Ado');
        await dialog.getByRole('button', { name: 'Add Authority' }).click();
        await expect(toast(page, '+2348031234567 is already listed for Ado, Benue.')).toBeVisible();
        await expect(dialog).toBeVisible();
        expect(await mock.requests({ method: 'POST', path: '/rest/v1/authorities' })).toHaveLength(0);
    });

    test('a stored number in another spelling still counts as a duplicate', async ({ page, mock }) => {
        const ado = (await mock.table<AuthorityRow>('authorities')).find((a) => a.name === 'Ado Emergency Desk')!;
        // Written before numbers were normalised.
        await fetch(`${MOCK_URL}/__mock/table/authorities/${ado.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone: '0803 123 4567' }),
        });
        await page.getByRole('button', { name: 'Add Authority' }).click();
        const dialog = page.getByRole('dialog', { name: 'Add Authority' });
        await dialog.getByLabel('Name').fill('Same number');
        await dialog.getByLabel('Phone').fill('+234 803 123 4567');
        await dialog.getByLabel('Coverage LGA').selectOption('Ado');
        await dialog.getByRole('button', { name: 'Add Authority' }).click();
        await expect(toast(page, '+2348031234567 is already listed for Ado, Benue.')).toBeVisible();
        expect(await mock.requests({ method: 'POST', path: '/rest/v1/authorities' })).toHaveLength(0);
    });

    test('coverage reads every row in 1000-row pages (PostgREST max-rows)', async ({ page, mock }) => {
        // 1100 contacts: fillers for Makurdi, and the only Agatu contact sorted last by id.
        const rows = Array.from({ length: 1099 }, (_, i) => ({
            id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
            name: `Filler ${i}`,
            phone: `+23480300${String(i).padStart(5, '0')}`,
            coverage_lga: 'Makurdi',
            coverage_state: 'Benue',
        }));
        rows.push({
            id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
            name: 'Agatu Desk',
            phone: '+2348031110000',
            coverage_lga: 'Agatu',
            coverage_state: 'Benue',
        });
        const res = await fetch(`${MOCK_URL}/rest/v1/authorities`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(rows),
        });
        expect(res.status).toBe(201);

        await page.reload();
        await expect(page.getByText('Showing 1–25 of 1,103 authorities')).toBeVisible();
        const panel = gaps(page);
        await expect(panel).toContainText(`${LOCATIONS.length - 4} of ${LOCATIONS.length} LGAs have no contact`);
        await expect(panel.getByRole('button', { name: 'Agatu', exact: true })).toHaveCount(0);
        await expect(panel.getByRole('button', { name: 'Makurdi', exact: true })).toHaveCount(0);

        const coverage = (await mock.requests({ method: 'GET', path: '/rest/v1/authorities' })).filter((r) =>
            decodeURIComponent(r.query).startsWith('select=coverage_lga,coverage_state'),
        );
        const offsets = coverage.map((r) => new URLSearchParams(r.query).get('offset'));
        // The last load (after the reload): pages at 0 and 1000, then a short page ends it.
        expect(offsets.slice(-2)).toEqual(['0', '1000']);
        for (const r of coverage) expect(new URLSearchParams(r.query).get('limit')).toBe('1000');
    });

    test('edits an authority', async ({ page, mock }) => {
        await row(page, 'Ado Emergency Desk').getByRole('button', { name: 'Edit Ado Emergency Desk' }).click();
        const dialog = page.getByRole('dialog', { name: 'Edit Authority' });
        await expect(dialog.getByLabel('Phone')).toHaveValue('+2348031234567');
        // Legacy row (no state): Ado exists only in Benue, so the state is filled in.
        await expect(dialog.getByLabel('Coverage LGA')).toHaveValue('Benue|Ado');
        await dialog.getByLabel('Phone').fill('0803 123 4000');
        await dialog.getByLabel(/Organisation/).fill('');
        await dialog.getByRole('button', { name: 'Save Changes' }).click();
        await expect(toast(page, 'Authority updated')).toBeVisible();
        await expect(row(page, 'Ado Emergency Desk')).toContainText('+2348031234000');

        const patch = (await mock.requests({ method: 'PATCH', path: '/rest/v1/authorities' })).at(-1)!;
        expect(patch.body).toEqual({
            name: 'Ado Emergency Desk',
            organization: null,
            phone: '+2348031234000',
            coverage_lga: 'Ado',
            coverage_state: 'Benue',
        });
        await expect(row(page, 'Ado Emergency Desk').getByText('State not set')).toHaveCount(0);
        await expect(row(page, 'Ado Emergency Desk')).toContainText('Benue');
        const id = (await mock.table<AuthorityRow>('authorities')).find((a) => a.name === 'Ado Emergency Desk')!.id;
        expect(patch.query).toContain(`id=eq.${id}`);
        // The duplicate check excludes the row being edited.
        const dupCheck = (await mock.requests({ method: 'GET', path: '/rest/v1/authorities' })).find((r) =>
            decodeURIComponent(r.query).startsWith('select=id,phone'),
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

    test('same-named LGAs in different states are distinct (Obi: Benue and Nasarawa)', async ({ page, mock }) => {
        const panel = gaps(page);
        const obiChips = panel.getByRole('button', { name: 'Obi', exact: true });
        await expect(obiChips).toHaveCount(2);

        await page.getByRole('button', { name: 'Add Authority' }).click();
        const dialog = page.getByRole('dialog', { name: 'Add Authority' });
        const select = dialog.getByLabel('Coverage LGA');
        await expect(select.locator('optgroup[label="Benue"] option', { hasText: /^Obi$/ })).toHaveAttribute('value', 'Benue|Obi');
        await expect(select.locator('optgroup[label="Nasarawa"] option', { hasText: /^Obi$/ })).toHaveAttribute(
            'value',
            'Nasarawa|Obi',
        );
        await dialog.getByLabel('Name').fill('Obi Nasarawa Desk');
        await dialog.getByLabel('Phone').fill('08031110003');
        await select.selectOption('Nasarawa|Obi');
        await dialog.getByRole('button', { name: 'Add Authority' }).click();
        await expect(toast(page, 'Authority added')).toBeVisible();
        const post = (await mock.requests({ method: 'POST', path: '/rest/v1/authorities' })).at(-1)!;
        expect(post.body).toMatchObject({ coverage_lga: 'Obi', coverage_state: 'Nasarawa', phone: '+2348031110003' });
        await expect(row(page, 'Obi Nasarawa Desk')).toContainText('Nasarawa');

        // Only Nasarawa's Obi is covered now; Benue's Obi is still a gap.
        await expect(obiChips).toHaveCount(1);
        await expect(obiChips).toHaveAttribute('title', 'Add an authority for Obi, Benue');
        await expect(panel).toContainText(`${LOCATIONS.length - 3} of ${LOCATIONS.length} LGAs have no contact`);

        // The same number may cover Benue's Obi too (duplicate check is per state).
        await obiChips.click();
        const dialog2 = page.getByRole('dialog', { name: 'Add Authority' });
        await expect(dialog2.getByLabel('Coverage LGA')).toHaveValue('Benue|Obi');
        await dialog2.getByLabel('Name').fill('Obi Benue Desk');
        await dialog2.getByLabel('Phone').fill('08031110003');
        await dialog2.getByRole('button', { name: 'Add Authority' }).click();
        await expect(toast(page, 'Authority added')).toBeVisible();
        await expect(obiChips).toHaveCount(0);
        const obi = (await mock.table<AuthorityRow>('authorities')).filter((a) => a.coverage_lga === 'Obi');
        expect(obi.map((a) => a.coverage_state).sort()).toEqual(['Benue', 'Nasarawa']);

        // The LGA filter tells them apart too.
        await page.getByLabel('Filter authorities by LGA').selectOption('Nasarawa|Obi');
        await expect(page.getByText('Showing 1–1 of 1 authorities')).toBeVisible();
        await expect(row(page, 'Obi Nasarawa Desk')).toBeVisible();
    });

    test('a legacy authority in an ambiguous LGA must be given a state when edited', async ({ page, mock }) => {
        const old = (await mock.table<AuthorityRow>('authorities')).find((a) => a.name === 'Old Contact')!;
        await fetch(`${MOCK_URL}/__mock/table/authorities/${old.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ coverage_lga: 'Obi', phone: '08031110009' }),
        });
        await page.reload();
        await expect(page.getByText('Showing 1–3 of 3 authorities')).toBeVisible();
        // A legacy Obi contact is texted for both states, so neither Obi is a gap.
        await expect(gaps(page).getByRole('button', { name: 'Obi', exact: true })).toHaveCount(0);
        await expect(row(page, 'Old Contact').getByText('State not set')).toBeVisible();

        await row(page, 'Old Contact').getByRole('button', { name: 'Edit Old Contact' }).click();
        const dialog = page.getByRole('dialog', { name: 'Edit Authority' });
        const select = dialog.getByLabel('Coverage LGA');
        await expect(select).toHaveValue('|Obi');
        await expect(select.locator('option:checked')).toHaveText('Obi (state not set)');
        await expect(dialog).toContainText('Obi exists in Benue and Nasarawa. Choose the state');
        await dialog.getByRole('button', { name: 'Save Changes' }).click();
        await expect(toast(page, 'Choose the state of Obi')).toBeVisible();
        expect(await mock.requests({ method: 'PATCH', path: '/rest/v1/authorities' })).toHaveLength(0);

        await select.selectOption('Benue|Obi');
        await dialog.getByRole('button', { name: 'Save Changes' }).click();
        await expect(toast(page, 'Authority updated')).toBeVisible();
        const patch = (await mock.requests({ method: 'PATCH', path: '/rest/v1/authorities' })).at(-1)!;
        expect(patch.body).toMatchObject({ coverage_lga: 'Obi', coverage_state: 'Benue' });
        // Now only Benue's Obi is covered.
        const chip = gaps(page).getByRole('button', { name: 'Obi', exact: true });
        await expect(chip).toHaveCount(1);
        await expect(chip).toHaveAttribute('title', 'Add an authority for Obi, Nasarawa');
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
