import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';

const listen = vi.hoisted(() => vi.fn());
const getPairingInfo = vi.hoisted(() => vi.fn());
const listWaiting = vi.hoisted(() => vi.fn());
const getSubmission = vi.hoisted(() => vi.fn());
const markEntered = vi.hoisted(() => vi.fn());
const deleteSubmissions = vi.hoisted(() => vi.fn());
const writeText = vi.hoisted(() => vi.fn());
const check = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/event', () => ({ listen }));
vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({ writeText }));
vi.mock('@tauri-apps/plugin-updater', () => ({ check }));
vi.mock('./pairing', () => ({ getPairingInfo }));
vi.mock('./queue', () => ({ listWaiting, getSubmission, markEntered, deleteSubmissions }));

const PAIRING = { url: 'http://192.168.1.20:8787/?t=abc', token: 'abc', port: 8787 };

/**
 * Fixtures are dated against the clock the test runs on, not a fixed day: a
 * record from before today sets off the end-of-day prompt, which would then sit
 * over every other test in this file.
 */
function on(daysAgo: number, hour: number, minute: number): string {
  const at = new Date();
  at.setDate(at.getDate() - daysAgo);
  at.setHours(hour, minute, 0, 0);
  return at.toISOString();
}

const JANE = { id: 'a3f9', name: 'Jane Doe', submitted_at: on(0, 14, 12), entered_at: null };
const JOHN = { id: 'b71c', name: 'John Roe', submitted_at: on(0, 14, 9), entered_at: null };

const DETAILS = {
  first_name: 'Jane',
  last_name: 'Doe',
  preferred_name: '',
  address: '12 King St W',
  city: 'Toronto',
  province: 'ON',
  postal_code: 'M5H 1A1',
  phone: '4165551234',
  email: 'jane@example.com',
  date_of_birth: '1985-04-17',
  health_insurance_number: '1234567890',
  health_insurance_version: 'AB',
  hc_type: 'ON',
};

/** Hands back the handler `listen` was given for an event, so a test can fire it. */
function handlerFor(event: string) {
  const call = listen.mock.calls.find(([name]) => name === event);
  expect(call, `no listener for ${event}`).toBeDefined();
  return call![1] as () => void;
}

