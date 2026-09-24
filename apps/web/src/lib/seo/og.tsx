import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';

/**
 * Image Open Graph « Le Rang en relief », partagée par l'image du site
 * (app/opengraph-image.tsx) et, plus tard, par celles des pages métier.
 *
 * Satori (le moteur d'ImageResponse) ne lit ni les polices variables, ni
 * la 3D, ni color-mix() : on lui donne des INSTANCES STATIQUES d'Archivo
 * (assets/fonts, licence OFL), la file en 2D vue de dessus et des couleurs
 * résolues à la main depuis les jetons de globals.css (thème sombre).
 *
 * Même grammaire que le produit : le rail, les lattes et leur tranche, les
 * numéros au sol, le seuil vermillon « Comptoir » avec sa flaque de
 * lumière, le volet, et un seul vermillon, pour « Vous ». Aucune capture
 * d'écran, aucun prénom, aucun chiffre inventé : la scène est un schéma.
 */

export const OG_SIZE = { width: 1200, height: 630 } as const;
export const OG_CONTENT_TYPE = 'image/png';

// Jetons de globals.css, résolus pour le thème sombre.
const C = {
  ink1000: '#05070A',
  ink900: '#0B0E13',
  ink800: '#11151B',
  ink700: '#181D25',
  ink600: '#222833',
  floor: '#07090D',
  bone100: '#FAF9F6',
  muted: '#9AA3AF',
  faint: '#69737F',
  signal500: '#FF4B1F',
  signal600: '#E23A10',
  line: 'rgba(250, 249, 246, 0.08)',
  floorLine: 'rgba(250, 249, 246, 0.06)',
  floorNumber: 'rgba(250, 249, 246, 0.24)',
  rail: 'rgba(250, 249, 246, 0.26)',
  edgeLight: 'inset 0 1px 0 rgba(250, 249, 246, 0.08)',
  // --spill : vermillon (22 % à l'écran, 26 % ici pour survivre à la
  // vignette réduite des réseaux), seule lumière permise, posée au sol.
  spill: 'rgba(255, 75, 31, 0.26)',
  // Latte « en cours » : texte 12 % sur latte (color-mix résolu).
  serving: '#39404B',
} as const;

// ---------------------------------------------------------------------
// Polices
// ---------------------------------------------------------------------

type OgFont = {
  name: string;
  data: ArrayBuffer;
  weight: 500 | 700 | 800;
  style: 'normal';
};

const FONT_FILES = [
  // Titres, chiffres du volet, libellé du seuil (t-hero, t-board).
  { file: 'Archivo-Expanded-ExtraBold.ttf', name: 'Archivo Expanded', weight: 800 },
  // « Rang » du mot-symbole (wdth 112).
  { file: 'Archivo-SemiExpanded-ExtraBold.ttf', name: 'Archivo SemiExpanded', weight: 800 },
  // Étiquettes de signalétique (t-label : wdth 88, wght 700) et « via ».
  { file: 'Archivo-SemiCondensed-Bold.ttf', name: 'Archivo SemiCondensed', weight: 700 },
  // Chapô.
  { file: 'Archivo-Medium.ttf', name: 'Archivo', weight: 500 },
] as const;

/**
 * Chemin des polices. `process.cwd()` vaut apps/web en développement, au
 * build, et en production « standalone » (server.js fait chdir dans son
 * dossier) ; next.config.ts les inclut dans la trace des routes d'image.
 */
const FONT_DIR = join(process.cwd(), 'assets', 'fonts');

let fontsPromise: Promise<OgFont[]> | null = null;

/** Lit les polices une seule fois par processus. */
export function loadOgFonts(): Promise<OgFont[]> {
  fontsPromise ??= Promise.all(
    FONT_FILES.map(async ({ file, name, weight }) => {
      const buffer = await readFile(join(FONT_DIR, file));
      const data = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
      return { name, data, weight, style: 'normal' as const };
    }),
  ).catch((error: unknown) => {
    // Un échec ne doit pas rester en cache : on retentera à la prochaine requête.
    fontsPromise = null;
    throw error;
  });
  return fontsPromise;
}

// ---------------------------------------------------------------------
// Scène
// ---------------------------------------------------------------------

export interface OgCardProps {
  /** Étiquette au-dessus du titre (« File d’attente virtuelle »). */
  kicker: string;
  /** Titre, en Archivo étendu extra-gras. */
  title: string;
  /** Chapô facultatif, trois lignes au plus. */
  lead?: string;
  /** Libellé du seuil (« Comptoir », « Atelier », « Salle »…). */
  seuil?: string;
  /** Domaine affiché en bas (« rangvia.fr ») ; rien si absent. */
  host?: string | null;
}

