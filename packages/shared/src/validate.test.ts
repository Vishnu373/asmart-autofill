import { describe, expect, it } from 'vitest';

import { PROVINCES, type Submission } from './submission';
import { validate } from './validate';

const TODAY = Date.UTC(2026, 7, 20);

function valid(): Submission {
  return {
    first_name: 'Jane',
    last_name: 'Doe',
    preferred_name: 'Janie',
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
}

function failingField(patch: Partial<Submission>): string | undefined {
  return validate({ ...valid(), ...patch }, TODAY)?.field;
}

describe('validate', () => {
  it("accepts the design's example payload", () => {
    expect(validate(valid(), TODAY)).toBeNull();
  });

  it('allows the optional fields to be missing', () => {
    const submission = valid();
    delete submission.preferred_name;
    delete submission.email;
    delete submission.health_insurance_version;
    expect(validate(submission, TODAY)).toBeNull();
  });

  it('counts a blank optional field as missing', () => {
    expect(validate({ ...valid(), email: '  ', health_insurance_version: '' }, TODAY)).toBeNull();
  });

  it('requires every required field', () => {
    const blanks: Partial<Submission>[] = [
      { first_name: '' },
      { last_name: '' },
      { address: '' },
      { city: ' ' },
      { province: '' },
      { hc_type: '' },
      { postal_code: '' },
      { phone: '' },
      { date_of_birth: '' },
      { health_insurance_number: '' },
    ];

    for (const blank of blanks) {
      const [field] = Object.keys(blank);
      expect(validate({ ...valid(), ...blank }, TODAY)).toEqual({ field, reason: 'is required' });
    }
  });

  it('accepts a postal code without the space', () => {
    expect(validate({ ...valid(), postal_code: 'M5H1A1' }, TODAY)).toBeNull();
  });

  it('refuses a misshapen postal code', () => {
    for (const bad of ['M5H 1A', '12345', 'MMM 111', 'M5H 1A11']) {
      expect(failingField({ postal_code: bad })).toBe('postal_code');
    }
  });

  it('accepts a phone number with separators', () => {
    expect(validate({ ...valid(), phone: '(416) 555-1234' }, TODAY)).toBeNull();
  });

  it('refuses a phone number without ten digits', () => {
    for (const bad of ['416555123', '41655512345', 'four one six']) {
      expect(failingField({ phone: bad })).toBe('phone');
    }
  });

  it('refuses an email without a dotted domain', () => {
    for (const bad of ['jane', 'jane@', '@example.com', 'jane@example', 'ja ne@example.com']) {
      expect(failingField({ email: bad })).toBe('email');
    }
  });

  it('requires a date of birth that is a real past date', () => {
    for (const bad of ['17-04-1985', '1985-02-30', '1985-13-01', '2026-08-21']) {
      expect(failingField({ date_of_birth: bad })).toBe('date_of_birth');
    }
  });

  it('accepts a date of birth of today', () => {
    expect(validate({ ...valid(), date_of_birth: '2026-08-20' }, TODAY)).toBeNull();
  });

  it('refuses a province that is not a known code', () => {
    for (const bad of ['Ontario', 'on', 'ZZ']) {
      expect(validate({ ...valid(), province: bad }, TODAY)).toEqual({
        field: 'province',
        reason: 'must be a Canadian province or territory',
      });
      expect(failingField({ hc_type: bad })).toBe('hc_type');
    }
  });

  it('accepts every province the dropdown offers', () => {
    for (const { value } of PROVINCES) {
      expect(validate({ ...valid(), province: value }, TODAY)).toBeNull();
    }
  });

  it('refuses an Ontario health card number that is not ten digits', () => {
    for (const bad of ['123456789', '12345678901', '123456789X']) {
      expect(failingField({ health_insurance_number: bad })).toBe('health_insurance_number');
    }
  });

  it('takes another province at its own format', () => {
    const quebec = { ...valid(), hc_type: 'QC', health_insurance_number: 'DOEJ 9001 0112' };
    expect(validate(quebec, TODAY)).toBeNull();
  });

  it('still requires a health card number for another province', () => {
    expect(failingField({ hc_type: 'QC', health_insurance_number: '  ' })).toBe(
      'health_insurance_number',
    );
  });

  it('refuses a version code that is not two letters', () => {
    for (const bad of ['A', 'ABC', 'A1']) {
      expect(failingField({ health_insurance_version: bad })).toBe('health_insurance_version');
    }
  });

  it('names the field and the reason', () => {
    expect(validate({ ...valid(), phone: '' }, TODAY)).toEqual({
      field: 'phone',
      reason: 'is required',
    });
  });
});
