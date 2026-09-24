import type { NextConfig } from 'next';

/**
 * En-têtes de sécurité appliqués à tout le site. La CSP autorise
 * strictement : nos propres ressources, Supabase (REST + WebSocket temps
 * réel), Stripe et Google Fonts. Rien d'autre.
 */
const supabaseOrigin = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co').origin;
  } catch {
    return 'https://placeholder.supabase.co';
  }
})();
const supabaseSocket = supabaseOrigin.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:');
const isDev = process.env.NODE_ENV !== 'production';

const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  // Next.js injecte du JS inline hydraté ; 'unsafe-inline' reste
  // nécessaire tant que l'on ne génère pas de nonce par requête.
  // 'unsafe-eval' n'est ajouté QU'EN DÉVELOPPEMENT, pour React Refresh :
  // la production ne l'autorise jamais.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''} https://js.stripe.com`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https:",
  `connect-src 'self' ${supabaseOrigin} ${supabaseSocket} https://api.stripe.com`,
  "frame-src https://js.stripe.com https://hooks.stripe.com",
  "worker-src 'self'",
  "manifest-src 'self'",
  'upgrade-insecure-requests',
].join('; ');

const nextConfig: NextConfig = {
  /* Image Docker autonome : Next.js recopie dans .next/standalone le
     serveur et les seules dépendances utilisées. L'image finale n'a
     pas besoin de node_modules complet, ce qui la fait passer de
     ~1,2 Go à ~180 Mo. Sans conséquence hors Docker. */
  output: 'standalone',

  reactStrictMode: true,
  // Pas de badge « N » de développement : il masquait les captures de revue.
  devIndicators: false,
  poweredByHeader: false,
  /* Chargés par Node à l'exécution, jamais empaquetés : node-forge
     (signature CMS des passes Apple Wallet) et sharp (images des passes,
     binaires natifs linuxmusl de l'image Docker). */
  serverExternalPackages: ['web-push', 'node-forge', 'sharp'],
  /* Polices des images de partage (lib/seo/og.tsx) : lues par readFile,
     donc invisibles pour le traçage automatique de la sortie standalone.
     Les images sont générées au build, mais une revalidation ou une route
     d'image dynamique les relirait en production : on les embarque.
     La clé est un motif picomatch : un « [metier] » littéral y serait lu
     comme une classe de caractères, d'où le joker qui couvre la racine
     et chaque segment (/pour/[metier]/opengraph-image…). */
  outputFileTracingIncludes: {
    '/**/opengraph-image*': ['./assets/fonts/**'],
  },
  experimental: {
    // Les actions serveur portent des mutations de file : on plafonne la
    // taille du corps pour limiter la surface d'abus.
    serverActions: { bodySizeLimit: '1mb' },
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          {
            key: 'Permissions-Policy',
            // nfc=(self) est indispensable : sans lui, le navigateur
            // refuse NDEFReader.write() et la programmation des plaques
            // échouerait avec une NotAllowedError incompréhensible.
            value: 'camera=(), microphone=(), geolocation=(self), nfc=(self), interest-cohort=()',
          },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
        ],
      },
      {
        // Apple exige un JSON servi sans redirection ni extension.
        source: '/.well-known/apple-app-site-association',
        headers: [{ key: 'Content-Type', value: 'application/json' }],
      },
      {
        /* Vidéos de démonstration : noms de fichiers hachés au montage,
           donc un fichier ne change jamais de contenu. Un an, immuable :
           le navigateur ne revalide même pas. */
        source: '/videos/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      {
        source: '/sw.js',
        headers: [
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
          { key: 'Service-Worker-Allowed', value: '/' },
          { key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' },
        ],
      },
      /* Lien de suivi /s/<jeton> et son rattachement : le jeton est dans
         l'URL. Pas de Referer vers un autre site, pas de cache, pas
         d'indexation. Déclarés après la règle générale : pour une même
         clé, Next retient la dernière règle qui correspond. */
      ...['/s/:path*', '/api/client/claim'].map((source) => ({
        source,
        headers: [
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Cache-Control', value: 'no-store' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        ],
      })),
      /* Passes Wallet (.pkpass, redirection vers Google, service web Apple) :
         jamais de Referer. Le cache reste fixé par chaque route (les images
         des lattes sont immuables, un pass ne l'est pas). */
      ...['/api/client/wallet/:path*', '/api/wallet/:path*'].map((source) => ({
        source,
        headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }],
      })),
    ];
  },
};

export default nextConfig;
