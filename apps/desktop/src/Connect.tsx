import { QRCodeSVG } from 'qrcode.react';

import { CopyButton } from './CopyButton';
import type { PairingInfo } from './pairing';

export function Connect({ pairing, error }: { pairing: PairingInfo | null; error: string | null }) {
  return (
    <section className="connect">
      {pairing ? (
        <>
          <h2>Scan the QR code to connect a tablet or iPad</h2>
          <QRCodeSVG value={pairing.url} size={200} marginSize={2} />
          <p className="hint">…or copy the link:</p>
          <p className="url">
            <span>{pairing.url}</span>
            <CopyButton value={pairing.url} label="the link" />
          </p>
        </>
      ) : (
        <p className="placeholder">Nothing to scan yet.</p>
      )}
      <p className="status">{status(pairing, error)}</p>
    </section>
  );
}

function status(pairing: PairingInfo | null, error: string | null) {
  if (error) return `Cannot reach the server: ${error}`;
  if (!pairing) return 'Starting — waiting for a network address.';
  return `Server running on port ${pairing.port}.`;
}
