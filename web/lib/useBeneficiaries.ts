'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { useAccount } from 'wagmi';
import { monadTestnet } from './chain';
import {
  addBeneficiary,
  beneficiaryKey,
  getBeneficiaries,
  removeBeneficiary,
  subscribeBeneficiaries,
  type AddResult,
  type Beneficiary,
} from './beneficiaries';
import type { KnownPayee } from './risk';

/**
 * Reads the current account's saved payees and keeps them in sync across every
 * view (and browser tab). Beneficiaries are scoped to the owner + this app's
 * chain, so switching accounts swaps the whole list.
 */
export function useBeneficiaries() {
  const { address } = useAccount();
  const key = address ? beneficiaryKey(monadTestnet.id, address) : null;

  const list = useSyncExternalStore<Beneficiary[]>(
    (onChange) => subscribeBeneficiaries(key, onChange),
    () => getBeneficiaries(key),
    () => getBeneficiaries(null), // server snapshot: always empty
  );

  const add = useCallback(
    (addressRaw: string, name: string): AddResult => {
      if (!key) return { ok: false, error: 'Log in to save a beneficiary.' };
      return addBeneficiary(key, addressRaw, name);
    },
    [key],
  );

  const remove = useCallback(
    (targetAddress: string) => {
      if (!key) return;
      removeBeneficiary(key, targetAddress);
    },
    [key],
  );

  // Shape the list for the risk engine (address + name only).
  const knownPayees: KnownPayee[] = useMemo(
    () => list.map((b) => ({ address: b.address, name: b.name })),
    [list],
  );

  return { list, knownPayees, add, remove };
}
