'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { Wordmark } from '@/components/Wordmark';
import { ACTIVITY_OPTIONS } from '@/lib/copy';
import { WEEKDAYS } from '@/lib/format';
import { completeOnboarding, openQueueNow, type OnboardingResult } from '@/server/actions/onboarding';
import styles from './onboarding.module.css';

/**
 * ONBOARDING.
 *
 * L'objectif n'est pas de collecter des informations : c'est d'arriver
 * le plus vite possible à une plaque qui fonctionne. Cinq étapes, une
 * seule décision réellement structurante (file commune ou file par
 * professionnel), et un écran final qui donne le QR, le lien, et de quoi
 * tester immédiatement comme un client.
 */

type Step = 'place' | 'team' | 'queue' | 'review' | 'hours' | 'done';

const STEPS: { id: Step; label: string }[] = [
  { id: 'place', label: 'Établissement' },
  { id: 'team', label: 'Équipe' },
  { id: 'queue', label: 'File' },
  { id: 'review', label: 'Avis Google' },
  { id: 'hours', label: 'Horaires' },
];

interface Hours {
  weekday: number;
  isClosed: boolean;
  opensAt: string;
  closesAt: string;
}

const DEFAULT_HOURS: Hours[] = WEEKDAYS.map((_, index) => ({
  weekday: index,
  isClosed: index === 6,
  opensAt: '09:00',
  closesAt: '19:00',
}));

