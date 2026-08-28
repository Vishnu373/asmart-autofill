import { FIELDS, type Submission } from '@asmart/shared';
import { useState } from 'react';

import { CopyButton } from './CopyButton';
import { markEntered, type Summary } from './queue';
import { time } from './time';

interface Props {
  entry: Summary;
  details: Submission;
  onDone: () => void;
  onGone: () => void;
}

export function Detail({ entry, details, onDone, onGone }: Props) {
  const [entering, setEntering] = useState(false);

  async function enter() {
    setEntering(true);
    try {
      // False means it left while this view was open — swept, or entered on
      // another look. Either way the list is where the answer is.
      if (await markEntered(entry.id)) {
        onDone();
      } else {
        onGone();
      }
    } catch (e) {
      console.error('could not mark entered:', e);
      setEntering(false);
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

      <button type="button" className="entered" onClick={() => void enter()} disabled={entering}>
        Mark as entered
      </button>
    </section>
  );
}
