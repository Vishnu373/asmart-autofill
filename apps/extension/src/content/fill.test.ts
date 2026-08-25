import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { Submission } from '@asmart/shared';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Mapping } from '../shared/types';
import { fill } from './fill';

const PAGE = readFileSync(
  resolve(import.meta.dirname, '../../../../e2e/fixtures/demographic.html'),
  'utf8',
);

const MAPPING: Mapping = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../../../../src-tauri/mapping.json'), 'utf8'),
) as Mapping;

const PERSON: Submission = {
  first_name: 'Ada',
  last_name: 'Lovelace',
  preferred_name: '',
  address: '12 Bayview Road',
  city: 'Toronto',
  province: 'ON',
  postal_code: 'M4C 1B5',
  phone: '4165550143',
  email: 'ada@example.com',
  date_of_birth: '1990-04-17',
  health_insurance_number: '1234567890',
  health_insurance_version: 'AB',
  hc_type: 'ON',
};

function box(id: string) {
  return document.querySelector<HTMLInputElement | HTMLSelectElement>(id)!;
}

beforeEach(() => {
  document.documentElement.innerHTML = PAGE;
});

describe('a blank page', () => {
  it('fills every mapped field that has a value', () => {
    const result = fill(document, PERSON, MAPPING);

    expect(result.missing).toEqual([]);
    expect(result.occupied).toEqual([]);
    expect(result.filled).toEqual([
      'first_name',
      'last_name',
      'address',
      'city',
      'province',
      'postal_code',
      'phone',
      'email',
      'date_of_birth',
      'health_insurance_number',
      'health_insurance_version',
      'hc_type',
    ]);
    expect(box('#firstName').value).toBe('Ada');
    expect(box('#postal').value).toBe('M4C 1B5');
    expect(box('#province').value).toBe('ON');
    expect(box('#hcType').value).toBe('ON');
  });

  it('leaves an absent optional value alone, without reporting it', () => {
    const result = fill(document, PERSON, MAPPING);

    expect(result.filled).not.toContain('preferred_name');
    expect(result.missing).not.toContain('preferred_name');
    expect(box('#preferredName').value).toBe('');
  });

  it('highlights every field it filled', () => {
    fill(document, PERSON, MAPPING);

    expect(box('#firstName').style.outline).not.toBe('');
    expect(box('#province').style.outline).not.toBe('');
    expect(box('#preferredName').style.outline).toBe('');
  });

  it('dispatches the input and change events a keystroke would', () => {
    const seen: string[] = [];
    for (const kind of ['input', 'change']) {
      document.addEventListener(kind, (event) => {
        seen.push(`${kind}:${(event.target as HTMLElement).id}`);
      });
    }

    fill(document, PERSON, MAPPING);

    expect(seen).toContain('input:firstName');
    expect(seen).toContain('change:firstName');
    expect(seen).toContain('input:province');
    expect(seen).toContain('change:province');
  });
});

describe('a page that already holds details', () => {
  it('refuses, and writes nothing at all', () => {
    box('#lastName').value = 'Byron';

    const result = fill(document, PERSON, MAPPING);

    expect(result.occupied).toEqual(['last_name']);
    expect(result.filled).toEqual([]);
    expect(box('#firstName').value).toBe('');
    expect(box('#firstName').style.outline).toBe('');
    expect(box('#province').value).toBe('');
    expect(box('#lastName').value).toBe('Byron');
  });

  it('counts a pre-selected dropdown as occupied', () => {
    box('#province').value = 'BC';

    const result = fill(document, PERSON, MAPPING);

    expect(result.occupied).toEqual(['province']);
    expect(result.filled).toEqual([]);
  });
});

describe('a mapping that does not match the page', () => {
  it('reports a selector that matched nothing, by name', () => {
    const result = fill(document, PERSON, {
      ...MAPPING,
      fields: { ...MAPPING.fields, city: '#nowhere' },
    });

    expect(result.missing).toEqual(['city']);
    expect(result.filled).toContain('first_name');
    expect(box('#city').value).toBe('');
  });

  it('reports a dropdown that has no such option, rather than writing nothing quietly', () => {
    const result = fill(document, { ...PERSON, province: 'ZZ' }, MAPPING);

    expect(result.missing).toEqual(['province']);
    expect(box('#province').value).toBe('');
  });

  /** F8 hand-edits these selectors, so a wrong one has to be reported, not thrown. */
  it('reports a selector that lands on something other than a box', () => {
    const result = fill(document, PERSON, {
      ...MAPPING,
      fields: { ...MAPPING.fields, city: 'form[name=addDemographic]' },
    });

    expect(result.missing).toEqual(['city']);
    expect(result.filled).toContain('first_name');
    expect(box('#city').value).toBe('');
  });

  it('reports a selector that is not valid CSS', () => {
    const result = fill(document, PERSON, {
      ...MAPPING,
      fields: { ...MAPPING.fields, city: '##city' },
    });

    expect(result.missing).toEqual(['city']);
    expect(result.filled).toContain('first_name');
    expect(box('#city').value).toBe('');
  });

  it('ignores a field the mapping does not carry', () => {
    const fields = { ...MAPPING.fields };
    delete fields.email;

    const result = fill(document, PERSON, { ...MAPPING, fields });

    expect(result.missing).toEqual([]);
    expect(result.filled).not.toContain('email');
    expect(box('#email').value).toBe('');
  });
});
