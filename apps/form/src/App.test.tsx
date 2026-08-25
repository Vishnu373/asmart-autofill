import '@testing-library/jest-dom/vitest';

import type { Submission } from '@asmart/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';

const VALID: Submission = {
  first_name: 'Jane',
  last_name: 'Doe',
  preferred_name: '',
  address: '12 King St W',
  city: 'Toronto',
  province: 'ON',
  postal_code: 'M5H 1A1',
  phone: '4165551234',
  email: '',
  date_of_birth: '1985-04-17',
  health_insurance_number: '1234567890',
  health_insurance_version: '',
  hc_type: 'ON',
};

function fill(values: Partial<Submission>) {
  for (const [name, value] of Object.entries(values)) {
    fireEvent.change(document.getElementById(name)!, { target: { value } });
  }
}

function submit() {
  fireEvent.click(screen.getByRole('button'));
}

function created(): Response {
  return new Response(JSON.stringify({ id: 'ab12' }), { status: 201 });
}

let fetchMock: ReturnType<typeof vi.fn>;

// jsdom under bun gives a localStorage without the methods, so stand one in.
const stored = new Map<string, string>();

beforeEach(() => {
  stored.set('asmart-token', 'secret');
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  stored.clear();
});

describe('validation display', () => {
  it('shows the reason next to the offending field and does not send', () => {
    render(<App />);
    fill({ ...VALID, postal_code: 'nope' });
    submit();

    expect(document.getElementById('postal_code')).toHaveAccessibleDescription(
      'must look like A1A 1A1',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports a field on blur and clears it once it is fixed', () => {
    render(<App />);
    fireEvent.blur(document.getElementById('first_name')!);
    expect(screen.getByText('is required')).toBeInTheDocument();

    fill({ first_name: 'Jane' });
    fireEvent.blur(document.getElementById('first_name')!);
    expect(screen.queryByText('is required')).not.toBeInTheDocument();
  });

  it('sends the token as a bearer header and clears the form once saved', async () => {
    fetchMock.mockResolvedValue(created());
    render(<App />);
    fill(VALID);
    submit();

    await screen.findByText('Thank you. The front desk has your details.');
    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers.authorization).toBe('Bearer secret');
    expect(options.headers['idempotency-key']).toEqual(expect.any(String));
    expect(document.getElementById('first_name')).toHaveValue('');
  });
});

describe('double-submit guard', () => {
  it('sends once when the button is pressed twice', async () => {
    let finish!: (response: Response) => void;
    fetchMock.mockReturnValue(
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
    );

    render(<App />);
    fill(VALID);
    submit();
    submit();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    finish(created());
    await screen.findByText('Thank you. The front desk has your details.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reuses the idempotency key when a retry follows a failure', async () => {
    fetchMock.mockRejectedValue(new TypeError('failed to fetch'));
    render(<App />);
    fill(VALID);
    submit();

    await screen.findByText(/front desk is not reachable/);
    fetchMock.mockResolvedValue(created());
    submit();

    await screen.findByText('Thank you. The front desk has your details.');
    const keys = fetchMock.mock.calls
      .filter(([url]) => url === '/api/submissions')
      .map(([, options]) => options.headers['idempotency-key']);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });
  it('starts a new key when a value is corrected after a failure', async () => {
    fetchMock.mockRejectedValue(new TypeError('failed to fetch'));
    render(<App />);
    fill(VALID);
    submit();

    await screen.findByText(/front desk is not reachable/);
    fetchMock.mockResolvedValue(created());
    fill({ phone: '4165559999' });
    submit();

    await screen.findByText('Thank you. The front desk has your details.');
    const keys = fetchMock.mock.calls
      .filter(([url]) => url === '/api/submissions')
      .map(([, options]) => options.headers['idempotency-key']);
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
  });
});

describe('on a non-secure origin, which is what the tablet gets over http', () => {
  it('still submits when crypto.randomUUID is missing', async () => {
    fetchMock.mockResolvedValue(created());
    vi.stubGlobal('crypto', {
      getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto),
    });

    render(<App />);
    fill(VALID);
    submit();

    await screen.findByText('Thank you. The front desk has your details.');
    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers['idempotency-key']).toEqual(expect.any(String));
  });
});

describe('what actually leaves the tablet', () => {
  it('is trimmed, since a tablet keyboard is easy to leave a space on', async () => {
    fetchMock.mockResolvedValue(created());

    render(<App />);
    fill({ ...VALID, first_name: '  Jane  ', postal_code: ' M5H 1A1 ' });
    submit();

    await screen.findByText('Thank you. The front desk has your details.');
    const [, options] = fetchMock.mock.calls[0];
    expect(JSON.parse(options.body)).toMatchObject({
      first_name: 'Jane',
      postal_code: 'M5H 1A1',
    });
  });
});

describe('a field with a fixed set of answers', () => {
  it('offers the province as a dropdown of the codes OSCAR fills', () => {
    render(<App />);
    const province = document.getElementById('province')!;
    expect(province.tagName).toBe('SELECT');
    const values = Array.from((province as HTMLSelectElement).options).map((o) => o.value);
    expect(values).toContain('ON');
  });

  it('cannot hold a value the dropdown does not offer', () => {
    render(<App />);
    fill({ ...VALID, province: 'Ontario' });
    submit();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('when the front desk is away', () => {
  it('says so rather than blaming the form', async () => {
    fetchMock.mockRejectedValue(new TypeError('failed to fetch'));
    render(<App />);
    fill(VALID);
    submit();

    await screen.findByText(/front desk is not reachable/);
  });

  it('blames the form when health still answers', async () => {
    fetchMock.mockImplementation((url: string) =>
      url === '/api/health'
        ? Promise.resolve(new Response('{}', { status: 200 }))
        : Promise.reject(new TypeError('failed to fetch')),
    );
    render(<App />);
    fill(VALID);
    submit();

    await screen.findByText(/Something went wrong/);
  });

  it('asks for a re-pairing when the token is stale', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 401 }));
    render(<App />);
    fill(VALID);
    submit();

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/pairing again/));
  });
});
