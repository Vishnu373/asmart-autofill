import { FIELDS, validate, type Submission } from '@asmart/shared';
import { useRef, useState } from 'react';

import { send, type Outcome } from './api';

type Status = Outcome['kind'] | 'sending';

const INPUT_TYPE: Partial<Record<keyof Submission, string>> = {
  date_of_birth: 'date',
  phone: 'tel',
  email: 'email',
};

const MESSAGE: Record<Exclude<Status, 'sending'>, string> = {
  saved: 'Thank you. The front desk has your details.',
  invalid: 'Please check the highlighted field.',
  unauthorized: 'This tablet needs pairing again. Please ask the front desk to show the QR code.',
  busy: 'Too many submissions just now. Please wait a moment and press submit again.',
  unreachable: 'The front desk is not reachable. Please hand the tablet to a staff member.',
  broken: 'Something went wrong sending the form. Please hand the tablet to a staff member.',
};

export function App() {
  const [values, setValues] = useState(blank);
  const [errors, setErrors] = useState<Partial<Record<keyof Submission, string>>>({});
  const [status, setStatus] = useState<Status | null>(null);
  // Held across a failure so a retry is the same submission to the front desk.
  const key = useRef<string | null>(null);
  // A tablet can dispatch two taps before React re-renders the disabled button.
  const inFlight = useRef(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current) {
      return;
    }

    const error = validate(values);
    if (error) {
      setErrors({ [error.field]: error.reason });
      setStatus('invalid');
      document.getElementById(error.field)?.focus();
      return;
    }

    inFlight.current = true;
    try {
      key.current ??= newKey();
      setStatus('sending');

      const outcome = await send(trimmed(values), key.current);
      setStatus(outcome.kind);

      if (outcome.kind === 'saved') {
        key.current = null;
        setValues(blank());
        setErrors({});
      } else if (outcome.kind === 'invalid') {
        setErrors({ [outcome.field]: outcome.reason });
      }
    } catch {
      setStatus('broken');
    } finally {
      inFlight.current = false;
    }
  }

  /**
   * A changed value is a different submission, so the key that identified the
   * old one has to go: reusing it would hand back the entry already waiting and
   * quietly discard the correction.
   */
  function change(name: keyof Submission, value: string) {
    key.current = null;
    setValues((current) => ({ ...current, [name]: value }));
  }

  /** The shared rules report one problem at a time; show it only on its own field. */
  function checkOne(name: keyof Submission) {
    const error = validate(values);
    setErrors({ ...errors, [name]: error?.field === name ? error.reason : undefined });
  }

  return (
    <main>
      <h1>Your details</h1>
      <form onSubmit={onSubmit} noValidate>
        {FIELDS.map(({ name, label, optional, options }) => (
          <label key={name} htmlFor={name}>
            <span>
              {label}
              {optional ? ' (optional)' : ''}
            </span>
            {options ? (
              <select
                id={name}
                name={name}
                value={values[name] ?? ''}
                aria-invalid={errors[name] ? true : undefined}
                aria-describedby={errors[name] ? `${name}-error` : undefined}
                onChange={(event) => change(name, event.target.value)}
                onBlur={() => checkOne(name)}
              >
                <option value="">Please choose</option>
                {options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={name}
                name={name}
                type={INPUT_TYPE[name] ?? 'text'}
                value={values[name] ?? ''}
                autoComplete="off"
                aria-invalid={errors[name] ? true : undefined}
                aria-describedby={errors[name] ? `${name}-error` : undefined}
                onChange={(event) => change(name, event.target.value)}
                onBlur={() => checkOne(name)}
              />
            )}
            {errors[name] && (
              <p className="error" id={`${name}-error`}>
                {errors[name]}
              </p>
            )}
          </label>
        ))}
        <button type="submit" disabled={status === 'sending'}>
          {status === 'sending' ? 'Sending…' : 'Submit'}
        </button>
      </form>
      {status && status !== 'sending' && (
        <p role="status" className={status === 'saved' ? 'saved' : 'error'}>
          {MESSAGE[status]}
        </p>
      )}
    </main>
  );
}

/**
 * `crypto.randomUUID` exists only in a secure context, and the tablet loads the
 * form over plain http from a LAN address. `getRandomValues` has no such gate.
 */
function newKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** The rules trim before they check, so an untrimmed value can pass and reach OSCAR as typed. */
function trimmed(submission: Submission): Submission {
  return Object.fromEntries(
    FIELDS.map(({ name }) => [name, submission[name]?.trim() ?? '']),
  ) as unknown as Submission;
}

function blank(): Submission {
  return Object.fromEntries(FIELDS.map(({ name }) => [name, ''])) as unknown as Submission;
}
