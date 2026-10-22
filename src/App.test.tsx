// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Imported after the env stub below so the app runs against the local demo backend.
let App: typeof import('./App').default;

beforeAll(async () => {
  vi.stubEnv('VITE_SUPABASE_URL', '');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
  App = (await import('./App')).default;
});

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = '';
});

const TIMEOUT = { timeout: 5000 };

function actionButton(name: 'Milk' | 'Urine' | 'Potty' | 'Both' | 'Sleep' | 'Medicine') {
  return screen.getByRole('button', { name: new RegExp(`^${name}\\.`) });
}

function todayCount(name: 'Milk' | 'Urine' | 'Potty' | 'Both' | 'Sleep' | 'Medicine'): string {
  return actionButton(name).getAttribute('aria-label') ?? '';
}

describe('Baby Monitor (local demo backend, full UI flow)', () => {
  it('creates a profile, logs with one tap, guards duplicates, undoes, backdates, and shows history', async () => {
    const user = userEvent.setup();
    render(<App />);

    // Create a baby profile.
    await user.click(screen.getByRole('tab', { name: 'New baby' }));
    await user.type(screen.getByLabelText(/Baby ID/), 'leo-2026');
    await user.type(screen.getByLabelText("Baby's name"), 'Leo');
    await user.type(screen.getByLabelText('Password'), 'secret123');
    await user.type(screen.getByLabelText('Confirm password'), 'secret123');
    await user.click(screen.getByRole('button', { name: 'Create profile' }));

    expect(await screen.findByRole('button', { name: /^Milk\./ }, TIMEOUT)).toBeTruthy();
    expect(screen.getByText('Leo')).toBeTruthy();
    expect(todayCount('Milk')).toContain('0 today');

    // One tap logs a feed and shows the Undo toast.
    await user.click(actionButton('Milk'));
    expect(await screen.findByRole('status', {}, TIMEOUT)).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('Milk logged');
    expect(todayCount('Milk')).toContain('1 today');

    // A second milk tap within 2 minutes asks first. Cancel keeps the count at 1.
    await user.click(actionButton('Milk'));
    const dupDialog = await screen.findByRole('dialog', { name: 'Possible duplicate' }, TIMEOUT);
    expect(dupDialog.textContent).toContain('Milk was logged');
    await user.click(within(dupDialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog', { name: 'Possible duplicate' })).toBeNull();
    expect(todayCount('Milk')).toContain('1 today');

    // Confirming the prompt registers the second feed.
    await user.click(actionButton('Milk'));
    const dupAgain = await screen.findByRole('dialog', { name: 'Possible duplicate' }, TIMEOUT);
    await user.click(within(dupAgain).getByRole('button', { name: 'Yes, log again' }));
    expect(todayCount('Milk')).toContain('2 today');

    // Urine, then Undo removes it.
    await user.click(actionButton('Urine'));
    expect(todayCount('Urine')).toContain('1 today');
    await user.click(await screen.findByRole('button', { name: 'Undo' }, TIMEOUT));
    expect(todayCount('Urine')).toContain('0 today');

    // Both counts toward Urine and Potty, but the guard uses the closest entry.
    await user.click(actionButton('Both'));
    expect(todayCount('Urine')).toContain('1 today');
    expect(todayCount('Potty')).toContain('1 today');

    // Backdate a feed to 30 min ago. That is outside the 2-minute window, so no prompt.
    await user.click(screen.getByRole('button', { name: 'Log a past time' }));
    const sheet = await screen.findByRole('dialog', { name: 'Log a past time' }, TIMEOUT);
    await user.click(within(sheet).getByRole('button', { name: '30 min ago' }));
    await user.click(within(sheet).getByRole('button', { name: 'Milk' }));
    expect(screen.queryByRole('dialog', { name: 'Possible duplicate' })).toBeNull();
    expect(todayCount('Milk')).toContain('3 today');

    // Optional quick chip on the entry that was just logged.
    await user.click(await screen.findByRole('button', { name: '90 ml' }, TIMEOUT));
    expect(screen.getByRole('button', { name: '90 ml' }).getAttribute('aria-pressed')).toBe('true');

    // History tab: daily totals and timeline.
    await user.click(screen.getByRole('button', { name: 'History' }));
    const feedsCard = screen.getByText('Feeds').parentElement as HTMLElement;
    expect(feedsCard.textContent).toContain('3');
    expect(feedsCard.textContent).toContain('90 ml total');
    expect(screen.getByText('Timeline')).toBeTruthy();
    expect(screen.getAllByText('Milk')).toHaveLength(3);

    // 3 AM night mode toggles the html class and persists.
    await user.click(screen.getByRole('button', { name: 'Turn on night mode' }));
    expect(document.documentElement.classList.contains('night')).toBe(true);
    expect(localStorage.getItem('bm:night')).toBe('1');
    await user.click(screen.getByRole('button', { name: 'Turn off night mode' }));
    expect(document.documentElement.classList.contains('night')).toBe(false);

    // Log out, then log back in. The same data is still there.
    await user.click(screen.getByRole('button', { name: 'Log out' }));
    await user.click(await screen.findByRole('tab', { name: 'Log in' }, TIMEOUT));
    await user.type(screen.getByLabelText(/Baby ID/), 'leo-2026');
    await user.type(screen.getByLabelText('Password'), 'wrong-pass');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Baby ID or password is incorrect.');

    const passwordField = screen.getByLabelText('Password');
    await user.clear(passwordField);
    await user.type(passwordField, 'secret123');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByRole('button', { name: /^Milk\./ }, TIMEOUT)).toBeTruthy();
    expect(todayCount('Milk')).toContain('3 today');
  }, 30_000);

  it('shows a clear error for a taken Baby ID', async () => {
    const user = userEvent.setup();
    const first = render(<App />);
    await user.click(screen.getByRole('tab', { name: 'New baby' }));
    await user.type(screen.getByLabelText(/Baby ID/), 'ava-2026');
    await user.type(screen.getByLabelText("Baby's name"), 'Ava');
    await user.type(screen.getByLabelText('Password'), 'secret123');
    await user.type(screen.getByLabelText('Confirm password'), 'secret123');
    await user.click(screen.getByRole('button', { name: 'Create profile' }));
    await screen.findByRole('button', { name: /^Milk\./ }, TIMEOUT);
    first.unmount();
    // A second person on another device: no session yet, same Baby ID.
    localStorage.removeItem('bm:session');

    render(<App />);
    await user.click(screen.getByRole('tab', { name: 'New baby' }));
    await user.type(screen.getByLabelText(/Baby ID/), 'ava-2026');
    await user.type(screen.getByLabelText("Baby's name"), 'Ava');
    await user.type(screen.getByLabelText('Password'), 'secret123');
    await user.type(screen.getByLabelText('Confirm password'), 'secret123');
    await user.click(screen.getByRole('button', { name: 'Create profile' }));
    expect((await screen.findByRole('alert', {}, TIMEOUT)).textContent).toContain('already taken');
  }, 30_000);
});
