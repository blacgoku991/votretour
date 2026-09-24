'use client';

import Link from 'next/link';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { FlapNumber } from '@/components/FlapNumber';
import { Plaque } from '@/components/objects/Plaque';
import { useScrollDriver, type DriverViewport } from '@/components/motion/useScrollDriver';
import { useLiteDevice, useReducedMotion } from '@/components/motion/useMotionPreference';
import { clamp } from '@/lib/motion';
import {
  cameraAt, cameraTransform, decorAt, queueAt, SLOT_IDS, THRESHOLDS, T_MAX,
  type QueueState, type SlotId,
} from './frame';
import { HOME_STORY_COPY, storyCssVars, type StoryText } from './copy';
import { POSTER_CSS } from './poster';
import styles from './Story.module.css';

/**
 * LE RANG EN RELIEF — la séquence de l'accueil.
 *
 * À t = 0, la scène EST l'écran client (volet, rail, lattes, plaque).
 * En défilant, la file se couche au sol et devient la vraie file du
 * commerce ; les personnes passent le seuil une à une.
 *
 * Moteur : useScrollDriver. `measure` lit la mise en page (rarement),
 * `frame` n'écrit que des styles et des attributs, et seulement ce qui a
 * changé. La caméra est continue (cameraAt, decorAt) ; l'état de la file
 * est discret (queueAt) et joué par les transitions CSS. React ne reçoit
 * que `ahead` et `joined` (le volet), une dizaine de fois en tout.
 *
 * Sans JavaScript ou en mouvement réduit : affiche statique en relief
 * (POSTER_CSS), et chaque étape montre sa vignette d'état.
 */

/** Positions de départ (t = 0), identiques au rendu serveur. */
const Q0 = queueAt(0);
const THRESHOLD_LIST = Object.values(THRESHOLDS);

interface Measures {
  steps: Array<{ top: number; h: number }>;
  line: number;
  stageBottom: number;
}

interface Cache {
  t: number;
  w: number;
  lite: boolean;
  styles: Map<Element, Record<string, string>>;
  queue: QueueState | null;
  /** Seuils franchis × 10 + étape active : l'identité de l'état discret. */
  key: number;
  pulse: 'a' | 'b' | null;
  seg: number[];
}

/** Nombre de rangées occupées (dernière latte présente + 1), de 1 à 6. */
function railRows(q: QueueState): number {
  let last = 0;
  for (const id of SLOT_IDS) {
    const s = q.slots[id];
    if (s.state !== 'hidden' && s.state !== 'passed') last = Math.max(last, s.pos);
  }
  return Math.min(6, last + 1);
}

function voletLabel(ahead: number, joined: boolean): string {
  if (!joined) return ahead <= 1 ? 'personne dans la file' : 'personnes dans la file';
  return ahead <= 1 ? 'personne devant vous' : 'personnes devant vous';
}

export interface StoryProps {
  /**
   * Les mots de la séquence. Absent : l'accueil, strictement comme avant
   * (aucune variable CSS posée, même DOM). Une page métier passe
   * `metierStoryCopy(page)`.
   */
  copy?: StoryText;
  /** Cible du lien « Passer l'animation » (id de la section suivante). */
  skipTargetId?: string;
  /** Au-dessus de l'étiquette du héros : le fil d'Ariane d'une page métier. */
  eyebrow?: React.ReactNode;
}

/**
 * Compensation du raccourci du libellé du seuil pour une inclinaison de
 * caméra donnée (degrés). Aux inclinaisons de la séquence (52° sur
 * téléphone, 56 à 58° sur ordinateur), rien ne change : c'est le rendu
 * dessiné. Quand la caméra se relève (34° pour le rideau), le libellé est
 * rallongé de sin(52°) / sin(tilt) pour garder la hauteur apparente qu'il a
 * pendant la séquence, borné à ×1,6.
 */
const SEUIL_REF = Math.sin((52 * Math.PI) / 180);
export function seuilLabelTransform(tilt: number): string {
  const t = Math.max(0, Math.min(90, Number.isFinite(tilt) ? tilt : 0));
  const k = Math.min(1.6, SEUIL_REF / Math.max(Math.sin((t * Math.PI) / 180), 1e-3));
  return k <= 1.001 ? '' : `scaleY(${k.toFixed(3)})`;
}

/** Au-delà, le titre du héros descend d'un cran (voir .title[data-length]). */
const LONG_TITLE = 40;

