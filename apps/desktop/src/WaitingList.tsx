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

  if (waiting === 'unknown') {
    return (
      <section className="waiting">
        <h2>Cannot tell how many are waiting.</h2>
      </section>
    );
  }

  const queued = waiting.filter((entry) => !entry.entered_at);
  const entered = waiting.filter((entry) => entry.entered_at);

  return (
    <>
      <section className="waiting">
        <h2>{heading(queued.length)}</h2>
        <Rows entries={queued} onOpen={onOpen} />
      </section>

      {/* Marking a patient entered no longer removes them, so the ones already
          in the EMR need somewhere to sit until staff delete them. */}
      {entered.length > 0 && (
        <section className="waiting kept">
          <h2>{entered.length} entered — not yet deleted</h2>
          <Rows entries={entered} onOpen={onOpen} />
        </section>
      )}
    </>
  );
}

function Rows({ entries, onOpen }: { entries: Summary[]; onOpen: (id: string) => void }) {
  return (
    <ul>
      {entries.map((entry) => (
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
  );
}

function heading(count: number) {
  if (count === 0) return 'No one waiting.';
  return count === 1 ? '1 patient waiting' : `${count} patients waiting`;
}
