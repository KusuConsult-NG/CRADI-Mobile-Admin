import { test, expect, toast, ADMIN } from './fixtures';

/**
 * Password recovery is a typed code, not a link.
 *
 * Appwrite's recovery mails a six-character code, which the migration
 * kept deliberately: it works in the mobile app, in this page and read
 * aloud down a phone line, and it removes the class of problems the
 * Supabase link had — two token shapes to detect, a `redirectTo` that had
 * to resolve a custom scheme, and a desktop browser that could open
 * neither. So there is nothing in the URL to test here, and the tests
 * that covered those shapes are gone with them.
 */

/** A new password that satisfies lib/password.ts and the server's minimum. */
const NEW_PASSWORD = 'Str0ng!Passw0rd';

/** Codes the `auth` Function has "mailed" (see e2e/mock-appwrite.mjs). */
const CODES = {
    admin: 'A1B2C3',
    nonAdmin: 'D4E5F6',
    expired: 'EXPIRE',
} as const;

/** The page's own error / confirmation box (not Next.js's empty route announcer). */
function alertBox(page: import('@playwright/test').Page) {
    return page.locator('.glass-card [role="alert"]');
}

async function requestCode(page: import('@playwright/test').Page, email: string) {
    await page.goto('/reset-password');
    await page.getByLabel('Email Address').fill(email);
    await page.getByRole('button', { name: 'Email me a code' }).click();
    await expect(page.getByRole('heading', { name: 'Enter your code' })).toBeVisible();
}

async function submit(
    page: import('@playwright/test').Page,
    code: string,
    password: string,
    confirm = password,
) {
    await page.getByLabel('Code from the email').fill(code);
    await page.getByLabel('New Password', { exact: true }).fill(password);
    await page.getByLabel('Confirm New Password').fill(confirm);
    await page.getByRole('button', { name: 'Update Password' }).click();
}

test.describe('password reset (typed code)', () => {
    test('asks for the address, then the code, and sets the password', async ({ page, mock }) => {
        await requestCode(page, ADMIN.email);

        const sent = await mock.calls<{ action: string; email?: string }>('/auth');
        expect(sent).toHaveLength(1);
        expect(sent[0]).toMatchObject({ action: 'sendRecoveryCode', email: ADMIN.email });

        await submit(page, CODES.admin, NEW_PASSWORD);
        await expect(page.getByRole('heading', { name: 'Password updated' })).toBeVisible();
        await expect(toast(page, 'Password updated successfully')).toBeVisible();

        const actions = (await mock.calls<{ action: string }>('/auth')).map((c) => c.action);
        expect(actions).toEqual(['sendRecoveryCode', 'verifyRecovery', 'setPassword']);

        // The recovery session is ended whether or not the change
        // succeeded, so a code never leaves a usable session behind.
        expect(
            await mock.requests({ method: 'DELETE', path: '/account/sessions/current' }),
        ).toHaveLength(1);

        // App users reach this page too, so the finished state has to name
        // the app rather than send everyone to the staff portal.
        await expect(page.getByText('Using the CRADI mobile app?')).toBeVisible();
        await page.getByRole('link', { name: 'Go to Admin Sign In' }).click();
        await expect(page).toHaveURL(/\/login$/);
    });

    test('the answer is the same for an address with no account', async ({ page, mock }) => {
        // Otherwise this page tells anyone which addresses are registered.
        await requestCode(page, 'nobody@cradi.test');
        await expect(toast(page, /a code is on its way/)).toBeVisible();
        const sent = await mock.calls('/auth');
        expect(sent).toHaveLength(1);
    });

    test('a code can be typed without asking for one first', async ({ page }) => {
        // The mail arrives on a phone and the reset happens on a desktop.
        await page.goto('/reset-password');
        await page.getByRole('button', { name: 'I already have a code' }).click();
        await expect(page.getByRole('heading', { name: 'Enter your code' })).toBeVisible();
        // Public route: the admin guard does not send it to /login.
        await expect(page).toHaveURL(/\/reset-password$/);
    });

    test('an expired or unknown code is reported, and nothing is changed', async ({
        page,
        mock,
        consoleGuard,
    }) => {
        consoleGuard.allow(/status of 201 /);
        await requestCode(page, ADMIN.email);

        await submit(page, CODES.expired, NEW_PASSWORD);
        await expect(alertBox(page)).toContainText('invalid or has expired');

        await submit(page, 'ZZZZZZ', NEW_PASSWORD);
        await expect(alertBox(page)).toContainText('invalid or has expired');

        const actions = (await mock.calls<{ action: string }>('/auth')).map((c) => c.action);
        expect(actions).not.toContain('setPassword');
    });

    test('a code belonging to another address is refused', async ({ page, consoleGuard }) => {
        consoleGuard.allow(/status of 201 /);
        await requestCode(page, ADMIN.email);
        // Bola's code, typed against the admin's address.
        await submit(page, CODES.nonAdmin, NEW_PASSWORD);
        await expect(alertBox(page)).toContainText('invalid or has expired');
    });

    test('mismatched passwords are refused before anything is sent', async ({ page, mock }) => {
        await requestCode(page, ADMIN.email);

        await submit(page, CODES.admin, NEW_PASSWORD, `${NEW_PASSWORD}x`);
        await expect(alertBox(page)).toContainText('Passwords do not match.');
        const actions = (await mock.calls<{ action: string }>('/auth')).map((c) => c.action);
        expect(actions).toEqual(['sendRecoveryCode']);

        // Fixing the confirmation lets it through.
        await submit(page, CODES.admin, NEW_PASSWORD);
        await expect(page.getByRole('heading', { name: 'Password updated' })).toBeVisible();
    });

    test('a short code is refused before the server is asked', async ({ page, mock }) => {
        await requestCode(page, ADMIN.email);
        await submit(page, 'A1B', NEW_PASSWORD);
        await expect(alertBox(page)).toContainText('6-character code');
        expect(await mock.calls('/auth')).toHaveLength(1);
    });

    test('weak passwords are refused by the shared rules', async ({ page, mock }) => {
        await requestCode(page, ADMIN.email);

        // Rules shared with the mobile app (lib/password.ts), checked locally
        // so a weak password never reaches the server — and never spends the
        // single-use code on the way.
        for (const [password, message] of [
            ['short', 'Password must be at least 8 characters'],
            ['alllowercase1!', 'Must contain at least one uppercase letter'],
            ['NoDigitsHere!', 'Must contain at least one number'],
            ['NoSpecial1Char', 'Must contain at least one special character'],
            ['Sequence123!', 'sequential characters'],
        ] as const) {
            await submit(page, CODES.admin, password);
            await expect(alertBox(page)).toContainText(message);
        }

        const actions = (await mock.calls<{ action: string }>('/auth')).map((c) => c.action);
        expect(actions).toEqual(['sendRecoveryCode']);

        // The form stays usable: a good password still goes through.
        await submit(page, CODES.admin, NEW_PASSWORD);
        await expect(page.getByRole('heading', { name: 'Password updated' })).toBeVisible();
    });
});
