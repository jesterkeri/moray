import { formatEther, parseEther, getAddress } from 'viem';
import { morayAbi } from './morayAbi';

export { morayAbi };

/** Deployed MorayVault address, validated + checksummed. Empty until deployed. */
export const MORAY_ADDRESS: `0x${string}` | undefined = (() => {
  const raw = (process.env.NEXT_PUBLIC_MORAY_ADDRESS || '').trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(raw)) return undefined;
  try {
    return getAddress(raw);
  } catch {
    return undefined;
  }
})();

export function isConfigured(): boolean {
  return MORAY_ADDRESS !== undefined;
}

/** Format a wei amount as MON with tabular, trailing-zero-trimmed decimals. */
export function formatMon(wei: bigint | undefined, maxFrac = 4): string {
  if (wei === undefined) return '—';
  const full = formatEther(wei);
  const [intPart, fracPart = ''] = full.split('.');
  if (maxFrac === 0 || fracPart.length === 0) return intPart;
  const trimmed = fracPart.slice(0, maxFrac).replace(/0+$/, '');
  return trimmed.length ? `${intPart}.${trimmed}` : intPart;
}

export function toWei(mon: string): bigint {
  return parseEther(mon as `${number}`);
}

/** Short 0x1234…abcd form for display. */
export function shortAddress(addr?: string): string {
  if (!addr) return '';
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
