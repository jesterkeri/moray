'use client';

import { useEffect, useState } from 'react';
import { parseEther } from 'viem';
import { useAccount, useBalance, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { MORAY_ADDRESS, morayAbi, formatMon, parseMon } from '@/lib/moray';
import { monadTestnet } from '@/lib/chain';

// Leave a little native MON for gas when using "Max".
const GAS_BUFFER = parseEther('0.01');

export function DepositFlow({ onDone }: { onDone: (info: { amount: string }) => void }) {
  const { address } = useAccount();
  const [amountStr, setAmountStr] = useState('');
  const [submittedAmount, setSubmittedAmount] = useState('');

  const { data: wallet } = useBalance({ address, query: { enabled: Boolean(address) } });

  const { writeContract, data: hash, isPending, error: writeError } = useWriteContract();
  const { isLoading: mining, isSuccess } = useWaitForTransactionReceipt({ hash });

  const amtWei = parseMon(amountStr);
  const walletValue = wallet?.value;
  const overBalance = amtWei !== null && walletValue !== undefined && amtWei > walletValue;
  const validAmt = amtWei !== null && amtWei > 0n && !overBalance;
  const busy = isPending || mining;
  const canSubmit =
    Boolean(address) && Boolean(MORAY_ADDRESS) && validAmt && walletValue !== undefined && !busy;

  const maxDeposit =
    walletValue !== undefined && walletValue > GAS_BUFFER ? walletValue - GAS_BUFFER : 0n;

  useEffect(() => {
    if (isSuccess) onDone({ amount: submittedAmount });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess]);

  function submit() {
    if (!canSubmit || amtWei === null || !MORAY_ADDRESS) return;
    setSubmittedAmount(amountStr); // snapshot for the toast; input can't change while busy
    writeContract({
      address: MORAY_ADDRESS,
      abi: morayAbi,
      functionName: 'deposit',
      value: amtWei,
      chainId: monadTestnet.id,
    });
  }

  return (
    <div>
      <p className="muted" style={{ fontSize: 13.5, margin: '-2px 0 16px' }}>
        Move MON from your wallet into your vault, where the protections apply.
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
          <span>{wallet ? `${formatMon(wallet.value)} MON in your wallet` : ' '}</span>
          {maxDeposit > 0n && (
            <button className="link-btn" onClick={() => setAmountStr(formatMon(maxDeposit, 18))}>
              Max
            </button>
          )}
        </div>
        {overBalance && <Err>That is more than your wallet balance.</Err>}
      </div>

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
            <span className="spinner-sm" /> Depositing…
          </>
        ) : (
          'Deposit'
        )}
      </button>
    </div>
  );
}

function Err({ children }: { children: React.ReactNode }) {
  return <div style={{ color: 'var(--danger)', fontSize: 12.5, marginTop: 7, marginLeft: 2 }}>{children}</div>;
}
