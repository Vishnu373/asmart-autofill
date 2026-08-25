import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';

const invoke = vi.hoisted(() => vi.fn());
const listen = vi.hoisted(() => vi.fn());
const getWaitingCount = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen }));
vi.mock('./waiting', () => ({ getWaitingCount }));

const PAIRING = { url: 'http://192.168.1.20:8787/?t=abc', token: 'abc', port: 8787 };

/** Hands back the handler `listen` was given, so a test can fire the event. */
function addressChanged() {
  const [event, handler] = listen.mock.calls[0];
  expect(event).toBe('address-changed');
  return handler as () => void;
}

/** Hands back the handler for the queue event, second of the two listeners. */
function queueChanged() {
  const [event, handler] = listen.mock.calls[1];
  expect(event).toBe('queue-changed');
  return handler as () => void;
}

beforeEach(() => {
  invoke.mockResolvedValue(PAIRING);
  listen.mockResolvedValue(() => {});
  getWaitingCount.mockResolvedValue(0);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('tray window', () => {
  it('renders the QR for the pairing url with the address and port underneath', async () => {
    const { container } = render(<App />);

    expect(await screen.findByText(PAIRING.url)).toBeDefined();
    expect(container.querySelector('svg')).not.toBeNull();
    expect(screen.getByText('Server running on port 8787.')).toBeDefined();
  });

  it('says it is starting and shows no QR before an address is known', async () => {
    invoke.mockResolvedValue(null);
    const { container } = render(<App />);

    expect(await screen.findByText('Starting — waiting for a network address.')).toBeDefined();
    expect(container.querySelector('svg')).toBeNull();
  });

  it('regenerates the QR when the address changes', async () => {
    render(<App />);
    await screen.findByText(PAIRING.url);

    const moved = { ...PAIRING, url: 'http://10.0.0.5:8787/?t=abc' };
    invoke.mockResolvedValue(moved);
    addressChanged()();

    expect(await screen.findByText(moved.url)).toBeDefined();
  });

  it('reports a failed pairing lookup instead of a port', async () => {
    invoke.mockRejectedValue('no state');
    render(<App />);

    expect(await screen.findByText('Cannot reach the server: no state')).toBeDefined();
  });

  it('updates the waiting count when told the queue changed', async () => {
    render(<App />);
    await screen.findByText('0 patients waiting');

    getWaitingCount.mockResolvedValue(2);
    queueChanged()();

    expect(await screen.findByText('2 patients waiting')).toBeDefined();
  });

  it('says nothing about the count until the first answer arrives', async () => {
    getWaitingCount.mockReturnValue(new Promise(() => {}));
    render(<App />);
    await screen.findByText(PAIRING.url);

    expect(screen.queryByText(/patient(s)? waiting/)).toBeNull();
    expect(screen.queryByText('Cannot tell how many are waiting.')).toBeNull();
  });

  it('says the count is unknown rather than zero when the command fails', async () => {
    getWaitingCount.mockRejectedValue('no state');
    render(<App />);

    expect(await screen.findByText('Cannot tell how many are waiting.')).toBeDefined();
  });

  it('shows the waiting count, singular for one', async () => {
    getWaitingCount.mockResolvedValue(1);
    render(<App />);

    expect(await screen.findByText('1 patient waiting')).toBeDefined();
  });

  it('shows the waiting count in the plural', async () => {
    getWaitingCount.mockResolvedValue(3);
    render(<App />);

    expect(await screen.findByText('3 patients waiting')).toBeDefined();
  });
});
