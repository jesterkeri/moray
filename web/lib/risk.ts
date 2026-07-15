import type { Address, PublicClient } from 'viem';
import { morayAbi } from './moray';

export type RiskLevel = 'trusted' | 'neutral' | 'caution' | 'risk';

export type RiskVerdict = {
  level: RiskLevel;
  title: string;
  reason: string;
  cleared: boolean;
};

export type KnownPayee = { address: string; name: string };

/**
 * Off-chain recipient-risk read. Uses only cheap RPC calls and (optionally) the
 * user's saved payees. Produces a plain-English verdict that justifies the
 * clearing window. Fail-closed: any uncertainty is treated as "new / caution",
 * never "safe".
 */
export async function assessRecipient(opts: {
  publicClient: PublicClient;
  from: Address;
  to: Address;
  morayAddress: Address;
  knownPayees?: KnownPayee[];
}): Promise<RiskVerdict> {
  const { publicClient, from, to, morayAddress, knownPayees = [] } = opts;

  // Address-poisoning lookalike: mimics the start+end of a saved payee but differs.
  const poison = findLookalike(to, knownPayees);
  if (poison) {
    return {
      level: 'risk',
      title: 'Looks like address poisoning',
      reason: `This mimics the start and end of ${poison.name}'s address but the middle is different. Verify every character before sending.`,
      cleared: false,
    };
  }

  try {
    const [cleared, txCount, code] = await Promise.all([
      publicClient.readContract({
        address: morayAddress,
        abi: morayAbi,
        functionName: 'cleared',
        args: [from, to],
      }) as Promise<boolean>,
      publicClient.getTransactionCount({ address: to }),
      publicClient.getCode({ address: to }),
    ]);

    if (cleared) {
      return {
        level: 'trusted',
        title: 'Trusted payee',
        reason: "You've cleared a payment to this address before, so it can clear right away.",
        cleared: true,
      };
    }

    const isContract = Boolean(code && code !== '0x');
    if (isContract) {
      return {
        level: 'neutral',
        title: 'Smart contract',
        reason: 'This is a contract, not a personal wallet. Make sure it is the one you intend. It clears through the new-payee window.',
        cleared: false,
      };
    }

    if (txCount === 0) {
      return {
        level: 'caution',
        title: 'Brand-new address',
        reason: 'No transaction history. If this is a scam or a typo, the clearing window lets you recall before it lands.',
        cleared: false,
      };
    }

    return {
      level: 'neutral',
      title: 'New payee',
      reason: 'You have not sent here before, so it clears through the new-payee window. You can recall it any time before it does.',
      cleared: false,
    };
  } catch {
    return {
      level: 'caution',
      title: "Couldn't verify this address",
      reason: 'Treating it as new. The clearing window still protects you.',
      cleared: false,
    };
  }
}

function findLookalike(to: string, known: KnownPayee[]): KnownPayee | null {
  const t = to.toLowerCase();
  for (const p of known) {
    const a = p.address.toLowerCase();
    if (a === t) continue; // exact match is the payee themselves, handled by `cleared`
    if (a.length === t.length && a.slice(0, 6) === t.slice(0, 6) && a.slice(-4) === t.slice(-4)) {
      return p;
    }
  }
  return null;
}
