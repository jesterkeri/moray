'use client';

import { useEffect, useRef, useState } from 'react';
import { isAddress, type Address } from 'viem';
import { usePublicClient, useAccount } from 'wagmi';
import { assessRecipient, type RiskVerdict, type KnownPayee } from './risk';
import { MORAY_ADDRESS } from './moray';

export function useRecipientRisk(to: string, knownPayees: KnownPayee[] = []) {
  const publicClient = usePublicClient();
  const { address: from } = useAccount();
  const [verdict, setVerdict] = useState<RiskVerdict | null>(null);
  const [loading, setLoading] = useState(false);
  const reqId = useRef(0);

  // Stable signature of the saved-payee set: re-assess when it actually changes
  // (a save, a removal, or a rename) but not on every render's fresh array
  // identity. Name is included so a rename refreshes the verdict label too.
  const payeesKey = knownPayees
    .map((p) => `${p.address.toLowerCase()}::${p.name}`)
    .sort()
    .join('|');

  useEffect(() => {
    const moray = MORAY_ADDRESS;
    if (!isAddress(to) || !from || !publicClient || !moray) {
      setVerdict(null);
      setLoading(false);
      return;
    }
    const id = ++reqId.current;
    setVerdict(null); // drop the previous address's verdict immediately (no stale "trusted")
    setLoading(true);
    const handle = setTimeout(() => {
      assessRecipient({
        publicClient,
        from,
        to: to as Address,
        morayAddress: moray,
        knownPayees,
      })
        .then((v) => {
          if (id === reqId.current) {
            setVerdict(v);
            setLoading(false);
          }
        })
        .catch(() => {
          if (id === reqId.current) setLoading(false);
        });
    }, 350); // debounce while typing
    return () => clearTimeout(handle);
    // knownPayees array identity intentionally omitted; payeesKey captures real
    // changes to the saved set so the poisoning/recognition checks stay current.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [to, from, publicClient, payeesKey]);

  return { verdict, loading };
}
