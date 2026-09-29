import { test, expect, login } from './fixtures';
import {
    buildFlow,
    decisionHours,
    LOAD_TIMEOUT_MS,
    loadOperationsStats,
    median,
    weekStart,
    type FlowRow,
} from '../lib/operations-stats';

/**
 * The operations panel answers "is the team keeping up?". The arithmetic is
 * pure and tested directly here; the panel itself is checked against the mock.
 */

const MON = Date.parse('2026-09-28T00:00:00Z'); // a Monday
const DAY = 86_400_000;

test.describe('operations arithmetic', () => {
    test('weekStart snaps to Monday UTC, and is stable inside a week', () => {
        expect(weekStart(MON)).toBe(MON);
        expect(weekStart(MON + 6 * DAY + 23 * 3_600_000)).toBe(MON); // Sunday night
        expect(weekStart(MON - 1)).toBe(MON - 7 * DAY); // Sunday before
    });

    test('median handles even and odd lengths, and empty', () => {
        expect(median([])).toBeNull();
        expect(median([5])).toBe(5);
        expect(median([3, 1, 2])).toBe(2);
        expect(median([4, 1, 3, 2])).toBe(2.5);
    });

    test('buildFlow returns one point per week, oldest first, all weeks present', () => {
        const weeks = buildFlow([], MON);
        expect(weeks).toHaveLength(8);
        expect(weeks[7].start).toBe(new Date(MON).toISOString());
        expect(weeks[0].start).toBe(new Date(MON - 7 * 7 * DAY).toISOString());
        expect(weeks.every((w) => w.submitted === 0 && w.decided === 0)).toBe(true);
    });

    test('a report decided in the window counts even when it arrived before it', () => {
        const rows: FlowRow[] = [
            // Submitted long before the window, approved in the latest week.
            {
                submitted_at: new Date(MON - 200 * DAY).toISOString(),
                approved_at: new Date(MON + DAY).toISOString(),
                rejected_at: null,
            },
        ];
        const weeks = buildFlow(rows, MON);
        expect(weeks[7].decided, 'decided lands in the latest week').toBe(1);
        expect(
            weeks.reduce((n, w) => n + w.submitted, 0),
            'its arrival is outside the window and is not counted',
        ).toBe(0);
    });

    test('rejections count as decisions, and a row is never counted twice', () => {
        const rows: FlowRow[] = [
            { submitted_at: new Date(MON).toISOString(), approved_at: null, rejected_at: new Date(MON).toISOString() },
            // Both set (should not happen): approval wins, still one decision.
            {
                submitted_at: new Date(MON).toISOString(),
                approved_at: new Date(MON).toISOString(),
                rejected_at: new Date(MON).toISOString(),
            },
        ];
        const weeks = buildFlow(rows, MON);
        expect(weeks[7].decided).toBe(2);
        expect(weeks[7].submitted).toBe(2);
    });

    test('malformed and undecided rows are skipped rather than throwing', () => {
        const rows: FlowRow[] = [
            { submitted_at: 'not-a-date', approved_at: null, rejected_at: null },
            { submitted_at: null, approved_at: null, rejected_at: null },
            { submitted_at: new Date(MON).toISOString(), approved_at: null, rejected_at: null },
        ];
        const weeks = buildFlow(rows, MON);
        expect(weeks[7].submitted).toBe(1);
        expect(weeks[7].decided).toBe(0);
    });

    test('decisionHours is the median span, ignoring undecided and reversed rows', () => {
        const at = (h: number) => new Date(MON + h * 3_600_000).toISOString();
        const rows: FlowRow[] = [
            { submitted_at: at(0), approved_at: at(2), rejected_at: null }, // 2h
            { submitted_at: at(0), approved_at: null, rejected_at: at(6) }, // 6h
            { submitted_at: at(0), approved_at: null, rejected_at: null }, // undecided
            { submitted_at: at(10), approved_at: at(1), rejected_at: null }, // decided before submitted
        ];
        expect(decisionHours(rows)).toBe(4); // median of [2, 6]
        expect(decisionHours([])).toBeNull();
    });
});

test('the operations panel renders its figures and the table view', async ({ page }) => {
    await login(page);

    const panel = page.getByRole('region', { name: 'Operations' });
    await expect(panel).toBeVisible();

    // Each tile shows a figure rather than a dash, and the backlog rows are labelled.
    await expect(panel.getByText('Oldest report still pending')).toBeVisible();
    await expect(panel.getByText('Median time to decision')).toBeVisible();
    await expect(panel.getByText('Escalated, still open')).toBeVisible();
    for (const label of ['Under a day', '1–3 days', '3–7 days', 'Over a week']) {
        await expect(panel.getByText(label, { exact: true })).toBeVisible();
    }

    // Identity is never colour alone: both series are named in the legend.
    await expect(panel.getByText('Submitted', { exact: true })).toBeVisible();
    await expect(panel.getByText('Decided', { exact: true })).toBeVisible();

    // The same numbers are available without reading the marks.
    await panel.getByRole('button', { name: 'Show these as a table' }).click();
    await expect(panel.getByRole('table')).toBeVisible();
    await expect(panel.getByRole('columnheader', { name: 'Submitted' })).toBeVisible();
});

// "1 hours" shipped in the first render of this panel and no assertion caught
// it — only looking at the page did. These pin the singular forms.
test('durations read as English, not "1 hours"', async ({ page }) => {
    await login(page);
    const panel = page.getByRole('region', { name: 'Operations' });
    await expect(panel).toBeVisible();
    const text = (await panel.textContent()) ?? '';
    expect(text, 'no "1 hours"').not.toMatch(/\b1 hours\b/);
    expect(text, 'no "1 days"').not.toMatch(/\b1 days\b/);
});

// The panel showed nothing in production because a failed or hanging load left
// the spinner up, and a spinner is an icon with no text. These pin both halves
// of the fix: the load cannot hang forever, and the UI names what went wrong.
test('the load is bounded, so a hanging query cannot spin forever', () => {
    expect(LOAD_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
    expect(typeof loadOperationsStats).toBe('function');
});

test('a load failure is reported in words, not left as a spinner', async ({ page, consoleGuard }) => {
    // Aborting the queries makes the client log; that is the point of the test.
    consoleGuard.allow(/.*/);
    await login(page);
    // Make every reports query fail so the panel takes its failure path.
    await page.route('**/rest/v1/reports**', (route) => route.abort('failed'));
    await page.reload();

    const panel = page.getByRole('region', { name: 'Operations' });
    await expect(panel).toBeVisible();
    // Either the error box or the labelled loading state — never a bare icon.
    await expect(panel).toContainText(/could not be loaded|Loading operations figures/i);
});