const PANEL_W = 500;
const RAIL_X = 196;
const SLAT_X = 228;
const SLAT_W = 236;
const SLAT_H = 44;
const PITCH = 60;
const COUNTER_Y = 152; // ligne du comptoir : bas du seuil
const FIRST_Y = COUNTER_Y + 22; // première latte en attente
const SELF_POS = 3; // « Vous » : troisième au sol, deux personnes devant
const LAST_POS = 8;
const VOLET_W = 116;
const VOLET_H = 138;

/** Taille du titre selon sa longueur : il doit tenir en trois lignes. */
export function ogTitleSize(title: string): number {
  const n = title.length;
  if (n <= 40) return 74;
  if (n <= 60) return 64;
  return 54;
}

/** Brouillard des lattes grises, comme .slot3d__face (jamais sur « Vous »). */
const fog = (pos: number): number => Math.max(0.25, Math.min(1, 1 - (pos - 1) * 0.12));

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
        {/* « via » plus étroit : le mot lui-même avance d'un cran. */}
        <span style={{ fontFamily: 'Archivo SemiCondensed', fontWeight: 700, color: C.bone100, opacity: 0.68 }}>
          via
        </span>
      </div>
    </div>
  );
}

function Slat({ pos }: { pos: number }) {
  const top = FIRST_Y + (pos - 1) * PITCH;
  const self = pos === SELF_POS;
  const opacity = self ? 1 : fog(pos);
  return (
    <div style={{ position: 'absolute', left: 0, top, width: PANEL_W, height: SLAT_H, display: 'flex' }}>
      {/* Numéro au sol */}
      <div
        style={{
          position: 'absolute',
          left: RAIL_X - 44,
          top: 12,
          width: 30,
          display: 'flex',
          justifyContent: 'flex-end',
          fontFamily: 'Archivo Expanded',
          fontWeight: 800,
          fontSize: 18,
          lineHeight: 1,
          color: self ? C.signal500 : C.floorNumber,
        }}
      >
        {String(pos)}
      </div>
      {/* Encoche : relie la latte au rail */}
      <div
        style={{
          position: 'absolute',
          left: RAIL_X + 3,
          top: SLAT_H / 2 - (self ? 2 : 1),
          width: SLAT_X - RAIL_X - 3,
          height: self ? 4 : 2,
          background: self ? C.signal500 : C.rail,
        }}
      />
      {/* Face et tranche */}
      <div
        style={{
          position: 'absolute',
          left: SLAT_X,
          top: 0,
          width: SLAT_W,
          height: SLAT_H,
          borderRadius: 10,
          background: self ? C.signal500 : C.ink600,
          boxShadow: self ? `0 5px 0 ${C.signal600}` : `${C.edgeLight}, 0 5px 0 ${C.ink700}`,
          opacity,
          display: 'flex',
          alignItems: 'center',
          padding: '0 16px',
          gap: 12,
        }}
      >
        {self ? (
          <div
            style={{
              display: 'flex',
              fontFamily: 'Archivo Expanded',
              fontWeight: 800,
              fontSize: 19,
              letterSpacing: -0.2,
              color: C.ink1000,
            }}
          >
            Vous
          </div>
        ) : (
          <div style={{ width: 18, height: 2, borderRadius: 2, background: C.muted, opacity: 0.35 }} />
        )}
      </div>
    </div>
  );
}

