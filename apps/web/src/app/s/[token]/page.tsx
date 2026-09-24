import type { Metadata } from 'next';
import Link from 'next/link';
import { DeviceGlyph, DEVICE_LABEL } from '@/components/objects/DeviceGlyph';
import { Immatriculation } from '@/components/objects/Immatriculation';
import { StageRail } from '@/components/objects/StageRail';
import { TicketNumber } from '@/components/objects/TicketNumber';
import { Wordmark } from '@/components/Wordmark';
import { initials } from '@/lib/format';
import { getProfile, hasStages } from '@/lib/profiles';
import { asMaskedRegistration } from '@/lib/profiles/registration';
import type { QueueProfile } from '@/lib/profiles/types';
import { requestFingerprint } from '@/server/client-session';
import { consumeRateLimit } from '@/server/ratelimit';
import { PROFILE_LIMITS } from '@/server/profiles/limits';
import { followLabel, peekClaim, type ClaimPreview } from '@/server/profiles/queue';
import { hashTrackingToken, isTrackingToken } from '@/server/profiles/tracking-link';
import clientStyles from '@/app/e/[slug]/client.module.css';
import { ClaimButton } from './ClaimButton';
import styles from './claim.module.css';

export const dynamic = 'force-dynamic';

/**
 * Le lien d'un QR de suivi ne doit ni remonter dans un moteur de
 * recherche, ni partir chez un tiers dans l'en-tête Referer (la balise
 * `referrer` suffit au navigateur : aucune ressource tierce n'est chargée
 * ici, et le lien vers l'accueil reste sur le même site).
 */
export const metadata: Metadata = {
  title: 'Suivre ma fiche',
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  referrer: 'no-referrer',
};

interface PageProps {
  params: Promise<{ token: string }>;
}

type View =
  | { kind: 'preview'; preview: ClaimPreview; token: string }
  | { kind: 'invalid' }
  | { kind: 'limited' };

/**
 * `/s/[jeton]` — ce que voit le client qui scanne le QR de suivi (étiquette
 * de clé, écran du réceptionnaire).
 *
 * D'abord un APERÇU, jamais un rattachement immédiat : un QR photographié
 * ou transmis par erreur ne doit pas rattacher la fiche au premier venu,
 * et le client vérifie que c'est bien SON véhicule. L'aperçu est masqué
 * en SQL (`peek_claim`) : l'immatriculation n'y montre que ses trois
 * derniers caractères, et il n'y a jamais de prénom. Puis un seul bouton,
 * « Suivre mon véhicule », qui rattache la fiche à ce téléphone
 * (`POST /api/client/claim`) et ouvre le suivi.
 *
 * Hors middleware (le jeton brut ne traverse ni l'authentification ni ses
 * journaux), `noindex`, `no-referrer`. Rendu serveur, sans état : un lien
 * expiré ou déjà servi s'affiche tel quel, d'après la base.
 */
export default async function ClaimPage({ params }: PageProps) {
  const { token } = await params;
  const view = await resolveView(token);

  return (
    <main className={clientStyles.screen} data-theme="dark">
      <span className={`floor-marks ${clientStyles.sideMarks}`} aria-hidden="true" />
      <div className={`client-shell ${clientStyles.inner}`}>
        {view.kind === 'preview' ? <Preview preview={view.preview} token={view.token} /> : <Unavailable kind={view.kind} />}
      </div>
    </main>
  );
}

async function resolveView(token: string): Promise<View> {
  // Un jeton mal formé n'interroge pas la base : même écran qu'un jeton expiré.
  if (!isTrackingToken(token)) return { kind: 'invalid' };

  const { ipHash } = await requestFingerprint();
  const rate = await consumeRateLimit(
    `claim-peek:ip:${ipHash ?? 'inconnue'}`,
    PROFILE_LIMITS.claimPeek.max,
    PROFILE_LIMITS.claimPeek.window,
  );
  if (!rate.allowed) return { kind: 'limited' };

  const preview = await peekClaim(hashTrackingToken(token)).catch((error: unknown) => {
    console.error('[suivi] aperçu indisponible', error instanceof Error ? error.message : 'inconnu');
    return null;
  });
  return preview ? { kind: 'preview', preview, token } : { kind: 'invalid' };
}

/* ------------------------------------------------------------------ */
/* Aperçu                                                               */
/* ------------------------------------------------------------------ */

const DOSSIER_WORD: Partial<Record<QueueProfile, string>> = {
  vehicle: 'Fiche atelier',
  device: 'Dossier de réparation',
  retail: 'Commande',
  desk: 'Ticket',
  table: 'Liste d’attente',
};

