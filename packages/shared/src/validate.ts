import { PROVINCES, type Submission } from './submission';

/** Names the field that failed and why, so the tablet can point at it. */
export interface ValidationError {
  field: keyof Submission;
  reason: string;
}

/**
 * Mirrors `Submission::validate` in `src-tauri/src/submission.rs` rule for rule.
 * `today` is a parameter so the date-of-birth rule is testable without waiting
 * for the clock; it is a UTC-midnight timestamp.
 */
export function validate(
  submission: Submission,
  today: number = todayUtc(),
): ValidationError | null {
  for (const field of ['first_name', 'last_name', 'preferred_name', 'address', 'city'] as const) {
    if (!required(submission[field] ?? '')) {
      return err(field, 'is required');
    }
  }

  const province = required(submission.province);
  if (!province) {
    return err('province', 'is required');
  }
  if (!isProvince(province)) {
    return err('province', 'must be a Canadian province or territory');
  }

  const hcType = required(submission.hc_type);
  if (!hcType) {
    return err('hc_type', 'is required');
  }
  if (!isProvince(hcType)) {
    return err('hc_type', 'must be a Canadian province or territory');
  }

  const postalCode = required(submission.postal_code);
  if (!postalCode) {
    return err('postal_code', 'is required');
  }
  if (!isPostalCode(postalCode)) {
    return err('postal_code', 'must look like A1A 1A1');
  }

  const phone = required(submission.phone);
  if (!phone) {
    return err('phone', 'is required');
  }
  if (digits(phone).length !== 10) {
    return err('phone', 'must have 10 digits');
  }

  const number = required(submission.health_insurance_number);
  if (!number) {
    return err('health_insurance_number', 'is required');
  }
  // Ten digits is Ontario's format. The other provinces each have their own,
  // and guessing at twelve of them would refuse cards that are perfectly good.
  if (hcType === 'ON' && !/^[0-9]{10}$/.test(number)) {
    return err('health_insurance_number', 'must be 10 digits');
  }

  const dateOfBirth = required(submission.date_of_birth);
  if (!dateOfBirth) {
    return err('date_of_birth', 'is required');
  }
  const parsed = parseDate(dateOfBirth);
  if (parsed === null) {
    return err('date_of_birth', 'must be a real date as YYYY-MM-DD');
  }
  if (parsed > today) {
    return err('date_of_birth', 'must not be in the future');
  }

  const email = required(submission.email ?? '');
  if (!email) {
    return err('email', 'is required');
  }
  if (!isEmail(email)) {
    return err('email', 'must look like name@example.com');
  }

  const version = required(submission.health_insurance_version ?? '');
  if (!version) {
    return err('health_insurance_version', 'is required');
  }
  if (!/^[A-Za-z]{2}$/.test(version)) {
    return err('health_insurance_version', 'must be two letters');
  }

  return null;
}

export function todayUtc(): number {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

function err(field: keyof Submission, reason: string): ValidationError {
  return { field, reason };
}

/** The trimmed value, or `null` when it is blank. */
function required(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function digits(value: string): string {
  return value.replace(/[^0-9]/g, '');
}

function isProvince(value: string): boolean {
  return PROVINCES.some((province) => province.value === value);
}

/** Letter-digit-letter, digit-letter-digit, with or without the middle space. */
function isPostalCode(value: string): boolean {
  return /^[A-Za-z][0-9][A-Za-z][0-9][A-Za-z][0-9]$/.test(value.replace(/\s/g, ''));
}

/**
 * Deliberately shallow: one `@`, something either side, and a dotted domain.
 * Anything stricter rejects addresses that work.
 */
function isEmail(value: string): boolean {
  const at = value.indexOf('@');
  if (at === -1) {
    return false;
  }
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  const labels = domain.split('.');
  return (
    !/\s/.test(value) &&
    local !== '' &&
    !domain.includes('@') &&
    labels.length > 1 &&
    labels.every((label) => label !== '')
  );
}

/** UTC-midnight timestamp for a strict `YYYY-MM-DD` calendar date, else `null`. */
function parseDate(value: string): number | null {
  const match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(value);
  if (!match) {
    return null;
  }
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(0);
  // setUTCFullYear rather than Date.UTC, which folds years under 100 into the 1900s.
  date.setUTCFullYear(year, month - 1, day);
  const timestamp = date.getTime();
  const real =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return real ? timestamp : null;
}
