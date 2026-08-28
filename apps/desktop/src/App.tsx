import type { Submission } from '@asmart/shared';
import { listen } from '@tauri-apps/api/event';
import { useCallback, useEffect, useState } from 'react';

import { Connect } from './Connect';
import { Detail } from './Detail';
import { getPairingInfo, type PairingInfo } from './pairing';
import { getSubmission, listWaiting, type Summary } from './queue';
import { Updater } from './Updater';
import { WaitingList, type Waiting } from './WaitingList';

/** The patient on screen, once both the summary and the 13 fields are in hand. */
interface Open {
  entry: Summary;
  details: Submission;
}

export function App() {
  const [pairing, setPairing] = useState<PairingInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState<Waiting>('asking');
  const [open, setOpen] = useState<Open | null>(null);
  const [expired, setExpired] = useState(false);

  const refreshPairing = useCallback(async () => {
    try {
      setPairing(await getPairingInfo());
      setError(null);
    } catch (e) {
      setError(String(e));
    }
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
   * The queue can drop an entry under the open view — two hours passing, or the
   * same patient entered from another look. Say so instead of showing fields
   * that no longer belong to anyone.
   */
  useEffect(() => {
    if (!open || waiting === 'asking' || waiting === 'unknown') {
      return;
    }
    if (!waiting.some((entry) => entry.id === open.entry.id)) {
      setOpen(null);
      setExpired(true);
    }
  }, [waiting, open]);

  async function show(id: string) {
    if (waiting === 'asking' || waiting === 'unknown') {
      return;
    }
    const entry = waiting.find((candidate) => candidate.id === id);
    if (!entry) {
      return;
    }
    setExpired(false);
    try {
      const details = await getSubmission(id);
      if (details) {
        setOpen({ entry, details });
      } else {
        setExpired(true);
      }
    } catch (e) {
      console.error('could not read the submission:', e);
      setExpired(true);
    }
  }

  return (
    <main>
      <h1>asmart-autofill</h1>
      {open ? (
        <Detail
          entry={open.entry}
          details={open.details}
          onDone={() => setOpen(null)}
          onGone={() => {
            setOpen(null);
            setExpired(true);
          }}
        />
      ) : (
        <>
          <Connect pairing={pairing} error={error} />
          {expired && (
            <p className="expired" role="status">
              That submission is no longer waiting.
            </p>
          )}
          <WaitingList waiting={waiting} onOpen={(id) => void show(id)} />
        </>
      )}
      <Updater />
    </main>
  );
}
