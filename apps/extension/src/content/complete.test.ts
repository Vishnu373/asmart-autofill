import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Submission } from '@asmart/shared';

import type { Mapping } from '../shared/types';
import { watchSave } from './complete';

/** F6 owns `fill`; the wiring only cares what it reports, or that it threw. */
const filling = vi.hoisted(() => vi.fn());
vi.mock('./fill', () => ({ fill: filling }));

const mapping: Mapping = {
  emr: 'oscar',
  version: 1,
  fields: { first_name: '#firstName' },
  save_button: 'form[name=addDemographic] input[type=submit]',
};

/** Stands in for the OSCAR page until F8 captures the real markup. */
function page() {
  document.body.innerHTML = `
    <form name="addDemographic">
      <input id="firstName" />
      <input type="submit" value="Save" />
    </form>
  `;
  return document.querySelector('form') as HTMLFormElement;
}

function save(form: HTMLFormElement) {
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

beforeEach(() => {
  document.body.innerHTML = '';
  filling.mockReturnValue({ filled: ['first_name'], missing: [], occupied: [] });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('watchSave', () => {
  it('reports a save on the form holding the save button', () => {
    const form = page();
    const saved = vi.fn();

    watchSave(document, mapping, saved);
    save(form);

    expect(saved).toHaveBeenCalledTimes(1);
  });

  it('reports once, however many times the form is submitted', () => {
    const form = page();
    const saved = vi.fn();

    watchSave(document, mapping, saved);
    save(form);
    save(form);

    expect(saved).toHaveBeenCalledTimes(1);
  });

  it('stops reporting once disposed', () => {
    const form = page();
    const saved = vi.fn();

    const stop = watchSave(document, mapping, saved);
    stop();
    save(form);

    expect(saved).not.toHaveBeenCalled();
  });

  it('ignores a submit the page cancelled', () => {
    const form = page();
    const saved = vi.fn();

    form.addEventListener('submit', (event) => event.preventDefault());
    watchSave(document, mapping, saved);
    save(form);

    expect(saved).not.toHaveBeenCalled();
  });

  it('ignores another form on the page', () => {
    page();
    const other = document.createElement('form');
    document.body.append(other);
    const saved = vi.fn();

    watchSave(document, mapping, saved);
    save(other);

    expect(saved).not.toHaveBeenCalled();
  });

  it('does nothing when the save button selector is not valid CSS', () => {
    page();
    const saved = vi.fn();

    const stop = watchSave(document, { ...mapping, save_button: '##save' }, saved);
    stop();

    expect(saved).not.toHaveBeenCalled();
  });

  it('does nothing when the save button is not on the page', () => {
    const saved = vi.fn();

    const stop = watchSave(document, mapping, saved);
    stop();

    expect(saved).not.toHaveBeenCalled();
  });
});

describe('the content script wiring', () => {
  const person = { first_name: 'Jane' } as unknown as Submission;

  /** Loads `index.ts` and hands back the message listener it registers. */
  async function load(sendMessage: ReturnType<typeof vi.fn>) {
    const listeners: ((
      message: unknown,
      sender: unknown,
      respond: (answer?: unknown) => void,
    ) => void)[] = [];
    vi.stubGlobal('chrome', {
      runtime: { sendMessage, onMessage: { addListener: listeners.push.bind(listeners) } },
    });
    vi.resetModules();
    await import('./index');
    return (id: string) =>
      new Promise<unknown>((resolve) => {
        listeners[0]({ kind: 'fill', id }, null, resolve);
      });
  }

  function answering() {
    return vi.fn(async (message: { kind: string }) =>
      message.kind === 'mapping' ? mapping : message.kind === 'details' ? person : 'done',
    );
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('marks the patient filled when staff save', async () => {
    const form = page();
    const sendMessage = answering();

    const askFill = await load(sendMessage);
    await askFill('a3f9');
    save(form);

    expect(sendMessage).toHaveBeenLastCalledWith({ kind: 'filled', id: 'a3f9' });
  });

  it('marks a second patient under the second id, not the first', async () => {
    const form = page();
    const sendMessage = answering();

    const askFill = await load(sendMessage);
    await askFill('a3f9');
    await askFill('b7c2');
    save(form);
    save(form);

    const filled = sendMessage.mock.calls.filter(([message]) => message.kind === 'filled');
    expect(filled).toEqual([[{ kind: 'filled', id: 'b7c2' }]]);
  });

  /** A popup left waiting shows nothing at all, which is the one thing F7 must not do. */
  it('answers the popup even when the fill throws', async () => {
    page();
    filling.mockImplementation(() => {
      throw new TypeError('not a box');
    });

    const askFill = await load(answering());

    await expect(askFill('a3f9')).resolves.toBe('failed');
  });

  it('forgets the patient once saved, so a later save reports nothing', async () => {
    const form = page();
    const sendMessage = answering();

    const askFill = await load(sendMessage);
    await askFill('a3f9');
    save(form);
    sendMessage.mockClear();
    save(form);

    expect(sendMessage).not.toHaveBeenCalled();
  });
});