beforeEach(() => {
  getPairingInfo.mockResolvedValue(PAIRING);
  listen.mockResolvedValue(() => {});
  listWaiting.mockResolvedValue([]);
  getSubmission.mockResolvedValue(DETAILS);
  markEntered.mockResolvedValue(true);
  deleteSubmissions.mockResolvedValue(1);
  writeText.mockResolvedValue(undefined);
  // No update, and no network call, unless a test says otherwise.
  check.mockResolvedValue(null);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('connecting a tablet', () => {
  it('renders the QR for the pairing url with the address and port underneath', async () => {
    const { container } = render(<App />);

    expect(await screen.findByText(PAIRING.url)).toBeDefined();
    expect(container.querySelector('svg')).not.toBeNull();
    expect(screen.getByText('Server running on port 8787.')).toBeDefined();
  });

  it('tells staff to scan or copy', async () => {
    render(<App />);

    expect(await screen.findByText('Scan the QR code to connect a tablet or iPad')).toBeDefined();
    expect(screen.getByText('…or copy the link:')).toBeDefined();
  });

  it('copies the pairing url', async () => {
    render(<App />);
    await screen.findByText(PAIRING.url);

    await userEvent.click(screen.getByRole('button', { name: 'Copy the link' }));

    expect(writeText).toHaveBeenCalledWith(PAIRING.url);
    expect(await screen.findByText('Copied')).toBeDefined();
  });

  it('says it is starting and shows no QR before an address is known', async () => {
    getPairingInfo.mockResolvedValue(null);
    const { container } = render(<App />);

    expect(await screen.findByText('Starting — waiting for a network address.')).toBeDefined();
    expect(container.querySelector('svg')).toBeNull();
  });

  it('regenerates the QR when the address changes', async () => {
    render(<App />);
    await screen.findByText(PAIRING.url);

    const moved = { ...PAIRING, url: 'http://10.0.0.5:8787/?t=abc' };
    getPairingInfo.mockResolvedValue(moved);
    handlerFor('address-changed')();

    expect(await screen.findByText(moved.url)).toBeDefined();
  });

  it('reports a failed pairing lookup instead of a port', async () => {
    getPairingInfo.mockRejectedValue('no state');
    render(<App />);

    expect(await screen.findByText('Cannot reach the server: no state')).toBeDefined();
  });
});

describe('the two tabs', () => {
  it('opens on the dashboard', async () => {
    render(<App />);

    expect(await screen.findByText(PAIRING.url)).toBeDefined();
    expect(screen.getByRole('button', { name: 'Dashboard' }).ariaCurrent).toBe('page');
  });

  it('shows the form fields in place of the dashboard, and comes back', async () => {
    render(<App />);
    await screen.findByText(PAIRING.url);

    await userEvent.click(screen.getByRole('button', { name: 'Form preview' }));
    expect(screen.getByText('First name')).toBeDefined();
    expect(screen.queryByText(PAIRING.url)).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Dashboard' }));
    expect(screen.getByText(PAIRING.url)).toBeDefined();
    expect(screen.queryByText('First name')).toBeNull();
  });
});

describe('the waiting list', () => {
  it('says nobody is waiting rather than showing an empty list', async () => {
    render(<App />);

    expect(await screen.findByText('No one waiting.')).toBeDefined();
  });

  it('updates when told the queue changed', async () => {
    render(<App />);
    await screen.findByText('No one waiting.');

    listWaiting.mockResolvedValue([JANE, JOHN]);
    handlerFor('queue-changed')();

    expect(await screen.findByText('2 patients waiting')).toBeDefined();
    expect(screen.getByText('Jane Doe')).toBeDefined();
    expect(screen.getByText('John Roe')).toBeDefined();
  });

  it('counts in the singular for one', async () => {
    listWaiting.mockResolvedValue([JANE]);
    render(<App />);

    expect(await screen.findByText('1 patient waiting')).toBeDefined();
  });

  it('says nothing about the count until the first answer arrives', async () => {
    listWaiting.mockReturnValue(new Promise(() => {}));
    render(<App />);
    await screen.findByText(PAIRING.url);

    expect(screen.queryByText(/patient(s)? waiting/)).toBeNull();
    expect(screen.queryByText('No one waiting.')).toBeNull();
    expect(screen.queryByText('Cannot tell how many are waiting.')).toBeNull();
  });

  it('says the count is unknown rather than zero when the command fails', async () => {
    listWaiting.mockRejectedValue('no state');
    render(<App />);

    expect(await screen.findByText('Cannot tell how many are waiting.')).toBeDefined();
  });
});

describe('one patient', () => {
  async function open() {
    listWaiting.mockResolvedValue([JANE]);
    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: /Jane Doe/ }));
    return await screen.findByRole('button', { name: 'Mark as entered' });
  }

  it('shows every field, asked for by id', async () => {
    await open();

    expect(getSubmission).toHaveBeenCalledWith('a3f9');
    expect(screen.getByText('12 King St W')).toBeDefined();
    expect(screen.getByText('1234567890')).toBeDefined();
  });

  it('shows the province code beside its full name, since OSCAR takes the code', async () => {
    await open();

    expect(screen.getAllByText('ON').length).toBe(2);
    expect(screen.getAllByText('Ontario').length).toBe(2);
  });

  it('copies one field', async () => {
    await open();

    await userEvent.click(screen.getByRole('button', { name: 'Copy Health card number' }));

    expect(writeText).toHaveBeenCalledWith('1234567890');
  });

  it('offers no copy button for a field the patient left blank', async () => {
    await open();

    expect(screen.queryByRole('button', { name: 'Copy Preferred name' })).toBeNull();
  });

  it('keeps the record, in a section of its own, once it is marked as entered', async () => {
    await open();
    listWaiting.mockResolvedValue([{ ...JANE, entered_at: on(0, 14, 20) }]);

    await userEvent.click(screen.getByRole('button', { name: 'Mark as entered' }));
    handlerFor('queue-changed')();

    expect(markEntered).toHaveBeenCalledWith('a3f9');
    expect(await screen.findByText('1 entered — not yet deleted')).toBeDefined();
    expect(screen.getByText('No one waiting.')).toBeDefined();
  });

  it('offers no second Mark as entered, and says when it happened', async () => {
    listWaiting.mockResolvedValue([{ ...JANE, entered_at: on(0, 14, 20) }]);
    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: /Jane Doe/ }));

    expect(await screen.findByText(/Still on this computer until deleted/)).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Mark as entered' })).toBeNull();
  });

  it('deletes one record from its own view, once the confirm is answered', async () => {
    await open();

    await userEvent.click(screen.getByRole('button', { name: 'Delete record' }));
    expect(deleteSubmissions).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));

    expect(deleteSubmissions).toHaveBeenCalledWith(['a3f9']);
    expect(await screen.findByText(PAIRING.url)).toBeDefined();
  });

  it('says so when the entered stamp could not be saved', async () => {
    await open();
    markEntered.mockRejectedValue('store write failed');

    await userEvent.click(screen.getByRole('button', { name: 'Mark as entered' }));

    expect(
      await screen.findByText('That did not work. The record is not marked as entered.'),
    ).toBeDefined();
    expect(screen.getByRole('button', { name: 'Mark as entered' })).toBeDefined();
  });

  it('says so when a delete could not be written, and leaves the confirm up', async () => {
    await open();
    deleteSubmissions.mockRejectedValue('store write failed');

    await userEvent.click(screen.getByRole('button', { name: 'Delete record' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));

    expect(
      await screen.findByText('That did not work. The record is still on this computer.'),
    ).toBeDefined();
    expect(screen.getByRole('button', { name: 'Delete permanently' })).toBeDefined();
  });

  it('does not announce a deletion the staff member just asked for', async () => {
    await open();
    // The queue-changed refresh can land before the delete command returns, and
    // the record vanishing then is not news to whoever pressed the button.
    let finish: (removed: number) => void = () => {};
    deleteSubmissions.mockReturnValue(
      new Promise<number>((resolve) => {
        finish = resolve;
      }),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Delete record' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));

    listWaiting.mockResolvedValue([]);
    handlerFor('queue-changed')();
    await screen.findByText('No one waiting.');

    expect(screen.queryByText('That record has been deleted.')).toBeNull();
    await act(async () => finish(1));
  });

  it('says so when the entry had already gone', async () => {
    await open();
    markEntered.mockResolvedValue(false);

    await userEvent.click(screen.getByRole('button', { name: 'Mark as entered' }));

    expect(await screen.findByText('That record has been deleted.')).toBeDefined();
  });

  it('returns to the list when the record is deleted while it is open', async () => {
    await open();

    listWaiting.mockResolvedValue([]);
    handlerFor('queue-changed')();

    expect(await screen.findByText('That record has been deleted.')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Mark as entered' })).toBeNull();
  });
});

describe("deleting yesterday's records", () => {
  const ENTERED = {
    id: 'c0de',
    name: 'Amir Khan',
    submitted_at: on(1, 16, 40),
    entered_at: on(1, 16, 45),
  };
  const NEVER_ENTERED = {
    id: 'd1ce',
    name: 'Mia Chen',
    submitted_at: on(1, 23, 10),
    entered_at: null,
  };

  it('asks at launch when something from before today is still held', async () => {
    listWaiting.mockResolvedValue([ENTERED]);
    render(<App />);

    expect(await screen.findByRole('dialog')).toBeDefined();
    expect(screen.getByText('Time to delete records from yesterday')).toBeDefined();
    expect(screen.getByText('1 record from before today is still on this computer.')).toBeDefined();
  });

  it('stays out of the way when everything is from today', async () => {
    listWaiting.mockResolvedValue([JANE, JOHN]);
    render(<App />);
    await screen.findByText('2 patients waiting');

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('deletes exactly the records it named, and nothing from today', async () => {
    listWaiting.mockResolvedValue([JANE, ENTERED]);
    render(<App />);
    await screen.findByRole('dialog');

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(deleteSubmissions).toHaveBeenCalledWith(['c0de']);
  });

  it('names the ones nobody entered and takes a second confirm for them', async () => {
    listWaiting.mockResolvedValue([ENTERED, NEVER_ENTERED]);
    render(<App />);
    await screen.findByRole('dialog');

    expect(screen.getByText('1 of them was never marked as entered.')).toBeDefined();

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(deleteSubmissions).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Delete anyway' }));
    expect(deleteSubmissions).toHaveBeenCalledWith(['c0de', 'd1ce']);
  });

  it('keeps the prompt up, and says so, when the delete could not be written', async () => {
    listWaiting.mockResolvedValue([ENTERED]);
    deleteSubmissions.mockRejectedValue('store write failed');
    render(<App />);
    await screen.findByRole('dialog');

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(await screen.findByText(/The records are still on this computer/)).toBeDefined();
    expect(screen.getByRole('dialog')).toBeDefined();
  });

  it('asks again the next morning, without the window being restarted', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    listWaiting.mockResolvedValue([ENTERED]);
    render(<App />);
    await screen.findByRole('dialog');

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    vi.setSystemTime(new Date(Date.now() + 24 * 60 * 60 * 1000));
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });

    expect(screen.getByRole('dialog')).toBeDefined();
  });

  it('deletes nothing on cancel, and does not ask again that day', async () => {
    listWaiting.mockResolvedValue([ENTERED]);
    render(<App />);
    await screen.findByRole('dialog');

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(deleteSubmissions).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();

    handlerFor('queue-changed')();
    await waitFor(() => expect(listWaiting).toHaveBeenCalledTimes(2));

    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('updates', () => {
  it('offers the update when one is available', async () => {
    check.mockResolvedValue({ version: '0.2.0', downloadAndInstall: vi.fn() });
    render(<App />);

    expect(await screen.findByText('Version 0.2.0 is available.')).toBeDefined();
  });

  it('says nothing when the check fails, so an offline clinic is not nagged', async () => {
    check.mockRejectedValue('offline');
    render(<App />);
    await screen.findByText(PAIRING.url);

    await waitFor(() => expect(check).toHaveBeenCalled());
    expect(screen.queryByText(/is available/)).toBeNull();
    expect(screen.queryByText(/could not be installed/)).toBeNull();
  });
});
