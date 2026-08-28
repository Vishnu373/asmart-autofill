import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';

const listen = vi.hoisted(() => vi.fn());
const getPairingInfo = vi.hoisted(() => vi.fn());
const listWaiting = vi.hoisted(() => vi.fn());
const getSubmission = vi.hoisted(() => vi.fn());
const markEntered = vi.hoisted(() => vi.fn());
const writeText = vi.hoisted(() => vi.fn());
const check = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/event', () => ({ listen }));
vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({ writeText }));
vi.mock('@tauri-apps/plugin-updater', () => ({ check }));
vi.mock('./pairing', () => ({ getPairingInfo }));
vi.mock('./queue', () => ({ listWaiting, getSubmission, markEntered }));

const PAIRING = { url: 'http://192.168.1.20:8787/?t=abc', token: 'abc', port: 8787 };

const JANE = { id: 'a3f9', name: 'Jane Doe', submitted_at: '2026-08-13T14:12:04Z' };
const JOHN = { id: 'b71c', name: 'John Roe', submitted_at: '2026-08-13T14:09:00Z' };

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
  writeText.mockResolvedValue(undefined);
  // No update, and no network call, unless a test says otherwise.
  check.mockResolvedValue(null);
});

afterEach(() => {
  vi.clearAllMocks();
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

  it('drops the entry when it is marked as entered', async () => {
    await open();

    await userEvent.click(screen.getByRole('button', { name: 'Mark as entered' }));

    expect(markEntered).toHaveBeenCalledWith('a3f9');
    expect(await screen.findByText(PAIRING.url)).toBeDefined();
  });

  it('says so when the entry had already gone', async () => {
    await open();
    markEntered.mockResolvedValue(false);

    await userEvent.click(screen.getByRole('button', { name: 'Mark as entered' }));

    expect(await screen.findByText('That submission is no longer waiting.')).toBeDefined();
  });

  it('returns to the list when the entry expires while it is open', async () => {
    await open();

    listWaiting.mockResolvedValue([]);
    handlerFor('queue-changed')();

    expect(await screen.findByText('That submission is no longer waiting.')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Mark as entered' })).toBeNull();
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
