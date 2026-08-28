import { check, type Update } from '@tauri-apps/plugin-updater';
import { useEffect, useState } from 'react';

type State =
  | { kind: 'none' }
  | { kind: 'available'; update: Update }
  | { kind: 'downloading'; percent: number }
  | { kind: 'failed' };

/**
 * A strip, not a dialog, and nothing installs itself: an app that restarts on
 * its own mid-registration loses the patient standing at the desk. A clinic
 * that is simply offline says nothing at all rather than being nagged.
 */
export function Updater() {
  const [state, setState] = useState<State>({ kind: 'none' });

  useEffect(() => {
    void check().then(
      (update) => update && setState({ kind: 'available', update }),
      (e: unknown) => console.error('update check failed:', e),
    );
  }, []);

  async function install(update: Update) {
    setState({ kind: 'downloading', percent: 0 });
    let total = 0;
    let seen = 0;
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          total = event.data.contentLength ?? 0;
        } else if (event.event === 'Progress') {
          seen += event.data.chunkLength;
          setState({ kind: 'downloading', percent: total ? Math.round((seen / total) * 100) : 0 });
        }
      });
      // Unreachable on Windows: downloadAndInstall hands over to the NSIS
      // installer and exits, and the installer starts the app again itself.
    } catch (e) {
      console.error('update failed:', e);
      setState({ kind: 'failed' });
    }
  }

  if (state.kind === 'none') {
    return null;
  }

  return (
    <aside className="updater" role="status">
      {state.kind === 'available' && (
        <>
          <span>Version {state.update.version} is available.</span>
          <button type="button" onClick={() => void install(state.update)}>
            Update and restart
          </button>
        </>
      )}
      {state.kind === 'downloading' && <span>Downloading… {state.percent}%</span>}
      {state.kind === 'failed' && <span>The update could not be installed.</span>}
    </aside>
  );
}
