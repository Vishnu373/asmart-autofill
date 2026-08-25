import { FIELDS, type Submission } from '@asmart/shared';

import { pending } from '../background/api';
import type { FillResult } from '../content/fill';
import type { Fill } from '../shared/messages';
import type { Waiting } from '../shared/types';

const root = document.getElementById('root') as HTMLElement;
const LABEL = new Map(FIELDS.map((field) => [field.name, field.label]));

void show();

async function show(): Promise<void> {
  const waiting = await pending();
  root.replaceChildren(
    waiting === null
      ? message(
          'down',
          'The front desk application is not running.',
          'Start it on this computer, then open this again.',
        )
      : waiting === 'refused'
        ? message(
            'down',
            'The front desk application will not accept this extension.',
            'It is running, so restarting it will not help — tell whoever set the extension up.',
          )
        : waiting.length === 0
          ? message('empty', 'No one is waiting.')
          : list(waiting),
  );
}

/** Already newest first from the application; the order here is the order it gave. */
function list(waiting: Waiting[]): HTMLElement {
  const rows = document.createElement('ul');
  rows.className = 'waiting';

  for (const person of waiting) {
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = person.name;

    const time = document.createElement('time');
    time.className = 'time';
    time.dateTime = person.submitted_at;
    time.textContent = new Date(person.submitted_at).toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
    });

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'patient';
    button.append(name, time);
    button.addEventListener('click', () => void pick(person.id));

    const row = document.createElement('li');
    row.append(button);
    rows.append(row);
  }

  return rows;
}

async function pick(id: string): Promise<void> {
  const handover: Fill = { kind: 'fill', id };
  const rows = Array.from(root.querySelectorAll<HTMLButtonElement>('.patient'));
  let result: Outcome;

  // One patient at a time: a second pick would meet the values the first wrote, and be refused.
  for (const row of rows) {
    row.disabled = true;
  }

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined) {
      throw new Error('no active tab');
    }
    result = await chrome.tabs.sendMessage<Fill, Outcome>(tab.id, handover);
  } catch {
    note('problem', "Open the patient's record in OSCAR first, then pick them again.");
    release(rows);
    return;
  }

  note(...outcome(result));
  if (result === null || typeof result === 'string' || result.filled.length === 0) {
    release(rows);
  }
}

/** Nothing reached the page, so the list is worth picking from again. */
function release(rows: HTMLButtonElement[]): void {
  for (const row of rows) {
    row.disabled = false;
  }
}

/** What the content script can come back with: a fill, a broken install, a fault, or nothing. */
type Outcome = FillResult | 'unconfigured' | 'failed' | null;

/** Never fail quietly: say which boxes were skipped and why. */
function outcome(result: Outcome): [tone: string, text: string] {
  if (result === null) {
    return ['problem', 'That patient is no longer waiting, or the application stopped.'];
  }
  if (result === 'unconfigured') {
    return [
      'problem',
      'Nothing was filled — this computer has no OSCAR field list. Enter this patient by hand, and tell whoever set the application up.',
    ];
  }
  if (result === 'failed') {
    return [
      'problem',
      'The extension ran into a problem. Check this page, and enter this patient by hand.',
    ];
  }
  if (result.occupied.length > 0) {
    return [
      'problem',
      `Nothing was filled — ${names(result.occupied)} already had something in it. Clear it, or enter this patient by hand.`,
    ];
  }
  if (result.missing.length > 0) {
    return [
      'problem',
      `${boxes(result.filled.length)} filled. Could not find ${names(result.missing)} on this page — enter by hand.`,
    ];
  }
  if (result.filled.length === 0) {
    return [
      'problem',
      'Nothing was filled — none of the OSCAR boxes are set up on this computer. Enter this patient by hand, and tell whoever set the application up.',
    ];
  }
  return ['done', `${boxes(result.filled.length)} filled. Check them, then save in OSCAR.`];
}

function names(fields: (keyof Submission)[]): string {
  return fields.map((field) => LABEL.get(field) ?? field).join(', ');
}

function boxes(count: number): string {
  return count === 1 ? '1 box' : `${count} boxes`;
}

function note(tone: string, text: string): void {
  root.querySelector('.note')?.remove();
  const line = document.createElement('p');
  line.className = `note ${tone}`;
  line.textContent = text;
  root.append(line);
}

function message(className: string, ...lines: string[]): HTMLElement {
  const block = document.createElement('div');
  block.className = className;
  for (const line of lines) {
    const paragraph = document.createElement('p');
    paragraph.textContent = line;
    block.append(paragraph);
  }
  return block;
}
