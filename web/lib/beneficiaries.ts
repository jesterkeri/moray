import { getAddress, isAddress } from 'viem';

/**
 * Beneficiaries — a local, per-owner address book of payees you have saved and
 * named yourself.
 *
 * This is deliberately OFF-CHAIN and advisory. Names are not on-chain data, and
 * the MorayVault contract is immutable and already deployed, so there is no
 * on-chain registry to write to. Nothing here can shorten a hold or bypass a
 * safety control: the clearing window, new-payee delay and instant-allowance
 * cap are all enforced by the contract from on-chain state, whatever this list
 * says. What the list buys you is recognition ("Saved as Mom") and, crucially,
 * it arms the address-poisoning detector (a lookalike of someone you saved gets
 * hard-flagged before you can send).
 *
 * Scoped per owner address + chain so a shared browser never mixes two people's
 * (or two accounts') payees. Values are public addresses + user labels, not
 * secrets, but we still validate + checksum on the way in and render names as
 * text so a pasted label can never do anything but display.
 */

export type Beneficiary = { address: `0x${string}`; name: string; addedAt: number };

const PREFIX = 'moray.beneficiaries.v1';
export const MAX_BENEFICIARIES = 50;
export const MAX_NAME_LEN = 40;

/** Stable empty result so hooks reading an unset key don't tear on re-render. */
const EMPTY: Beneficiary[] = [];

export function beneficiaryKey(chainId: number, owner: string): string {
  return `${PREFIX}.${chainId}.${owner.toLowerCase()}`;
}

/** Trim, collapse internal whitespace, and cap length. */
export function normalizeName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LEN);
}

function readStorage(key: string): Beneficiary[] {
  if (typeof window === 'undefined') return [];
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    return []; // storage disabled (private mode, blocked) — behave as empty
  }
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: Beneficiary[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const addr = (item as { address?: unknown }).address;
      const name = (item as { name?: unknown }).name;
      const addedAt = (item as { addedAt?: unknown }).addedAt;
      if (typeof addr !== 'string' || typeof name !== 'string') continue;
      if (!isAddress(addr)) continue;
      const cleanName = normalizeName(name);
      if (!cleanName) continue;
      out.push({
        address: getAddress(addr),
        name: cleanName,
        addedAt: typeof addedAt === 'number' && Number.isFinite(addedAt) ? addedAt : 0,
      });
    }
    return sortByName(out);
  } catch {
    return [];
  }
}

function writeStorage(key: string, list: Beneficiary[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(list));
  } catch {
    /* quota exceeded or storage disabled: session-only in-memory copy still works */
  }
}

function sortByName(list: Beneficiary[]): Beneficiary[] {
  return [...list].sort((a, b) => a.name.localeCompare(b.name) || a.address.localeCompare(b.address));
}

// --- external store (so SendFlow + the manager stay in sync, incl. cross-tab) --

type Listener = () => void;
const cache = new Map<string, Beneficiary[]>();
const listeners = new Map<string, Set<Listener>>();

function ensure(key: string): Beneficiary[] {
  let cached = cache.get(key);
  if (!cached) {
    cached = readStorage(key);
    cache.set(key, cached);
  }
  return cached;
}

function emit(key: string): void {
  const set = listeners.get(key);
  if (set) set.forEach((l) => l());
}

function commit(key: string, next: Beneficiary[]): void {
  const sorted = sortByName(next);
  cache.set(key, sorted);
  writeStorage(key, sorted);
  emit(key);
}

/** Current snapshot for a key (stable reference until it changes). */
export function getBeneficiaries(key: string | null): Beneficiary[] {
  if (!key) return EMPTY;
  return ensure(key);
}

export function subscribeBeneficiaries(key: string | null, listener: Listener): () => void {
  if (!key) return () => {};
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(listener);
  return () => {
    set!.delete(listener);
    if (set!.size === 0) listeners.delete(key);
  };
}

export type AddResult = { ok: true } | { ok: false; error: string };

export function addBeneficiary(key: string, addressRaw: string, nameRaw: string): AddResult {
  const trimmed = addressRaw.trim();
  if (!isAddress(trimmed)) return { ok: false, error: 'That is not a valid address.' };
  const address = getAddress(trimmed);
  const name = normalizeName(nameRaw);
  if (!name) return { ok: false, error: 'Give this beneficiary a name.' };

  const list = ensure(key);
  const idx = list.findIndex((b) => b.address.toLowerCase() === address.toLowerCase());
  if (idx === -1 && list.length >= MAX_BENEFICIARIES) {
    return { ok: false, error: `You can save up to ${MAX_BENEFICIARIES} beneficiaries.` };
  }

  const next = [...list];
  if (idx >= 0) {
    next[idx] = { ...next[idx], name }; // rename an existing payee, keep addedAt
  } else {
    next.push({ address, name, addedAt: Math.floor(Date.now() / 1000) });
  }
  commit(key, next);
  return { ok: true };
}

export function removeBeneficiary(key: string, address: string): void {
  const list = ensure(key);
  const next = list.filter((b) => b.address.toLowerCase() !== address.toLowerCase());
  if (next.length !== list.length) commit(key, next);
}

/** Find a saved payee by exact address (case-insensitive), or null. */
export function findBeneficiary(key: string | null, address: string): Beneficiary | null {
  if (!key) return null;
  const target = address.toLowerCase();
  return ensure(key).find((b) => b.address.toLowerCase() === target) ?? null;
}

// Keep every mounted view in sync when another tab edits the same key.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (!e.key) {
      cache.clear(); // localStorage.clear() fires a null-key event
      listeners.forEach((_set, key) => emit(key));
      return;
    }
    if (listeners.has(e.key)) {
      cache.set(e.key, readStorage(e.key));
      emit(e.key);
    }
  });
}