function headline(profile: QueueProfile): string {
  switch (profile) {
    case 'vehicle': return 'Votre véhicule, étape par étape';
    case 'device': return 'Votre appareil, étape par étape';
    case 'retail': return 'Votre commande, en direct';
    case 'table': return 'Votre table, sur votre téléphone';
    default: return 'Votre ticket, sur votre téléphone';
  }
}

function promise(profile: QueueProfile, place: string): string {
  return hasStages(profile)
    ? `${place} vous prévient à chaque étape, même demain : devis, pièce commandée, «\u00a0prêt\u00a0». Sans compte, sans application.`
    : `${place} vous prévient quand c’est votre tour. Sans compte, sans application.`;
}

/** Sous le bouton : ce que le téléphone suivra, dans le mot du métier. */
function claimNote(profile: QueueProfile): string {
  const what: Partial<Record<QueueProfile, string>> = {
    vehicle: 'la fiche atelier',
    device: 'le dossier',
    retail: 'la commande',
    table: 'votre place',
    desk: 'le ticket',
  };
  return `Ce téléphone suivra ${what[profile] ?? 'votre place'}. Rien d’autre à saisir.`;
}

/**
 * Monogramme, même règle que l'en-tête du suivi (`ClientExperience`) : la
 * marque avant « — », ses deux premiers mots en lettres. « PhoneFix —
 * Bastille » donne « PH », jamais « P— ».
 */
function monogram(name: string): string {
  const brand = name.split(/\s[—–-]\s/)[0] ?? name;
  const words = brand.split(/\s+/).filter((w) => /^\p{L}/u.test(w));
  if (words.length >= 2) return (words[0]!.charAt(0) + words[1]!.charAt(0)).toUpperCase();
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return initials(name);
}

/** « aujourd’hui à 17:40 », « demain à 09:15 », « jeudi 26 septembre à 08:30 ». */
function expiryLabel(iso: string, now = new Date(), timeZone = 'Europe/Paris'): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const day = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const time = new Intl.DateTimeFormat('fr-FR', { timeZone, hour: '2-digit', minute: '2-digit' }).format(at);
  if (day(at) === day(now)) return `aujourd’hui à ${time}`;
  if (day(at) === day(new Date(now.getTime() + 86_400_000))) return `demain à ${time}`;
  const date = new Intl.DateTimeFormat('fr-FR', { timeZone, weekday: 'long', day: 'numeric', month: 'long' }).format(at);
  return `${date} à ${time}`;
}

function Preview({ preview, token }: { preview: ClaimPreview; token: string }) {
  const { profile } = preview;
  const place = preview.location.name;
  const masked = profile === 'vehicle' ? asMaskedRegistration(preview.registrationMasked) : null;
  const staged = hasStages(profile) && preview.stage !== null;
  const deviceKind = profile === 'device' ? preview.deviceKind ?? 'other' : null;
  const expires = expiryLabel(preview.expiresAt);
  const subject = getProfile(profile).vocab.subject;

  return (
    <div className={styles.page}>
      <header className={clientStyles.header}>
        {preview.organization.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview.organization.logoUrl} alt="" className={clientStyles.logo} referrerPolicy="no-referrer" />
        ) : (
          <span className={clientStyles.logoFallback} aria-hidden="true">{monogram(place)}</span>
        )}
        <div className={clientStyles.identityText}>
          <p className={clientStyles.placeName}>{place}</p>
          <p className={clientStyles.subtitle}>{DOSSIER_WORD[profile] ?? 'Suivi'}</p>
          <p className={clientStyles.status}>
            <span className="pip pip--live" aria-hidden="true" />
            <span>Lien de suivi valide</span>
          </p>
        </div>
      </header>

      {/* L'étiquette de clé : l'objet que le client tient dans sa main,
          accroché à son anneau. La latte du Rang, percée d'un œillet. */}
      <figure className={styles.hang} aria-label={`${DOSSIER_WORD[profile] ?? 'Fiche'} chez ${place}`}>
        <svg className={styles.ring} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
          <circle cx="32" cy="30" r="21" />
          <path d="M32 9.5c7 0 12.5 4.2 14.6 10.2" />
        </svg>
        <div className={styles.tag} data-profile={profile}>
          <span className={styles.eyelet} aria-hidden="true" />
          <p className={styles.tagKicker}>{DOSSIER_WORD[profile] ?? 'Suivi'}</p>

          {masked && <Immatriculation maskedValue={masked} size="lg" className={styles.plate} />}

          {deviceKind && (
            <div className={styles.device}>
              <span className={styles.deviceIcon}>
                <DeviceGlyph kind={deviceKind} size={30} />
              </span>
              <span className={styles.deviceText}>
                <span className={styles.deviceKind}>{DEVICE_LABEL[deviceKind]}</span>
                {preview.model && <span className={styles.deviceModel}>{preview.model}</span>}
              </span>
            </div>
          )}

          {preview.ticketNo && profile !== 'vehicle' && (
            <div className={styles.ticket}>
              <TicketNumber
                value={preview.ticketNo}
                kind={profile === 'device' ? 'dossier' : 'ticket'}
                size="clamp(2.25rem, 1.5rem + 3.4vw, 3rem)"
              />
            </div>
          )}

          {profile === 'vehicle' && preview.model && <p className={styles.model}>{preview.model}</p>}
          {profile === 'vehicle' && !masked && !preview.model && (
            <p className={styles.model}>Votre {subject}</p>
          )}
        </div>
      </figure>

      <section className={styles.copy} aria-labelledby="suivi-titre">
        <h1 id="suivi-titre" className={styles.title}>{headline(profile)}</h1>
        <p className={styles.lead}>{promise(profile, place)}</p>
      </section>

      {staged && (
        <section className={styles.now} aria-label="Où en est-il">
          <p className="t-label">En ce moment</p>
          {/* L'aperçu ne connaît que l'étape EN COURS, pas le chemin suivi :
              un historique réduit à elle ne dessine comme « faite » que
              l'étape d'arrivée. On n'affirme pas qu'un devis ou une pièce
              ont eu lieu. */}
          <StageRail
            profile={profile}
            current={preview.stage}
            history={preview.stage ? [{ stage: preview.stage, at: '' }] : null}
            orientation="vertical"
            compact
          />
        </section>
      )}

      <ul className={styles.facts}>
        {masked && (
          <li>
            <FactIcon kind="mask" />
            <span>Immatriculation masquée : seuls ses trois derniers caractères s’affichent ici.</span>
          </li>
        )}
        <li>
          <FactIcon kind="once" />
          <span>Lien à usage unique{expires ? `, valable jusqu’à ${expires}` : ''}.</span>
        </li>
        <li>
          <FactIcon kind="free" />
          <span>Aucun compte, aucune information demandée. Vous arrêtez le suivi quand vous voulez.</span>
        </li>
      </ul>

      <div className={styles.dock}>
        <ClaimButton token={token} label={followLabel(profile)} note={claimNote(profile)} />
      </div>
    </div>
  );
}

