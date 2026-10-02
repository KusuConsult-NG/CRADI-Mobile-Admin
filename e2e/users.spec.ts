import type { Page } from '@playwright/test';
import { test, expect, openAsAdmin, toast, IDS, MOCK_URL } from './fixtures';

type Profile = {
    $id: string;
    role: string;
    state: string;
    lga: string;
    ward: string;
    isApproved: boolean;
    isVerified: boolean;
    isDisabled: boolean;
};

function row(page: Page, name: string) {
    return page.getByRole('row').filter({ hasText: name });
}

async function profileOf(mock: { table<T>(name: string): Promise<T[]> }, id: string) {
    const rows = await mock.table<Profile>('profiles');
    return rows.find((p) => p.$id === id);
}

async function confirmDialog(page: Page, title: string, button: string) {
    const dialog = page.getByRole('dialog', { name: title });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: button, exact: true }).click();
    await expect(dialog).toBeHidden();
}

test.describe('users', () => {
    test.beforeEach(async ({ page }) => {
        await openAsAdmin(page, '/dashboard/users');
        await expect(page.getByRole('heading', { name: 'User Management' })).toBeVisible();
    });

    test('lists users with status and "Email not confirmed" badges', async ({ page }) => {
        await expect(page.getByRole('row')).toHaveCount(6); // header + 5 users
        await expect(page.getByText('Showing 1–5 of 5 users')).toBeVisible();
        await expect(row(page, 'Uche Unconfirmed').getByText('Email not confirmed')).toBeVisible();
        await expect(page.getByText('Email not confirmed')).toHaveCount(1);
        await expect(row(page, 'Ada Confirmed').getByText('Pending', { exact: true })).toBeVisible();
        await expect(row(page, 'Bola Approved').getByText('Approved', { exact: true })).toBeVisible();
        await expect(row(page, 'Chidi Blocked').getByText('Blocked', { exact: true })).toBeVisible();
        await expect(row(page, 'Chidi Blocked')).toContainText("Bwall, Qua'an Pan, Plateau");
        // No self-destructive actions on your own row.
        const self = row(page, 'Grace Admin');
        await expect(self.getByRole('button', { name: /^Block/ })).toHaveCount(0);
        await expect(self.getByRole('button', { name: /^Delete/ })).toHaveCount(0);
        await expect(self.getByRole('button', { name: /^Change role/ })).toHaveCount(0);
    });

    test('search and status filter become Appwrite queries', async ({ page, mock }) => {
        await page.getByLabel('Filter users by status').selectOption('pending');
        await expect(page.getByRole('row')).toHaveCount(3);
        await page.getByLabel('Search users').fill('uche');
        await expect(page.getByRole('row')).toHaveCount(2);
        await expect(row(page, 'Uche Unconfirmed')).toBeVisible();
        const last = (await mock.reads('profiles'))
            .filter((r) => decodeURIComponent(r.query).includes('"method":"or"'))
            .at(-1);
        const q = decodeURIComponent(last!.query);
        expect(q).toContain('{"method":"equal","attribute":"isApproved","values":[false]}');
        expect(q).toContain('{"method":"equal","attribute":"isDisabled","values":[false]}');
        // `contains` on a string is a case-insensitive substring match,
        // which is what the PostgREST `ilike` filters were.
        for (const field of ['name', 'email', 'phone']) {
            expect(q).toContain(`{"method":"contains","attribute":"${field}","values":["uche"]}`);
        }
    });

    test('approves a user whose email is confirmed', async ({ page, mock }) => {
        await row(page, 'Ada Confirmed').getByRole('button', { name: 'Approve Ada Confirmed' }).click();
        await confirmDialog(page, 'Approve User', 'Approve');
        await expect(toast(page, 'User approved successfully!')).toBeVisible();
        await expect(row(page, 'Ada Confirmed').getByText('Approved', { exact: true })).toBeVisible();
        const p = await profileOf(mock, IDS.pendingConfirmed);
        expect(p).toMatchObject({ isApproved: true, isVerified: true });
        // User administration does not go through the `write` Function — it
        // goes through /api/admin/users/[uid], which uses the API key and a
        // bulk `updateRows` whose queries are the compare-and-set.
        const patch = (await mock.requests({
            method: 'PATCH',
            path: '/tablesdb/cradi/tables/profiles/rows',
        })).at(-1)!;
        const pinned = ((patch.body as { queries: string[] }).queries ?? []).map(
            (q) => JSON.parse(q) as { method: string; attribute: string; values: unknown[] },
        );
        // The values the admin reviewed are pinned, so an edit made in
        // another tab is refused rather than silently overwritten.
        expect(pinned).toEqual(
            expect.arrayContaining([
                { method: 'equal', attribute: '$id', values: [IDS.pendingConfirmed] },
                { method: 'equal', attribute: 'role', values: ['ewm'] },
                { method: 'equal', attribute: 'lga', values: ['Ado'] },
                { method: 'equal', attribute: 'ward', values: ['Apa'] },
            ]),
        );
    });

    test('refuses to approve a user whose email is not confirmed', async ({ page, mock, consoleGuard }) => {
        consoleGuard.allow(/status of 409 .*\/api\/admin\/users\//);
        consoleGuard.allow(/Error approving user:/);
        await row(page, 'Uche Unconfirmed').getByRole('button', { name: 'Approve Uche Unconfirmed' }).click();
        await confirmDialog(page, 'Approve User', 'Approve');
        await expect(
            toast(page, 'Failed to approve user: Email not confirmed: the user must confirm their email address'),
        ).toBeVisible();
        await expect(row(page, 'Uche Unconfirmed').getByText('Pending', { exact: true })).toBeVisible();
        await expect(row(page, 'Uche Unconfirmed').getByText('Email not confirmed')).toBeVisible();
        expect((await profileOf(mock, IDS.pendingUnconfirmed))?.isApproved).toBe(false);
        expect(await mock.writes({ collection: 'profiles', op: 'update' })).toHaveLength(0);
    });

    test('an approval is refused when the user changed their details meanwhile', async ({
        page,
        mock,
        consoleGuard,
    }) => {
        consoleGuard.allow(/status of 409 .*\/api\/admin\/users\//);
        consoleGuard.allow(/Error approving user:/);
        // The user moves to another LGA after the admin loaded the list.
        await expect(row(page, 'Ada Confirmed')).toContainText('Apa, Ado, Benue');
        await fetch(`${MOCK_URL}/__mock/table/profiles/${IDS.pendingConfirmed}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lga: 'Agatu', ward: 'Usha' }),
        });
        await row(page, 'Ada Confirmed').getByRole('button', { name: 'Approve Ada Confirmed' }).click();
        await confirmDialog(page, 'Approve User', 'Approve');
        await expect(
            toast(page, 'Failed to approve user: User details changed since you loaded them — reload and review again.'),
        ).toBeVisible();
        expect((await profileOf(mock, IDS.pendingConfirmed))?.isApproved).toBe(false);
    });

    test('changes a role', async ({ page, mock }) => {
        await row(page, 'Ada Confirmed').getByRole('button', { name: 'Change role of Ada Confirmed' }).click();
        const dialog = page.getByRole('dialog', { name: 'Change Role' });
        await expect(dialog.getByRole('button', { name: 'Save Role' })).toBeDisabled();
        await dialog.getByLabel('Role').selectOption('ewr');
        await dialog.getByRole('button', { name: 'Save Role' }).click();
        await expect(toast(page, 'Role changed to EW Responder')).toBeVisible();
        await expect(row(page, 'Ada Confirmed')).toContainText('EW Responder');
        expect((await profileOf(mock, IDS.pendingConfirmed))?.role).toBe('ewr');

        // A second change is pinned to the new role (no false "changed" conflict).
        await row(page, 'Ada Confirmed').getByRole('button', { name: 'Change role of Ada Confirmed' }).click();
        await page.getByRole('dialog', { name: 'Change Role' }).getByLabel('Role').selectOption('ldp_coordinator');
        await page.getByRole('button', { name: 'Save Role' }).click();
        await expect(toast(page, 'Role changed to LDP Coordinator')).toBeVisible();
        expect((await profileOf(mock, IDS.pendingConfirmed))?.role).toBe('ldp_coordinator');
    });

    test('blocks and unblocks a user (profile flag + account status)', async ({ page, mock }) => {
        await row(page, 'Bola Approved').getByRole('button', { name: 'Block Bola Approved' }).click();
        await confirmDialog(page, 'Block User', 'Block');
        await expect(toast(page, 'User blocked successfully!')).toBeVisible();
        await expect(row(page, 'Bola Approved').getByText('Blocked', { exact: true })).toBeVisible();
        expect((await profileOf(mock, IDS.approved))?.isDisabled).toBe(true);
        // Appwrite has no ban duration: an account is active or it is not.
        let status = await mock.requests({
            method: 'PATCH',
            path: `/users/${IDS.approved}/status`,
        });
        expect(status.map((r) => r.body)).toEqual([{ status: false }]);

        await row(page, 'Bola Approved').getByRole('button', { name: 'Unblock Bola Approved' }).click();
        await confirmDialog(page, 'Unblock User', 'Unblock');
        await expect(toast(page, 'User unblocked successfully!')).toBeVisible();
        await expect(row(page, 'Bola Approved').getByText('Approved', { exact: true })).toBeVisible();
        expect((await profileOf(mock, IDS.approved))?.isDisabled).toBe(false);
        status = await mock.requests({
            method: 'PATCH',
            path: `/users/${IDS.approved}/status`,
        });
        expect(status.at(-1)?.body).toEqual({ status: true });
    });

    test('revokes approval', async ({ page, mock }) => {
        await row(page, 'Bola Approved').getByRole('button', { name: 'Revoke approval of Bola Approved' }).click();
        await confirmDialog(page, 'Revoke Approval', 'Revoke');
        await expect(toast(page, 'Approval revoked')).toBeVisible();
        await expect(row(page, 'Bola Approved').getByText('Pending', { exact: true })).toBeVisible();
        await expect(row(page, 'Bola Approved').getByRole('button', { name: 'Approve Bola Approved' })).toBeVisible();
        expect((await profileOf(mock, IDS.approved))?.isApproved).toBe(false);
    });

    test('approving or blocking in a filtered list reloads it (the row leaves the filter)', async ({ page }) => {
        const filter = page.getByLabel('Filter users by status');
        await filter.selectOption('pending');
        await expect(page.getByRole('row')).toHaveCount(3);
        await row(page, 'Ada Confirmed').getByRole('button', { name: 'Approve Ada Confirmed' }).click();
        await confirmDialog(page, 'Approve User', 'Approve');
        await expect(toast(page, 'User approved successfully!')).toBeVisible();
        await expect(row(page, 'Ada Confirmed')).toHaveCount(0);
        await expect(page.getByRole('row')).toHaveCount(2);

        await filter.selectOption('approved');
        await expect(row(page, 'Ada Confirmed')).toBeVisible();
        await row(page, 'Bola Approved').getByRole('button', { name: 'Block Bola Approved' }).click();
        await confirmDialog(page, 'Block User', 'Block');
        await expect(toast(page, 'User blocked successfully!')).toBeVisible();
        await expect(row(page, 'Bola Approved')).toHaveCount(0);

        await filter.selectOption('blocked');
        await expect(row(page, 'Bola Approved')).toBeVisible();
        await row(page, 'Bola Approved').getByRole('button', { name: 'Unblock Bola Approved' }).click();
        await confirmDialog(page, 'Unblock User', 'Unblock');
        await expect(toast(page, 'User unblocked successfully!')).toBeVisible();
        await expect(row(page, 'Bola Approved')).toHaveCount(0);
    });

    test('changes location through the state → LGA → ward cascade (Obi exists in two states)', async ({
        page,
        mock,
    }) => {
        await row(page, 'Bola Approved').getByRole('button', { name: 'Change location of Bola Approved' }).click();
        const dialog = page.getByRole('dialog', { name: 'Change Location' });
        const state = dialog.getByLabel('State');
        const lga = dialog.getByLabel('LGA');
        const ward = dialog.getByLabel('Ward', { exact: true });

        // Pre-filled with the current Benue / Obi / Obi Ward.
        await expect(state).toHaveValue('Benue');
        await expect(lga).toHaveValue('Obi');
        await expect(ward).toHaveValue('Obi Ward');

        // Nasarawa's Obi has different wards from Benue's Obi.
        await state.selectOption('Nasarawa');
        await expect(lga).toHaveValue('');
        await expect(ward).toBeDisabled();
        await expect(dialog.getByRole('button', { name: 'Continue' })).toBeDisabled();
        await lga.selectOption('Obi');
        await expect(ward.locator('option', { hasText: 'Agwatashi' })).toHaveCount(1);
        await expect(ward.locator('option', { hasText: 'Obi Ward' })).toHaveCount(0);
        await state.selectOption('Benue');
        await lga.selectOption('Obi');
        await expect(ward.locator('option', { hasText: 'Agwatashi' })).toHaveCount(0);
        await expect(ward.locator('option', { hasText: 'Obi Ward' })).toHaveCount(1);

        await state.selectOption('Nasarawa');
        await lga.selectOption('Obi');
        await ward.selectOption('Agwatashi');
        await dialog.getByRole('button', { name: 'Continue' }).click();

        const confirm = page.getByRole('dialog', { name: 'Change Location' });
        await expect(confirm).toContainText('from Obi Ward, Obi, Benue to Agwatashi, Obi, Nasarawa');
        await confirm.getByRole('button', { name: 'Change location' }).click();
        await expect(toast(page, 'Location updated')).toBeVisible();
        await expect(row(page, 'Bola Approved')).toContainText('Agwatashi, Obi, Nasarawa');
        expect(await profileOf(mock, IDS.approved)).toMatchObject({ state: 'Nasarawa', lga: 'Obi', ward: 'Agwatashi' });

        // A ward missing from the INEC list can be typed.
        await row(page, 'Bola Approved').getByRole('button', { name: 'Change location of Bola Approved' }).click();
        await ward.selectOption('__other__');
        await dialog.getByLabel('Ward name').fill('  New Layout  ');
        await dialog.getByRole('button', { name: 'Continue' }).click();
        await page.getByRole('dialog', { name: 'Change Location' }).getByRole('button', { name: 'Change location' }).click();
        await expect(toast(page, 'Location updated')).toBeVisible();
        expect(await profileOf(mock, IDS.approved)).toMatchObject({ state: 'Nasarawa', lga: 'Obi', ward: 'New Layout' });
    });

    test('deletes a user', async ({ page, mock }) => {
        await row(page, 'Chidi Blocked').getByRole('button', { name: 'Delete Chidi Blocked' }).click();
        await confirmDialog(page, 'Delete User', 'Delete');
        await expect(toast(page, 'User deleted successfully!')).toBeVisible();
        await expect(row(page, 'Chidi Blocked')).toHaveCount(0);
        expect(await profileOf(mock, IDS.blocked)).toBeUndefined();
    });
});
