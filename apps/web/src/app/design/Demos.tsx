'use client';

import { useEffect, useRef, useState } from 'react';
import { FlapNumber, FlapText } from '@/components/FlapNumber';
import { Rang } from '@/components/Rang';
import { TimeField } from '@/components/TimeField';
import { FloorScene, type FloorSlat } from '@/components/objects/FloorScene';
import { Plaque } from '@/components/objects/Plaque';
import { Seuil } from '@/components/objects/Seuil';
import { useInViewOnce } from '@/components/motion/useInViewOnce';
import { useReducedMotion } from '@/components/motion/useMotionPreference';
import styles from './design.module.css';

/* Îlots interactifs de la planche. Tout ce qui dépend du temps ou d'un
   clic vit ici ; le reste est rendu côté serveur par page.tsx. */

/* ---------------------------------------------------------------- Volet */
const TEXTS = ['12 min', '8 min', '3 min'];
const NAMES = ['CAMILLE', 'KARIM', 'LÉA'];
const CODES = ['482193', '482750', '905113'];

export function FlapDemo() {
  const [n, setN] = useState(3);
  const [step, setStep] = useState(0);
  const reduced = useReducedMotion();

  const fall = () => {
    setN((v) => (v <= 0 ? 4 : v - 1));
    setStep((s) => s + 1);
  };

  return (
    <div className={styles.flapDemo}>
      <div className={styles.flapHero}>
        <div className={styles.flapBig} data-testid="flap-main">
          <FlapNumber value={n} label={`${n} ${n <= 1 ? 'personne' : 'personnes'} devant vous`} />
          <p className="t-label">{n <= 1 ? 'personne devant vous' : 'personnes devant vous'}</p>
        </div>
        <div className={styles.flapSide}>
          <div className={styles.flapCell}>
            <span className="t-label">Tuile · pad 2</span>
            <FlapNumber value={n * 7} pad={2} tile size="3.25rem" static label={`${n * 7} en attente`} />
          </div>
          <div className={styles.flapCell}>
            <span className="t-label">FlapText · proportionnel</span>
            <FlapText text={TEXTS[step % 3] as string} size="2.5rem" static />
          </div>
          <div className={styles.flapCell}>
            <span className="t-label">FlapText · fixe, tuile, 7 cases</span>
            <FlapText text={NAMES[step % 3] as string} fixed tile cells={7} size="2.25rem" static />
          </div>
          <div className={styles.flapCell}>
            <span className="t-label">Code d&apos;appairage</span>
            <FlapText text={CODES[step % 3] as string} fixed tile cells={6} size="2.25rem" static stagger={60} />
          </div>
        </div>
      </div>
      <div className={styles.actions}>
        <button type="button" className="btn btn--signal" onClick={fall} data-testid="flap-change">
          Faire tomber les valeurs
        </button>
        <span className="t-micro t-muted">
          {reduced ? 'Mouvement réduit : remplacement instantané.' : 'Seules les cellules qui changent tombent, en demi-cellules.'}
        </span>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- Rang */
export function RangDemo() {
  const [ahead, setAhead] = useState(4);
  return (
    <div className={styles.rangDemo}>
      <div className={styles.rangCol}>
        <div className={styles.rangHead}>
          <FlapNumber
            value={ahead}
            size="4.5rem"
            label={`${ahead} ${ahead <= 1 ? 'personne' : 'personnes'} devant vous`}
          />
          <p className="t-label">{ahead <= 1 ? 'personne devant vous' : 'personnes devant vous'}</p>
        </div>
        <Rang
          ahead={ahead}
          selfLabel="Camille"
          selfHint={ahead === 0 ? 'À vous' : 'Votre place'}
          headIsServing
        />
        <div className={styles.actions}>
          <button
            type="button"
            className="btn btn--signal btn--sm"
            onClick={() => setAhead((a) => Math.max(0, a - 1))}
            disabled={ahead === 0}
          >
            Avancer
          </button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setAhead((a) => Math.min(9, a + 1))}>
            Arrivée
          </button>
          <button type="button" className="btn btn--quiet btn--sm" onClick={() => setAhead(4)}>
            Réinitialiser
          </button>
        </div>
      </div>
      <div className={styles.rangCol}>
        <p className="t-label">Aperçu · ghostSelf, sans relief</p>
        <Rang ahead={2} ghostSelf relief={false} />
        <p className="t-label" style={{ marginTop: 20 }}>Rang 2D · places gardées</p>
        <div className="rang rang--relief" aria-hidden="true">
          <div className="slat slat--serving"><span className={styles.tickSignal} /></div>
          <div className="slat slat--kept">Camille · place gardée</div>
          <div className="slat"><span className={styles.tick} /></div>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- Segmenté */
export function SegDemo() {
  const [mode, setMode] = useState<'open' | 'paused' | 'closed'>('open');
  const [period, setPeriod] = useState(30);
  return (
    <div className={styles.segDemo}>
      <div className="seg" role="group" aria-label="État de la file">
        {(
          [
            ['open', 'Ouverte'],
            ['paused', 'En pause'],
            ['closed', 'Fermée'],
          ] as const
        ).map(([key, text]) => (
          <button key={key} type="button" aria-pressed={mode === key} onClick={() => setMode(key)}>
            {text}
          </button>
        ))}
      </div>
      <div className="seg" role="group" aria-label="Période">
        {[7, 30, 90].map((d) => (
          <button key={d} type="button" aria-pressed={period === d} onClick={() => setPeriod(d)}>
            {d} j
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ TimeField */
export function TimeDemo() {
  // La valeur reçue peut contenir des secondes ; ce que TimeField RENVOIE
  // est toujours 'HH:MM'. On affiche les deux, sans confondre l'entrée et
  // la sortie.
  const [open, setOpen] = useState('09:00');
  const [close, setClose] = useState('19:10:00');
  const [sentOpen, setSentOpen] = useState<string | null>(null);
  const [sentClose, setSentClose] = useState<string | null>(null);
  const sent = (v: string | null) => (v === null ? 'rien pour l’instant' : `« ${v} »`);
  return (
    <div className="field-rail">
      <div className="field">
        <label htmlFor="tf-open">Ouverture du lundi</label>
        <TimeField
          id="tf-open"
          value={open}
          onChange={(v) => {
            setOpen(v);
            setSentOpen(v);
          }}
          aria-label="Ouverture du lundi"
        />
        <span className="hint">Reçue : « {open} » · renvoyée : {sent(sentOpen)}</span>
      </div>
      <div className="field">
        <label htmlFor="tf-close">Fermeture (hors pas : 19 h 10)</label>
        <TimeField
          id="tf-close"
          value={close}
          onChange={(v) => {
            setClose(v);
            setSentClose(v);
          }}
          aria-label="Fermeture du lundi"
        />
        <span className="hint">Reçue : « {close} » · renvoyée : {sent(sentClose)}</span>
      </div>
      <div className="field">
        <label htmlFor="tf-off">Dimanche · fermé</label>
        <TimeField id="tf-off" value="" onChange={() => undefined} disabled aria-label="Ouverture du dimanche" />
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- FloorScene */
const START: FloorSlat[] = [
  { id: 'a', state: 'serving' },
  { id: 'b', state: 'wait' },
  { id: 'c', state: 'wait' },
  { id: 'v', state: 'self', label: 'Camille', hint: 'Votre place' },
  { id: 'd', state: 'wait' },
];

export function FloorDemo() {
  const [slats, setSlats] = useState<FloorSlat[]>(START);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const advance = () => {
    if (busy || slats.length === 0) return;
    setBusy(true);
    // 1. la tête passe (elle se relève et s'efface)…
    setSlats((list) =>
      list.map((s, i) => (i === 0 ? { ...s, state: 'passed' } : i === 1 && s.state === 'wait' ? { ...s, state: 'serving' } : s)),
    );
    // 2. …puis on la retire : les autres avancent d'un cran (--pos).
    timer.current = setTimeout(() => {
      setSlats((list) => {
        const rest = list.slice(1).map((s, i) =>
          s.id === 'v' ? { ...s, state: i === 0 ? ('turn' as const) : ('self' as const), hint: i === 0 ? 'À vous' : 'Votre place' } : s,
        );
        if (rest[0] && rest[0].state === 'wait') rest[0] = { ...rest[0], state: 'serving' };
        return rest;
      });
      setBusy(false);
    }, 640);
  };

  const arrive = () => {
    setSlats((list) => (list.length >= 8 ? list : [...list, { id: `n${Date.now()}`, state: 'wait' }]));
  };

  return (
    <div className={styles.floorDemo}>
      <FloorScene slats={slats} size="md" spill label="File en relief interactive" />
      <div className={styles.actions}>
        <button type="button" className="btn btn--signal btn--sm" onClick={advance} disabled={busy || slats.length < 2}>
          Avancer (Passage)
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={arrive} disabled={slats.length >= 8}>
          Arrivée
        </button>
        <button type="button" className="btn btn--quiet btn--sm" onClick={() => setSlats(START)}>
          Réinitialiser
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- Plaque */
export function PlaqueDemo({ qr }: { qr: string }) {
  const [rx, setRx] = useState(35);
  const [nfc, setNfc] = useState(0);
  return (
    <div className={styles.plaqueDemo}>
      <div
        className={styles.plaqueDriven}
        style={{ ['--plaque-rx' as string]: `${rx}deg`, ['--plaque-ry' as string]: '-10deg', ['--plaque-rz' as string]: `${-3 - (rx - 12) * 0.13}deg` } as React.CSSProperties}
        data-nfc={nfc ? 'on' : undefined}
        key={nfc}
      >
        <Plaque width={200} pose="none" qr={<span dangerouslySetInnerHTML={{ __html: qr }} />} name="Barber House" />
      </div>
      <div className={styles.plaqueControls}>
        <label className="field">
          <span className="t-label">Pose « none » : --plaque-rx = {rx}°</span>
          <input
            type="range"
            min={0}
            max={60}
            value={rx}
            onChange={(e) => setRx(Number(e.target.value))}
            className={styles.range}
          />
        </label>
        <button type="button" className="btn btn--outline-signal btn--sm" onClick={() => setNfc((v) => v + 1)}>
          Approcher un téléphone (data-nfc)
        </button>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- Seuil */
export function SeuilDemo() {
  const [run, setRun] = useState(0);
  return (
    <div className={styles.seuilTurn}>
      <Seuil key={run} tone="ink" draw label="Comptoir" className={styles.seuilInner}>
        <p className={styles.turnKicker}>C&apos;est</p>
        <p className={styles.turnTitle}>votre tour</p>
        <p className={styles.turnLabel}>Présentez-vous au comptoir</p>
      </Seuil>
      <button type="button" className="btn btn--solid btn--sm" onClick={() => setRun((r) => r + 1)}>
        Redessiner
      </button>
    </div>
  );
}

/* ------------------------------------------------------------- InView */
export function InViewDemo() {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInViewOnce(ref, { threshold: 0.5 });
  return (
    <div ref={ref} className={styles.inView}>
      <span className="t-label">useInViewOnce</span>
      <FlapText text={seen ? '1 240' : '—'} size="2rem" static label={seen ? '1 240 clients' : 'en attente'} />
    </div>
  );
}
