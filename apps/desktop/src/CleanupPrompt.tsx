import { useState } from 'react';

import type { Summary } from './queue';

interface Props {
  stale: Summary[];
  failed: boolean;
  onDelete: () => void;
  onCancel: () => void;
}

/**
 * Shown once a day, when records from before today are still held. Cancel
 * leaves everything alone and the prompt returns the next morning.
 */
export function CleanupPrompt({ stale, failed, onDelete, onCancel }: Props) {
  const [confirming, setConfirming] = useState(false);
  const unentered = stale.filter((record) => !record.entered_at).length;

  return (
    <div className="prompt-backdrop">
      <div className="prompt" role="dialog" aria-modal="true" aria-labelledby="prompt-title">
        <h2 id="prompt-title">Time to delete records from yesterday</h2>
        <p>
          {stale.length === 1
            ? '1 record from before today is still on this computer.'
            : `${stale.length} records from before today are still on this computer.`}
        </p>

        {/* The one way this prompt can lose a patient: deleting someone nobody
            copied into the EMR. Say so before the click, not after. */}
        {unentered > 0 && (
          <p className="warn">
            {unentered === 1
              ? '1 of them was never marked as entered.'
              : `${unentered} of them were never marked as entered.`}
          </p>
        )}

        {confirming && <p className="warn">Deleting removes them from this computer for good.</p>}

        {/* Closing on a failed delete is the worst outcome here: staff walk away
            believing yesterday is gone, and nothing asks again until tomorrow. */}
        {failed && (
          <p className="warn" role="alert">
            That did not work. The records are still on this computer — try again, or read the log.
          </p>
        )}

        <div className="prompt-actions">
          <button type="button" className="cancel" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="danger"
            onClick={() => (unentered > 0 && !confirming ? setConfirming(true) : onDelete())}
          >
            {confirming ? 'Delete anyway' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}
