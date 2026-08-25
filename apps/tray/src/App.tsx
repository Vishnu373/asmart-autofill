import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { QRCodeSVG } from 'qrcode.react';
import { useCallback, useEffect, useState } from 'react';

import { getWaitingCount } from './waiting';

interface PairingInfo {
  url: string;
  token: string;
  port: number;
}

/** `asking` is the moment before the first answer, which is neither a count
 * nor a failure and must not be reported as either. */
type Waiting = number | 'unknown' | 'asking';

export function App() {
  const [pairing, setPairing] = useState<PairingInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState<Waiting>('asking');

  const refresh = useCallback(async () => {
    try {
      setPairing(await invoke<PairingInfo | null>('get_pairing_info'));
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const unlisten = listen('address-changed', () => void refresh());
    return () => void unlisten.then((off) => off());
  }, [refresh]);

  useEffect(() => {
    const count = () =>
      void getWaitingCount().then(setWaiting, (e: unknown) => {
        // Swallowing this is what made a denied command look like an empty
        // waiting room for a whole afternoon.
        console.error('waiting count refused:', e);
        setWaiting('unknown');
      });
    count();
    const unlisten = listen('queue-changed', count);
    return () => void unlisten.then((off) => off());
  }, []);

  return (
    <main>
      <h1>asmart-autofill</h1>
      {pairing ? (
        <>
          <QRCodeSVG value={pairing.url} size={240} marginSize={2} />
          <p className="url">{pairing.url}</p>
        </>
      ) : (
        <p className="placeholder">Nothing to scan yet.</p>
      )}
      <p className="status">{status(pairing, error)}</p>
      {waiting !== 'asking' && <p className="waiting">{waitingText(waiting)}</p>}
    </main>
  );
}

/** `unknown` is "could not find out", which must not read as "nobody is here". */
function waitingText(waiting: number | 'unknown') {
  if (waiting === 'unknown') return 'Cannot tell how many are waiting.';
  return waiting === 1 ? '1 patient waiting' : `${waiting} patients waiting`;
}

function status(pairing: PairingInfo | null, error: string | null) {
  if (error) return `Cannot reach the server: ${error}`;
  if (!pairing) return 'Starting — waiting for a network address.';
  return `Server running on port ${pairing.port}.`;
}
