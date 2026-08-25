import type { Mapping } from '../shared/types';

/** Calls `saved` when staff save the demographic form. Returns a disposer. */
export function watchSave(root: Document, mapping: Mapping, saved: () => void): () => void {
  const button = locate(root, mapping.save_button);
  const form = button instanceof HTMLFormElement ? button : button?.closest('form');
  if (!form) {
    return () => {};
  }

  /**
   * Listening on the document rather than the form means the page's own submit
   * handlers have already run, so a submit their validation cancelled arrives
   * here with `defaultPrevented` set and is not a save.
   */
  const onSubmit = (event: Event) => {
    if (event.target !== form || event.defaultPrevented) {
      return;
    }
    stop();
    saved();
  };

  const stop = () => root.removeEventListener('submit', onSubmit);
  root.addEventListener('submit', onSubmit);
  return stop;
}

/** A save button selector that is invalid CSS finds nothing, the same as one that is wrong. */
function locate(root: Document, selector: string): Element | null {
  try {
    return root.querySelector(selector);
  } catch {
    return null;
  }
}
