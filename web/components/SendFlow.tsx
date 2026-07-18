'use client';

import { useEffect, useMemo, useState } from 'react';
import { isAddress, parseEther, parseEventLogs } from 'viem';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { MORAY_ADDRESS, morayAbi, formatMon } from '@/lib/moray';
import { monadTestnet } from '@/lib/chain';
import { formatDuration } from '@/lib/format';
import { useRecipientRisk } from '@/lib/useRecipientRisk';
import { useBeneficiaries } from '@/lib/useBeneficiaries';
import { MAX_NAME_LEN } from '@/lib/beneficiaries';
import type { RiskLevel } from '@/lib/risk';
import { ShieldIcon, AlertTriangleIcon, InfoIcon, ClockIcon, BookmarkIcon } from './icons';

function safeParseEther(v: string): bigint | null {
  if (!v || !/^\d*\.?\d*$/.test(v)) return null;
  try {
    return parseEther(v as `${number}`);
  } catch {
    return null;
  }
}

export function SendFlow({
  onSent,
}: {
  onSent: (info: { to: string; amount: string; seconds: number; known: boolean }) => void;
}) {
  const { address: from } = useAccount();
  const [to, setTo] = useState('');
  const [amountStr, setAmountStr] = useState('');

  const { list: beneficiaries, knownPayees, add: addBeneficiary } = useBeneficiaries();
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);

  const enabled = Boolean(from) && Boolean(MORAY_ADDRESS);

  const { data: vaultBalance } = useReadContract({
    address: MORAY_ADDRESS,
    abi: morayAbi,
    functionName: 'balanceOf',
    args: from ? [from] : undefined,
    query: { enabled },
  });
  const { data: minDelay } = useReadContract({
    address: MORAY_ADDRESS,
    abi: morayAbi,
    functionName: 'minNewPayeeDelay',
    query: { enabled },
  });
  const { data: withdrawDelay } = useReadContract({
    address: MORAY_ADDRESS,
    abi: morayAbi,
    functionName: 'withdrawDelay',
    query: { enabled },
  });
  const { data: remaining } = useReadContract({
    address: MORAY_ADDRESS,
    abi: morayAbi,
    functionName: 'remainingInstantAllowance',
    args: from ? [from] : undefined,
    query: { enabled },
  });

  const { verdict, loading: riskLoading } = useRecipientRisk(to, knownPayees);

  const { writeContract, data: hash, isPending, error: writeError, reset: resetWrite } = useWriteContract();
  const { data: receipt, isLoading: mining, isSuccess } = useWaitForTransactionReceipt({ hash });

  const amtWei = safeParseEther(amountStr);
  const isSelf = Boolean(from && isAddress(to) && to.toLowerCase() === from.toLowerCase());
  const validTo = isAddress(to) && !isSelf;

  // Instant recognition straight from the saved list (doesn't wait for the risk read).
  const savedName = useMemo(() => {
    if (!isAddress(to)) return null;
    const t = to.toLowerCase();
    return beneficiaries.find((b) => b.address.toLowerCase() === t)?.name ?? null;
  }, [to, beneficiaries]);
  const overBalance = amtWei !== null && vaultBalance !== undefined && amtWei > (vaultBalance as bigint);
  const validAmt = amtWei !== null && amtWei > 0n && !overBalance;

  const clearing = useMemo(() => {
    if (!validTo || !validAmt || amtWei === null) return null;
    if (minDelay === undefined || withdrawDelay === undefined || remaining === undefined) return null;
    const clearedFlag = verdict?.cleared ?? false;
    const newPayee = !clearedFlag;
    const overAllowance = amtWei > (remaining as bigint);
    let seconds = 0;
    if (newPayee) seconds = Math.max(seconds, Number(minDelay));
    if (overAllowance) seconds = Math.max(seconds, Number(withdrawDelay));
    let reason: string;
    if (seconds === 0) reason = 'Clears instantly — a trusted payee, within your instant allowance.';
    else if (newPayee && overAllowance)
      reason = 'Held because this is a new payee and the amount is above your instant allowance.';
    else if (newPayee) reason = 'Held because this is a new payee. Recall it any time before it clears.';
    else reason = 'Held because the amount is above your instant allowance.';
    return { seconds, reason };
  }, [validTo, validAmt, amtWei, minDelay, withdrawDelay, remaining, verdict]);

  // Editing the recipient closes an open "save as beneficiary" form.
  useEffect(() => {
    setSaveOpen(false);
    setSaveName('');
    setSaveError(null);
  }, [to]);

  // On account switch, wipe the whole draft (and any in-flight write) so a send
  // can never fire from the newly-active vault to the previous account's stale
  // recipient/amount.
  useEffect(() => {
    setTo('');
    setAmountStr('');
    setSaveOpen(false);
    setSaveName('');
    setSaveError(null);
    resetWrite();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from]);

  useEffect(() => {
    if (!isSuccess || !receipt) return;
    // Report the ACTUAL on-chain window from the emitted event, not the preview.
    let seconds = 0;
    let known = false;
    try {
      const logs = parseEventLogs({ abi: morayAbi, logs: receipt.logs, eventName: 'TransferCreated' });
      const created = logs[0];
      if (created) {
        const unlock = Number((created.args as { unlockTime: bigint }).unlockTime);
        seconds = Math.max(0, unlock - Math.floor(Date.now() / 1000));
        known = true;
      }
    } catch {
      known = false; // fall back to a conservative "check Clearing" toast, never the stale preview
    }
    onSent({ to, amount: amountStr, seconds, known });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess, receipt]);

  const busy = isPending || mining;
  // Only allow send once the recipient has been assessed, the window preview is
  // resolved, and the balance is known, so the user never sends blind or oversized.
  const canSend =
    enabled &&
    validTo &&
    validAmt &&
    vaultBalance !== undefined &&
    !busy &&
    clearing !== null &&
    !riskLoading &&
    verdict !== null;

  function saveCurrent() {
    setSaveError(null);
    const res = addBeneficiary(to, saveName);
    if (!res.ok) {
      setSaveError(res.error);
      return;
    }
    setSaveOpen(false);
    setSaveName('');
  }

  function submit() {
    if (!canSend || amtWei === null || !MORAY_ADDRESS) return;
    writeContract({
      address: MORAY_ADDRESS,
      abi: morayAbi,
      functionName: 'send',
      args: [to as `0x${string}`, amtWei, 0n],
      chainId: monadTestnet.id,
    });
  }

  const noVaultFunds = vaultBalance !== undefined && (vaultBalance as bigint) === 0n;

  return (
    <div>
      {/* Recipient */}
      <div className="form-group">
        <label className="form-label">Recipient</label>
        <input
          className="field field-mono"
          placeholder="0x…"
          value={to}
          onChange={(e) => setTo(e.target.value.trim())}
          spellCheck={false}
          autoComplete="off"
          disabled={busy}
        />
        {beneficiaries.length > 0 && (
          <div className="payee-pick">
            {beneficiaries.map((b) => {
              const active = to.length > 0 && b.address.toLowerCase() === to.toLowerCase();
              return (
                <button
                  key={b.address}
                  type="button"
                  className={`payee-chip${active ? ' active' : ''}`}
                  onClick={() => setTo(b.address)}
                  disabled={busy}
                  title={b.address}
                >
                  <BookmarkIcon size={12} />
                  {b.name}
                </button>
              );
            })}
          </div>
        )}
        {isSelf && <FieldError>Use Withdraw to move funds to your own wallet.</FieldError>}
      </div>

      {validTo && (
        <div className="form-group">
          {riskLoading && !verdict ? (
            <div className="verdict" data-level="neutral">
              <span className="verdict-icon">
                <span className="spinner-sm" />
              </span>
              <div>
                <div className="verdict-title">Checking this address…</div>
                <div className="verdict-reason">Reading its on-chain history.</div>
              </div>
            </div>
          ) : (
            verdict && <VerdictCard level={verdict.level} title={verdict.title} reason={verdict.reason} />
          )}

          {savedName ? (
            <div className="saved-note">
              <BookmarkIcon size={13} />
              Saved as <strong>{savedName}</strong>
            </div>
          ) : (
            !isSelf &&
            (saveOpen ? (
              <div className="save-payee">
                <input
                  className="field"
                  placeholder="Name it, e.g. Mom, Landlord, Coinbase"
                  value={saveName}
                  maxLength={MAX_NAME_LEN}
                  onChange={(e) => setSaveName(e.target.value)}
                  disabled={busy}
                  autoFocus
                />
                {saveError && <FieldError>{saveError}</FieldError>}
                <div className="row gap-2" style={{ marginTop: 8 }}>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={saveCurrent}
                    disabled={busy || !saveName.trim()}
                  >
                    Save beneficiary
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      setSaveOpen(false);
                      setSaveError(null);
                    }}
                    disabled={busy}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="save-payee-toggle"
                onClick={() => setSaveOpen(true)}
                disabled={busy}
              >
                <BookmarkIcon size={13} />
                Save this address as a beneficiary
              </button>
            ))
          )}
        </div>
      )}

      {/* Amount */}
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
            <button
              className="link-btn"
              onClick={() => setAmountStr(formatMon(vaultBalance as bigint, 18))}
            >
              Max
            </button>
          )}
        </div>
        {overBalance && <FieldError>That is more than your vault balance.</FieldError>}
        {noVaultFunds && <FieldError>Deposit into your safe first, then you can send.</FieldError>}
      </div>

      {/* Window preview */}
      {clearing && (
        <div className="form-group">
          <div className="window-card">
            <span className="window-icon">
              <ClockIcon size={17} />
            </span>
            <div>
              <div className="window-main">
                {clearing.seconds === 0
                  ? 'Clears instantly'
                  : `Clears in ${formatDuration(clearing.seconds)}`}
              </div>
              <div className="window-sub">{clearing.reason}</div>
            </div>
          </div>
        </div>
      )}

      {writeError && (
        <FieldError>{writeError.message.split('\n')[0].slice(0, 140)}</FieldError>
      )}

      <button className="btn btn-primary btn-block" style={{ height: 48, marginTop: 4 }} disabled={!canSend} onClick={submit}>
        {isPending ? (
          <>
            <span className="spinner-sm" /> Confirm in your wallet…
          </>
        ) : mining ? (
          <>
            <span className="spinner-sm" /> Sending…
          </>
        ) : (
          'Send'
        )}
      </button>
    </div>
  );
}

function VerdictCard({ level, title, reason }: { level: RiskLevel; title: string; reason: string }) {
  const icon =
    level === 'trusted' ? (
      <ShieldIcon size={18} />
    ) : level === 'risk' ? (
      <AlertTriangleIcon size={18} />
    ) : level === 'caution' ? (
      <AlertTriangleIcon size={18} />
    ) : (
      <InfoIcon size={18} />
    );
  return (
    <div className="verdict" data-level={level}>
      <span className="verdict-icon">{icon}</span>
      <div>
        <div className="verdict-title">{title}</div>
        <div className="verdict-reason">{reason}</div>
      </div>
    </div>
  );
}

function FieldError({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ color: 'var(--danger)', fontSize: 12.5, marginTop: 7, marginLeft: 2 }}>{children}</div>
  );
}
