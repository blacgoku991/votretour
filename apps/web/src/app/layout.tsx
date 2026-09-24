import type { Metadata, Viewport } from 'next';
import { Archivo } from 'next/font/google';
import { appClipPublished, seoIndexable } from '@/lib/seo/site';
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
    default: 'Rangvia — la file d\'attente qui vous laisse partir',
    template: '%s · Rangvia',
  },
  description:
    "Vos clients approchent leur téléphone d'une plaque, rejoignent la file et sortent. Ils voient combien de personnes sont devant eux et reçoivent une notification quand c'est leur tour.",
  applicationName: 'Rangvia',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Rangvia' },
  manifest: '/manifest.webmanifest',
  openGraph: {
    type: 'website',
    locale: 'fr_FR',
    siteName: 'Rangvia',
    title: "Rangvia — la file d'attente qui vous laisse partir",
    // L'App Clip n'est cité qu'une fois réellement publié sur l'App Store.
    description: appClipPublished()
      ? 'File d\'attente virtuelle pour les commerces sans rendez-vous. Plaque NFC, QR code, App Clip iPhone.'
      : 'File d\'attente virtuelle pour les commerces sans rendez-vous. Plaque NFC et QR code, sans application à installer.',
  },
  // Indexable seulement en production (SEO_INDEXABLE=1, en https), en
  // cohérence avec robots.txt : un banc ou une préproduction ne doit
  // jamais se retrouver dans Google.
  robots: seoIndexable() ? { index: true, follow: true } : { index: false, follow: false },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0B0E13',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={archivo.variable} data-theme="dark" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
