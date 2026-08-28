import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { useEffect, useRef, useState } from 'react';

const FLASH = 1500;

/**
 * The plugin rather than `navigator.clipboard`, which needs a secure context.
 * WebView2 serves the window from `http://tauri.localhost`, which is the case
 * that works on the machine it was written on and fails silently elsewhere.
 */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  async function copy() {
    try {
      await writeText(value);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), FLASH);
    } catch (e) {
      // A copy that silently does nothing has staff pasting the previous field
      // into the wrong box without noticing.
      console.error('copy failed:', e);
    }
  }

  return (
    <button type="button" className="copy" onClick={() => void copy()} aria-label={`Copy ${label}`}>
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}
