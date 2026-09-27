import { test, expect, login, type MockApi } from './fixtures';
import type { Page } from '@playwright/test';

/**
 * The "is every control wired to something?" sweep.
 *
 * Every other spec asserts a specific behaviour. This one is exhaustive
 * instead of deep: on each page it clicks every interactive element in turn
 * and asserts that SOMETHING observable happened — the URL changed, the
 * rendered text changed (a modal, a toast, a re-filtered table, a toggled
 * row), or the app talked to the backend. A control that does none of those
 * three is a dead control and fails the test with its accessible name.
 */

/** Ends the session or destroys the fixture the rest of the sweep walks over. */
const DESTRUCTIVE =
    /sign out|log ?out|delete|remove|reject|block|disable|deactivate|^×$|^close$/i;

/** Opens a new tab / hands off to the OS — nothing observable in-page. */
const EXTERNAL = /^https?:\/\//;

const PAGES: { path: string; name: string }[] = [
    { path: '/dashboard', name: 'dashboard' },
    { path: '/dashboard/reports', name: 'reports' },
    { path: '/dashboard/alerts', name: 'alerts' },
    { path: '/dashboard/users', name: 'users' },
    { path: '/dashboard/authorities', name: 'authorities' },
    { path: '/dashboard/knowledge', name: 'knowledge' },
    { path: '/dashboard/news', name: 'news' },
    { path: '/dashboard/settings', name: 'settings' },
];

interface Probe {
    page: string;
    control: string;
    kind: string;
    result: string;
    detail: string;
}

const SELECTOR = 'button, a[href], [role="button"], input:not([type="hidden"]), select, textarea';

async function describeControls(page: Page) {
    return page.$$eval(SELECTOR, (els) =>
        els.map((el, index) => {
            const e = el as HTMLElement & { disabled?: boolean; type?: string; href?: string };
            const rect = e.getBoundingClientRect();
            const name =
                e.getAttribute('aria-label') ||
                (e as HTMLInputElement).placeholder ||
                (e.textContent || '').trim() ||
                e.getAttribute('title') ||
                e.getAttribute('name') ||
                `${e.tagName.toLowerCase()}#${index}`;
            return {
                index,
                name: name.replace(/\s+/g, ' ').slice(0, 60),
                tag: e.tagName.toLowerCase(),
                type: e.type ?? '',
                href: e.getAttribute('href') ?? '',
                disabled: !!e.disabled || e.getAttribute('aria-disabled') === 'true',
                visible: rect.width > 0 && rect.height > 0,
            };
        }),
    );
}

async function snapshot(page: Page, mock: MockApi) {
    return {
        url: new URL(page.url()).pathname + new URL(page.url()).search,
        text: await page.locator('body').innerText(),
        // innerText leaves out what is inside a field, so a control whose only
        // effect is on a field (typing, "Show password", a checkbox) would
        // otherwise read as dead.
        fields: await page.$$eval('input, select, textarea', (els) =>
            els
                .map((el) => {
                    const e = el as HTMLInputElement;
                    return `${e.name || e.id || e.placeholder}=${e.type}:${e.value}:${e.checked}`;
                })
                .join('|'),
        ),
        requests: (await mock.requests()).length,
    };
}

/**
 * Clicks (or, for a text field, types into) every control on `path` and
 * records what each one did.
 */
