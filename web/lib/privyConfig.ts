import type { PrivyClientConfig } from '@privy-io/react-auth';
import { monadTestnet } from './chain';

// Moray manages the wallet for you: email/passkey login creates a non-custodial
// embedded wallet. No external-wallet (MetaMask) connect flow.
export const privyConfig: PrivyClientConfig = {
  defaultChain: monadTestnet,
  supportedChains: [monadTestnet],
  loginMethods: ['email', 'passkey'],
  embeddedWallets: {
    createOnLogin: 'users-without-wallets',
    showWalletUIs: false,
  },
  appearance: {
    theme: 'dark',
    accentColor: '#19C9B1',
    walletChainType: 'ethereum-only',
    showWalletLoginFirst: false,
  },
};
