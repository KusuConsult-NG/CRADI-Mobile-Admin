import type { Page } from '@playwright/test';
import { test, expect, openAsAdmin, toast } from './fixtures';

type Article = { $id: string; title: string; category: string; hazardType: string; source: string; imageUrl: string | null };

function articleCard(page: Page, title: string) {
    return page.locator('div.bg-white.rounded-xl').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
}

async function articleBy(mock: { table<T>(name: string): Promise<T[]> }, title: string) {
    return (await mock.table<Article>('knowledge_base')).find((a) => a.title === title);
}

test.describe('knowledge base', () => {
    test.beforeEach(async ({ page }) => {
        await openAsAdmin(page, '/dashboard/knowledge');
        await expect(page.getByRole('heading', { name: 'Knowledge Base' })).toBeVisible();
        await expect(page.getByText('Showing 1–2 of 2 articles')).toBeVisible();
    });

    test('creates an article with the chosen category and hazard type', async ({ page, mock }) => {
        await page.getByRole('button', { name: 'New Article' }).click();
        const dialog = page.getByRole('dialog', { name: 'New Article' });
        await expect(dialog.getByLabel('Category')).toHaveValue('general');
        await dialog.getByLabel('Title').fill('Storm preparedness');
        await dialog.getByLabel('Category').selectOption({ label: 'Storm' });
        await dialog.getByLabel('Source').fill(' NiMet ');
        await dialog.getByLabel('Content').fill('Secure loose roofing sheets.');
        await dialog.getByRole('button', { name: 'Create Article' }).click();
        await expect(toast(page, 'Article created')).toBeVisible();
        await expect(articleCard(page, 'Storm preparedness')).toContainText('Storm');
        const post = (await mock.writes({ collection: 'knowledge_base', op: 'create' })).at(-1)!;
        expect(post.data).toEqual({
            title: 'Storm preparedness',
            content: 'Secure loose roofing sheets.',
            source: 'NiMet',
            imageUrl: null,
            category: 'Storm',
            hazardType: 'storm',
        });
    });

    test('rejects a non-https image URL and missing content', async ({ page, mock }) => {
        await page.getByRole('button', { name: 'New Article' }).click();
        const dialog = page.getByRole('dialog', { name: 'New Article' });
        await dialog.getByLabel('Title').fill('Untrusted image');
        await dialog.getByLabel('Content').fill('Body');
        await dialog.getByLabel(/Image URL/).fill('http://example.com/a.png');
        await dialog.getByRole('button', { name: 'Create Article' }).click();
        await expect(toast(page, 'Image URL must start with https://')).toBeVisible();
        await dialog.getByLabel('Content').fill('   ');
        await dialog.getByLabel(/Image URL/).fill('');
        await dialog.getByRole('button', { name: 'Create Article' }).click();
        await expect(toast(page, 'Title and content are required.')).toBeVisible();
        expect(await mock.writes({ collection: 'knowledge_base', op: 'create' })).toHaveLength(0);
    });

    test('editing an article with a legacy category keeps its category and hazard type', async ({ page, mock }) => {
        await articleCard(page, 'Legacy floods guide').getByRole('button', { name: 'Edit article Legacy floods guide' }).click();
        const dialog = page.getByRole('dialog', { name: 'Edit Article' });
        const category = dialog.getByLabel('Category');
        await expect(category).toHaveValue('__stored__');
        await expect(category.locator('option:checked')).toHaveText('Floods / flooding (current)');
        await dialog.getByLabel('Title').fill('Legacy floods guide (revised)');
        await dialog.getByRole('button', { name: 'Save Changes' }).click();
        await expect(toast(page, 'Article updated')).toBeVisible();

        const patch = (await mock.writes({ collection: 'knowledge_base', op: 'update' })).at(-1)!;
        expect(patch.data).toEqual({
            title: 'Legacy floods guide (revised)',
            content: 'Old article with a legacy category.',
            source: 'NiMet',
            imageUrl: null,
        });
        expect(await articleBy(mock, 'Legacy floods guide (revised)')).toMatchObject({
            category: 'Floods',
            hazardType: 'flooding',
        });
    });

    test('editing an article with a listed category keeps it, or changes it when picked', async ({ page, mock }) => {
        const edit = () =>
            articleCard(page, 'Flood safety basics').getByRole('button', { name: 'Edit article Flood safety basics' }).click();
        await edit();
        let dialog = page.getByRole('dialog', { name: 'Edit Article' });
        await expect(dialog.getByLabel('Category')).toHaveValue('flood');
        await expect(dialog.getByLabel('Category').locator('option', { hasText: '(current)' })).toHaveCount(0);
        await dialog.getByRole('button', { name: 'Save Changes' }).click();
        await expect(toast(page, 'Article updated')).toBeVisible();
        let patch = (await mock.writes({ collection: 'knowledge_base', op: 'update' })).at(-1)!;
        expect(patch.data).toMatchObject({ category: 'Flood', hazardType: 'flood' });

        await edit();
        dialog = page.getByRole('dialog', { name: 'Edit Article' });
        await dialog.getByLabel('Category').selectOption({ label: 'Extreme Heat' });
        await dialog.getByRole('button', { name: 'Save Changes' }).click();
        await expect(toast(page, 'Article updated')).toBeVisible();
        patch = (await mock.writes({ collection: 'knowledge_base', op: 'update' })).at(-1)!;
        expect(patch.data).toMatchObject({ category: 'Extreme Heat', hazardType: 'extreme_heat' });
        await expect(articleCard(page, 'Flood safety basics')).toContainText('Extreme Heat');
    });

    test('deletes an article after confirmation', async ({ page, mock }) => {
        await articleCard(page, 'Flood safety basics').getByRole('button', { name: 'Delete article Flood safety basics' }).click();
        const dialog = page.getByRole('dialog', { name: 'Delete Article' });
        await expect(dialog).toContainText('Delete “Flood safety basics”? This cannot be undone.');
        await dialog.getByRole('button', { name: 'Delete' }).click();
        await expect(toast(page, 'Article deleted')).toBeVisible();
        await expect(page.getByText('Showing 1–1 of 1 articles')).toBeVisible();
        expect(await articleBy(mock, 'Flood safety basics')).toBeUndefined();
    });
});
