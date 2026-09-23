'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { Wordmark } from '@/components/Wordmark';
import { TimeField } from '@/components/TimeField';
import { useReducedMotion } from '@/components/motion/useMotionPreference';
import { ACTIVITY_OPTIONS } from '@/lib/copy';
import { WEEKDAYS } from '@/lib/format';
import { completeOnboarding, type OnboardingResult } from '@/server/actions/onboarding';
import { RailNote, StepBand, StepRail } from './StepRail';
import { ReadyScreen } from './ReadyScreen';
import styles from './onboarding.module.css';

/**
 * ONBOARDING.
 *
 * L'objectif n'est pas de collecter des informations : c'est d'arriver
 * le plus vite possible à une plaque qui fonctionne. Cinq étapes, une
 * seule décision réellement structurante (file commune ou file par
 * professionnel), et un écran final qui donne le QR, le lien, et de quoi
 * tester immédiatement comme un client.
 *
 * Habillage « Le Rang en relief » : la progression est un rail de lattes
 * (StepRail), les étapes glissent de 16 px en 240 ms, les horaires sont en
 * 24 h (TimeField, « 09 h 00 ») et envoient toujours « HH:MM ».
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

/** Durée de la sortie d'une étape ; l'entrée, en CSS, dure 140 ms : 240 ms en tout. */
const LEAVE_MS = 100;

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

  // Transition entre étapes : sortie (-16 px), puis entrée (+16 px → 0).
  const reduced = useReducedMotion();
  const [leaving, setLeaving] = useState(false);
  const [direction, setDirection] = useState<1 | -1>(1);
  const leaveTimer = useRef<number | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);

  useEffect(() => () => {
    if (leaveTimer.current !== null) window.clearTimeout(leaveTimer.current);
  }, []);

  // Après un changement d'étape (pas au premier affichage), le focus va au
  // titre : le lecteur d'écran annonce la nouvelle étape.
  useEffect(() => {
    if (!moved.current) return;
    titleRef.current?.focus();
  }, [step]);

  const index = STEPS.findIndex((s) => s.id === step);

  const goTo = (target: Step, dir: 1 | -1) => {
    if (leaving) return;
    setDirection(dir);
    moved.current = true;
    if (reduced) { setStep(target); return; }
    setLeaving(true);
    leaveTimer.current = window.setTimeout(() => {
      leaveTimer.current = null;
      setStep(target);
      setLeaving(false);
    }, LEAVE_MS);
  };

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

  const greeting = `${userName ? `Bonjour ${userName.split(' ')[0]}.` : 'Bienvenue.'} Créons votre file.`;
  const kicker = (
    <p className="t-kicker">
      <span className="t-kicker__num" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
      <span className="sr-only">{`Étape ${index + 1}`}</span>
      {`sur ${String(STEPS.length).padStart(2, '0')} · ${STEPS[index]?.label ?? ''}`}
    </p>
  );
  const title = (text: React.ReactNode) => (
    <h1 ref={titleRef} tabIndex={-1} className={`t-title ${styles.title}`}>{text}</h1>
  );

  return (
    <main className={styles.screen}>
      <aside className={styles.aside}>
        <div className={styles.asideInner}>
          <Wordmark />
          <StepRail steps={STEPS} index={index} greeting={greeting} />
          <RailNote />
        </div>
      </aside>

      <header className={styles.mobileHead}>
        <StepBand steps={STEPS} index={index} />
      </header>

      <div className={styles.main}>
        <div
          key={step}
          className={styles.pane}
          data-leaving={leaving ? '1' : undefined}
          data-dir={direction}
        >
          {step === 'place' && <p className={styles.mobileGreeting}>{greeting}</p>}

          {step === 'place' && (
            <div className={styles.stepBody}>
              <div className={styles.stepHead}>
                {kicker}
                {title('Votre commerce')}
                <p className={styles.lead}>C&apos;est le nom que verront vos clients.</p>
              </div>
              <div className="field-rail">
                <div className="field">
                  <label htmlFor="org">Nom du commerce</label>
                  <input id="org" className={`input ${styles.input}`} autoFocus value={form.organizationName}
                    placeholder="Barber House" autoComplete="organization"
                    onChange={(e) => setForm({ ...form, organizationName: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor="activity">Activité</label>
                  <select id="activity" className={`select ${styles.input}`} value={form.activity}
                    onChange={(e) => setForm({ ...form, activity: e.target.value })}>
                    {ACTIVITY_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="place">Nom de l&apos;établissement</label>
                  <input id="place" className={`input ${styles.input}`} value={form.locationName}
                    placeholder="Barber House — Paris 11" aria-describedby="place-aide"
                    onChange={(e) => setForm({ ...form, locationName: e.target.value })} />
                  <p className="hint" id="place-aide">Utile si vous avez plusieurs adresses. Sinon, laissez vide.</p>
                </div>
                <div className={`field ${styles.addressField}`} role="group" aria-labelledby="coord-label">
                  <span className={styles.groupLabel} id="coord-label">Coordonnées · facultatif</span>
                  <div className={styles.grid2}>
                    <div className="field">
                      <label htmlFor="addr">Adresse</label>
                      <input id="addr" className={`input ${styles.input}`} value={form.addressLine1}
                        autoComplete="address-line1"
                        onChange={(e) => setForm({ ...form, addressLine1: e.target.value })} />
                    </div>
                    <div className="field">
                      <label htmlFor="cp">Code postal</label>
                      <input id="cp" className={`input ${styles.input}`} value={form.postalCode}
                        autoComplete="postal-code" inputMode="numeric"
                        onChange={(e) => setForm({ ...form, postalCode: e.target.value })} />
                    </div>
                    <div className="field">
                      <label htmlFor="ville">Ville</label>
                      <input id="ville" className={`input ${styles.input}`} value={form.city}
                        autoComplete="address-level2"
                        onChange={(e) => setForm({ ...form, city: e.target.value })} />
                    </div>
                    <div className="field">
                      <label htmlFor="tel">Téléphone</label>
                      <input id="tel" className={`input ${styles.input}`} type="tel" value={form.phone}
                        autoComplete="tel"
                        onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 'team' && (
            <div className={styles.stepBody}>
              <div className={styles.stepHead}>
                {kicker}
                {title('Qui travaille ici ?')}
                <p className={styles.lead}>
                  Un prénom suffit. Vous pourrez en ajouter à tout moment — et ils
                  n&apos;ont pas besoin de compte pour apparaître dans la file.
                </p>
              </div>
              <div className="field-rail">
                {staffNames.map((name, i) => (
                  <div key={i} className={`field ${styles.staffField}`}>
                    <div className={styles.staffRow}>
                      <input
                        className={`input ${styles.input}`}
                        aria-label={`Professionnel ${i + 1}`}
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
                          aria-label={`Retirer le professionnel ${i + 1}`}
                          onClick={() => setStaffNames(staffNames.filter((_, j) => j !== i))}>
                          Retirer
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <button type="button" className={`btn btn--ghost btn--sm ${styles.addStaff}`}
                onClick={() => setStaffNames([...staffNames, ''])}>
                <span aria-hidden="true" className={styles.plus}>+</span> Ajouter un professionnel
              </button>
            </div>
          )}

          {step === 'queue' && (
            <div className={styles.stepBody}>
              <div className={styles.stepHead}>
                {kicker}
                {title('Comment travaillez-vous ?')}
                <p className={styles.lead}>
                  C&apos;est le seul choix qui change vraiment le fonctionnement. Il reste
                  modifiable ensuite.
                </p>
              </div>
              <div className={styles.modes}>
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
            <div className={styles.stepBody}>
              <div className={styles.stepHead}>
                {kicker}
                {title('Votre lien d’avis Google')}
                <p className={styles.lead}>
                  À la fin de chaque passage, le client reçoit un remerciement avec un bouton
                  qui ouvre directement ce lien. C&apos;est proposé à tout le monde, sans
                  filtrage.
                </p>
              </div>
              <div className="field-rail">
                <div className="field">
                  <label htmlFor="review">Lien « Rédiger un avis »</label>
                  <input id="review" className={`input ${styles.input}`} type="url" inputMode="url"
                    placeholder="https://g.page/r/..."
                    value={form.googleReviewUrl}
                    onChange={(e) => setForm({ ...form, googleReviewUrl: e.target.value })} />
                </div>
              </div>
              <details className={styles.help}>
                <summary>Où trouver ce lien&nbsp;?</summary>
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
            <div className={styles.stepBody}>
              <div className={styles.stepHead}>
                {kicker}
                {title('Vos horaires')}
                <p className={styles.lead}>
                  Indicatif&nbsp;: la file s&apos;ouvre et se ferme d&apos;un geste depuis le
                  tableau de bord.
                </p>
              </div>
              <ul className={styles.hours}>
                {hours.map((day, i) => {
                  const dayName = WEEKDAYS[day.weekday] ?? '';
                  const lower = dayName.toLowerCase();
                  return (
                    <li key={day.weekday} className={styles.hoursRow} data-closed={day.isClosed ? '1' : undefined}>
                      <span className={styles.dayName}>{dayName}</span>
                      <label className={styles.openToggle}>
                        <input type="checkbox" className={styles.switch} checked={!day.isClosed}
                          aria-label={`Ouvert le ${lower}`}
                          onChange={(e) => {
                            const next = [...hours];
                            next[i] = { ...day, isClosed: !e.target.checked };
                            setHours(next);
                          }} />
                        <span aria-hidden="true">{day.isClosed ? 'Fermé' : 'Ouvert'}</span>
                      </label>
                      {!day.isClosed ? (
                        <span className={styles.times}>
                          <TimeField
                            value={day.opensAt}
                            aria-label={`Ouverture du ${lower}`}
                            onChange={(value) => {
                              const next = [...hours];
                              next[i] = { ...day, opensAt: value };
                              setHours(next);
                            }}
                          />
                          <span className={styles.timeSep} aria-hidden="true">à</span>
                          <TimeField
                            value={day.closesAt}
                            aria-label={`Fermeture du ${lower}`}
                            onChange={(value) => {
                              const next = [...hours];
                              next[i] = { ...day, closesAt: value };
                              setHours(next);
                            }}
                          />
                        </span>
                      ) : (
                        <span className={styles.closedNote}>Fermé toute la journée</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>

        <div className={styles.navWrap}>
          {error && <div className="banner banner--error" role="alert"><span>{error}</span></div>}
          <div className={styles.nav}>
            {index > 0 && (
              <button type="button" className={`btn btn--quiet btn--lg ${styles.back}`}
                onClick={() => goTo(STEPS[index - 1]!.id, -1)}>
                Retour
              </button>
            )}
            {index < STEPS.length - 1 ? (
              <button
                type="button"
                className="btn btn--signal btn--lg grow"
                disabled={step === 'place' && form.organizationName.trim().length < 2}
                onClick={() => goTo(STEPS[index + 1]!.id, 1)}
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
        <span className={styles.modeDesc}>{description}</span>
      </span>
      <span className={styles.modeCheck} aria-hidden="true" />
    </button>
  );
}
