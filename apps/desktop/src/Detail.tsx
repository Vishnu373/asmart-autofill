import { FIELDS, type Submission } from '@asmart/shared';
import { useState } from 'react';

import { CopyButton } from './CopyButton';
import { deleteSubmissions, markEntered, type Summary } from './queue';
import { time } from './time';

interface Props {
  entry: Summary;
  details: Submission;
  /** True while this view is the one deleting, so the list can stay quiet. */
  onRemoving: (active: boolean) => void;
  onDone: () => void;
  onGone: () => void;
}

export function Detail({ entry, details, onRemoving, onDone, onGone }: Props) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [enterFailed, setEnterFailed] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState(false);

  async function enter() {
    setBusy(true);
    setEnterFailed(false);
    try {
      // False means it left while this view was open — deleted on another look.
      // Either way the list is where the answer is.
      if (await markEntered(entry.id)) {
        onDone();
      } else {
        onGone();
      }
    } catch (e) {
      // Only the button coming back said anything before, which reads as a
      // misclick rather than as a stamp that never happened.
      console.error('could not mark entered:', e);
      setEnterFailed(true);
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setDeleteFailed(false);
    onRemoving(true);
    try {
      await deleteSubmissions([entry.id]);
      onDone();
    } catch (e) {
      // The confirm stays up and says so. Closing it looks exactly like the
      // success path, and the record is still on the computer either way.
      console.error('could not delete:', e);
      onRemoving(false);
      setDeleteFailed(true);
      setBusy(false);
    }
  }

  return (
    <section className="detail">
      <button type="button" className="back" onClick={onDone}>
        ‹ Back
      </button>
      <h2>{entry.name}</h2>
      <p className="meta">
        {entry.id} · {time(entry.submitted_at)}
      </p>

      <dl>
        {FIELDS.map(({ name, label, options }) => {
          const value = details[name]?.trim() ?? '';
          const option = options?.find((o) => o.value === value);
          return (
            <div key={name} className="field">
              <dt>{label}</dt>
              <dd>
                {value ? (
                  <>
                    <span className="value">{value}</span>
                    {option && <span className="expanded">{option.label}</span>}
                    <CopyButton value={value} label={label} />
                  </>
                ) : (
                  <span className="blank">—</span>
                )}
              </dd>
            </div>
          );
        })}
      </dl>

      {entry.entered_at ? (
        <p className="entered-note">
          Entered at {time(entry.entered_at)}. Still on this computer until deleted.
        </p>
      ) : (
        <>
          <button type="button" className="entered" onClick={() => void enter()} disabled={busy}>
            Mark as entered
          </button>
          {enterFailed && (
            <p className="warn" role="alert">
              That did not work. The record is not marked as entered.
            </p>
          )}
        </>
      )}

      {confirming ? (
        <div className="confirm">
          <p className="warn">Delete this record from this computer for good?</p>
          {deleteFailed && (
            <p className="warn" role="alert">
              That did not work. The record is still on this computer.
            </p>
          )}
          <div className="prompt-actions">
            <button type="button" className="cancel" onClick={() => setConfirming(false)}>
              Cancel
            </button>
            <button type="button" className="danger" onClick={() => void remove()} disabled={busy}>
              Delete permanently
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="delete" onClick={() => setConfirming(true)}>
          Delete record
        </button>
      )}
    </section>
  );
}
