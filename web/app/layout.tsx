import type { Metadata } from 'next';
import { Archivo, Hanken_Grotesk, IBM_Plex_Mono } from 'next/font/google';
import Providers from './providers';
import './globals.css';

// Display: industrial grotesk for the plaque headline + balance figures.
const archivo = Archivo({
  subsets: ['latin'],
  variable: '--font-archivo',
  weight: ['500', '600', '700', '800', '900'],
});
// Body: warm, legible grotesk.
const hanken = Hanken_Grotesk({
  subsets: ['latin'],
  variable: '--font-hanken',
});
// Numerals / data / the time-lock dial: engraved engineering mono.
const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  variable: '--font-plex-mono',
  weight: ['400', '500', '600'],
});

export const metadata: Metadata = {
  title: 'Moray — the self-custodial safe',
  description:
    "Bank-grade protection, you hold the keys. A self-custodial safe for the crypto you can't afford to lose. A thief with your key still has to wait.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      data-theme="dark"
      className={`${archivo.variable} ${hanken.variable} ${plexMono.variable}`}
    >
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
