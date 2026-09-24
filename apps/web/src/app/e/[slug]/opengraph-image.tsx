import { ImageResponse } from 'next/og';
import { getProfile } from '@/lib/profiles';
import { QUEUE_PROFILES, type QueueProfile } from '@/lib/profiles/types';
import { OG_CONTENT_TYPE, OG_SIZE, loadOgFonts, ogHost, ogTitleSize } from '@/lib/seo/og';
import { siteUrl } from '@/lib/seo/site';
import { resolveEntryPoint } from '@/server/queue';

/**
 * Image de partage d'un établissement (/e/<slug>) : ce qu'affiche une
 * messagerie quand un commerçant envoie le lien de sa file, ou qu'un
 * client le transfère à un ami.
 *
 * Ce qu'elle montre : le NOM DE L'ÉTABLISSEMENT (donnée publique, déjà
 * dans le titre de la page), « Rejoindre la file », et la plaque du
 * comptoir, avec son seuil. Ce qu'elle ne montre JAMAIS : aucun prénom,
 * aucune adresse, aucun logo tiers, et AUCUN NOMBRE. L'image du site
 * dessine un volet « 2 devant vous » : c'est un schéma sur une page de
 * présentation, mais accolé au nom d'un vrai commerce, il se lirait comme
 * l'état de SA file, faux une minute plus tard (une image se met en
 * cache). D'où une composition propre, sans volet : la plaque qu'on
 * approche, pas la file qu'on compte.
 *
 * Plaque inconnue, suspendue ou non attribuée : l'image générique, sans
 * dire si le lien existe.
 *
 * Mise en cache une heure par lien : un renommage apparaît à la
 * régénération suivante. Pas de rendu au build (aucun lien n'est connu à
 * l'avance).
 */

export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = 'Rejoindre la file sur Rangvia, depuis son téléphone';
export const revalidate = 3600;

/** Au-delà, le nom est coupé proprement : il doit tenir en trois lignes. */
const MAX_NAME = 56;

const LEAD = 'Prenez votre place depuis votre téléphone, sans application, et suivez la file en direct.';

// Jetons de globals.css, résolus pour le thème sombre (Satori ne lit ni
// les variables CSS ni color-mix()), comme dans lib/seo/og.tsx.
const C = {
  ink1000: '#05070A',
  ink900: '#0B0E13',
  ink700: '#181D25',
  floor: '#07090D',
  bone100: '#FAF9F6',
  bone300: '#E4E1DA',
  muted: '#9AA3AF',
  faint: '#69737F',
  signal500: '#FF4B1F',
  line: 'rgba(250, 249, 246, 0.08)',
  floorLine: 'rgba(250, 249, 246, 0.06)',
  spill: 'rgba(255, 75, 31, 0.26)',
} as const;

const PANEL_W = 500;

function shortName(name: string): string {
  const clean = name.replace(/\s+/g, ' ').trim();
  if (clean.length <= MAX_NAME) return clean;
  const cut = clean.slice(0, MAX_NAME - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > 24 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

function counterOf(profile: unknown): string {
  // `resolve_entry_point` porte le profil de la file depuis la migration
  // 0035 ; l'ancien type TypeScript ne le déclare pas, d'où la lecture
  // prudente. Un profil inconnu retombe sur le comptoir.
  if (typeof profile === 'string' && (QUEUE_PROFILES as readonly string[]).includes(profile)) {
    return getProfile(profile as QueueProfile).vocab.counter;
  }
  return 'Comptoir';
}

function Wordmark() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <svg width="40" height="40" viewBox="0 0 26 26" fill="none">
        <rect x="1" y="3" width="2" height="20" rx="1" fill={C.bone100} opacity="0.32" />
        <rect x="7" y="4" width="18" height="4" rx="2" fill={C.bone100} opacity="0.28" />
        <rect x="7" y="11" width="13" height="4" rx="2" fill={C.bone100} opacity="0.46" />
        <rect x="7" y="18" width="9" height="4" rx="2" fill={C.signal500} />
        <rect x="3" y="5.2" width="4" height="1.6" rx="0.8" fill={C.bone100} opacity="0.32" />
        <rect x="3" y="12.2" width="4" height="1.6" rx="0.8" fill={C.bone100} opacity="0.32" />
        <rect x="3" y="19.2" width="4" height="1.6" rx="0.8" fill={C.signal500} />
      </svg>
      <div style={{ display: 'flex', alignItems: 'baseline', fontSize: 30, letterSpacing: -0.6, lineHeight: 1 }}>
        <span style={{ fontFamily: 'Archivo SemiExpanded', fontWeight: 800, color: C.bone100 }}>Rang</span>
        <span style={{ fontFamily: 'Archivo SemiCondensed', fontWeight: 700, color: C.bone100, opacity: 0.68 }}>
          via
        </span>
      </div>
    </div>
  );
}

/**
 * La plaque du comptoir, posée au sol devant le seuil : l'objet que le
 * client approche de son téléphone. Même dessin que la `Plaque` du site
 * (os, ondes NFC, légende), en 2D pour Satori.
 */
