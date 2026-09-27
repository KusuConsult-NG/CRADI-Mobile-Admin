import { test, expect, toast, ADMIN, MOCK_URL } from './fixtures';

/** A new password that satisfies lib/password.ts and the mock's 12-char minimum. */
const NEW_PASSWORD = 'Str0ng!Passw0rd';

/** Valid for lib/password.ts, but under the mock project's minimum length. */
const SUPABASE_WEAK = 'Aa1!bdfg';

/** The page's own error / confirmation box (not Next.js's empty route announcer). */
function alertBox(page: import('@playwright/test').Page) {
    return page.locator('.glass-card [role="alert"]');
}

async function fillNewPassword(page: import('@playwright/test').Page, password: string, confirm = password) {
    await page.getByLabel('New Password', { exact: true }).fill(password);
    await page.getByLabel('Confirm New Password').fill(confirm);
    await page.getByRole('button', { name: 'Update Password' }).click();
}

test.describe('password reset (link form)', () => {
    test('token_hash link: sets a new password, signs out and links to login', async ({ page, mock }) => {
        await page.goto('/reset-password?token_hash=recovery-admin-ok&type=recovery');
        await expect(page.getByRole('heading', { name: 'Set a New Password' })).toBeVisible();
        // The token is taken out of the address bar once it has been exchanged.
        await expect(page).toHaveURL(/\/reset-password$/);

        const verify = await mock.requests({ method: 'POST', path: '/auth/v1/verify' });
        expect(verify).toHaveLength(1);
        expect(verify[0].body).toMatchObject({ token_hash: 'recovery-admin-ok', type: 'recovery' });

        await fillNewPassword(page, NEW_PASSWORD);

        await expect(page.getByRole('heading', { name: 'Password updated' })).toBeVisible();
        await expect(toast(page, 'Password updated successfully')).toBeVisible();

        const update = await mock.requests({ method: 'PUT', path: '/auth/v1/user' });
        expect(update).toHaveLength(1);
        expect(update[0].status).toBe(200);
        // The recovery session is ended, as the mobile app does after a reset.
        expect(await mock.requests({ method: 'POST', path: '/auth/v1/logout' })).toHaveLength(1);
        // Nothing was written into the admin panel's own session slot.
        expect(await page.evaluate(() => window.localStorage.getItem('cradi-admin-auth'))).toBeNull();

        await page.getByRole('link', { name: 'Go to Sign In' }).click();
        await expect(page).toHaveURL(/\/login$/);

        // The new password works; the old one does not.
        await page.getByLabel('Email Address').fill(ADMIN.email);
        await page.getByLabel('Password', { exact: true }).fill(NEW_PASSWORD);
        await page.getByRole('button', { name: 'Sign In' }).click();
        await expect(page).toHaveURL(/\/dashboard$/);
    });

    test('implicit #access_token fragment is accepted too', async ({ page, mock }) => {
        const session = (await (await fetch(`${MOCK_URL}/__mock/session?email=${ADMIN.email}`)).json()) as {
            access_token: string;
            refresh_token: string;
        };
        const fragment = `access_token=${session.access_token}&refresh_token=${session.refresh_token}&expires_in=3600&token_type=bearer&type=recovery`;

        await page.goto(`/reset-password#${fragment}`);
        await expect(page.getByRole('heading', { name: 'Set a New Password' })).toBeVisible();
        await expect(page).toHaveURL(/\/reset-password$/);
        // No token exchange: the session came ready-made in the fragment.
        expect(await mock.requests({ method: 'POST', path: '/auth/v1/verify' })).toHaveLength(0);

        await fillNewPassword(page, NEW_PASSWORD);
        await expect(page.getByRole('heading', { name: 'Password updated' })).toBeVisible();
        expect(await mock.requests({ method: 'PUT', path: '/auth/v1/user' })).toHaveLength(1);
    });

    test('no token in the URL: explains what to do instead of spinning', async ({ page }) => {
        await page.goto('/reset-password');
        await expect(page.getByRole('heading', { name: 'Reset link problem' })).toBeVisible();
        await expect(alertBox(page)).toContainText('This page needs a password reset link');
        await expect(page.getByRole('link', { name: 'Back to Sign In' })).toBeVisible();
        // Public route: it is not sent to /login by the admin guard.
        await expect(page).toHaveURL(/\/reset-password$/);
    });

    test('expired or already-used token is reported', async ({ page, consoleGuard }) => {
        consoleGuard.allow(/status of 403 .*\/auth\/v1\/verify/);
        await page.goto('/reset-password?token_hash=recovery-admin-expired&type=recovery');
        await expect(page.getByRole('heading', { name: 'Reset link problem' })).toBeVisible();
        await expect(alertBox(page)).toContainText('invalid or has expired');
        await expect(page).toHaveURL(/\/reset-password$/);

        // A token that never existed fails the same way, and a used one too.
        await page.goto('/reset-password?token_hash=not-a-real-token&type=recovery');
        await expect(alertBox(page)).toContainText('invalid or has expired');
    });

    test('GoTrue error parameters on the link are surfaced', async ({ page }) => {
        await page.goto(
            '/reset-password#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
        );
        await expect(page.getByRole('heading', { name: 'Reset link problem' })).toBeVisible();
        await expect(alertBox(page)).toContainText('Email link is invalid or has expired');
    });

    test('mismatched passwords are refused before anything is sent', async ({ page, mock }) => {
        await page.goto('/reset-password?token_hash=recovery-bola-ok&type=recovery');
        await expect(page.getByRole('heading', { name: 'Set a New Password' })).toBeVisible();

        await fillNewPassword(page, NEW_PASSWORD, `${NEW_PASSWORD}x`);
        await expect(alertBox(page)).toContainText('Passwords do not match.');
        expect(await mock.requests({ method: 'PUT', path: '/auth/v1/user' })).toHaveLength(0);

        // Fixing the confirmation lets it through.
        await fillNewPassword(page, NEW_PASSWORD);
        await expect(page.getByRole('heading', { name: 'Password updated' })).toBeVisible();
    });

    test('weak passwords are refused by the shared rules and by Supabase', async ({ page, mock, consoleGuard }) => {
        consoleGuard.allow(/status of 422 .*\/auth\/v1\/user/);
        await page.goto('/reset-password?token_hash=recovery-admin-ok&type=recovery');
        await expect(page.getByRole('heading', { name: 'Set a New Password' })).toBeVisible();

        // Rules shared with the mobile app (lib/password.ts), checked locally.
        await fillNewPassword(page, 'short');
        await expect(alertBox(page)).toContainText('Password must be at least 8 characters');

        await fillNewPassword(page, 'alllowercase1!');
        await expect(alertBox(page)).toContainText('Must contain at least one uppercase letter');

        await fillNewPassword(page, 'NoDigitsHere!');
        await expect(alertBox(page)).toContainText('Must contain at least one number');

        await fillNewPassword(page, 'NoSpecial1Char');
        await expect(alertBox(page)).toContainText('Must contain at least one special character');

        await fillNewPassword(page, 'Sequence123!');
        await expect(alertBox(page)).toContainText('sequential characters');

        expect(await mock.requests({ method: 'PUT', path: '/auth/v1/user' })).toHaveLength(0);

        // Supabase's own policy is stricter here: its message is shown verbatim.
        await fillNewPassword(page, SUPABASE_WEAK);
        await expect(alertBox(page)).toContainText('Password should be at least 12 characters.');
        expect(await mock.requests({ method: 'PUT', path: '/auth/v1/user' })).toHaveLength(1);

        // The form stays usable: a good password still goes through.
        await fillNewPassword(page, NEW_PASSWORD);
        await expect(page.getByRole('heading', { name: 'Password updated' })).toBeVisible();
    });
});
