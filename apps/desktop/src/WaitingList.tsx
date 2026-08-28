import type { Summary } from './queue';
import { time } from './time';

/** `unknown` is "could not find out", which must not read as "nobody is here". */
export type Waiting = Summary[] | 'unknown' | 'asking';

export function WaitingList({
  waiting,
  onOpen,
}: {
  waiting: Waiting;
  onOpen: (id: string) => void;
}) {
  if (waiting === 'asking') {
    return null;
  }

  return (
    <section className="waiting">
      <h2>{heading(waiting)}</h2>
      {waiting !== 'unknown' && (
        <ul>
          {waiting.map((entry) => (
            <li key={entry.id}>
              <button type="button" onClick={() => onOpen(entry.id)}>
                <span className="name">{entry.name}</span>
                <span className="id">{entry.id}</span>
                <span className="at">{time(entry.submitted_at)}</span>
                <span aria-hidden="true" className="chevron">
                  ›
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function heading(waiting: Summary[] | 'unknown') {
  if (waiting === 'unknown') return 'Cannot tell how many are waiting.';
  if (waiting.length === 0) return 'No one waiting.';
  return waiting.length === 1 ? '1 patient waiting' : `${waiting.length} patients waiting`;
}
