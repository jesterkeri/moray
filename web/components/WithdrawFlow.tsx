'use client';

import { useEffect, useMemo, useState } from 'react';
import { parseEventLogs } from 'viem';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { MORAY_ADDRESS, morayAbi, formatMon, parseMon } from '@/lib/moray';
import { monadTestnet } from '@/lib/chain';
import { formatDuration } from '@/lib/format';
import { ClockIcon, ArrowUpIcon } from './icons';

export function WithdrawFlow({
  onDone,
}: {
  onDone: (info: { instant: boolean; seconds: number }) => void;
}) {
  const { address } = useAccount();
  const [amountStr, setAmountStr] = useState('');
  const enabled = Boolean(address) && Boolean(MORAY_ADDRESS);

  const { data: vaultBalance } = useReadContract({
    address: MORAY_ADDRESS,
    abi: morayAbi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled },
  });
  const { data: remaining } = useReadContract({
    address: MORAY_ADDRESS,
    abi: morayAbi,
    functionName: 'remainingInstantAllowance',
    args: address ? [address] : undefined,
    query: { enabled },
  });
  const { data: withdrawDelay } = useReadContract({
    address: MORAY_ADDRESS,
    abi: morayAbi,
    functionName: 'withdrawDelay',
    query: { enabled },
  });

  const { writeContract, data: hash, isPending, error: writeError } = useWriteContract();
  const { data: receipt, isLoading: mining, isSuccess } = useWaitForTransactionReceipt({ hash });

  const amtWei = parseMon(amountStr);
  const overBalance = amtWei !== null && vaultBalance !== undefined && amtWei > (vaultBalance as bigint);
  const validAmt = amtWei !== null && amtWei > 0n && !overBalance;

  const preview = useMemo(() => {
    if (!validAmt || amtWei === null) return null;
    if (remaining === undefined || withdrawDelay === undefined) return null;
    const instant = amtWei <= (remaining as bigint);
    return { instant, seconds: instant ? 0 : Number(withdrawDelay) };
  }, [validAmt, amtWei, remaining, withdrawDelay]);

  const busy = isPending || mining;
  const canSubmit = enabled && validAmt && vaultBalance !== undefined && !busy && preview !== null;

  useEffect(() => {
    if (!isSuccess || !receipt) return;
    // Truth from the emitted event: Withdrawn = instant, WithdrawRequested = delayed.
    let instant = preview?.instant ?? false;
    let seconds = preview?.seconds ?? 0;
    try {
      const logs = parseEventLogs({ abi: morayAbi, logs: receipt.logs });
      const withdrawn = logs.find((l) => l.eventName === 'Withdrawn');
      const requested = logs.find((l) => l.eventName === 'WithdrawRequested');
      if (withdrawn) {
        instant = true;
        seconds = 0;
      } else if (requested) {
        instant = false;
        const unlock = Number((requested.args as { unlockTime: bigint }).unlockTime);
        seconds = Math.max(0, unlock - Math.floor(Date.now() / 1000));
      }
    } catch {
      /* fall back to the preview */
    }
    onDone({ instant, seconds });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess, receipt]);

  function submit() {
    if (!canSubmit || amtWei === null || !MORAY_ADDRESS) return;
    writeContract({
      address: MORAY_ADDRESS,
      abi: morayAbi,
      functionName: 'withdraw',
      args: [amtWei],
      chainId: monadTestnet.id,
    });
  }

  return (
    <div>
      <p className="muted" style={{ fontSize: 13.5, margin: '-2px 0 16px' }}>
        Move MON from your vault back to your wallet.
      </p>

      <div className="form-group">
        <label className="form-label">Amount</label>
        <div className="amount-wrap">
          <input
            className="amount-input"
            placeholder="0.0"
            inputMode="decimal"
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
            disabled={busy}
          />
          <span className="amount-suffix">MON</span>
        </div>
        <div className="field-hint">
          <span>
            {vaultBalance !== undefined ? `${formatMon(vaultBalance as bigint)} MON in vault` : ' '}
          </span>
          {vaultBalance !== undefined && (vaultBalance as bigint) > 0n && (
            <button className="link-btn" onClick={() => setAmountStr(formatMon(vaultBalance as bigint, 18))}>
              Max
            </button>
          )}
        </div>
        {overBalance && <Err>That is more than your vault balance.</Err>}
      </div>

      {preview && (
        <div className="form-group">
          <div className="window-card">
            <span className="window-icon">
              {preview.instant ? <ArrowUpIcon size={17} /> : <ClockIcon size={17} />}
            </span>
            <div>
              <div className="window-main">
                {preview.instant ? 'Withdraws instantly' : `Withdraws in ${formatDuration(preview.seconds)}`}
              </div>
              <div className="window-sub">
                {preview.instant
                  ? 'Within your instant allowance this window.'
                  : 'Above your instant allowance, so it clears through a recallable, freezable window. Recall it any time before it lands.'}
              </div>
            </div>
          </div>
        </div>
      )}

      {writeError && <Err>{writeError.message.split('\n')[0].slice(0, 140)}</Err>}

      <button
        className="btn btn-primary btn-block"
        style={{ height: 48, marginTop: 4 }}
        disabled={!canSubmit}
        onClick={submit}
      >
        {isPending ? (
          <>
            <span className="spinner-sm" /> Confirm in your wallet…
          </>
        ) : mining ? (
          <>
            <span className="spinner-sm" /> Withdrawing…
          </>
        ) : (
          'Withdraw'
        )}
      </button>
    </div>
  );
}

function Err({ children }: { children: React.ReactNode }) {
  return <div style={{ color: 'var(--danger)', fontSize: 12.5, marginTop: 7, marginLeft: 2 }}>{children}</div>;
}
