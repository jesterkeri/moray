'use client';

import { useEffect, useRef } from 'react';
import { parseEther } from 'viem';
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { MORAY_ADDRESS, morayAbi } from './moray';
import { monadTestnet } from './chain';

// Keep this much native MON in the signer wallet for gas; sweep the rest into
// the vault so the vault is the real, protected, spendable balance.
export const GAS_RESERVE = parseEther('0.1');
// Don't bother sweeping dust (and avoid churn on tiny balance jitters).
const MIN_SWEEP = parseEther('0.02');

/**
 * Auto-deposit: when the signer wallet holds more than the gas reserve, move the
 * excess into the vault automatically. Removes the manual "deposit first" step.
 * Paused for a short window after a withdrawal so funds the user just pulled out
 * aren't immediately swept back in.
 */
export function useAutoDeposit({
  walletBalance,
  enabled,
  paused,
  onSwept,
}: {
  walletBalance: bigint | undefined;
  enabled: boolean;
  paused: boolean;
  onSwept: (amount: bigint) => void;
}) {
  const { writeContract, data: hash, isPending } = useWriteContract();
  const {
    isSuccess,
    isError: receiptError,
    isLoading: mining,
  } = useWaitForTransactionReceipt({ hash, query: { enabled: Boolean(hash) } });

  // The exact wallet balance we last fired a sweep at, so a failed/pending sweep
  // never loops at the same balance (only a real balance change re-triggers).
  const triedAt = useRef<bigint | null>(null);
  const sweptAmount = useRef<bigint>(0n);
  // In-flight from signing through receipt: never queue a second sweep while the
  // first is still confirming/mining (isPending alone misses the mining window).
  const inFlight = useRef(false);

  useEffect(() => {
    if (!enabled || paused || isPending || mining || inFlight.current) return;
    if (!MORAY_ADDRESS || walletBalance === undefined) return;
    if (walletBalance <= GAS_RESERVE + MIN_SWEEP) return;
    if (triedAt.current === walletBalance) return;

    const amount = walletBalance - GAS_RESERVE;
    triedAt.current = walletBalance;
    sweptAmount.current = amount;
    inFlight.current = true;
    writeContract(
      {
        address: MORAY_ADDRESS,
        abi: morayAbi,
        functionName: 'deposit',
        value: amount,
        chainId: monadTestnet.id,
      },
      // a failed sweep is silent (the manual "Move to safe" still works); clear
      // the in-flight lock so a later balance change can try again.
      { onError: () => { inFlight.current = false; } },
    );
  }, [walletBalance, enabled, paused, isPending, mining]);

  useEffect(() => {
    if (isSuccess) {
      inFlight.current = false;
      onSwept(sweptAmount.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess]);

  // A mined-but-reverted sweep (or a receipt-wait error) must release the lock so
  // a later real balance change can try again — triedAt still blocks a same-
  // balance retry of the failed tx.
  useEffect(() => {
    if (receiptError) inFlight.current = false;
  }, [receiptError]);
}
