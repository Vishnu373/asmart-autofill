import type { Ask } from '../shared/messages';
import { details, mapping, markFilled } from './api';
import { poll } from './poll';

const INTERVAL = 1000;
/** Chrome stops an idle service worker, so an alarm wakes it and the interval starts again. */
const KEEPALIVE = 'poll';

let timer: ReturnType<typeof setInterval> | undefined;

function start(): void {
  if (timer !== undefined) {
    return;
  }
  timer = setInterval(() => void poll(), INTERVAL);
  void poll();
}

chrome.runtime.onStartup.addListener(start);
chrome.runtime.onInstalled.addListener(start);
chrome.alarms.onAlarm.addListener(start);
chrome.alarms.create(KEEPALIVE, { periodInMinutes: 1 });

start();

chrome.runtime.onMessage.addListener((ask: Ask, _sender, respond) => {
  void answer(ask).then(respond);
  return true;
});

function answer(ask: Ask) {
  switch (ask.kind) {
    case 'details':
      return details(ask.id);
    case 'mapping':
      return mapping();
    case 'filled':
      return markFilled(ask.id);
  }
}
