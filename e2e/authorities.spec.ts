import type { Page } from '@playwright/test';
import { test, expect, openAsAdmin, toast, MOCK_URL } from './fixtures';
import { LOCATIONS } from '../lib/wards';

type AuthorityRow = {
    $id: string;
    name: string;
    phone: string;
    coverageLga: string;
    coverageState: string;
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
        // Every contact names its state, so the list never shows "State not set".
        await expect(row(page, 'Ado Emergency Desk').getByText('State not set')).toHaveCount(0);
        await expect(row(page, 'Ado Emergency Desk')).toContainText('Benue');
        await expect(panel.getByRole('button', { name: 'Ado', exact: true })).toHaveCount(0);
        await expect(panel.getByRole('button', { name: "Qua'an Pan", exact: true })).toHaveCount(0);
        await expect(panel.getByRole('button', { name: 'Agatu', exact: true })).toBeVisible();
        // The warning names the state too: an unknown LGA reported as a bare
        // name is the ambiguity this screen exists to remove — “Obi” alone
        // could be Benue's or Nasarawa's.
        await expect(panel).toContainText('“Nowhere, Benue”');

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
        const post = (await mock.writes({ collection: 'authorities', op: 'create' })).at(-1)!;
        expect(post.data).toEqual({
            name: 'Agatu Desk',
            organization: 'SEMA Benue',
            phone: '+2348031234568',
            coverageLga: 'Agatu',
            coverageState: 'Benue',
        });
        // Duplicate check ran first: every contact of the (state, LGA), compared
        // after normalising the stored numbers too (not a raw phone=eq filter).
        const dupCheck = (await mock.reads('authorities')).find((r) =>
            decodeURIComponent(r.query).includes('"values":["Agatu"]'),
        );
        const dupQuery = decodeURIComponent(dupCheck!.query);
        expect(dupQuery).toContain('select=id,phone');
        expect(dupQuery).not.toContain('phone=eq.');
        // Scoped to the (state, LGA), not the LGA name: there are no
        // state-less contacts to match any more.
        // Per (state, LGA): the same desk may legitimately cover Obi in
        // Benue and Obi in Nasarawa, so the check must name both.
        expect(dupQuery).toContain('"attribute":"coverageState"');
        expect(dupQuery).toContain('"values":["Benue"]');
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

        // Same number already listed for Ado, Benue.
        await dialog.getByLabel('Coverage LGA').selectOption('Ado');
        await dialog.getByRole('button', { name: 'Add Authority' }).click();
        await expect(toast(page, '+2348031234567 is already listed for Ado, Benue.')).toBeVisible();
        await expect(dialog).toBeVisible();
        expect(await mock.writes({ collection: 'authorities', op: 'create' })).toHaveLength(0);
    });

    test('a stored number in another spelling still counts as a duplicate', async ({ page, mock }) => {
        const ado = (await mock.table<AuthorityRow>('authorities')).find((a) => a.name === 'Ado Emergency Desk')!;
        // Written before numbers were normalised.
        await fetch(`${MOCK_URL}/__mock/table/authorities/${ado.$id}`, {
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
        expect(await mock.writes({ collection: 'authorities', op: 'create' })).toHaveLength(0);
    });

    test('coverage reads every row, a page at a time', async ({ page, mock }) => {
        // 1100 contacts: fillers for Makurdi, and the only Agatu contact
        // sorted last by id — a single truncated page would miss it and
        // report Agatu as a gap.
        const rows: Record<string, string>[] = Array.from({ length: 1099 }, (_, i) => ({
            $id: `filler${String(i).padStart(14, '0')}`,
            name: `Filler ${i}`,
            phone: `+23480300${String(i).padStart(5, '0')}`,
            coverageLga: 'Makurdi',
            coverageState: 'Benue',
        }));
        rows.push({
            $id: 'zzzzzzzzzzzzzzzzzzzz',
            name: 'Agatu Desk',
            phone: '+2348031110000',
            coverageLga: 'Agatu',
            coverageState: 'Benue',
        });
        const res = await fetch(`${MOCK_URL}/__mock/table/authorities`, {
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

        const coverage = (await mock.reads('authorities')).filter((r) =>
            decodeURIComponent(r.query).includes('"values":["coverageLga","coverageState"]'),
        );
        const page_ = (r: { query: string }, key: string) =>
            decodeURIComponent(r.query).match(new RegExp(`"method":"${key}","values":\\[(\\d+)\\]`))?.[1];
        // The last load (after the reload): pages at 0 and 1000, then a short page ends it.
        expect(coverage.slice(-2).map((r) => page_(r, 'offset'))).toEqual(['0', '1000']);
        for (const r of coverage) expect(page_(r, 'limit')).toBe('1000');
    });

    test('edits an authority', async ({ page, mock }) => {
        await row(page, 'Ado Emergency Desk').getByRole('button', { name: 'Edit Ado Emergency Desk' }).click();
        const dialog = page.getByRole('dialog', { name: 'Edit Authority' });
        await expect(dialog.getByLabel('Phone')).toHaveValue('+2348031234567');
        await expect(dialog.getByLabel('Coverage LGA')).toHaveValue('Benue|Ado');
        await dialog.getByLabel('Phone').fill('0803 123 4000');
        await dialog.getByLabel(/Organisation/).fill('');
        await dialog.getByRole('button', { name: 'Save Changes' }).click();
        await expect(toast(page, 'Authority updated')).toBeVisible();
        await expect(row(page, 'Ado Emergency Desk')).toContainText('+2348031234000');

        const patch = (await mock.writes({ collection: 'authorities', op: 'update' })).at(-1)!;
        expect(patch.data).toEqual({
            name: 'Ado Emergency Desk',
            organization: null,
            phone: '+2348031234000',
            coverageLga: 'Ado',
            coverageState: 'Benue',
        });
        await expect(row(page, 'Ado Emergency Desk').getByText('State not set')).toHaveCount(0);
        await expect(row(page, 'Ado Emergency Desk')).toContainText('Benue');
        const id = (await mock.table<AuthorityRow>('authorities')).find((a) => a.name === 'Ado Emergency Desk')!.$id;
        expect(patch.documentId).toBe(id);
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
        const post = (await mock.writes({ collection: 'authorities', op: 'create' })).at(-1)!;
        expect(post.data).toMatchObject({
            coverageLga: 'Obi',
            coverageState: 'Nasarawa',
            phone: '+2348031110003',
        });
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
        const obi = (await mock.table<AuthorityRow>('authorities')).filter((a) => a.coverageLga === 'Obi');
        expect(obi.map((a) => a.coverageState).sort()).toEqual(['Benue', 'Nasarawa']);

        // The LGA filter tells them apart too.
        await page.getByLabel('Filter authorities by LGA').selectOption('Nasarawa|Obi');
        await expect(page.getByText('Showing 1–1 of 1 authorities')).toBeVisible();
        await expect(row(page, 'Obi Nasarawa Desk')).toBeVisible();
    });

    test('an LGA can never be submitted without its state, even from a tampered DOM', async ({ page, mock }) => {
        // The select only offers real (state, LGA) pairs, grouped by state:
        // there is no option whose value carries an LGA and no state.
        await page.getByRole('button', { name: 'Add Authority' }).click();
        const dialog = page.getByRole('dialog', { name: 'Add Authority' });
        const select = dialog.getByLabel('Coverage LGA');
        const values = await select.locator('option').evaluateAll((os) =>
            os.map((o) => (o as HTMLOptionElement).value),
        );
        expect(values).toContain('');
        for (const v of values.filter(Boolean)) {
            const [state, lga] = v.split('|');
            expect(state, v).not.toBe('');
            expect(lga, v).not.toBe('');
        }
        // Every non-empty option lives inside an <optgroup> named after its state.
        const orphans = await select
            .locator(':scope > option')
            .evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean));
        expect(orphans).toEqual([]);

        await dialog.getByLabel('Name').fill('Tampered Desk');
        await dialog.getByLabel('Phone').fill('08031110055');

        // Now forge the values a tampered page could send: an LGA with an empty
        // state, an LGA with a state it is not in, an invented state, and a
        // bare LGA name with no separator at all. Each is refused client-side
        // and nothing is POSTed. (The database refuses them too: coverage_state
        // is NOT NULL with a composite foreign key into public.nigeria_lgas.)
        for (const [forged, message] of [
            ['|Obi', 'Choose the state of Obi'],
            ['Obi', 'Choose the state of Obi'],
            ['Plateau|Obi', 'Choose the state of Obi'],
            ['Atlantis|Obi', 'Choose the state of Obi'],
            ['|Makurdi', 'Choose the state of Makurdi'],
        ] as const) {
            await select.evaluate((el, v) => {
                const sel = el as HTMLSelectElement;
                const opt = document.createElement('option');
                opt.value = v;
                opt.textContent = v;
                sel.appendChild(opt);
                sel.value = v;
                sel.dispatchEvent(new Event('change', { bubbles: true }));
            }, forged);
            await expect(select).toHaveValue(forged);
            await dialog.getByRole('button', { name: 'Add Authority' }).click();
            await expect(toast(page, message)).toBeVisible();
            await expect(dialog).toBeVisible();
            expect(await mock.writes({ collection: 'authorities', op: 'create' })).toHaveLength(0);
        }

        // A real pair goes through, carrying the state.
        await select.selectOption('Nasarawa|Obi');
        await dialog.getByRole('button', { name: 'Add Authority' }).click();
        await expect(toast(page, 'Authority added')).toBeVisible();
        const post = (await mock.writes({ collection: 'authorities', op: 'create' })).at(-1)!;
        expect(post.data).toMatchObject({ coverageLga: 'Obi', coverageState: 'Nasarawa' });
        expect((await mock.table<AuthorityRow>('authorities')).every((a) => !!a.coverageState)).toBe(true);
    });

    test('a contact whose LGA is not in its state must be re-pointed before it can be saved', async ({ page, mock }) => {
        // Defensive: the database cannot produce such a row (20260927090000),
        // but if one arrives the form opens with nothing selected rather than
        // carrying a coverage it cannot name a state for.
        const old = (await mock.table<AuthorityRow>('authorities')).find((a) => a.name === 'Old Contact')!;
        await fetch(`${MOCK_URL}/__mock/table/authorities/${old.$id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ coverageLga: 'Obi', coverageState: 'Plateau', phone: '08031110009' }),
        });
        await page.reload();
        await expect(page.getByText('Showing 1–3 of 3 authorities')).toBeVisible();
        // Obi, Plateau is not a real pair: neither Obi counts as covered.
        await expect(gaps(page).getByRole('button', { name: 'Obi', exact: true })).toHaveCount(2);
        await expect(row(page, 'Old Contact').getByText('Unknown LGA')).toBeVisible();

        await row(page, 'Old Contact').getByRole('button', { name: 'Edit Old Contact' }).click();
        const dialog = page.getByRole('dialog', { name: 'Edit Authority' });
        const select = dialog.getByLabel('Coverage LGA');
        await expect(select).toHaveValue('');
        await dialog.getByRole('button', { name: 'Save Changes' }).click();
        await expect(toast(page, 'Choose the LGA this contact covers.')).toBeVisible();
        expect(await mock.writes({ collection: 'authorities', op: 'update' })).toHaveLength(0);

        await select.selectOption('Benue|Obi');
        await dialog.getByRole('button', { name: 'Save Changes' }).click();
        await expect(toast(page, 'Authority updated')).toBeVisible();
        const patch = (await mock.writes({ collection: 'authorities', op: 'update' })).at(-1)!;
        expect(patch.data).toMatchObject({ coverageLga: 'Obi', coverageState: 'Benue' });
        // Now only Benue's Obi is covered.
        const chip = gaps(page).getByRole('button', { name: 'Obi', exact: true });
        await expect(chip).toHaveCount(1);
        await expect(chip).toHaveAttribute('title', 'Add an authority for Obi, Nasarawa');
    });

    test('deletes an authority after confirmation', async ({ page, mock }) => {
        await row(page, 'Old Contact').getByRole('button', { name: 'Delete Old Contact' }).click();
        const dialog = page.getByRole('dialog', { name: 'Delete Authority' });
        await expect(dialog).toContainText('Delete Old Contact (12345) for Nowhere, Benue?');
        await dialog.getByRole('button', { name: 'Delete' }).click();
        await expect(toast(page, 'Authority deleted')).toBeVisible();
        await expect(row(page, 'Old Contact')).toHaveCount(0);
        await expect(page.getByText('Showing 1–2 of 2 authorities')).toBeVisible();
        const del = await mock.writes({ collection: 'authorities', op: 'delete' });
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
