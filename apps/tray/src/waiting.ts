import { invoke } from '@tauri-apps/api/core';

export async function getWaitingCount(): Promise<number> {
  return invoke<number>('get_waiting_count');
}
