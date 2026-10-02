import type { Page } from '@playwright/test';
import { test, expect, openAsAdmin, toast } from './fixtures';

type NewsLinkRow = {
    id: string;
    title: string;
    url: string;
    source: string;
    sortOrder: number;
    isActive: boolean;
};

function row(page: Page, title: string) {
    return page.getByRole('row').filter({ hasText: title });
}

async function linkBy(mock: { table<T>(name: string): Promise<T[]> }, title: string) {
    return (await mock.table<NewsLinkRow>('news_links')).find((l) => l.title === title);
}

test.describe('news links', () => {
    test.beforeEach(async ({ page }) => {
        await openAsAdmin(page, '/dashboard/news');
        await expect(page.getByRole('heading', { name: 'News Links', exact: true })).toBeVisible();
        await expect(page.getByText('Showing 1–5 of 5 links')).toBeVisible();
    });

    test('lists links in sort order with their status and explains where they appear', async ({ page, mock }) => {
        await expect(page.getByText(/appear in the mobile app.s News section when the live ReliefWeb feed is\s+unavailable/)).toBeVisible();
        const titles = await page.locator('tbody tr td:nth-child(2) p').allTextContents();
        expect(titles).toEqual([
            'Flood Safety: What to do before, during, and after',
            'NiMet Seasonal Climate Prediction',
            'Emergency Contact Directory: Nigeria',
            'Understanding Early Warning Systems',
            'Archived bulletin',
        ]);
        const nimet = row(page, 'NiMet Seasonal Climate Prediction');
        await expect(nimet.getByRole('link', { name: 'https://nimet.gov.ng/' })).toHaveAttribute('href', 'https://nimet.gov.ng/');
        await expect(nimet.getByRole('link', { name: 'https://nimet.gov.ng/' })).toHaveAttribute('target', '_blank');
        await expect(nimet.getByRole('button', { name: 'Hide NiMet Seasonal Climate Prediction' })).toHaveText('Active');
        await expect(row(page, 'Archived bulletin').getByRole('button', { name: 'Show Archived bulletin' })).toHaveText('Hidden');

        // Same order as the mobile app: sortOrder, then oldest first, with
        // `$id` as the tiebreak that keeps the page boundary stable.
        const get = (await mock.reads('news_links'))[0];
        const asked = decodeURIComponent(get.query);
        expect(asked).toContain('{"method":"orderAsc","attribute":"sortOrder"}');
        expect(asked).toContain('{"method":"orderAsc","attribute":"$createdAt"}');
        expect(asked).toContain('{"method":"orderAsc","attribute":"$id"}');
    });

    test('creates a link at the end of the list when no sort order is given', async ({ page, mock }) => {
        await page.getByRole('button', { name: 'Add Link' }).click();
        const dialog = page.getByRole('dialog', { name: 'Add Link' });
        await dialog.getByLabel('Title').fill('  NEMA flood outlook ');
        await dialog.getByLabel('URL').fill(' https://nema.gov.ng/outlook ');
        await dialog.getByLabel(/Source/).fill(' NEMA ');
        await dialog.getByRole('button', { name: 'Add Link' }).click();

        await expect(toast(page, 'Link added')).toBeVisible();
        await expect(dialog).toBeHidden();
        await expect(page.getByText('Showing 1–6 of 6 links')).toBeVisible();
        await expect(row(page, 'NEMA flood outlook')).toContainText('60');
        const post = (await mock.writes({ collection: 'news_links', op: 'create' })).at(-1)!;
        expect(post.data).toEqual({
            title: 'NEMA flood outlook',
            url: 'https://nema.gov.ng/outlook',
            source: 'NEMA',
            sortOrder: 60,
            isActive: true,
        });
    });

    test('rejects a missing title, non-http(s) URLs and a bad sort order', async ({ page, mock }) => {
        await page.getByRole('button', { name: 'Add Link' }).click();
        const dialog = page.getByRole('dialog', { name: 'Add Link' });
        const submit = dialog.getByRole('button', { name: 'Add Link' });

        await dialog.getByLabel('URL').fill('https://example.org');
        await submit.click();
        await expect(toast(page, 'Title is required.')).toBeVisible();

        await dialog.getByLabel('Title').fill('Bad link');
        for (const bad of ['ftp://example.org/file', 'example.org', 'javascript:alert(1)', 'https://exa mple.org']) {
            await dialog.getByLabel('URL').fill(bad);
            await submit.click();
            await expect(toast(page, 'URL must be a web address starting with http:// or https://')).toBeVisible();
        }
        await dialog.getByLabel('URL').fill('');
        await submit.click();
        await expect(toast(page, 'URL is required.')).toBeVisible();

        await dialog.getByLabel('URL').fill('https://example.org');
        await dialog.getByLabel('Sort order').fill('1.5');
        await submit.click();
        await expect(toast(page, 'Sort order must be a whole number.')).toBeVisible();

        await expect(dialog).toBeVisible();
        expect(await mock.writes({ collection: 'news_links', op: 'create' })).toHaveLength(0);
    });

    test('edits a link, including its sort order and active flag', async ({ page, mock }) => {
        await row(page, 'Understanding Early Warning Systems')
            .getByRole('button', { name: 'Edit Understanding Early Warning Systems' })
            .click();
        const dialog = page.getByRole('dialog', { name: 'Edit Link' });
        await expect(dialog.getByLabel('Title')).toHaveValue('Understanding Early Warning Systems');
        await expect(dialog.getByLabel('URL')).toHaveValue('https://www.undrr.org/terminology/early-warning-system');
        await expect(dialog.getByLabel(/Source/)).toHaveValue('UNDRR');
        await expect(dialog.getByLabel('Sort order')).toHaveValue('40');
        await expect(dialog.getByLabel(/Active/)).toBeChecked();

        await dialog.getByLabel('Title').fill('Early Warning Systems explained');
        await dialog.getByLabel('Sort order').fill('5');
        await dialog.getByLabel('Sort order').press('Tab');
        await dialog.getByRole('button', { name: 'Save Changes' }).click();
        await expect(toast(page, 'Link updated')).toBeVisible();

        const patch = (await mock.writes({ collection: 'news_links', op: 'update' })).at(-1)!;
        expect(patch.documentId).toBe('news0000000000000004');
        expect(patch.data).toEqual({
            title: 'Early Warning Systems explained',
            url: 'https://www.undrr.org/terminology/early-warning-system',
            source: 'UNDRR',
            sortOrder: 5,
            isActive: true,
        });
        // Now first in the list.
        await expect(page.locator('tbody tr').first()).toContainText('Early Warning Systems explained');

        // An existing link must keep a sort order.
        await row(page, 'Archived bulletin').getByRole('button', { name: 'Edit Archived bulletin' }).click();
        const again = page.getByRole('dialog', { name: 'Edit Link' });
        await again.getByLabel('Sort order').fill('');
        await again.getByRole('button', { name: 'Save Changes' }).click();
        await expect(toast(page, 'Sort order is required.')).toBeVisible();
    });

    test('toggles a link between active and hidden', async ({ page, mock }) => {
        const title = 'NiMet Seasonal Climate Prediction';
        await row(page, title).getByRole('button', { name: `Hide ${title}` }).click();
        await expect(toast(page, 'Link hidden from the app')).toBeVisible();
        await expect(row(page, title).getByRole('button', { name: `Show ${title}` })).toHaveText('Hidden');
        expect(await linkBy(mock, title)).toMatchObject({ isActive: false });
        let patch = (await mock.writes({ collection: 'news_links', op: 'update' })).at(-1)!;
        expect(patch.data).toEqual({ isActive: false });

        await row(page, title).getByRole('button', { name: `Show ${title}` }).click();
        await expect(toast(page, 'Link shown in the app')).toBeVisible();
        await expect(row(page, title).getByRole('button', { name: `Hide ${title}` })).toHaveText('Active');
        expect(await linkBy(mock, title)).toMatchObject({ isActive: true });
        patch = (await mock.writes({ collection: 'news_links', op: 'update' })).at(-1)!;
        expect(patch.data).toEqual({ isActive: true });
    });

    test('deletes a link after confirmation', async ({ page, mock }) => {
        const title = 'Emergency Contact Directory: Nigeria';
        await row(page, title).getByRole('button', { name: `Delete ${title}` }).click();
        const dialog = page.getByRole('dialog', { name: 'Delete Link' });
        await expect(dialog).toContainText(`Delete “${title}”?`);
        await dialog.getByRole('button', { name: 'Cancel' }).click();
        await expect(dialog).toBeHidden();
        expect(await linkBy(mock, title)).toBeDefined();

        await row(page, title).getByRole('button', { name: `Delete ${title}` }).click();
        await page.getByRole('dialog', { name: 'Delete Link' }).getByRole('button', { name: 'Delete' }).click();
        await expect(toast(page, 'Link deleted')).toBeVisible();
        await expect(page.getByText('Showing 1–4 of 4 links')).toBeVisible();
        await expect(row(page, title)).toHaveCount(0);
        expect(await linkBy(mock, title)).toBeUndefined();
    });
});
