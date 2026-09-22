import type { Metadata, Viewport } from 'next';
import { Archivo } from 'next/font/google';
import './globals.css';

/**
 * Archivo — famille de signalétique à axes variables.
 * L'axe de chasse (wdth) est celui qui porte l'identité : interface
 * resserrée, chiffres de position très larges. Police auto-hébergée par
 * next/font : aucune requête vers un tiers, aucun décalage au chargement.
 */
const archivo = Archivo({
  subsets: ['latin'],
  axes: ['wdth'],
  display: 'swap',
  variable: '--font-archivo',
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
  title: {
    default: 'VotreTour — la file d\'attente qui vous laisse partir',
    template: '%s · VotreTour',
  },
  description:
    "Vos clients approchent leur téléphone d'une plaque, rejoignent la file et sortent. Ils voient combien de personnes sont devant eux et reçoivent une notification quand c'est leur tour.",
  applicationName: 'VotreTour',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'VotreTour' },
  manifest: '/manifest.webmanifest',
  openGraph: {
    type: 'website',
    locale: 'fr_FR',
    siteName: 'VotreTour',
    title: "VotreTour — la file d'attente qui vous laisse partir",
    description:
      'File d\'attente virtuelle pour les commerces sans rendez-vous. Plaque NFC, QR code, App Clip iPhone.',
  },
  robots: { index: true, follow: true },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#FAF9F6' },
    { media: '(prefers-color-scheme: dark)', color: '#0B0E13' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={archivo.variable} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
