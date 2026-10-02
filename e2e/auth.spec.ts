import { test, expect, login, toast, ADMIN, MOCK_URL } from './fixtures';

test.describe('authentication', () => {
    test('signs in as admin and lands on the dashboard', async ({ page, mock }) => {
        await login(page);
        await expect(page.getByRole('heading', { name: 'Welcome back, Grace Admin!' })).toBeVisible();
        const sessionCalls = await mock.requests({
            method: 'POST',
            path: '/account/sessions/email',
        });
        expect(sessionCalls).toHaveLength(1);
    });

    test('a protected page redirects to /login?next= and returns there after sign-in', async ({ page }) => {
        await page.goto('/dashboard/reports');
        await expect(page).toHaveURL(/\/login\?next=%2Fdashboard%2Freports$/);
        await page.getByLabel('Email Address').fill(ADMIN.email);
        await page.getByLabel('Password', { exact: true }).fill(ADMIN.password);
        await page.getByRole('button', { name: 'Sign In' }).click();
        await expect(page).toHaveURL(/\/dashboard\/reports$/);
        await expect(page.getByRole('heading', { name: 'Report Management' })).toBeVisible();
    });

    test('open-redirect attempts in ?next= are ignored', async ({ page }) => {
        // Through the login form…
        await login(page, { path: '/login?next=%2F%2Fevil.example%2Fsteal', expectedPath: '/dashboard' });

        // …and when an already signed-in admin opens a crafted login link.
        // Raw query strings, as they would appear in a crafted link.
        const attempts = [
            '//evil.example',
            '%2F%2Fevil.example',
            'https%3A%2F%2Fevil.example%2F',
            'http%3Aevil.example',
            '%2F%5Cevil.example',
            '/%5C/evil.example',
            '%2F%09%2Fevil.example',
            '%2F%0A%2Fevil.example',
            '%5C%5Cevil.example',
            'javascript%3Aalert(1)',
        ];
        for (const next of attempts) {
            await page.goto(`/login?next=${next}`);
            await expect(page, `next=${next}`).toHaveURL(/^http:\/\/127\.0\.0\.1:\d+\/dashboard$/);
        }

        // A same-origin path is honoured.
        await page.goto('/login?next=%2Fdashboard%2Fsettings');
        await expect(page).toHaveURL(/\/dashboard\/settings$/);
    });

    test('wrong password and non-admin accounts are refused', async ({ page, mock, consoleGuard }) => {
        consoleGuard.allow(/status of 401 .*\/account\/sessions\/email/);
        await page.goto('/login');
        await page.getByLabel('Email Address').fill(ADMIN.email);
        await page.getByLabel('Password', { exact: true }).fill('wrong');
        await page.getByRole('button', { name: 'Sign In' }).click();
        await expect(page.getByText('Incorrect email or password.')).toBeVisible();

        // An approved monitor (role ewv) can sign in to Appwrite but is not an admin.
        await page.getByLabel('Email Address').fill('bola@cradi.test');
        await page.getByLabel('Password', { exact: true }).fill('bola-pass');
        await page.getByRole('button', { name: 'Sign In' }).click();
        await expect(
            page.getByText('Access denied. This account is not an approved, active administrator.'),
        ).toBeVisible();
        await expect(page).toHaveURL(/\/login$/);
        // The non-admin session is ended — and only this one: an Appwrite
        // session is per-device, so deleting `current` leaves the same
        // account signed in on the mobile app, which is what Supabase's
        // `scope: 'local'` bought.
        const logout = await mock.requests({
            method: 'DELETE',
            path: '/account/sessions/current',
        });
        expect(logout).toHaveLength(1);
    });

    test('logout ends the session and protects the dashboard again', async ({ page, mock }) => {
        await login(page);
        await page.getByRole('button', { name: 'Logout' }).click();
        await expect(page).toHaveURL(/\/login$/);
        await expect(toast(page, 'Logged out successfully')).toBeVisible();
        const logout = await mock.requests({
            method: 'DELETE',
            path: '/account/sessions/current',
        });
        expect(logout).toHaveLength(1);

        await page.goto('/dashboard/users');
        await expect(page).toHaveURL(/\/login\?next=%2Fdashboard%2Fusers$/);
    });

    test('security headers: CSP allows the Appwrite origin (API, realtime, Storage images)', async ({ request }) => {
        const res = await request.get('/login');
        const csp = res.headers()['content-security-policy'];
        const host = new URL(MOCK_URL).host;
        expect(csp).toContain(`connect-src 'self' ${MOCK_URL} ws://${host}`);
        expect(csp).toContain(`img-src 'self' data: blob: https: ${MOCK_URL}`);
        expect(csp).toContain("frame-ancestors 'none'");
        expect(csp).not.toContain('unsafe-eval');
        // Scripts: a per-request nonce, no 'unsafe-inline'.
        const scriptSrc = csp.split('; ').find((d) => d.startsWith('script-src '))!;
        expect(scriptSrc).toMatch(/^script-src 'self' 'nonce-[A-Za-z0-9+/=]{24}' 'strict-dynamic'$/);
        const nonce = scriptSrc.match(/'nonce-([^']+)'/)![1];
        const html = await res.text();
        const scripts = html.match(/<script\b[^>]*>/g) ?? [];
        expect(scripts.length).toBeGreaterThan(0);
        for (const tag of scripts) expect(tag).toContain(`nonce="${nonce}"`);
        const again = (await request.get('/login')).headers()['content-security-policy'];
        expect(again).not.toContain(nonce);
        expect(res.headers()['x-frame-options']).toBe('DENY');
        // Production build: HTTPS-only for two years.
        expect(res.headers()['strict-transport-security']).toBe('max-age=63072000; includeSubDomains');
    });
});
