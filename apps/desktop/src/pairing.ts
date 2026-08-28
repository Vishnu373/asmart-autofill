import { invoke } from '@tauri-apps/api/core';

export interface PairingInfo {
  url: string;
  token: string;
  port: number;
}

export async function getPairingInfo(): Promise<PairingInfo | null> {
  return invoke<PairingInfo | null>('get_pairing_info');
}