export function Story({
  copy = HOME_STORY_COPY,
  skipTargetId = 'apres-histoire',
  eyebrow,
}: StoryProps): React.JSX.Element {
  // Une page métier pose ses textes en variables CSS et peut réduire un
  // titre long ; l'accueil jamais, quelle que soit la copie qu'il passe.
  const custom = copy.kind !== 'home';
  const reduced = useReducedMotion();
  const lite = useLiteDevice();
  const [ready, setReady] = useState(false);
  const [hud, setHud] = useState({ ahead: Q0.ahead, joined: Q0.joined });

  const sectionRef = useRef<HTMLElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<HTMLDivElement | null>(null);
  const floorRef = useRef<HTMLDivElement | null>(null);
  const seuilRef = useRef<HTMLDivElement | null>(null);
  const seuilLabelRef = useRef<HTMLSpanElement | null>(null);
  const spillRef = useRef<HTMLDivElement | null>(null);
  const voletRef = useRef<HTMLDivElement | null>(null);
  const phoneRef = useRef<HTMLDivElement | null>(null);
  const plaqueRef = useRef<HTMLDivElement | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);
  const segRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const stepRefs = useRef<Array<HTMLLIElement | null>>([]);
  const slotRefs = useRef<Partial<Record<SlotId, HTMLDivElement | null>>>({});
  const liteRef = useRef(lite);
  liteRef.current = lite;
  const hudRef = useRef(hud);
  hudRef.current = hud;

  const cache = useRef<Cache>({ t: -1, w: 0, lite: false, styles: new Map(), queue: null, key: -1, pulse: null, seg: [] });

  useEffect(() => setReady(true), []);
  const enabled = ready && !reduced;

  /** Écrit une propriété seulement si sa valeur a changé (cache, aucune lecture). */
  const put = useCallback((el: HTMLElement | null, prop: 'transform' | 'opacity', value: string) => {
    if (!el) return;
    const map = cache.current.styles;
    let rec = map.get(el);
    if (!rec) {
      rec = {};
      map.set(el, rec);
    }
    if (rec[prop] === value) return;
    rec[prop] = value;
    el.style[prop] = value;
  }, []);

  const applyQueue = useCallback((q: QueueState) => {
    const prev = cache.current.queue;
    const stage = stageRef.current;
    if (!stage) return;

    // Lattes : --pos et data-state, seulement quand ils changent.
    for (const id of SLOT_IDS) {
      const el = slotRefs.current[id];
      if (!el) continue;
      const next = q.slots[id];
      const was = prev?.slots[id];
      if (!was || was.pos !== next.pos) {
        el.style.setProperty('--pos', String(next.pos));
        el.style.setProperty('--i', String(next.pos));
      }
      if (!was || was.state !== next.state) el.dataset.state = next.state;
    }

    // Le rail mesure la file : jusqu'à la dernière latte présente.
    const rows = railRows(q);
    if (!prev || railRows(prev) !== rows) {
      if (railRef.current) railRef.current.style.transform = `translateZ(0.5px) scaleY(${rows / 6})`;
    }

    // Indicateurs du HUD : attributs data-* sur la scène.
    const attrs: Array<[string, string]> = [
      ['notif', q.notif ? '1' : '0'],
      ['pro', q.pro],
      ['turn', q.turn ? '1' : '0'],
      ['merci', q.merci ? '1' : '0'],
      ['nfc', q.nfc ? 'on' : 'off'],
      ['phone', q.phoneGone ? 'gone' : 'on'],
      ['dot', q.dotOut ? 'out' : 'in'],
    ];
    for (const [k, v] of attrs) if (stage.dataset[k] !== v) stage.dataset[k] = v;

    // Étape active (rail de lecture).
    if (!prev || prev.active !== q.active) {
      stepRefs.current.forEach((li, i) => {
        if (!li) return;
        const on = q.active === i + 1;
        if (on) li.dataset.active = '1';
        else if (li.dataset.active) delete li.dataset.active;
      });
    }

    // Impulsion du rail : à chaque cran joué en descendant.
    if (prev && q.crans > prev.crans && worldRef.current) {
      const nextPulse = cache.current.pulse === 'a' ? 'b' : 'a';
      cache.current.pulse = nextPulse;
      worldRef.current.dataset.pulse = nextPulse;
    }

    cache.current.queue = q;

    // Le volet est un composant : un seul setState par changement.
    const h = hudRef.current;
    if (h.ahead !== q.ahead || h.joined !== q.joined) setHud({ ahead: q.ahead, joined: q.joined });
  }, []);

  const measure = useCallback((): Measures => {
    const sy = window.scrollY;
    const steps = stepRefs.current.map((el) => {
      if (!el) return { top: Number.POSITIVE_INFINITY, h: 1 };
      const r = el.getBoundingClientRect();
      return { top: r.top + sy, h: Math.max(1, r.height) };
    });
    const vh = window.innerHeight;
    const mobile = window.innerWidth < 1024;
    const headerH =
      Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--site-header-h')) || 56;
    const stageH = stageRef.current ? stageRef.current.getBoundingClientRect().height : 0;
    const stageBottom = headerH + stageH;
    // Mobile et tablette : une étape mesure la bande visible sous la scène.
    // La ligne est placée bas dans cette bande, pour que les seuils d'une
    // étape tombent pendant que son titre est lisible (et non déjà passé
    // sous la scène).
    const line = mobile ? stageBottom + 0.9 * (vh - stageBottom) : 0.55 * vh;
    return { steps, line, stageBottom };
  }, []);

  const frame = useCallback(
    (scrollY: number, m: Measures, vp: DriverViewport) => {
      let t = 0;
      for (const s of m.steps) t += clamp((m.line - (s.top - scrollY)) / s.h);
      t = clamp(t, 0, T_MAX);
      const c = cache.current;
      const isLite = liteRef.current;
      if (Math.abs(t - c.t) < 0.0005 && c.w === vp.w && c.lite === isLite) return;
      c.t = t;
      c.w = vp.w;
      c.lite = isLite;

      // Continu : au plus une dizaine d'écritures, aucune lecture.
      const cam = cameraAt(t, vp, isLite);
      const d = decorAt(t, vp, isLite);
      put(worldRef.current, 'transform', cameraTransform(cam));
      put(voletRef.current, 'transform', d.voletScale === 1 ? '' : `scale(${d.voletScale.toFixed(4)})`);
      put(
        phoneRef.current,
        'transform',
        `translate(${d.phone.x.toFixed(2)}px, ${d.phone.y.toFixed(2)}px) rotate(${d.phone.rot.toFixed(2)}deg)`,
      );
      put(phoneRef.current, 'opacity', d.phone.o.toFixed(3));
      put(plaqueRef.current, 'opacity', d.plaqueO.toFixed(3));
      put(spillRef.current, 'opacity', d.spill.toFixed(3));
      put(seuilRef.current, 'opacity', d.seuilO.toFixed(3));
      put(floorRef.current, 'opacity', d.seuilO.toFixed(3));
      // Le seuil est debout sur un sol incliné de `tilt` : vu par la caméra,
      // son libellé est écrasé d'un facteur sin(tilt). Quand la caméra se
      // relève pour le rideau « votre tour » (34°), il paraîtrait coupé à
      // mi-hauteur : on le rallonge dans son plan (seuilLabelTransform).
      // Transform seul, aucune lecture.
      put(seuilLabelRef.current, 'transform', seuilLabelTransform(cam.tilt));
      d.seg.forEach((v, i) => {
        if (c.seg[i] === v) return;
        c.seg[i] = v;
        const el = segRefs.current[i];
        if (el) el.style.transform = `scaleX(${v.toFixed(4)})`;
      });

      // Discret : seulement quand un seuil est franchi.
      // L'état ne dépend que des seuils franchis et de l'étape active.
      let crossed = 0;
      for (const v of THRESHOLD_LIST) if (t >= v) crossed += 1;
      const key = crossed * 10 + (t < 0.02 ? 0 : Math.min(6, Math.floor(t) + 1));
      if (key !== c.key) {
        c.key = key;
        applyQueue(queueAt(t));
      }
    },
    [applyQueue, put],
  );

  useScrollDriver<Measures>({ target: sectionRef, measure, frame, enabled });

  // Moteur allumé / éteint : data-engine, et remise à t = 0 à l'arrêt
  // (mouvement réduit activé en cours de route).
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    stage.dataset.engine = enabled ? 'on' : 'off';
    if (enabled) return;
    const c = cache.current;
    c.t = -1;
    c.seg = [];
    c.styles.clear();
    for (const el of [worldRef.current, voletRef.current, phoneRef.current, plaqueRef.current, spillRef.current, seuilRef.current, floorRef.current, seuilLabelRef.current]) {
      if (el) {
        el.style.transform = '';
        el.style.opacity = '';
      }
    }
    segRefs.current.forEach((el) => el && (el.style.transform = ''));
    if (c.queue) applyQueue(Q0);
    c.queue = null;
    c.key = -1;
  }, [enabled, applyQueue]);

  // Moteur : will-change seulement pendant que la section est à l'écran.
  useEffect(() => {
    const section = sectionRef.current;
    const stage = stageRef.current;
    if (!enabled || !section || !stage || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver(
      (entries) => {
        const e = entries[entries.length - 1];
        if (!e) return;
        if (e.isIntersecting) stage.dataset.live = '1';
        else delete stage.dataset.live;
      },
      { rootMargin: '100px 0px' },
    );
    io.observe(section);
    return () => {
      io.disconnect();
      delete stage.dataset.live;
    };
  }, [enabled]);

  const turnHidden = hud.joined && hud.ahead === 0;
  const slotStyle = (id: SlotId) =>
    ({ ['--pos' as string]: Q0.slots[id].pos, ['--i' as string]: Q0.slots[id].pos }) as React.CSSProperties;

  return (
    <section
      ref={sectionRef}
      id="histoire"
      className={styles.story}
      data-story=""
      data-kind={custom ? 'metier' : undefined}
      aria-labelledby="histoire-titre"
    >
      <a className={`skip-link ${styles.skip}`} href={`#${skipTargetId}`}>
        Passer l’animation
      </a>

      {/* ============================ HÉROS ============================ */}
      <div className={styles.hero}>
        <div className={styles.heroInner}>
          {eyebrow}
          <p className={`t-label ${styles.heroLabel}`}>{copy.hero.label}</p>
          <h1
            className={`t-hero ${styles.title}`}
            data-length={custom && copy.hero.title.length > LONG_TITLE ? 'long' : undefined}
          >
            {copy.hero.title}
          </h1>
          <p className={`t-lead ${styles.lead}`}>{copy.hero.lead}</p>
          <div className={styles.actions}>
            <Link href={copy.hero.primary.href} className="btn btn--signal btn--lg">
              {copy.hero.primary.label}
            </Link>
            <a href={copy.hero.secondary.href} className="btn btn--ghost btn--lg">
              {copy.hero.secondary.label}
            </a>
          </div>
          <p className={`t-micro t-muted ${styles.micro}`}>
            {/* Le « · » reste collé au mot qui le précède : jamais en tête de ligne. */}
            {copy.hero.micro.map((part, i) => (
              <Fragment key={part}>
                {i > 0 && ' '}
                <span>{part}</span>
              </Fragment>
            ))}
          </p>
        </div>
        <p className={styles.scrollHint} data-story-hint="">
          <span className={styles.scrollRail} aria-hidden="true" />
          {copy.hero.scrollHint}
        </p>
      </div>

      {/* ============================ SCÈNE ============================ */}
      <div
        ref={stageRef}
        className={styles.stage}
        data-story-stage=""
        data-engine="off"
        data-notif="0"
        data-pro="off"
        data-turn="0"
        data-merci="0"
        data-nfc="off"
        data-phone="on"
        data-dot="in"
        data-lite={lite ? '1' : undefined}
        style={custom ? (storyCssVars(copy) as React.CSSProperties) : undefined}
        aria-hidden="true"
      >
        <div className={`scene3d ${styles.frame}`}>
          <div ref={worldRef} className={`world3d ${styles.world}`} data-story-world="">
            <div ref={floorRef} className={`floor3d ${styles.floor}`} data-story-floor="">
              {[1, 2, 3, 4, 5].map((n) => (
                <span key={n} className="floorNum" style={{ ['--n' as string]: n } as React.CSSProperties}>
                  {n}
                </span>
              ))}
            </div>
            <div ref={spillRef} className={`spill3d ${styles.spill}`} data-story-spill="" />
            <div ref={railRef} className={`rail3d ${styles.rail}`} data-story-rail="" />
            <span className={styles.pulse} />
            <div ref={seuilRef} className={`seuil3d ${styles.seuil}`} data-story-seuil="">
              <span ref={seuilLabelRef} className="seuil3d__label">
                {copy.seuil}
              </span>
            </div>

            {SLOT_IDS.map((id) => (
              <div
                key={id}
                ref={(el) => {
                  slotRefs.current[id] = el;
                }}
                className={`slot3d ${styles.slot}`}
                data-slot={id}
                data-state={Q0.slots[id].state}
                style={slotStyle(id)}
              >
                <span className="slot3d__notch" />
                <div className="slot3d__lift">
                  {/* Libellés décoratifs : « Camille » et son indice (selon
                      l'état), « Votre place » ou « Prochain client » en
                      fantôme ; les autres lattes sont anonymes (coche). */}
                  <div className={`slot3d__face ${styles.face} ${id === 'vous' || id === 'next' ? '' : styles.anon}`}>
                    {id === 'vous' && (
                      <span className={styles.text}>
                        <span className={styles.name}>{copy.clientName}</span>
                        <span className={styles.hint} />
                      </span>
                    )}
                  </div>
                  <div className="slot3d__edge" />
                  {id === 'vous' && <span className={styles.dot} />}
                </div>
              </div>
            ))}
          </div>

          {/* Plaque 2D et téléphone (étape 1). */}
          <div ref={plaqueRef} className={styles.plaque} data-story-plaque="">
            <Plaque width={120} pose="front" className={styles.plaqueObj} />
            <div ref={phoneRef} className={styles.phone} data-story-phone="">
              <span className={styles.phoneBody} />
            </div>
          </div>

          {/* HUD : textes en 2D, jamais en 3D. */}
          <div ref={voletRef} className={styles.volet} data-hidden={turnHidden ? '1' : undefined}>
            <FlapNumber
              static
              value={hud.ahead}
              size="var(--volet-size)"
              label={`${hud.ahead} ${voletLabel(hud.ahead, hud.joined)}`}
            />
            <span className={`t-label ${styles.voletLabel}`}>{voletLabel(hud.ahead, hud.joined)}</span>
          </div>

          <div className={styles.turn}>
            {copy.turn.lead && <span className={styles.turnKicker}>{copy.turn.lead}</span>}
            <span className={styles.turnTitle}>{copy.turn.main}</span>
            <span className="t-label">{copy.turn.line}</span>
          </div>

          <div className={styles.merci}>
            <span className={`t-title ${styles.merciTitle}`}>{copy.merci.title}</span>
            <span className={styles.merciPlace}>{copy.place}</span>
            {copy.merci.button && (
              <button type="button" className={`btn btn--signal btn--sm ${styles.merciBtn}`} tabIndex={-1}>
                {copy.merci.button}
              </button>
            )}
          </div>

          <div className={styles.notifWrap}>
            <div className={styles.notif}>
              <span className={styles.notifIcon} />
              <span className={styles.notifText}>
                <span className={`t-micro ${styles.notifApp}`}>Rangvia · maintenant</span>
                <span className={styles.notifTitle}>{copy.notif.title}</span>
                <span className={styles.notifBody}>{copy.notif.body}</span>
              </span>
            </div>
          </div>

          {/* Panneau pro. Après l'appui, « En cours · avec Karim / Léa »
              bascule en fondu vers « Suivant / Camille » (textes en CSS). */}
          <div className={styles.pro}>
            <div className={styles.proInfo}>
              <span className={`t-label ${styles.swap} ${styles.proLabel}`} />
              <span className={`${styles.swap} ${styles.proName}`} />
              {copy.proTime && <span className={`t-num ${styles.proTime}`}>{copy.proTime}</span>}
            </div>
            <button type="button" className={`btn btn--signal btn--key btn--block ${styles.proKey}`} tabIndex={-1}>
              {copy.proKey}
            </button>
          </div>

          <div className={styles.progress} data-story-progress="">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <span
                key={i}
                ref={(el) => {
                  segRefs.current[i] = el;
                }}
                className={styles.segFill}
              />
            ))}
          </div>
        </div>
      </div>

      {/* =========================== ÉTAPES =========================== */}
      <h2 id="histoire-titre" className="sr-only">
        Comment ça marche, en six temps
      </h2>
      <ol className={styles.steps} data-story-steps="">
        {copy.steps.map((step, i) => (
          <li
            key={step.kicker}
            ref={(el) => {
              stepRefs.current[i] = el;
            }}
            id={i === 0 ? 'comment' : undefined}
            className={styles.step}
            data-step={i + 1}
            data-story-step=""
          >
            <div className={styles.stepInner}>
              <p className={`t-kicker ${styles.kicker}`}>
                <span className="t-kicker__num">{String(i + 1).padStart(2, '0')}</span>
                {step.kicker}
              </p>
              <h3 className={`t-story ${styles.stepTitle}`}>{step.title}</h3>
              <p className={`t-body t-muted ${styles.stepBody}`}>{step.body}</p>
              <p className={styles.benefit}>
                <span className={styles.benefitSlat} aria-hidden="true" />
                {step.benefit}
              </p>
              <p className={styles.stepState} data-story-state="" data-outline={step.outline ? '1' : undefined}>
                <span className={styles.stateSlat} aria-hidden="true" />
                {step.state}
              </p>
            </div>
          </li>
        ))}
      </ol>

      {/* Affiche statique : mouvement réduit et sans JavaScript. */}
      <style
        dangerouslySetInnerHTML={{ __html: `@media (prefers-reduced-motion: reduce){${POSTER_CSS}}` }}
      />
      <noscript dangerouslySetInnerHTML={{ __html: `<style>${POSTER_CSS}</style>` }} />
    </section>
  );
}