function PlaqueScene({ seuil }: { seuil: string }) {
  const lines = [0, 1, 2, 3, 4, 5, 6, 7];
  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        width: PANEL_W,
        height: OG_SIZE.height,
        background: C.floor,
        borderLeft: `1px solid ${C.line}`,
        overflow: 'hidden',
      }}
    >
      {lines.map((i) => (
        <div
          key={i}
          style={{ position: 'absolute', left: 0, top: 170 + i * 60, width: PANEL_W, height: 1, background: C.floorLine }}
        />
      ))}
      {/* Flaque de lumière, seule lumière permise, derrière le seuil */}
      <div
        style={{
          position: 'absolute',
          left: 20,
          top: 40,
          width: 460,
          height: 220,
          backgroundImage: `radial-gradient(ellipse 50% 50% at 50% 50%, ${C.spill} 0%, rgba(255, 75, 31, 0) 100%)`,
        }}
      />
      {/* Le seuil : deux poteaux et un linteau vermillon */}
      <div
        style={{
          position: 'absolute',
          left: 70,
          top: 58,
          width: 360,
          height: 96,
          borderTop: `3px solid ${C.signal500}`,
          borderLeft: `3px solid ${C.signal500}`,
          borderRight: `3px solid ${C.signal500}`,
          borderRadius: '8px 8px 0 0',
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            display: 'flex',
            marginTop: 11,
            fontFamily: 'Archivo Expanded',
            fontWeight: 800,
            fontSize: 13,
            letterSpacing: 3.2,
            lineHeight: 1,
            textTransform: 'uppercase',
            color: C.signal500,
          }}
        >
          {seuil}
        </div>
      </div>
      {/* La plaque */}
      <div
        style={{
          position: 'absolute',
          left: 150,
          top: 196,
          width: 200,
          height: 270,
          borderRadius: 18,
          background: C.bone100,
          boxShadow: `inset 0 1px 0 rgba(255, 255, 255, 0.9), 0 8px 0 ${C.bone300}, 0 30px 60px rgba(0, 0, 0, 0.55)`,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '64px 18px 22px',
        }}
      >
        <svg width="72" height="72" viewBox="0 0 24 24" fill="none">
          <circle cx="6" cy="12" r="1.6" fill={C.ink900} />
          <path d="M9.5 8.5a5 5 0 0 1 0 7" stroke={C.ink900} strokeWidth="1.8" strokeLinecap="round" />
          <path d="M12.5 6a8.5 8.5 0 0 1 0 12" stroke={C.ink900} strokeWidth="1.8" strokeLinecap="round" />
          <path d="M15.5 3.5a12 12 0 0 1 0 17" stroke={C.ink900} strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            fontFamily: 'Archivo SemiCondensed',
            fontWeight: 700,
            fontSize: 11,
            lineHeight: 1.4,
            letterSpacing: 2,
            textTransform: 'uppercase',
            color: C.ink700,
          }}
        >
          <span>Approchez votre</span>
          <span>téléphone</span>
        </div>
      </div>
      {/* Le rail : la file commence à la plaque */}
      <div
        style={{
          position: 'absolute',
          left: 248,
          top: 482,
          width: 3,
          height: 150,
          borderRadius: 3,
          background: 'rgba(250, 249, 246, 0.26)',
        }}
      />
    </div>
  );
}

function EntryCard({ kicker, title, seuil, host }: { kicker: string; title: string; seuil: string; host: string | null }) {
  const titleSize = ogTitleSize(title);
  return (
    <div
      style={{
        width: OG_SIZE.width,
        height: OG_SIZE.height,
        display: 'flex',
        background: C.ink900,
        color: C.bone100,
        fontFamily: 'Archivo',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          width: OG_SIZE.width - PANEL_W,
          padding: '56px 48px 60px 72px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Wordmark />
          {host ? (
            <div
              style={{
                display: 'flex',
                fontFamily: 'Archivo SemiCondensed',
                fontWeight: 700,
                fontSize: 15,
                letterSpacing: 2.4,
                textTransform: 'uppercase',
                color: C.faint,
              }}
            >
              {host}
            </div>
          ) : null}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              display: 'flex',
              fontFamily: 'Archivo SemiCondensed',
              fontWeight: 700,
              fontSize: 17,
              lineHeight: 1,
              letterSpacing: 3,
              textTransform: 'uppercase',
              color: C.signal500,
            }}
          >
            {kicker}
          </div>
          <div
            style={{
              display: 'flex',
              marginTop: 26,
              fontFamily: 'Archivo Expanded',
              fontWeight: 800,
              fontSize: titleSize,
              lineHeight: 0.94,
              letterSpacing: -titleSize * 0.04,
              color: C.bone100,
            }}
          >
            {title}
          </div>
          <div
            style={{
              display: 'flex',
              marginTop: 28,
              maxWidth: 540,
              fontWeight: 500,
              fontSize: 24,
              lineHeight: 1.45,
              color: C.muted,
            }}
          >
            {LEAD}
          </div>
        </div>
      </div>
      <PlaqueScene seuil={seuil} />
    </div>
  );
}

export default async function EntryPointOgImage({ params }: { params: Promise<{ slug: string }> | { slug: string } }) {
  const { slug } = await Promise.resolve(params);
  const host = ogHost(siteUrl());
  const [fonts, entryPoint] = await Promise.all([loadOgFonts(), resolveEntryPoint(slug).catch(() => null)]);

  const known = entryPoint !== null && entryPoint.status === 'ok';
  const queueProfile = known ? (entryPoint.queue as { profile?: unknown } | null)?.profile : undefined;
  const card = known ? (
    <EntryCard kicker="Rejoindre la file" title={shortName(entryPoint.location.name)} seuil={counterOf(queueProfile)} host={host} />
  ) : (
    <EntryCard kicker="File d’attente virtuelle" title="Rejoindre la file." seuil="Comptoir" host={host} />
  );
  return new ImageResponse(card, { ...OG_SIZE, fonts });
}
