import { FIELDS, type Submission } from '@asmart/shared';

import type { Mapping } from '../shared/types';

export interface FillResult {
  /** Field names written into the page. */
  filled: (keyof Submission)[];
  /** Mapped fields whose selector matched nothing. */
  missing: (keyof Submission)[];
  /** Mapped fields that already held a value. Non-empty means nothing was written. */
  occupied: (keyof Submission)[];
}

type Box = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

const HIGHLIGHT = '2px solid #1a7f37';

export function fill(root: Document, person: Submission, mapping: Mapping): FillResult {
  const targets: { name: keyof Submission; box: Box; value: string }[] = [];
  const missing: (keyof Submission)[] = [];
  const occupied: (keyof Submission)[] = [];

  for (const { name } of FIELDS) {
    const selector = mapping.fields[name];
    const value = person[name]?.trim();
    if (selector === undefined || !value) {
      continue;
    }

    const box = locate(root, selector);
    if (box === null || (box instanceof HTMLSelectElement && !offers(box, value))) {
      missing.push(name);
    } else if (box.value.trim() !== '') {
      occupied.push(name);
    } else {
      targets.push({ name, box, value });
    }
  }

  // All or nothing: half a chart is worse than none.
  if (occupied.length > 0) {
    return { filled: [], missing, occupied };
  }

  for (const { box, value } of targets) {
    box.value = value;
    box.style.outline = HIGHLIGHT;
    box.dispatchEvent(new Event('input', { bubbles: true }));
    box.dispatchEvent(new Event('change', { bubbles: true }));
  }

  return { filled: targets.map((target) => target.name), missing, occupied };
}

/**
 * A hand-edited selector can be invalid CSS, or can land on a wrapper rather
 * than a box. Neither can hold a value, so both are missing — which staff are
 * told — instead of throwing and leaving them with no answer at all.
 */
function locate(root: Document, selector: string): Box | null {
  let found: Element | null;
  try {
    found = root.querySelector(selector);
  } catch {
    return null;
  }
  if (
    found instanceof HTMLInputElement ||
    found instanceof HTMLSelectElement ||
    found instanceof HTMLTextAreaElement
  ) {
    return found;
  }
  return null;
}

function offers(box: HTMLSelectElement, value: string): boolean {
  return Array.from(box.options).some((option) => option.value === value);
}
