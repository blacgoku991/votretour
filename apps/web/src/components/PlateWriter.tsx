'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNfcWriter } from '@/hooks/useNfcWriter';
import { explainNoNfc } from '@/lib/nfc';
import styles from './PlateWriter.module.css';

/**
 * PROGRAMMER UNE PLAQUE.
 *
 * Écrit réellement le tag NFC depuis le navigateur, puis le relit pour
 * vérifier. Aucune étape n'est simulée : si le navigateur ne sait pas
 * écrire — tout iPhone, tout ordinateur — on le dit et on donne la
 * marche à suivre qui marche, au lieu d'un bouton qui ne ferait rien.
 */

export interface ProgrammedResult {
  serialNumber: string | null;
  verified: boolean;
  locked: boolean;
}

interface Props {
  url: string;
  plateLabel: string;
  /** Tag déjà passé en lecture seule : plus rien n'est réécrivable. */
  lockedAt?: string | null;
  disabled?: boolean;
  /** Appelé après une écriture réussie, pour l'enregistrer côté serveur. */
  onProgrammed: (result: ProgrammedResult) => void | Promise<void>;
  /** Variante compacte pour les grilles de plaques. */
  compact?: boolean;
}

export function PlateWriter({
  url, plateLabel, lockedAt, disabled, onProgrammed, compact,
}: Props) {
  const { support, state, program, cancel, reset, skipVerification } = useNfcWriter();
  const [open, setOpen] = useState(false);
  const [lockWanted, setLockWanted] = useState(false);
  const [saved, setSaved] = useState<'idle' | 'saving' | 'done'>('idle');
  const dialogRef = useRef<HTMLDivElement>(null);
  const reported = useRef(false);

  const close = useCallback(() => {
    cancel();
    reset();
    setOpen(false);
    setLockWanted(false);
    setSaved('idle');
    reported.current = false;
  }, [cancel, reset]);

  // Échap ferme, le focus entre dans la boîte, et la page derrière cesse
  // de défiler : c'est une vraie boîte de dialogue, pas un panneau
  // décoratif. Sans le verrou de défilement, le doigt fait glisser la
  // page sous le dialogue et les boutons se dérobent.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    dialogRef.current?.focus();

    const { body } = document;
    const previousOverflow = body.style.overflow;
    const previousPadding = body.style.paddingRight;
    // Compenser la barre de défilement évite que la page derrière ne
    // sursaute de quelques pixels à l'ouverture.
    const gap = window.innerWidth - document.documentElement.clientWidth;
    body.style.overflow = 'hidden';
    if (gap > 0) body.style.paddingRight = `${gap}px`;

    return () => {
      document.removeEventListener('keydown', onKey);
      body.style.overflow = previousOverflow;
      body.style.paddingRight = previousPadding;
    };
  }, [open, close]);

  // Une fois l'écriture terminée, on l'enregistre — une seule fois.
  useEffect(() => {
    if (state.phase !== 'done' || reported.current) return;
    reported.current = true;
    setSaved('saving');
    void (async () => {
      await onProgrammed({
        serialNumber: state.serialNumber,
        verified: state.verified,
        locked: state.locked,
      });
      setSaved('done');
    })();
  }, [state.phase, state.serialNumber, state.verified, state.locked, onProgrammed]);

  const start = () => {
    reported.current = false;
    setSaved('idle');
    void program(url, { lock: lockWanted });
  };

  if (lockedAt) {
    // En mode compact, la carte affiche déjà l'état dans sa rangée de
    // pastilles : le répéter ici ferait doublon.
    if (compact) return null;
    return (
      <span className={`chip chip--copper ${styles.compactChip}`}
        title="Ce tag a été passé en lecture seule définitive.">
        Tag verrouillé
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        className={compact ? 'btn btn--ghost btn--sm' : 'btn btn--signal'}
        onClick={() => setOpen(true)}
        disabled={disabled}
      >
        <NfcGlyph />
        Programmer la plaque
      </button>

      {open && (
        <div className={styles.backdrop} onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
          <div
            className={styles.dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="plate-writer-title"
            tabIndex={-1}
            ref={dialogRef}
          >
            <header className={styles.head}>
              <div>
                <p className="t-label">Programmer un tag NFC</p>
                <h2 id="plate-writer-title" className={styles.title}>{plateLabel}</h2>
              </div>
              <button type="button" className="btn btn--quiet btn--sm" onClick={close} aria-label="Fermer">
                Fermer
              </button>
            </header>

            {support === null ? (
              <p className="t-small t-muted">Vérification du téléphone…</p>
            ) : support === 'unsupported' ? (
              <Fallback url={url} />
            ) : (
              <Programmer
                phase={state.phase}
                error={state.error}
                serialNumber={state.serialNumber}
                verified={state.verified}
                locked={state.locked}
                saved={saved}
                url={url}
                lockWanted={lockWanted}
                onLockWanted={setLockWanted}
                onStart={start}
                onSkip={skipVerification}
                onClose={close}
              />
            )}
          </div>
        </div>
      )}
    </>
  );
}

/* ================================================================== */

function Programmer({
  phase, error, serialNumber, verified, locked, saved, url,
  lockWanted, onLockWanted, onStart, onSkip, onClose,
}: {
  phase: string; error: string | null; serialNumber: string | null;
  verified: boolean; locked: boolean; saved: 'idle' | 'saving' | 'done';
  url: string; lockWanted: boolean;
  onLockWanted: (v: boolean) => void;
  onStart: () => void; onSkip: () => void; onClose: () => void;
}) {
  const live = phase === 'waiting' || phase === 'writing' || phase === 'verify' || phase === 'locking';

  return (
    <div className={styles.body}>
      <div className={`${styles.stage} ${live ? styles.stageLive : ''} ${phase === 'done' ? styles.stageDone : ''}`}>
        <Target phase={phase} />
        <div className={styles.stageText} role="status" aria-live="polite">
          <p className={styles.stageTitle}>{TITLE[phase] ?? 'Prêt'}</p>
          <p className="t-small t-muted">{DETAIL[phase] ?? DETAIL.idle}</p>
        </div>
      </div>

      {phase === 'error' && error && (
        <div className="banner banner--error" role="alert"><span>{error}</span></div>
      )}

      {phase === 'done' && (
        <div className={styles.result}>
          <div className="row g2">
            {verified
              ? <span className="chip chip--jade">Relue et vérifiée</span>
              : <span className="chip chip--copper">Écrite, non relue</span>}
            {locked && <span className="chip chip--copper">Verrouillée</span>}
            {saved === 'saving' && <span className="chip">Enregistrement…</span>}
            {saved === 'done' && <span className="chip">Enregistrée</span>}
          </div>
          {serialNumber && (
            <p className="t-micro t-faint">
              Tag n° <code>{serialNumber}</code> — noté pour reconnaître cette plaque plus tard.
            </p>
          )}
          {!verified && (
            <p className="t-micro t-faint">
              La plaque n&apos;a pas été relue : posez-la sur le comptoir et scannez-la
              une fois avec un téléphone pour confirmer qu&apos;elle ouvre la bonne page.
            </p>
          )}
        </div>
      )}

      {phase === 'idle' && (
        <>
          <p className={styles.urlLine}>
            <span className="t-label">Sera écrit sur le tag</span>
            <code className={styles.url}>{url}</code>
          </p>
          <label className={styles.lockRow}>
            <input
              type="checkbox"
              checked={lockWanted}
              onChange={(e) => onLockWanted(e.target.checked)}
            />
            <span>
              <b>Verrouiller le tag après écriture</b>
              <span className="t-micro t-faint">
                Personne ne pourra plus le réécrire — y compris vous. Utile contre le
                remplacement malveillant d&apos;une plaque en libre accès. Irréversible.
              </span>
            </span>
          </label>
        </>
      )}

      <div className={styles.actions}>
        {phase === 'idle' && (
          <button type="button" className="btn btn--signal btn--block btn--lg" onClick={onStart}>
            Commencer
          </button>
        )}
        {phase === 'verify' && (
          <button type="button" className="btn btn--ghost btn--block" onClick={onSkip}>
            Terminer sans vérifier
          </button>
        )}
        {(phase === 'waiting' || phase === 'writing' || phase === 'locking') && (
          <button type="button" className="btn btn--quiet btn--block" onClick={onClose}>
            Annuler
          </button>
        )}
        {phase === 'error' && (
          <button type="button" className="btn btn--signal btn--block" onClick={onStart}>
            Réessayer
          </button>
        )}
        {phase === 'done' && (
          <button type="button" className="btn btn--solid btn--block" onClick={onClose}>
            Terminé
          </button>
        )}
      </div>
    </div>
  );
}

const TITLE: Record<string, string> = {
  idle: 'Prêt à écrire',
  waiting: 'Approchez la plaque',
  writing: 'Écriture en cours',
  verify: 'Vérification',
  locking: 'Verrouillage du tag',
  done: 'Plaque programmée',
  error: 'Ça n’a pas marché',
};

const DETAIL: Record<string, string> = {
  idle: 'Le tag doit être vierge ou réinscriptible. Un NTAG213 suffit largement.',
  waiting: "Posez la plaque contre le dos du téléphone, vers le haut, près de l'appareil photo.",
  writing: 'Ne bougez plus la plaque.',
  verify: 'Retirez la plaque, puis reposez-la : on relit ce qui vient d’être écrit.',
  locking: 'Gardez la plaque contre le téléphone.',
  done: 'Vous pouvez la coller sur le comptoir.',
  error: 'Rien n’a été perdu : la plaque et son lien sont inchangés.',
};

/* ------------------------------------------------------------------ */

/** La cible : le rail du produit, replié en anneaux concentriques. */
function Target({ phase }: { phase: string }) {
  const done = phase === 'done';
  const failed = phase === 'error';
  return (
    <div className={styles.target} aria-hidden="true">
      <span className={styles.ring} />
      <span className={styles.ring} />
      <span className={styles.core}>
        {done ? (
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4.5 12.5 9.5 17.5 19.5 7" />
          </svg>
        ) : failed ? (
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.4" strokeLinecap="round">
            <path d="M12 6v8M12 18h.01" />
          </svg>
        ) : (
          <NfcGlyph size={26} />
        )}
      </span>
    </div>
  );
}

function NfcGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
      <path d="M7 5.5a9 9 0 0 1 0 13" />
      <path d="M11 8a5 5 0 0 1 0 8" />
      <path d="M15 10.4a1.9 1.9 0 0 1 0 3.2" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */

/** Ce qu'on affiche quand le navigateur ne peut pas écrire. */
function Fallback({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const reason = explainNoNfc(typeof navigator !== 'undefined' ? navigator.userAgent : '');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { setCopied(false); }
  };

  return (
    <div className={styles.body}>
      <div className="banner banner--warn">
        <span>
          <b>{reason.title}</b>
          <br />
          {reason.detail}
        </span>
      </div>

      <div>
        <p className="t-label">Adresse à écrire sur le tag</p>
        <div className={styles.urlRow}>
          <code className={styles.url}>{url}</code>
          <button type="button" className="btn btn--ghost btn--sm" onClick={copy}>
            {copied ? 'Copié' : 'Copier'}
          </button>
        </div>
      </div>

      <ol className={styles.steps}>
        <li>
          Installez <b>NFC Tools</b> (gratuite, App Store ou Google Play).
        </li>
        <li>Onglet <b>Écrire</b> → <b>Ajouter un enregistrement</b> → <b>URL</b>.</li>
        <li>Collez l’adresse ci-dessus, puis <b>Écrire</b>.</li>
        <li>Approchez le tag. Testez-le : il doit ouvrir votre page de file.</li>
      </ol>

      <p className="t-micro t-faint">
        L’enregistrement doit être de type <b>URI</b>. Un enregistrement « texte »
        afficherait l’adresse au lieu de l’ouvrir.
      </p>
    </div>
  );
}
