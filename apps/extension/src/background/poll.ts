import { pending } from './api';
import type { Waiting } from '../shared/types';

const RUNNING = '#1a7f37';
const STOPPED = '#b3261e';

export async function poll(): Promise<void> {
  await badge(await pending());
}

async function badge(waiting: Waiting[] | 'refused' | null): Promise<void> {
  if (waiting === null || waiting === 'refused') {
    await chrome.action.setBadgeBackgroundColor({ color: STOPPED });
    await chrome.action.setBadgeText({ text: '!' });
    await chrome.action.setTitle({
      title:
        waiting === null
          ? 'The front desk application is not running'
          : 'The front desk application is running but will not accept this extension',
    });
    return;
  }

  const count = waiting.length;
  await chrome.action.setBadgeBackgroundColor({ color: RUNNING });
  await chrome.action.setBadgeText({ text: count === 0 ? '' : String(count) });
  await chrome.action.setTitle({
    title: count === 1 ? '1 patient waiting' : `${count} patients waiting`,
  });
}
