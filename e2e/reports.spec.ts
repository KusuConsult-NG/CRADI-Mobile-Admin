import type { Page } from '@playwright/test';
import { test, expect, openAsAdmin, toast, IDS, MOCK_URL } from './fixtures';

type ReportRow = { $id: string; description: string; status: string; hazardType: string; rejectionReason: string | null };

function card(page: Page, description: string) {
    return page.locator('div.bg-white.rounded-xl').filter({ has: page.locator('h3'), hasText: description });
}

const titles = (page: Page) => page.locator('h3');

function capitalize(s: string) {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

async function reportBy(mock: { table<T>(name: string): Promise<T[]> }, description: string) {
    return (await mock.table<ReportRow>('reports')).find((r) => r.description === description)!;
}

test.describe('reports', () => {
    test.beforeEach(async ({ page }) => {
        await openAsAdmin(page, '/dashboard/reports');
        await expect(page.getByRole('heading', { name: 'Report Management' })).toBeVisible();
        await expect(titles(page)).toHaveCount(11);
    });

    test('lists reports with canonical hazard names and a verification-request badge', async ({ page }) => {
        await expect(page.getByText('Showing 1–11 of 11 reports')).toBeVisible();
        // Legacy "Floods" is shown under its canonical name.
        await expect(card(page, 'Legacy flood row').locator('h3')).toHaveText('Flooding');
        await expect(page.getByText('Verification request', { exact: true })).toHaveCount(1);
        await expect(card(page, 'Please verify: storm damage').getByText('Verification request')).toBeVisible();
        await expect(card(page, 'Please verify: storm damage').locator('h3')).toHaveText('Windstorms');
        await expect(card(page, 'Bush burning near farms')).toContainText('2 verifications');
        await expect(card(page, 'River Benue overflowing')).toContainText('Obi Ward, Obi, Benue');
    });

    test('shows report images from Storage paths and absolute URLs (allowed by the CSP)', async ({ page }) => {
        const images = card(page, 'River Benue overflowing').locator('img');
        await expect(images).toHaveCount(2);
        await expect(images.nth(0)).toHaveAttribute(
            'src',
            `${MOCK_URL}/storage/v1/object/public/report-images/reports/flood-1.jpg`,
        );
        await expect(images.nth(1)).toHaveAttribute('src', 'https://images.example/flood-2.jpg');
        // The Storage image actually loads (a CSP block would fail the console guard too).
        await expect
            .poll(() => images.nth(0).evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
            .toBe(1);
    });

    const HAZARD_EXPECTATIONS: [string, string[]][] = [
        ['Flooding', ['River Benue overflowing', 'Legacy flood row']],
        ['Extreme Temperatures', ['Heatwave in the market']],
        ['Drought', ['Wells running dry']],
        ['Windstorms', ['Roofs blown off', 'Please verify: storm damage']],
        ['Wildfires', ['Bush burning near farms']],
        ['Erosion', ['Gully widening on the road']],
        ['Pest Outbreak', ['Locusts on millet']],
        ['Crop Disease', ['Cassava mosaic']],
        ['Conflict', ['Herder clash reported']],
    ];

    test('hazard filter covers all 9 hazards, including legacy spellings', async ({ page, mock }) => {
        const filter = page.getByLabel('Filter reports by hazard');
        await expect(filter.locator('option')).toHaveText(['All Hazards', ...HAZARD_EXPECTATIONS.map(([h]) => h)]);
        for (const [hazard, descriptions] of HAZARD_EXPECTATIONS) {
            const loaded = page.waitForResponse(
                (r) =>
                    r.url().includes('/tables/reports/rows') &&
                    decodeURIComponent(r.url()).includes('"attribute":"hazardType"'),
            );
            await filter.selectOption(hazard);
            await loaded;
            await expect(titles(page), hazard).toHaveText(descriptions.map(() => hazard));
            for (const d of descriptions) await expect(card(page, d)).toBeVisible();
        }
        const flooding = (await mock.reads('reports')).find((r) =>
            decodeURIComponent(r.query).includes('"attribute":"hazardType"'),
        );
        // The canonical name plus every legacy spelling, so a row written
        // before the names were settled still answers the filter.
        const hazardQuery = JSON.parse(
            decodeURIComponent(flooding!.query).match(/\{"method":"equal","attribute":"hazardType"[^}]*\}/)![0],
        ) as { values: string[] };
        expect(hazardQuery.values).toEqual([
            'Flooding',
            'Flood',
            'Floods',
            'flood',
            'floods',
            'flooding',
            'Flash Flood',
            'flash flood',
        ]);

        await filter.selectOption('all');
        await expect(titles(page)).toHaveCount(11);
    });

    test('approves a report', async ({ page, mock }) => {
        await card(page, 'River Benue overflowing').getByRole('button', { name: 'Approve' }).click();
        await expect(toast(page, 'Report marked as approved')).toBeVisible();
        await expect(card(page, 'River Benue overflowing').getByText('Approved', { exact: true })).toBeVisible();
        const patch = (await mock.writes({ collection: 'reports', op: 'update' })).at(-1)!;
        expect(patch.data).toEqual({ status: 'approved', updatedBy: IDS.admin, approvedAt: expect.any(String) });
        // Optimistic lock: only applies to the status the card showed.
        expect(patch.expect).toEqual({ status: 'pending' });
        expect((await reportBy(mock, 'River Benue overflowing')).status).toBe('approved');
    });

    for (const [button, elsewhere] of [
        ['Approve', 'rejected'],
        ['Mark Verified', 'approved'],
    ] as const) {
        test(`${button} on a report decided elsewhere is refused and the list reloads`, async ({ page, mock }) => {
            const row = await reportBy(mock, 'Roofs blown off');
            // Another admin decides the report after this page loaded.
            await fetch(`${MOCK_URL}/__mock/table/reports/${row.$id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: elsewhere }),
            });
            const target = card(page, 'Roofs blown off');
            await expect(target.getByText('Pending', { exact: true })).toBeVisible();
            await target.getByRole('button', { name: button }).click();
            await expect(toast(page, 'This report changed since you loaded it — reloading')).toBeVisible();
            await expect(target.getByText(capitalize(elsewhere), { exact: true })).toBeVisible();
            const patch = (await mock.writes({ collection: 'reports', op: 'update' })).at(-1)!;
            expect(patch.expect).toEqual({ status: 'pending' });
            // Nothing was overwritten.
            expect((await reportBy(mock, 'Roofs blown off')).status).toBe(elsewhere);
        });
    }

    test('reset to pending of a report reopened elsewhere shows the server reason and reloads', async ({
        page,
        mock,
        consoleGuard,
    }) => {
        consoleGuard.allow(/status of 400 .*\/rest\/v1\/rpc\/reopen_report/);
        consoleGuard.allow(/Error updating report:/);
        const row = await reportBy(mock, 'Bush burning near farms');
        await fetch(`${MOCK_URL}/__mock/table/reports/${row.$id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'pending', verificationCount: 0 }),
        });
        const target = card(page, 'Bush burning near farms');
        await target.getByRole('button', { name: 'Reset to Pending' }).click();
        await page.getByRole('dialog', { name: 'Reset to Pending' }).getByRole('button', { name: 'Reset to Pending' }).click();
        await expect(toast(page, 'Report is already pending')).toBeVisible();
        // 22023 (invalid state): the list reloads and shows the current status.
        await expect(target.getByText('Pending', { exact: true })).toBeVisible();
        await expect(target).not.toContainText('verifications');
    });

    test('marks a report verified', async ({ page, mock }) => {
        await card(page, 'Roofs blown off').getByRole('button', { name: 'Mark Verified' }).click();
        await expect(toast(page, 'Report marked as verified')).toBeVisible();
        await expect(card(page, 'Roofs blown off').getByText('Verified', { exact: true })).toBeVisible();
        const patch = (await mock.writes({ collection: 'reports', op: 'update' })).at(-1)!;
        expect(patch.data).toEqual({ status: 'verified', updatedBy: IDS.admin, verifiedAt: expect.any(String) });
    });

    test('rejects with a reason after confirmation; cancel does nothing', async ({ page, mock }) => {
        const target = card(page, 'Locusts on millet');
        await target.getByRole('button', { name: 'Reject' }).click();
        let dialog = page.getByRole('dialog', { name: 'Reject Report' });
        await expect(dialog).toContainText('Reject this Pest Outbreak report?');
        await dialog.getByRole('button', { name: 'Cancel' }).click();
        await expect(dialog).toBeHidden();
        expect(await mock.writes({ collection: 'reports', op: 'update' })).toHaveLength(0);

        await target.getByRole('button', { name: 'Reject' }).click();
        dialog = page.getByRole('dialog', { name: 'Reject Report' });
        await dialog.getByLabel(/Reason/).fill('  Duplicate of an existing report  ');
        await dialog.getByRole('button', { name: 'Reject' }).click();
        await expect(toast(page, 'Report marked as rejected')).toBeVisible();
        await expect(target.getByText('Rejected', { exact: true })).toBeVisible();
        const patch = (await mock.writes({ collection: 'reports', op: 'update' })).at(-1)!;
        expect(patch.data).toEqual({
            status: 'rejected',
            updatedBy: IDS.admin,
            rejectedAt: expect.any(String),
            rejectionReason: 'Duplicate of an existing report',
        });
        expect((await reportBy(mock, 'Locusts on millet')).rejectionReason).toBe('Duplicate of an existing report');
    });

    test('rejecting without a reason stores null', async ({ page, mock }) => {
        await card(page, 'Cassava mosaic').getByRole('button', { name: 'Reject' }).click();
        await page.getByRole('dialog', { name: 'Reject Report' }).getByRole('button', { name: 'Reject' }).click();
        await expect(toast(page, 'Report marked as rejected')).toBeVisible();
        const patch = (await mock.writes({ collection: 'reports', op: 'update' })).at(-1)!;
        expect(patch.data).toMatchObject({ status: 'rejected', rejectionReason: null });
    });

    test('reset to pending goes through the reopen_report RPC', async ({ page, mock }) => {
        const target = card(page, 'Bush burning near farms');
        await target.getByRole('button', { name: 'Reset to Pending' }).click();
        const dialog = page.getByRole('dialog', { name: 'Reset to Pending' });
        await expect(dialog).toContainText('All peer verification votes (2)');
        await dialog.getByRole('button', { name: 'Reset to Pending' }).click();
        await expect(toast(page, 'Report marked as pending')).toBeVisible();
        await expect(target.getByText('Pending', { exact: true })).toBeVisible();
        await expect(target).not.toContainText('verifications');
        const rpc = (await mock.requests({ method: 'POST', path: '/functions/operation/executions' })).map(
            (r) => JSON.parse((r.body as { body: string }).body) as { operation: string; params: unknown },
        );
        expect(rpc).toHaveLength(1);
        const row = await reportBy(mock, 'Bush burning near farms');
        expect(rpc[0]).toEqual({ operation: 'reopen_report', params: { p_report_id: row.$id } });
        expect(row.status).toBe('pending');
        // Never written as a plain status update (the database refuses that).
        expect(await mock.writes({ collection: 'reports', op: 'update' })).toHaveLength(0);
    });

    test('status filter reloads when a report leaves the filtered status', async ({ page }) => {
        const loaded = page.waitForResponse((r) => r.url().includes('status=eq.pending'));
        await page.getByLabel('Filter reports by status').selectOption('pending');
        await loaded;
        await expect(titles(page)).toHaveCount(8);
        await card(page, 'Gully widening on the road').getByRole('button', { name: 'Approve' }).click();
        await expect(toast(page, 'Report marked as approved')).toBeVisible();
        await expect(titles(page)).toHaveCount(7);
        await expect(card(page, 'Gully widening on the road')).toHaveCount(0);
    });
});
