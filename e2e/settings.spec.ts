import { test, expect, openAsAdmin, toast } from './fixtures';

type SettingRow = { key: string; value: unknown; updated_at: string };

test.describe('app settings', () => {
    test.beforeEach(async ({ page }) => {
        await openAsAdmin(page, '/dashboard/settings');
        await expect(page.getByRole('heading', { name: 'App Settings' })).toBeVisible();
        await expect(page.getByLabel('Minimum peer confirmations')).toBeVisible();
    });

    test('loads stored values and defaults for missing keys', async ({ page, mock }) => {
        await expect(page.getByLabel('Minimum peer confirmations')).toHaveValue('2');
        // Stored as the JSON string "30": still read as a number.
        await expect(page.getByLabel('Escalation timeout')).toHaveValue('30');
        await expect(page.getByLabel('Max SMS per alert event')).toHaveValue('20');
        await expect(page.getByLabel('Max SMS per LGA per day')).toHaveValue('50');
        await expect(page.getByRole('switch', { name: 'Peer chat enabled' })).toBeChecked();
        await expect(page.getByLabel('Minimum app version')).toHaveValue('1.0.0');
        await expect(page.getByLabel('Update required message')).toHaveValue('');
        await expect(page.getByText('Not set: the default shown is used until you save.')).toHaveCount(3);
        // Missing keys count as changes until saved.
        await expect(page.getByRole('button', { name: 'Save 3 changes' })).toBeEnabled();

        const get = (await mock.requests({ method: 'GET', path: '/rest/v1/app_settings' }))[0];
        expect(decodeURIComponent(get.query)).toBe(
            'select=key,value,updated_at&key=in.(minimum_peer_confirmations,escalation_timeout_minutes,max_sms_per_alert_event,max_sms_per_lga_per_day,feature_flag_peer_chat,app_min_version,app_min_version_message)',
        );
    });

    test('shows validation errors and blocks saving', async ({ page, mock }) => {
        const save = page.getByRole('button', { name: /^Save/ });
        const peers = page.getByLabel('Minimum peer confirmations');

        await peers.fill('0');
        await expect(page.getByText('Must be between 1 and 10.')).toBeVisible();
        await expect(peers).toHaveAttribute('aria-invalid', 'true');
        await expect(save).toBeDisabled();

        await peers.fill('2.5');
        await expect(page.getByText('Enter a whole number.')).toBeVisible();

        await peers.fill('');
        await expect(page.getByText('Enter a whole number.')).toBeVisible();

        await peers.fill('11');
        await expect(page.getByText('Must be between 1 and 10.')).toBeVisible();
        await peers.fill('3');
        await expect(page.getByRole('alert').filter({ hasText: 'between' })).toHaveCount(0);

        await page.getByLabel('Escalation timeout').fill('4');
        await expect(page.getByText('Must be between 5 and 1440.')).toBeVisible();
        await page.getByLabel('Escalation timeout').fill('30');

        const version = page.getByLabel('Minimum app version');
        for (const bad of ['1.0', 'v1.0.0', '1.0.0-beta', '1..0']) {
            await version.fill(bad);
            await expect(page.getByText('Use the form MAJOR.MINOR.PATCH, e.g. 1.0.14.')).toBeVisible();
            await expect(save).toBeDisabled();
        }
        await version.fill('1.0.14');
        await expect(save).toBeEnabled();
        expect(await mock.requests({ method: 'POST', path: '/rest/v1/app_settings' })).toHaveLength(0);
    });

    test('saves changed values as typed JSON via upsert', async ({ page, mock }) => {
        await page.getByLabel('Minimum peer confirmations').fill('3');
        await page.getByRole('switch', { name: 'Peer chat enabled' }).uncheck();
        await page.getByLabel('Minimum app version').fill(' 1.2.3 ');
        await page.getByLabel('Update required message').fill('  Please update now.  ');
        await expect(page.getByText('Unsaved change')).toHaveCount(3);
        await page.getByRole('button', { name: 'Save 6 changes' }).click();
        await expect(toast(page, 'Saved 6 settings')).toBeVisible();

        const post = (await mock.requests({ method: 'POST', path: '/rest/v1/app_settings' })).at(-1)!;
        expect(post.query).toContain('on_conflict=key');
        expect(post.prefer).toContain('resolution=merge-duplicates');
        const byKey = Object.fromEntries((post.body as SettingRow[]).map((r) => [r.key, r.value]));
        expect(byKey).toStrictEqual({
            minimum_peer_confirmations: 3,
            max_sms_per_alert_event: 20,
            max_sms_per_lga_per_day: 50,
            feature_flag_peer_chat: false,
            app_min_version: '1.2.3',
            app_min_version_message: 'Please update now.',
            // escalation_timeout_minutes is stored as "30" and unchanged: not written.
        } as Record<string, unknown>);
        for (const r of post.body as SettingRow[]) expect(typeof r.updated_at).toBe('string');

        const stored = Object.fromEntries((await mock.table<SettingRow>('app_settings')).map((r) => [r.key, r.value]));
        expect(stored).toMatchObject({ minimum_peer_confirmations: 3, feature_flag_peer_chat: false, unrelated_key: 'ignored' });

        // Reloaded: nothing left to save.
        await expect(page.getByRole('button', { name: 'Save changes' })).toBeDisabled();
        await expect(page.getByText('Not set: the default shown is used until you save.')).toHaveCount(0);
        await page.reload();
        await expect(page.getByLabel('Minimum peer confirmations')).toHaveValue('3');
        await expect(page.getByRole('switch', { name: 'Peer chat enabled' })).not.toBeChecked();
        await expect(page.getByLabel('Minimum app version')).toHaveValue('1.2.3');
    });

    test('only changed keys are written; discard restores loaded values', async ({ page, mock }) => {
        // Save the 3 missing defaults first so later saves are minimal.
        await page.getByRole('button', { name: 'Save 3 changes' }).click();
        await expect(toast(page, 'Saved 3 settings')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Save changes' })).toBeDisabled();

        await page.getByLabel('Escalation timeout').fill('45');
        await page.getByLabel('Minimum app version').fill('2.0.0');
        await page.getByRole('button', { name: 'Discard changes' }).click();
        await expect(page.getByLabel('Escalation timeout')).toHaveValue('30');
        await expect(page.getByLabel('Minimum app version')).toHaveValue('1.0.0');

        await page.getByLabel('Escalation timeout').fill('45');
        await page.getByRole('button', { name: 'Save 1 change' }).click();
        await expect(toast(page, 'Saved 1 setting')).toBeVisible();
        const post = (await mock.requests({ method: 'POST', path: '/rest/v1/app_settings' })).at(-1)!;
        expect((post.body as SettingRow[]).map(({ key, value }) => ({ key, value }))).toEqual([
            { key: 'escalation_timeout_minutes', value: 45 },
        ]);
    });
});