async function sweep(page: Page, mock: MockApi, path: string, name: string, probes: Probe[]) {
    await page.goto(path);
    await page.waitForLoadState('load');
    await page.waitForTimeout(700);
    const controls = (await describeControls(page)).filter((c) => c.visible);

    for (const control of controls) {
        const probe: Probe = { page: name, control: control.name, kind: control.tag, result: '', detail: '' };
        if (control.disabled) {
            probe.result = 'disabled';
            probe.detail = 'deliberate disabled state';
            probes.push(probe);
            continue;
        }
        if (DESTRUCTIVE.test(control.name)) {
            probe.result = 'skipped';
            probe.detail = 'destructive — covered by its own spec';
            probes.push(probe);
            continue;
        }
        if (EXTERNAL.test(control.href)) {
            probe.result = 'external-link';
            probe.detail = control.href;
            probes.push(probe);
            continue;
        }
        if (control.tag === 'a') {
            // A <Link>/<a> is wired iff it has a non-empty, non-"#" target.
            probe.result = control.href && control.href !== '#' ? 'link' : 'dead';
            probe.detail = control.href || '(no href)';
            probes.push(probe);
            continue;
        }

        // The page may finish rendering after the first enumeration (the
        // settings form waits for its fetch), which shifts every index. Look
        // the control up again, and re-read its disabled state, right before
        // pressing it.
        const current = (await describeControls(page)).find(
            (c) => c.visible && c.tag === control.tag && c.name === control.name,
        );
        if (!current) {
            probe.result = 'unreachable';
            probe.detail = 'no longer rendered';
            probes.push(probe);
            continue;
        }
        if (current.disabled) {
            probe.result = 'disabled';
            probe.detail = 'deliberate disabled state';
            probes.push(probe);
            continue;
        }
        const target = page.locator(SELECTOR).nth(current.index);
        const before = await snapshot(page, mock);
        try {
            if (control.tag === 'input' && /^(text|search|email|tel|url|number|password|date|datetime-local)$/.test(control.type)) {
                await target.fill('flood');
                await page.waitForTimeout(600);
            } else if (control.tag === 'textarea') {
                await target.fill('flood');
                await page.waitForTimeout(400);
            } else if (control.tag === 'select') {
                const values = await target.locator('option').evaluateAll((os) =>
                    (os as HTMLOptionElement[]).map((o) => o.value),
                );
                const next = values.find((v) => v !== (values[0] ?? '')) ?? values[0];
                await target.selectOption(next);
                await page.waitForTimeout(600);
            } else if (control.type === 'checkbox' || control.type === 'radio') {
                await target.click({ force: true });
                await page.waitForTimeout(400);
            } else {
                await target.click({ force: true });
                await page.waitForTimeout(800);
            }
        } catch (error) {
            probe.result = 'unreachable';
            probe.detail = (error as Error).message.split('\n')[0];
            probes.push(probe);
            await page.goto(path);
            await page.waitForTimeout(500);
            continue;
        }

        const after = await snapshot(page, mock);
        // A submit button on a form the browser refuses to submit (an empty
        // required field) correctly does nothing: that is HTML validation, not
        // a dead control.
        if (control.type === 'submit') {
            const valid = await target
                .evaluate((el) => (el as HTMLButtonElement).form?.checkValidity() ?? true)
                .catch(() => true);
            if (!valid) {
                probe.result = 'blocked-by-validation';
                probe.detail = 'the form has an empty required field, so the browser blocks submit';
                probes.push(probe);
                await page.goto(path);
                await page.waitForTimeout(500);
                continue;
            }
        }
        const bits: string[] = [];
        if (before.url !== after.url) bits.push(`url → ${after.url}`);
        if (before.text !== after.text) bits.push('rendered text changed');
        if (before.fields !== after.fields) bits.push('field value / checked changed');
        if (after.requests > before.requests) bits.push(`${after.requests - before.requests} request(s)`);
        probe.result = bits.length ? 'live' : 'dead';
        probe.detail = bits.join('; ') || 'nothing observable';
        probes.push(probe);

        // Back to a clean page: a modal, a filter or a navigation must not
        // leak into the next control.
        await page.goto(path);
        await page.waitForTimeout(500);
    }
}

for (const { path, name } of PAGES) {
    test(`every control on the ${name} page is wired to something`, async ({ page, mock }) => {
        test.setTimeout(300_000);
        await login(page);
        const probes: Probe[] = [];
        await sweep(page, mock, path, name, probes);
        report(probes);
        const dead = probes.filter((p) => p.result === 'dead');
        expect(dead.map((p) => p.control), `dead controls on ${path}`).toEqual([]);
        // A regression guard: the sweep must keep finding controls to press.
        expect(probes.length, `controls found on ${path}`).toBeGreaterThan(2);
    });
}

function report(probes: Probe[]) {
    const tally = probes.reduce<Record<string, number>>((acc, p) => {
        acc[p.result] = (acc[p.result] ?? 0) + 1;
        return acc;
    }, {});
    console.log(`controls probed: ${probes.length} ${JSON.stringify(tally)}`);
    for (const p of probes) console.log(`  [${p.result}] ${p.page} :: ${p.control} (${p.kind}) — ${p.detail}`);
}

test('login and reset-password controls are wired', async ({ page, mock }) => {
    test.setTimeout(300_000);
    const probes: Probe[] = [];
    await sweep(page, mock, '/login', 'login', probes);
    await sweep(page, mock, '/reset-password', 'reset-password', probes);
    report(probes);
    const dead = probes.filter((p) => p.result === 'dead');
    expect(dead.map((p) => `${p.page} :: ${p.control}`), 'controls with no observable effect').toEqual([]);
});
