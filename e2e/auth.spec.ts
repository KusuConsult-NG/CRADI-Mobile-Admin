import { test, expect, login, toast, ADMIN, MOCK_URL } from './fixtures';

test.describe('authentication', () => {
    test('signs in as admin and lands on the dashboard', async ({ page, mock }) => {
        await login(page);
        await expect(page.getByRole('heading', { name: 'Welcome back, Grace Admin!' })).toBeVisible();
        const tokenCalls = await mock.requests({ method: 'POST', path: '/auth/v1/token' });
        expect(tokenCalls).toHaveLength(1);
        expect(tokenCalls[0].query).toBe('grant_type=password');
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
        consoleGuard.allow(/status of 400 .*\/auth\/v1\/token/);
        await page.goto('/login');
        await page.getByLabel('Email Address').fill(ADMIN.email);
        await page.getByLabel('Password', { exact: true }).fill('wrong');
        await page.getByRole('button', { name: 'Sign In' }).click();
        await expect(page.getByText('Incorrect email or password.')).toBeVisible();

        // An approved monitor (role ewv) can sign in to Supabase but is not an admin.
        await page.getByLabel('Email Address').fill('bola@cradi.test');
        await page.getByLabel('Password', { exact: true }).fill('bola-pass');
        await page.getByRole('button', { name: 'Sign In' }).click();
        await expect(
            page.getByText('Access denied. This account is not an approved, active administrator.'),
        ).toBeVisible();
        await expect(page).toHaveURL(/\/login$/);
        // The non-admin session is ended locally.
        const logout = await mock.requests({ method: 'POST', path: '/auth/v1/logout' });
        expect(logout).toHaveLength(1);
        expect(logout[0].query).toBe('scope=local');
        const stored = await page.evaluate(() => window.localStorage.getItem('cradi-admin-auth'));
        expect(stored).toBeNull();
    });

    test('logout ends the session and protects the dashboard again', async ({ page, mock }) => {
        await login(page);
        await page.getByRole('button', { name: 'Logout' }).click();
        await expect(page).toHaveURL(/\/login$/);
        await expect(toast(page, 'Logged out successfully')).toBeVisible();
        const logout = await mock.requests({ method: 'POST', path: '/auth/v1/logout' });
        expect(logout.map((r) => r.query)).toEqual(['scope=local']);

        await page.goto('/dashboard/users');
        await expect(page).toHaveURL(/\/login\?next=%2Fdashboard%2Fusers$/);
    });

    test('security headers: CSP allows the Supabase origin (API, realtime, Storage images)', async ({ request }) => {
        const res = await request.get('/login');
        const csp = res.headers()['content-security-policy'];
        const host = new URL(MOCK_URL).host;
        expect(csp).toContain(`connect-src 'self' ${MOCK_URL} ws://${host}`);
        expect(csp).toContain(`img-src 'self' data: blob: https: ${MOCK_URL}`);
        expect(csp).toContain("frame-ancestors 'none'");
        expect(csp).not.toContain('unsafe-eval');
        expect(res.headers()['x-frame-options']).toBe('DENY');
    });
});