export function OnboardingFlow({ userName }: { userName: string | null }) {
  const [step, setStep] = useState<Step>('place');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OnboardingResult | null>(null);
  const [pending, startTransition] = useTransition();

  const [form, setForm] = useState({
    organizationName: '',
    activity: 'barber',
    locationName: '',
    addressLine1: '',
    postalCode: '',
    city: '',
    phone: '',
    queueMode: 'shared' as 'shared' | 'per_staff',
    googleReviewUrl: '',
  });
  const [staffNames, setStaffNames] = useState<string[]>(['']);
  const [hours, setHours] = useState<Hours[]>(DEFAULT_HOURS);

  const index = STEPS.findIndex((s) => s.id === step);

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const response = await completeOnboarding({
        organizationName: form.organizationName.trim(),
        activity: form.activity as never,
        locationName: form.locationName.trim() || form.organizationName.trim(),
        addressLine1: form.addressLine1.trim() || null,
        postalCode: form.postalCode.trim() || null,
        city: form.city.trim() || null,
        phone: form.phone.trim() || null,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Paris',
        queueMode: form.queueMode,
        googleReviewUrl: form.googleReviewUrl.trim() || null,
        staffNames: staffNames.map((n) => n.trim()).filter(Boolean),
        openingHours: hours.map((h) => ({
          weekday: h.weekday,
          isClosed: h.isClosed,
          opensAt: h.opensAt,
          closesAt: h.closesAt,
        })),
      });

      if (!response.ok) { setError(response.error); return; }
      setResult(response.data);
      setStep('done');
    });
  };

  if (step === 'done' && result) {
    return <ReadyScreen result={result} />;
  }

  return (
    <main className={styles.screen}>
      <span className={styles.rails} aria-hidden="true" />

      <div className={styles.panel}>
        <header className={styles.head}>
          <Wordmark />
          <p className="t-small t-muted">
            {userName ? `Bonjour ${userName.split(' ')[0]}.` : 'Bienvenue.'} Créons votre file.
          </p>
        </header>

        {/* La progression est dessinée comme la file elle-même : des
            lattes qui se remplissent. */}
        <div className={styles.progress} aria-hidden="true">
          {STEPS.map((s, i) => (
            <span
              key={s.id}
              className={`${styles.progressSlat} ${i <= index ? styles.progressSlatDone : ''}`}
            />
          ))}
        </div>
        <p className="t-label">{`Étape ${index + 1} sur ${STEPS.length} · ${STEPS[index]?.label ?? ''}`}</p>

        {error && <div className="banner banner--error" role="alert"><span>{error}</span></div>}

        <div className={styles.card}>
          {step === 'place' && (
            <div className="stack g4">
              <div>
                <h1 className="t-title">Votre commerce</h1>
                <p className="t-small t-muted">C&apos;est le nom que verront vos clients.</p>
              </div>
              <div className="field">
                <label htmlFor="org">Nom du commerce</label>
                <input id="org" className="input" autoFocus value={form.organizationName}
                  placeholder="Barber House"
                  onChange={(e) => setForm({ ...form, organizationName: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="activity">Activité</label>
                <select id="activity" className="select" value={form.activity}
                  onChange={(e) => setForm({ ...form, activity: e.target.value })}>
                  {ACTIVITY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="place">Nom de l&apos;établissement</label>
                <input id="place" className="input" value={form.locationName}
                  placeholder="Barber House — Paris 11"
                  onChange={(e) => setForm({ ...form, locationName: e.target.value })} />
                <p className="hint">Utile si vous avez plusieurs adresses. Sinon, laissez vide.</p>
              </div>
              <div className={styles.grid2}>
                <div className="field">
                  <label htmlFor="addr">Adresse</label>
                  <input id="addr" className="input" value={form.addressLine1}
                    onChange={(e) => setForm({ ...form, addressLine1: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor="cp">Code postal</label>
                  <input id="cp" className="input" value={form.postalCode}
                    onChange={(e) => setForm({ ...form, postalCode: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor="ville">Ville</label>
                  <input id="ville" className="input" value={form.city}
                    onChange={(e) => setForm({ ...form, city: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor="tel">Téléphone</label>
                  <input id="tel" className="input" type="tel" value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                </div>
              </div>
            </div>
          )}

          {step === 'team' && (
            <div className="stack g4">
              <div>
                <h1 className="t-title">Qui travaille ici ?</h1>
                <p className="t-small t-muted">
                  Un prénom suffit. Vous pourrez en ajouter à tout moment — et ils
                  n&apos;ont pas besoin de compte pour apparaître dans la file.
                </p>
              </div>
              <div className="stack g2">
                {staffNames.map((name, i) => (
                  <div key={i} className={styles.staffRow}>
                    <input
                      className="input"
                      placeholder={i === 0 ? 'Vous' : `Professionnel ${i + 1}`}
                      value={name}
                      onChange={(e) => {
                        const next = [...staffNames];
                        next[i] = e.target.value;
                        setStaffNames(next);
                      }}
                    />
                    {staffNames.length > 1 && (
                      <button type="button" className="btn btn--quiet btn--sm"
                        onClick={() => setStaffNames(staffNames.filter((_, j) => j !== i))}>
                        Retirer
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <button type="button" className="btn btn--ghost btn--sm"
                onClick={() => setStaffNames([...staffNames, ''])}>
                + Ajouter un professionnel
              </button>
            </div>
          )}

          {step === 'queue' && (
            <div className="stack g4">
              <div>
                <h1 className="t-title">Comment travaillez-vous ?</h1>
                <p className="t-small t-muted">
                  C&apos;est le seul choix qui change vraiment le fonctionnement. Il reste
                  modifiable ensuite.
                </p>
              </div>
              <div className="stack g2">
                <ModeCard
                  active={form.queueMode === 'shared'}
                  title="Une file commune"
                  description="Le prochain client part avec le premier professionnel disponible. Le plus courant."
                  onSelect={() => setForm({ ...form, queueMode: 'shared' })}
                />
                <ModeCard
                  active={form.queueMode === 'per_staff'}
                  title="Une file par professionnel"
                  description="Chaque client choisit avec qui il veut passer, et attend dans sa file à lui."
                  onSelect={() => setForm({ ...form, queueMode: 'per_staff' })}
                />
              </div>
            </div>
          )}

          {step === 'review' && (
            <div className="stack g4">
              <div>
                <h1 className="t-title">Votre lien d&apos;avis Google</h1>
                <p className="t-small t-muted">
                  À la fin de chaque passage, le client reçoit un remerciement avec un bouton
                  qui ouvre directement ce lien. C&apos;est proposé à tout le monde, sans
                  filtrage.
                </p>
              </div>
              <div className="field">
                <label htmlFor="review">Lien « Rédiger un avis »</label>
                <input id="review" className="input" type="url" inputMode="url"
                  placeholder="https://g.page/r/..."
                  value={form.googleReviewUrl}
                  onChange={(e) => setForm({ ...form, googleReviewUrl: e.target.value })} />
              </div>
              <details className={styles.help}>
                <summary>Où trouver ce lien ?</summary>
                <ol>
                  <li>Ouvrez votre fiche d&apos;établissement Google (Google Business Profile).</li>
                  <li>Cliquez sur <strong>Demander des avis</strong> — Google affiche un lien court.</li>
                  <li>Copiez-le et collez-le ici.</li>
                </ol>
                <p>
                  Vous pouvez aussi passer cette étape et le renseigner plus tard dans
                  Réglages.
                </p>
              </details>
            </div>
          )}

          {step === 'hours' && (
            <div className="stack g4">
              <div>
                <h1 className="t-title">Vos horaires</h1>
                <p className="t-small t-muted">
                  Indicatif : la file s&apos;ouvre et se ferme d&apos;un geste depuis le
                  tableau de bord.
                </p>
              </div>
              <div className="stack g2">
                {hours.map((day, i) => (
                  <div key={day.weekday} className={styles.hoursRow}>
                    <span className={styles.dayName}>{WEEKDAYS[day.weekday]}</span>
                    <label className={styles.closedToggle}>
                      <input type="checkbox" checked={!day.isClosed}
                        onChange={(e) => {
                          const next = [...hours];
                          next[i] = { ...day, isClosed: !e.target.checked };
                          setHours(next);
                        }} />
                      <span>{day.isClosed ? 'Fermé' : 'Ouvert'}</span>
                    </label>
                    {!day.isClosed && (
                      <>
                        <input type="time" className="input" value={day.opensAt}
                          onChange={(e) => {
                            const next = [...hours];
                            next[i] = { ...day, opensAt: e.target.value };
                            setHours(next);
                          }} />
                        <input type="time" className="input" value={day.closesAt}
                          onChange={(e) => {
                            const next = [...hours];
                            next[i] = { ...day, closesAt: e.target.value };
                            setHours(next);
                          }} />
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className={styles.nav}>
          {index > 0 && (
            <button type="button" className="btn btn--ghost"
              onClick={() => setStep(STEPS[index - 1]!.id)}>
              Retour
            </button>
          )}
          {index < STEPS.length - 1 ? (
            <button
              type="button"
              className="btn btn--signal btn--lg grow"
              disabled={step === 'place' && form.organizationName.trim().length < 2}
              onClick={() => setStep(STEPS[index + 1]!.id)}
            >
              Continuer
            </button>
          ) : (
            <button type="button" className="btn btn--signal btn--lg grow"
              disabled={pending} onClick={submit}>
              {pending ? 'Création…' : 'Créer ma file'}
            </button>
          )}
        </div>
      </div>
    </main>
  );
}

function ModeCard({
  active, title, description, onSelect,
}: { active: boolean; title: string; description: string; onSelect: () => void }) {
  return (
    <button type="button" onClick={onSelect}
      className={`${styles.modeCard} ${active ? styles.modeCardActive : ''}`}
      aria-pressed={active}>
      <span className={styles.modeMark} aria-hidden="true">
        {/* Le pictogramme est la file elle-même, dans les deux modes. */}
        <svg width="34" height="34" viewBox="0 0 34 34" fill="currentColor">
          {title.includes('commune') ? (
            <>
              <rect x="2" y="5" width="2" height="24" rx="1" opacity="0.4" />
              <rect x="8" y="6" width="22" height="5" rx="2.5" opacity="0.3" />
              <rect x="8" y="14.5" width="17" height="5" rx="2.5" opacity="0.5" />
              <rect x="8" y="23" width="12" height="5" rx="2.5" />
            </>
          ) : (
            <>
              <rect x="2" y="5" width="2" height="24" rx="1" opacity="0.4" />
              <rect x="8" y="6" width="10" height="5" rx="2.5" opacity="0.4" />
              <rect x="8" y="14.5" width="10" height="5" rx="2.5" opacity="0.4" />
              <rect x="21" y="6" width="9" height="5" rx="2.5" opacity="0.3" />
              <rect x="21" y="14.5" width="9" height="5" rx="2.5" />
              <rect x="8" y="23" width="10" height="5" rx="2.5" />
            </>
          )}
        </svg>
      </span>
      <span className={styles.modeText}>
        <span className="t-section">{title}</span>
        <span className="t-small t-muted">{description}</span>
      </span>
    </button>
  );
}

/* ==================================================================
   Écran final : « Votre file est prête »
   ================================================================== */

function ReadyScreen({ result }: { result: OnboardingResult }) {
  const [opened, setOpened] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <main className={styles.screen}>
      <span className={styles.rails} aria-hidden="true" />
      <div className={`${styles.panel} fade-in`}>
        <header className={styles.head}><Wordmark /></header>

        <div className={styles.readyCard}>
          <p className="t-label">C&apos;est prêt</p>
          <h1 className="t-display">Votre file est prête</h1>
          <p className="t-body t-muted">
            {result.locationName} peut recevoir ses premiers clients. Posez ce QR au
            comptoir, ou écrivez ce lien sur une plaque NFC.
          </p>

          <div className={styles.qrRow}>
            <div className={styles.qrFrame}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/p/${result.plateCode}?format=svg`} alt="QR code de votre file" />
            </div>
            <div className="stack g3 grow">
              <code className={styles.url}>{result.plateUrl}</code>
              <div className="row g2 wrap">
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
            </div>
          </div>

          <div className="stack g3">
            {!opened ? (
              <button type="button" className="btn btn--signal btn--hero" disabled={pending}
                onClick={() => startTransition(async () => {
                  const response = await openQueueNow(result.queueId);
                  if (response.ok) setOpened(true);
                })}>
                {pending ? 'Ouverture…' : 'Ouvrir la file maintenant'}
              </button>
            ) : (
              <div className="banner">
                <span className="pip pip--live" />
                <span>La file est ouverte. Vos clients peuvent scanner.</span>
              </div>
            )}

            <a className="btn btn--ghost btn--lg" href={result.plateUrl} target="_blank" rel="noreferrer">
              Tester comme un client
            </a>
            <Link className="btn btn--quiet" href={`/app/${result.organizationSlug}/file`}>
              Aller au tableau de bord
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