function Floor({ seuil }: { seuil: string }) {
  const positions = Array.from({ length: LAST_POS }, (_, i) => i + 1);
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
      {/* Lignes du sol, une par place */}
      {positions.map((pos) => (
        <div
          key={`l${pos}`}
          style={{
            position: 'absolute',
            left: 0,
            top: FIRST_Y + (pos - 1) * PITCH - 8,
            width: PANEL_W,
            height: 1,
            background: C.floorLine,
          }}
        />
      ))}
      {/* Flaque de lumière posée au sol, derrière le seuil */}
      <div
        style={{
          position: 'absolute',
          left: SLAT_X - 150,
          top: COUNTER_Y - 90,
          width: SLAT_W + 300,
          height: 200,
          backgroundImage: `radial-gradient(ellipse 50% 50% at 50% 50%, ${C.spill} 0%, rgba(255, 75, 31, 0) 100%)`,
        }}
      />
      {/* Le rail : la file elle-même */}
      <div
        style={{
          position: 'absolute',
          left: RAIL_X,
          top: 96,
          width: 3,
          height: OG_SIZE.height - 96,
          borderRadius: 3,
          background: C.rail,
        }}
      />
      {/* Le seuil : deux poteaux et un linteau de 3 px */}
      <div
        style={{
          position: 'absolute',
          left: RAIL_X - 14,
          top: 58,
          width: SLAT_X + SLAT_W - RAIL_X + 30,
          height: COUNTER_Y - 58,
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
      {/* Latte au comptoir : en cours de service */}
      <div
        style={{
          position: 'absolute',
          left: RAIL_X + 3,
          top: COUNTER_Y - SLAT_H - 14 + SLAT_H / 2 - 1,
          width: SLAT_X - RAIL_X - 3,
          height: 2,
          background: C.signal500,
          opacity: 0.9,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: SLAT_X,
          top: COUNTER_Y - SLAT_H - 14,
          width: SLAT_W,
          height: SLAT_H,
          borderRadius: 10,
          background: C.serving,
          boxShadow: `${C.edgeLight}, 0 5px 0 ${C.ink700}`,
          display: 'flex',
          alignItems: 'center',
          padding: '0 16px',
          gap: 12,
        }}
      >
        <div style={{ width: 18, height: 2, borderRadius: 2, background: C.signal500, opacity: 0.9 }} />
        <div
          style={{
            display: 'flex',
            fontFamily: 'Archivo SemiCondensed',
            fontWeight: 700,
            fontSize: 13,
            letterSpacing: 2.2,
            textTransform: 'uppercase',
            color: C.bone100,
          }}
        >
          En cours
        </div>
      </div>
      {positions.map((pos) => (
        <Slat key={`s${pos}`} pos={pos} />
      ))}
      {/* Le volet : combien de personnes devant vous (les places 1 et 2) */}
      <div
        style={{
          position: 'absolute',
          left: 28,
          top: FIRST_Y + (SELF_POS - 1) * PITCH - VOLET_H,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
        }}
      >
        <div
          style={{
            position: 'relative',
            display: 'flex',
            width: VOLET_W,
            height: VOLET_H,
            borderRadius: 12,
            background: C.ink800,
            boxShadow: `${C.edgeLight}, 0 5px 0 ${C.ink1000}`,
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
          }}
        >
          {/* Moitié haute de la lamelle, un ton plus claire */}
          <div
            style={{ position: 'absolute', left: 0, top: 0, width: VOLET_W, height: VOLET_H / 2, background: C.ink700 }}
          />
          <div
            style={{
              display: 'flex',
              fontFamily: 'Archivo Expanded',
              fontWeight: 800,
              fontSize: 122,
              lineHeight: 1,
              letterSpacing: -4,
              color: C.bone100,
              marginTop: 8,
            }}
          >
            {String(SELF_POS - 1)}
          </div>
          {/* Charnière de la lamelle */}
          <div
            style={{ position: 'absolute', left: 0, top: VOLET_H / 2 - 1, width: VOLET_W, height: 2, background: C.ink1000 }}
          />
          {/* Encoches des axes, de part et d'autre de la charnière */}
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: VOLET_H / 2 - 6,
              width: 4,
              height: 12,
              borderRadius: '0 3px 3px 0',
              background: C.floor,
            }}
          />
          <div
            style={{
              position: 'absolute',
              right: 0,
              top: VOLET_H / 2 - 6,
              width: 4,
              height: 12,
              borderRadius: '3px 0 0 3px',
              background: C.floor,
            }}
          />
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            marginTop: 16,
            fontFamily: 'Archivo SemiCondensed',
            fontWeight: 700,
            fontSize: 13,
            lineHeight: 1.35,
            letterSpacing: 2.4,
            textTransform: 'uppercase',
            color: C.muted,
          }}
        >
          <span>Devant</span>
          <span>vous</span>
        </div>
      </div>
    </div>
  );
}

export function OgCard({ kicker, title, lead, seuil = 'Comptoir', host }: OgCardProps) {
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
        {/* En-tête : le mot-symbole, comme en haut du site */}
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
        {/* Le texte, posé en bas comme une affiche */}
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
              color: C.muted,
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
          {lead ? (
            <div
              style={{
                display: 'flex',
                marginTop: 28,
                maxWidth: 540,
                fontFamily: 'Archivo',
                fontWeight: 500,
                fontSize: 24,
                lineHeight: 1.45,
                color: C.muted,
              }}
            >
              {lead}
            </div>
          ) : null}
        </div>
      </div>
      <Floor seuil={seuil} />
    </div>
  );
}

/** Domaine public à afficher, seulement pour une vraie URL en https. */
export function ogHost(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.hostname === 'localhost') return null;
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** Rend une image OG 1200×630 avec les polices du site. */
export async function renderOgImage(props: OgCardProps): Promise<ImageResponse> {
  const fonts = await loadOgFonts();
  return new ImageResponse(<OgCard {...props} />, { ...OG_SIZE, fonts });
}
