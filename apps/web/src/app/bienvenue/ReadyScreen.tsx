'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { Wordmark } from '@/components/Wordmark';
import { Plaque } from '@/components/objects/Plaque';
import { Seuil } from '@/components/objects/Seuil';
import { openQueueNow, type OnboardingResult } from '@/server/actions/onboarding';
import { metierInstallNote, ONBOARDING_COPY } from './metiers';
import styles from './onboarding.module.css';

/**
 * ÉCRAN FINAL : « Votre file est prête ».
 *
 * Sur le sol (--floor), le Seuil « Comptoir » se dessine et encadre la
 * vraie plaque de l'établissement (vrai QR). La plaque entre une fois, de
 * couchée à posée (6°, légèrement tournée), en 700 ms.
 * Le marquage au sol reste AUTOUR du seuil, jamais sous un texte.
 *
 * Logique inchangée : ouverture de la file, copie du lien, QR en PNG,
 * affiche, test comme un client, tableau de bord.
 *
 * La file créée est toujours au passage : les mots sont ceux d'avant les
 * profils, mot pour mot, sans aucune promesse d'interface de métier. Pour
 * une activité qui a un métier propre (garage, restaurant, guichet…), une
 * phrase honnête, sous le lien : l'équipe Rangvia active l'interface de
 * ce métier lors de l'installation.
 */

const PLAQUE_POSE = {
  // 6° au plus : la tranche haute ne se lit pas comme une barre au-dessus de la face.
  ['--plaque-rx' as string]: '6deg',
  ['--plaque-ry' as string]: '0deg',
  ['--plaque-rz' as string]: '-3deg',
} as React.CSSProperties;

export function ReadyScreen({ result }: { result: OnboardingResult }) {
  const copy = ONBOARDING_COPY;
  const installNote = metierInstallNote(result.activity);
  const [opened, setOpened] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();
  const titleRef = useRef<HTMLHeadingElement>(null);

  // L'écran remplace l'étape Horaires (souvent défilée) et le bouton qui
  // avait le focus : on revient en haut et le focus va au titre, que le
  // lecteur d'écran annonce.
  useEffect(() => {
    window.scrollTo(0, 0);
    titleRef.current?.focus({ preventScroll: true });
  }, []);

  const qr = (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`/api/p/${result.plateCode}?format=svg`} alt="QR code de votre file" />
  );

  return (
    <main className={styles.ready}>
      <header className={styles.readyBar}>
        <Wordmark />
      </header>

      <div className={styles.readyStage}>
        <Seuil draw label="Comptoir" className={styles.readySeuil}>
          <div className={styles.plaqueEntry}>
            {/* Une seule plaque : 240 px sur ordinateur, réduite en CSS sur mobile. */}
            <Plaque
              width={240}
              pose="none"
              qr={qr}
              name={result.locationName}
              className={styles.readyPlaque}
              style={PLAQUE_POSE}
            />
          </div>
        </Seuil>
        {/* Le sol devant le comptoir : le marquage commence au seuil. */}
        <div className={styles.readyFloor} aria-hidden="true">
          <span className="floor-marks" />
        </div>
      </div>

      <div className={styles.readyText}>
        <p className={`t-label ${styles.readyKicker}`}>C’est prêt</p>
        <h1 ref={titleRef} tabIndex={-1} className={`t-display ${styles.readyTitle}`}>{copy.readyTitle}</h1>
        <p className={`t-lead ${styles.readyLead}`}>
          {result.locationName} peut recevoir ses premiers clients. Posez ce QR au
          comptoir, ou écrivez ce lien sur une plaque NFC.
        </p>

        <code className={styles.url}>{result.plateUrl}</code>

        <div className={styles.readyActions}>
          {!opened ? (
            <button type="button" className="btn btn--signal btn--hero" disabled={pending}
              onClick={() => startTransition(async () => {
                const response = await openQueueNow(result.queueId);
                if (response.ok) setOpened(true);
              })}>
              {pending ? copy.openPending : copy.openNow}
            </button>
          ) : (
            <div className={`banner ${styles.openBanner}`} role="status">
              <span className="pip pip--live" />
              <span>{copy.openedBanner}</span>
            </div>
          )}

          <a className="btn btn--outline-signal btn--lg" href={result.plateUrl} target="_blank" rel="noreferrer">
            Tester comme un client
          </a>

          <div className={styles.tools}>
            <button type="button" className="btn btn--ghost btn--sm"
              onClick={async () => {
                await navigator.clipboard.writeText(result.plateUrl);
                setCopied(true);
                setTimeout(() => setCopied(false), 1800);
              }}>
              {copied ? 'Copié' : 'Copier le lien'}
            </button>
            <a className="btn btn--ghost btn--sm" download
              href={`/api/p/${result.plateCode}?format=png&size=1200`}>
              QR en PNG
            </a>
            <a className="btn btn--ghost btn--sm" target="_blank" rel="noreferrer"
              href={`/api/p/${result.plateCode}?format=affiche`}>
              Affiche à imprimer
            </a>
          </div>

          <Link className="btn btn--quiet" href={`/app/${result.organizationSlug}/file`}>
            Aller au tableau de bord
          </Link>
        </div>

        {installNote && (
          <p className={styles.readyInstall}>
            <span className={styles.installMark} aria-hidden="true" />
            {installNote}
          </p>
        )}
      </div>
    </main>
  );
}
