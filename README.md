# Moray

**The self-custodial safe.** Bank-grade protection, you hold the keys.

Moray is a focused, self-custodial smart-contract wallet for the crypto you cannot
afford to lose. No seed phrase, no dapp browser, no swaps. It does one job better
than anything else: it protects the funds inside it.

Built on [Monad](https://monad.xyz) for the BuildAnything "Spark" hackathon.

---

## The problem (a real one)

Self-custody is terrifying, and I feel it every time I move real money on-chain.
A normal wallet like MetaMask gives you full control and zero safety. One slip is
final:

1. **A wrong or scam send.** Paste a poisoned address, fat-finger an amount, or
   get tricked by a fake site, and the money is gone the instant you confirm.
   There is no "cancel."
2. **A stolen key.** Phishing or a stolen phone hands an attacker your key, and a
   normal wallet lets them drain everything in a single transaction.
3. **Lost access.** Lose your key or your life, and the funds are frozen forever.
   No one can recover them.

A bank protects you from all three, but a bank holds your money and can freeze it.
I wanted the bank's safety without the bank.

## What Moray is

A smart-contract wallet whose only purpose is safety. You keep custody (an
app-managed, non-custodial key), and the contract enforces protections a dumb key
never could. Think of it as the safe you keep beside your everyday wallet, for the
balance you would be devastated to lose.

It is deliberately **not** a "MetaMask killer." It is complementary: your daily
wallet for spending, Moray for the funds that need a vault.

## How it protects you

Moray closes all three ways you lose crypto, and every protection is enforced
on-chain, not by a server anyone has to trust.

**1. A wrong or scam send is recallable.**
Payments clear through a window you control. Before you send, Moray reads the
recipient on-chain and gives a plain-English verdict (trusted payee, brand-new
address, smart contract, or a suspected address-poisoning lookalike) and sizes the
clearing window to match. A never-cleared payee is force-held on-chain so a scam or
a typo can be recalled with one tap before it lands.

**2. A stolen key cannot drain you.**
Cash-out is bank-style rate-limited. Small everyday amounts are instant up to a
per-day allowance you set; anything larger becomes a delayed, recallable, freezable
exit. Sends obey the same rule, so a thief cannot route around it. Raising the
allowance is itself time-locked. A recovery contact you name can freeze the account
out-of-band, or trigger a kill switch that sweeps everything to a safe address you
committed earlier. No action that redirects funds is ever instant.

**3. Your funds outlive lost access.**
Name an heir. If you go silent for a period you choose, the heir can inherit, but
only after a veto window that you cancel automatically just by using your vault.

## Why it needs a smart contract (and Monad)

A private key can only sign. It cannot hold a payment for a window, enforce a daily
limit, freeze itself, or pass funds to an heir. A contract can. Moray puts the
funds and the rules inside the contract, so the protections hold even against
someone who has your key.

Monad makes this practical: an EVM chain fast and cheap enough that a clearing
window, a recall, and a live risk read feel instant, with block times that keep the
countdowns honest.

## Security

Moray is built security-first, and its guarantees are stated honestly.

- **Non-custodial.** Login (email or passkey) creates a Privy embedded wallet
  secured by a TEE and Shamir's Secret Sharing. No single party, including us or
  Privy, ever holds your full key. The app has no server that can move your money.
- **The load-bearing invariant.** Every powerful, fund-redirecting change is
  delayed and cancellable by the current owner. Protective actions that only stop
  money leaving (panic freeze) are instant. Delegated parties (recovery contact,
  heir) can never redirect funds to an address of their choosing, only freeze you,
  sweep to your own pre-committed safe address, or inherit after a vetoable delay.
- **No instant full drain.** Even the kill switch pays only your own safe address,
  and only after that address has matured. So a stolen key can move at most your
  small daily allowance instantly, never the whole vault at once.
- **Honest limit (stated, not hidden).** If an attacker controls your key while
  your vault is empty (before you fund it), they can pre-set a malicious safe
  address and drain you after you deposit. This is the "compromised at setup" case:
  set up Moray and fund it from a trusted device. Once funded, changing the safe
  address is time-locked and vetoable.
- **Reviewed hard.** The contract went through five adversarial review rounds
  (findings converged 7, then 2, then 1, then 0), and ships with 74 tests that
  prove each control denies the bad case (reentrancy, delegate theft, the send
  bypass, the pre-position drain, and more).

## Tech

- **Contract:** Foundry + Solidity (`src/MorayVault.sol`), native MON.
- **Frontend:** Next.js (app router), wagmi + viem, Privy embedded wallet.
- **Chain:** Monad testnet (chain id 10143).

## Deployment

- **Contract (Monad testnet):** [`0x12CA0E45F5B227CFe5aCcad2550CA3e91e76caCd`](https://testnet.monadexplorer.com/address/0x12CA0E45F5B227CFe5aCcad2550CA3e91e76caCd)
- **Deploy tx:** [`0xa87ed5a4...dca2f`](https://testnet.monadexplorer.com/tx/0xa87ed5a41bd1418738ef447a51dd53ec250c24e5673f0af3b10c9c5dfe8dca2f) (block 45465915)
- **Live app:** https://moray-three.vercel.app

There is no owner and no admin. The deployer holds no privileges over the vault
once it is live: every control is keyed per user, and the constructor only sets
the delay immutables below.

**Deployed delays.** These are deliberately short so every mechanic is visible
in a live demo. Production values would be much longer.

| Delay | Deployed | Production would be |
| --- | --- | --- |
| New-payee hold | 60s | ~1h |
| Large-exit (anti-drain) window | 90s | ~1h |
| Config change / safe maturity / unfreeze | 120s | ~24-48h |
| Inheritance veto | 120s | ~7d |
| Unclaimed-transfer reclaim grace | 600s | ~1-7d |

## Run it locally

**Contracts**

```sh
forge test          # 74 tests
forge build
```

**Frontend**

```sh
cd web
npm install
cp .env.example .env.local   # set NEXT_PUBLIC_PRIVY_APP_ID + NEXT_PUBLIC_MORAY_ADDRESS
npm run dev                  # http://localhost:3000
```

Create a Privy app at [dashboard.privy.io](https://dashboard.privy.io) (enable
Email + Passkey login and Embedded Wallets) for the app id, and set the deployed
vault address after deploying to Monad testnet.

## Status

- Contract: complete, reviewed, 74 tests green.
- Frontend: vault dashboard with live on-chain balances, plus Send (with the
  recipient-risk verdict and recall), Deposit, and Withdraw (the instant/delayed
  split). Safety controls and the full statement are next.

## License

MIT. See [LICENSE](LICENSE).