function FactIcon({ kind }: { kind: 'mask' | 'once' | 'free' }) {
  return (
    <svg className={styles.factIcon} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      {kind === 'mask' && (
        <>
          <rect x="2.5" y="5.5" width="15" height="9" rx="2" />
          <circle cx="7" cy="10" r="1.1" className={styles.factFill} />
          <circle cx="10.5" cy="10" r="1.1" className={styles.factFill} />
          <path d="M13.6 10h1.4" />
        </>
      )}
      {kind === 'once' && (
        <>
          <circle cx="10" cy="10" r="7.2" />
          <path d="M10 6.2V10l2.6 1.8" />
        </>
      )}
      {kind === 'free' && (
        <>
          <path d="M10 2.8 16 5v4.6c0 3.7-2.5 6.3-6 7.6-3.5-1.3-6-3.9-6-7.6V5l6-2.2Z" />
          <path d="m7.3 10 1.9 1.9L13 8.2" />
        </>
      )}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Lien expiré, déjà servi, ou trop de tentatives                       */
/* ------------------------------------------------------------------ */

function Unavailable({ kind }: { kind: 'invalid' | 'limited' }) {
  const limited = kind === 'limited';
  return (
    <div className={`${styles.page} ${styles.pageEmpty}`}>
      <div className={styles.bar}>
        <Link href="/" aria-label="Rangvia" className={styles.home}><Wordmark /></Link>
      </div>

      {/* L'étiquette sans rien dessus, décrochée : le lien ne mène plus nulle part. */}
      <div className={styles.hang} data-state="empty" aria-hidden="true">
        <svg className={styles.ring} viewBox="0 0 64 64" focusable="false">
          <circle cx="32" cy="30" r="21" />
        </svg>
        <div className={`${styles.tag} ${styles.tagGhost}`}>
          <span className={styles.eyelet} />
          <span className={styles.ghostLine} />
          <span className={`${styles.ghostLine} ${styles.ghostLineShort}`} />
        </div>
      </div>

      <section className={styles.copy}>
        <p className="t-label">{limited ? 'Un instant' : 'Lien de suivi'}</p>
        <h1 className={styles.title}>
          {limited ? 'Trop de tentatives.' : 'Ce lien a déjà servi ou a expiré.'}
        </h1>
        <p className={styles.lead}>
          {limited
            ? 'Patientez une minute, puis rouvrez ce lien.'
            : 'Un QR de suivi ne sert qu’une fois. L’accueil vous en donne un nouveau : il suffit de le scanner.'}
        </p>
      </section>
    </div>
  );
}
