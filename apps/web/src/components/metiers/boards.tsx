import { Reveal } from '@/components/motion/Reveal';
import type { CounterContent, RowContent, SettingContent } from '@/lib/metiers/types';
import { FlapIndex, Section } from './parts';
import styles from './metiers.module.css';

/**
 * Les « tableaux des départs » d'une page métier : le problème, le
 * comptoir, les réglages conseillés, les arguments. Même grammaire que
 * l'accueil (`rail-list board`) ; tout le texte vient de la page rendue
 * par le registre, rien n'est écrit ici qui parle d'un métier en
 * particulier.
 */

interface SectionAnchor {
  anchorId?: string;
}

/** 2. Le problème : trois scènes vécues, numérotées en volets de gare. */
export function ProblemBoard({ rows, anchorId }: { rows: readonly RowContent[] } & SectionAnchor): React.JSX.Element | null {
  if (rows.length === 0) return null;
  return (
    <Section
      id="probleme"
      anchorId={anchorId}
      kicker="Le problème"
      title="Vous connaissez la scène."
      lead="Trois moments ordinaires, avant la file virtuelle."
    >
      <ol className={`rail-list board ${styles.problem}`}>
        {rows.map((row, i) => (
          <Reveal as="li" variant="rise" index={i} key={row.key}>
            <FlapIndex n={i + 1} />
            <span className={`t-board ${styles.boardKey}`}>{row.key}</span>
            <span className={`t-body ${styles.problemText}`}>{row.text}</span>
          </Reveal>
        ))}
      </ol>
    </Section>
  );
}

/**
 * 4. Côté comptoir. Chaque clé est une TOUCHE du produit, écrite comme sur
 * le poste (vérifié par metiers-vocab.test.ts) : on la dessine donc comme
 * une touche, avec sa tranche. La première, celle du geste principal, est
 * vermillon, comme TERMINER sur le poste.
 */
export function CounterBoard({ rows, anchorId }: { rows: readonly CounterContent[] } & SectionAnchor): React.JSX.Element | null {
  if (rows.length === 0) return null;
  return (
    <Section
      id="comptoir"
      anchorId={anchorId}
      kicker="Côté comptoir"
      title="Tout tient en quelques touches."
      lead="Les mots de votre poste, tels que vous les trouverez en ouvrant votre file."
    >
      <ol className={`rail-list board ${styles.counter}`}>
        {rows.map((row, i) => (
          <Reveal as="li" variant="rise" index={i} key={row.key} className={i === 0 ? 'is-self' : undefined}>
            <span className={styles.keycap} data-tone={i === 0 ? 'signal' : undefined}>
              {row.key}
            </span>
            <span className="t-body t-muted">{row.text}</span>
          </Reveal>
        ))}
      </ol>
    </Section>
  );
}

/**
 * 6. Réglages conseillés : le libellé de l'écran Réglages, la valeur
 * conseillée (posée comme le choix actif d'un sélecteur) et la raison,
 * propre au métier.
 */
export function SettingsBoard({ rows, anchorId }: { rows: readonly SettingContent[] } & SectionAnchor): React.JSX.Element | null {
  if (rows.length === 0) return null;
  return (
    <Section
      id="reglages"
      anchorId={anchorId}
      kicker="Réglages conseillés"
      title="Nos réglages, pour démarrer."
      lead="Ceux que nous choisirions à votre place. Chacun se change à tout moment dans Réglages."
    >
      <ul className={`rail-list board ${styles.settings}`}>
        {rows.map((row) => (
          <li key={`${row.label}-${row.value}`}>
            <span className={styles.settingLabel}>{row.label}</span>
            <span className={styles.settingValue}>
              <span className={styles.settingDot} aria-hidden="true" />
              {row.value}
            </span>
            <span className="t-body t-muted">{row.text}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** 7. Pourquoi Rangvia : les arguments du métier, deux par ligne. */
export function ArgumentsList({ rows, anchorId }: { rows: readonly RowContent[] } & SectionAnchor): React.JSX.Element | null {
  if (rows.length === 0) return null;
  return (
    <Section id="pourquoi" anchorId={anchorId} kicker="Pourquoi Rangvia" title="Ce qui change pour vous.">
      <ul className={styles.args}>
        {rows.map((row, i) => (
          <li key={row.key} className={styles.arg} data-first={i === 0 ? '1' : undefined}>
            <h3 className={styles.argKey}>{row.key}</h3>
            <p className={`t-body t-muted ${styles.argText}`}>{row.text}</p>
          </li>
        ))}
      </ul>
    </Section>
  );
}
