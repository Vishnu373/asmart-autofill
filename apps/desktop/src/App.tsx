import type { Submission } from '@asmart/shared';
import { listen } from '@tauri-apps/api/event';
import { useCallback, useEffect, useRef, useState } from 'react';

import { CleanupPrompt } from './CleanupPrompt';
import { Connect } from './Connect';
import { Detail } from './Detail';
import { getPairingInfo, type PairingInfo } from './pairing';
import { Preview } from './Preview';
import { deleteSubmissions, getSubmission, listWaiting, type Summary } from './queue';
import { dayKey, fromBeforeToday } from './stale';
import { Updater } from './Updater';
import { WaitingList, type Waiting } from './WaitingList';

/** The patient on screen, once both the summary and the 13 fields are in hand. */
interface Open {
  entry: Summary;
  details: Submission;
}

type Tab = 'dashboard' | 'preview';

export function App() {
  const [pairing, setPairing] = useState<PairingInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState<Waiting>('asking');
  const [open, setOpen] = useState<Open | null>(null);
  const [gone, setGone] = useState(false);
  const [tab, setTab] = useState<Tab>('dashboard');
  const [cleanup, setCleanup] = useState<Summary[] | null>(null);
  const [cleanupFailed, setCleanupFailed] = useState(false);
  const [today, setToday] = useState(dayKey);
  // Cancelling the prompt is answered for the calendar day, not for this run of
  // the application. A front desk that never closes the window would otherwise
  // be asked on the morning it first opened and never again.
  const askedOn = useRef<string | null>(null);
  // A record leaving under the open view is a surprise worth saying out loud —
  // unless this view is the one deleting it.
  const removing = useRef<string | null>(null);

  const refreshPairing = useCallback(async () => {
    try {
      setPairing(await getPairingInfo());
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  /** Midnight has to arrive on its own; a quiet clinic sends no queue events. */
  useEffect(() => {
    const tick = setInterval(() => setToday(dayKey()), 60_000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    void refreshPairing();
    const unlisten = listen('address-changed', () => void refreshPairing());
    return () => void unlisten.then((off) => off());
  }, [refreshPairing]);

  useEffect(() => {
    // Two submissions land together, the older list answers last, and the open
    // patient looks gone. Only the newest request is allowed to write.
    let latest = 0;
    const refresh = () => {
      const mine = ++latest;
      void listWaiting().then(
        (list) => {
          if (mine === latest) {
            setWaiting(list);
          }
        },
        (e: unknown) => {
          // Swallowing this is what made a denied command look like an empty
          // waiting room for a whole afternoon.
          console.error('waiting list refused:', e);
          if (mine === latest) {
            setWaiting('unknown');
          }
        },
      );
    };
    refresh();
    const unlisten = listen('queue-changed', refresh);
    return () => void unlisten.then((off) => off());
  }, []);

  /**
   * Nothing expires on its own any more, so an entry leaving under the open
   * view means a staff member deleted it — here, or on a second look at the
   * same list. Either way the fields on screen no longer belong to anyone.
   *
   * A record that is still here but has just been marked entered has to be
   * picked up too, or the open view keeps offering a button that is now done.
   */
  useEffect(() => {
    if (!open || waiting === 'asking' || waiting === 'unknown') {
      return;
    }
    const fresh = waiting.find((entry) => entry.id === open.entry.id);
    if (!fresh) {
      // The delete command and the queue-changed refresh race, so this can run
      // before the button that caused it has even returned.
      const ours = removing.current === open.entry.id;
      removing.current = null;
      setOpen(null);
      setGone(!ours);
    } else if (fresh.entered_at !== open.entry.entered_at) {
      setOpen({ ...open, entry: fresh });
    }
  }, [waiting, open]);

  /** Asked once a day, as soon as a list shows anything from before today. */
  useEffect(() => {
    if (askedOn.current === today || waiting === 'asking' || waiting === 'unknown') {
      return;
    }
    const stale = fromBeforeToday(waiting);
    if (stale.length > 0) {
      askedOn.current = today;
      setCleanup(stale);
    }
  }, [waiting, today]);

  async function show(id: string) {
    if (waiting === 'asking' || waiting === 'unknown') {
      return;
    }
    const entry = waiting.find((candidate) => candidate.id === id);
    if (!entry) {
      return;
    }
    setGone(false);
    try {
      const details = await getSubmission(id);
      if (details) {
        setOpen({ entry, details });
      } else {
        setGone(true);
      }
    } catch (e) {
      console.error('could not read the submission:', e);
      setGone(true);
    }
  }

  /** The ids the prompt named, not a rule re-run here — see `delete_submissions`. */
  async function clean(stale: Summary[]) {
    try {
      await deleteSubmissions(stale.map((entry) => entry.id));
    } catch (e) {
      // Closing here would leave staff believing yesterday's records are gone,
      // with nothing to ask again until tomorrow.
      console.error('could not delete:', e);
      setCleanupFailed(true);
      return;
    }
    setCleanupFailed(false);
    setCleanup(null);
  }

  function dashboard() {
    if (open) {
      return (
        <Detail
          entry={open.entry}
          details={open.details}
          onRemoving={(active) => {
            removing.current = active ? open.entry.id : null;
          }}
          onDone={() => setOpen(null)}
          onGone={() => {
            setOpen(null);
            setGone(true);
          }}
        />
      );
    }
    return (
      <>
        <Connect pairing={pairing} error={error} />
        {gone && (
          <p className="expired" role="status">
            That record has been deleted.
          </p>
        )}
        <WaitingList waiting={waiting} onOpen={(id) => void show(id)} />
      </>
    );
  }

  return (
    <main>
      <h1>asmart-autofill</h1>
      <nav className="tabs">
        {(['dashboard', 'preview'] as const).map((name) => (
          <button
            key={name}
            type="button"
            aria-current={tab === name ? 'page' : undefined}
            onClick={() => setTab(name)}
          >
            {name === 'dashboard' ? 'Dashboard' : 'Form preview'}
          </button>
        ))}
      </nav>
      {tab === 'preview' ? <Preview /> : dashboard()}
      <Updater />
      {cleanup && (
        <CleanupPrompt
          stale={cleanup}
          failed={cleanupFailed}
          onDelete={() => void clean(cleanup)}
          onCancel={() => {
            setCleanupFailed(false);
            setCleanup(null);
          }}
        />
      )}
    </main>
  );
}
