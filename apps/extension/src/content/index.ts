import type { Fill } from '../shared/messages';
import { askDetails, askFilled, askMapping } from '../shared/messages';
import { watchSave } from './complete';
import { fill, type FillResult } from './fill';

/** Set while one patient is being entered, so a save maps back to an id. */
let stop: (() => void) | undefined;

chrome.runtime.onMessage.addListener((message: Fill, _sender, respond) => {
  if (message.kind !== 'fill') {
    return;
  }
  // Never leave the popup waiting: an unexpected fault is still an answer.
  void enter(message.id)
    .then(respond)
    .catch(() => respond('failed'));
  return true;
});

async function enter(id: string): Promise<FillResult | 'unconfigured' | null> {
  const [mapping, person] = await Promise.all([askMapping(), askDetails(id)]);
  if (mapping === 'unconfigured') {
    return mapping;
  }
  if (mapping === null || person === null) {
    return null;
  }

  const result = fill(document, person, mapping);
  if (result.filled.length > 0) {
    stop?.();
    stop = watchSave(document, mapping, () => {
      stop = undefined;
      // `gone` and null are as final as `done`: the entry is not ours any more.
      void askFilled(id);
    });
  }
  return result;
}
