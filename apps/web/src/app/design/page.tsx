import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import QRCode from 'qrcode';
import { FlapText } from '@/components/FlapNumber';
import { FloorScene } from '@/components/objects/FloorScene';
import { Plaque } from '@/components/objects/Plaque';
import { Seuil } from '@/components/objects/Seuil';
import { Reveal } from '@/components/motion/Reveal';
import {
  FlapDemo, FloorDemo, InViewDemo, PlaqueDemo, RangDemo, SegDemo, SeuilDemo, TimeDemo,
} from './Demos';
import { WalletPreview } from './WalletPreview';
import styles from './design.module.css';

/**
 * PLANCHE DE RÉFÉRENCE « LE RANG EN RELIEF » — page de développement.
 *
 * Chaque primitive de la fondation (WP0), dans chacun de ses états. C'est
 * la référence visuelle de tous les lots. Introuvable en production.
 */

export const metadata: Metadata = {
  title: 'Planche de design',
  robots: { index: false, follow: false },
};

const SECTIONS = [
  ['jetons', 'Jetons'],
  ['typo', 'Typographie'],
  ['boutons', 'Boutons'],
  ['champs', 'Champs'],
  ['listes', 'Listes'],
  ['volet', 'Le Volet'],
  ['rang', 'Le Rang'],
  ['sol', 'Le sol en relief'],
  ['plaque', 'La Plaque'],
  ['seuil', 'Le Seuil'],
  ['etats', 'États'],
  ['revelation', 'Révélation'],
  ['wallet', 'Passes Wallet'],
] as const;

const SWATCHES = [
  ['--floor', 'Sol des scènes', 'var(--floor)'],
  ['--surface', 'Page · encre 900', 'var(--surface)'],
  ['--surface-raised', 'Surface levée', 'var(--surface-raised)'],
  ['--slat', 'Latte', 'var(--slat)'],
  ['--slat-edge', 'Tranche', 'var(--slat-edge)'],
  ['--accent', 'Signal', 'var(--accent)'],
  ['--slat-edge-self', 'Tranche « Vous »', 'var(--slat-edge-self)'],
  ['--bone-100', 'Os · plaque', 'var(--bone-100)'],
] as const;

function Head({ n, id, title, note }: { n: number; id: string; title: string; note: string }) {
  return (
    <header className={styles.sectionHead}>
      <p className="t-kicker">
        <span className="t-kicker__num">{String(n).padStart(2, '0')}</span>
        {SECTIONS.find(([k]) => k === id)?.[1]}
      </p>
      <h2 id={`${id}-titre`} className={`t-title ${styles.sectionTitle}`}>{title}</h2>
      <p className={`t-small t-muted ${styles.sectionNote}`}>{note}</p>
    </header>
  );
}

function Sec({
  n, id, title, note, children,
}: { n: number; id: string; title: string; note: string; children: React.ReactNode }) {
  return (
    <section id={id} className={styles.section} aria-labelledby={`${id}-titre`}>
      <Head n={n} id={id} title={title} note={note} />
      <div className={styles.body}>{children}</div>
    </section>
  );
}

export default async function DesignPage() {
  if (process.env.NODE_ENV === 'production') notFound();

  const site = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
  const qr = await QRCode.toString(`${site}/e/barber-house-paris-11-comptoir`, {
    type: 'svg',
    margin: 0,
    errorCorrectionLevel: 'M',
    color: { dark: '#0B0E13', light: '#0000' },
  });

  return (
    <div className={styles.page}>
      {/* ------------------------------------------------------ En-tête */}
      <header className={styles.hero}>
        <span className="floor-marks" aria-hidden="true" />
        <div className={`shell ${styles.heroInner}`}>
          <div className={styles.heroText}>
            <p className="t-label">Rangvia · planche de référence · développement</p>
            <h1 className="t-hero">Le Rang en relief</h1>
            <p className="t-lead">
              Jetons, primitives et objets partagés par toutes les pages. Chaque état est montré ici :
              si un lot s&apos;en écarte, c&apos;est ici qu&apos;on le voit.
            </p>
            <nav aria-label="Sections de la planche" className={styles.toc}>
              <ol className="rail-list">
                {SECTIONS.map(([id, label], i) => (
                  <li key={id}>
                    <a href={`#${id}`} className={styles.tocLink}>
                      <span className={styles.tocNum}>{String(i + 1).padStart(2, '0')}</span>
                      {label}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          </div>
          <div className={styles.heroScene}>
            <FloorScene
              size="lg"
              intro
              spill
              slats={[
                { id: 'h0', state: 'serving' },
                { id: 'h1', state: 'wait' },
                { id: 'h2', state: 'wait' },
                { id: 'h3', state: 'self', label: 'Camille', hint: 'Votre place' },
                { id: 'h4', state: 'wait' },
                { id: 'h5', state: 'wait' },
              ]}
            />
          </div>
        </div>
      </header>

      <main className={`shell ${styles.main}`}>
        {/* -------------------------------------------------- 01 Jetons */}
        <Sec n={1} id="jetons" title="Trois profondeurs, un seul signal" note="Page en encre 900, sol des scènes en #07090D, surfaces levées en encre 800. Le vermillon ne sert qu'au « maintenant ».">
          <ul className={styles.swatches}>
            {SWATCHES.map(([token, name, value]) => (
              <li key={token} className={styles.swatch}>
                <span className={styles.chipColor} style={{ background: value }} />
                <span className={styles.swatchText}>
                  <code className={styles.code}>{token}</code>
                  <span className="t-small t-muted">{name}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className={styles.contrast}>
            <span className={styles.contrastInk}>Encre sur vermillon · 5,9:1</span>
            <span className={styles.contrastCobalt} data-accent="cobalt">Blanc sur cobalt · 5,3:1</span>
          </div>
        </Sec>

        {/* -------------------------------------------- 02 Typographie */}
        <Sec n={2} id="typo" title="Archivo, pilotée par ses axes" note="Chiffres toujours tabulaires. Après un titre, 20 px au moins (--gap-title), jamais de marge négative.">
          <div className={styles.typeStack}>
            <div className={styles.typeRow}>
              <span className={styles.typeTag}>.t-hero</span>
              <p className="t-hero">Vos clients n&apos;attendent plus debout.</p>
            </div>
            <div className={styles.typeRow}>
              <span className={styles.typeTag}>.t-lead</span>
              <p className="t-lead">
                Ils approchent leur téléphone de la plaque, prennent leur place dans la file et s&apos;en vont.
              </p>
            </div>
            <div className={styles.typeRow}>
              <span className={styles.typeTag}>.t-display</span>
              <p className="t-display">Rien à installer. Vraiment.</p>
            </div>
            <div className={styles.typeRow}>
              <span className={styles.typeTag}>.t-kicker + .t-story</span>
              <div>
                <p className="t-kicker">
                  <span className="t-kicker__num">01</span>Il arrive
                </p>
                <p className={`t-story ${styles.afterKicker}`}>Un geste pour prendre sa place.</p>
              </div>
            </div>
            <div className={styles.typeRow}>
              <span className={styles.typeTag}>.t-title</span>
              <p className="t-title">Merci pour votre visite</p>
            </div>
            <div className={styles.typeRow}>
              <span className={styles.typeTag}>.t-board</span>
              <p className="t-board">Absent · Décaler · Retirer</p>
            </div>
            <div className={styles.typeRow}>
              <span className={styles.typeTag}>.t-label · .t-body · .t-micro</span>
              <div className="stack g2">
                <p className="t-label">File ouverte</p>
                <p className="t-body">Un seul chiffre : combien de personnes sont devant lui.</p>
                <p className="t-micro t-muted">Sans compte client · Sans application · Sans SMS payant</p>
              </div>
            </div>
          </div>
        </Sec>

        {/* ------------------------------------------------ 03 Boutons */}
        <Sec n={3} id="boutons" title="Appuyer" note="Texte encre sur vermillon. Désactivé = fantôme en pointillés, plus jamais de pavé gris. La touche TERMINER est le seul objet de l'outil de travail.">
          <div className={styles.buttons}>
            <div className={styles.btnRow}>
              <button type="button" className="btn btn--signal">Ouvrir ma file</button>
              <button type="button" className="btn btn--outline-signal">Tester comme un client</button>
              <button type="button" className="btn btn--ghost">Voir la file avancer</button>
              <button type="button" className="btn btn--solid">Ajouter</button>
              <button type="button" className="btn btn--quiet">Annuler</button>
              <button type="button" className="btn btn--danger">Fermer</button>
            </div>
            <div className={styles.btnRow}>
              <button type="button" className="btn btn--signal" disabled>Rejoindre la file</button>
              <button type="button" className="btn btn--solid" disabled>Ajouter</button>
              <button type="button" className="btn btn--ghost" disabled>Décaler</button>
              <button type="button" className="btn btn--outline-signal" aria-disabled="true">Indisponible</button>
            </div>
            <div className={styles.btnRow}>
              <button type="button" className="btn btn--signal btn--sm">Petit</button>
              <button type="button" className="btn btn--signal">Normal</button>
              <button type="button" className="btn btn--signal btn--lg">Grand</button>
            </div>
            <div className={styles.keys}>
              <div className={styles.keyCell}>
                <span className="t-label">btn--key · appuyez</span>
                <button type="button" className="btn btn--signal btn--key btn--block">Terminer</button>
              </div>
              <div className={styles.keyCell}>
                <span className="t-label">btn--key · désactivé</span>
                <button type="button" className="btn btn--signal btn--key btn--block" disabled>Terminer</button>
              </div>
            </div>
            <div className={styles.heroBtn}>
              <span className="t-label">btn--hero · écran client</span>
              <button type="button" className="btn btn--signal btn--hero">Rejoindre la file</button>
            </div>
          </div>
        </Sec>

        {/* ------------------------------------------------- 04 Champs */}
        <Sec n={4} id="champs" title="Champs accrochés au rail" note="L'encoche passe au jade quand le champ est valide, au vermillon au focus. L'heure s'écrit en 24 h : « 09 h 00 ».">
          <div className={styles.fieldsGrid}>
            <form className="field-rail" action="#">
              <div className="field">
                <label htmlFor="d-name">Prénom (facultatif)</label>
                <input id="d-name" className="input" placeholder="Camille" defaultValue="" />
                <span className="hint">Pour vous appeler au comptoir</span>
              </div>
              <div className="field">
                <label htmlFor="d-mail">E-mail</label>
                <input id="d-mail" className="input" type="email" required defaultValue="owner@barberhouse.test" />
              </div>
              <div className="field">
                <label htmlFor="d-staff">Professionnel</label>
                <select id="d-staff" className="select" defaultValue="k">
                  <option value="">Le premier disponible</option>
                  <option value="k">Karim</option>
                  <option value="l">Léa</option>
                </select>
              </div>
            </form>
            <TimeDemo />
          </div>
        </Sec>

        {/* ------------------------------------------------- 05 Listes */}
        <Sec n={5} id="listes" title="Le tableau des départs" note="Des lignes accrochées à un rail, jamais une grille de cartes. .board s'emploie toujours avec .rail-list ; la ligne en cours porte .is-self.">
          <div className="stack g6">
            <SegDemo />
            <ol className="rail-list board">
              <li>
                <span className="t-board">Terminer</span>
                <span className="t-body t-muted">La file avance, les positions se recalculent, les clients sont prévenus.</span>
                <span className="chip">Au comptoir</span>
              </li>
              <li className="is-self">
                <span className={styles.boardKey}>
                  <span className="t-board">Pro</span>
                  <span className="chip chip--signal">Le plus choisi</span>
                </span>
                <span className="t-body t-muted">1 établissement · 3 professionnels · 2 plaques</span>
                <button type="button" className="btn btn--signal btn--sm">Essayer</button>
              </li>
              <li>
                {/* Clé sur plusieurs lignes dans la colonne de 17rem : des
                    virgules, qui finissent proprement une ligne, plutôt
                    qu'un « · » orphelin en bout de ligne. */}
                <span className="t-board">Absent, décaler, retirer</span>
                <span className="t-body t-muted">Quelqu&apos;un n&apos;est pas revenu ? Il recule, il attend de côté, ou il sort.</span>
                <button type="button" className="btn btn--ghost btn--sm">Essayer</button>
              </li>
            </ol>
            <div className={`kpi-band ${styles.kpiBand}`}>
              <div>
                <p className="t-label">Clients accueillis</p>
                <FlapText text="1 240" size="clamp(1.625rem, 1.3rem + 1vw, 2rem)" static label="1 240 clients accueillis" />
              </div>
              <div>
                <p className="t-label">Attente médiane</p>
                <FlapText text="12 min" size="clamp(1.625rem, 1.3rem + 1vw, 2rem)" static />
                <p className="hint">moyenne 14 min</p>
              </div>
              <div>
                <p className="t-label">Durée de prestation</p>
                <FlapText text="+ de 24 h" size="clamp(1.625rem, 1.3rem + 1vw, 2rem)" static />
              </div>
              <div>
                <p className="t-label">Taux de passage</p>
                <FlapText text="92 %" size="clamp(1.625rem, 1.3rem + 1vw, 2rem)" static />
              </div>
            </div>
            <ul className="rail-list">
              <li>Une seule application pour tous les commerces</li>
              <li aria-current="true">Notifications natives, avec retour haptique</li>
              <li>Fonctionne aussi en QR code, et sur Android</li>
            </ul>
          </div>
        </Sec>

        {/* -------------------------------------------------- 06 Volet */}
        <Sec n={6} id="volet" title="Le Volet v2 tombe en demi-cellules" note="La moitié haute part en 180 ms, la basse arrive en 240 ms après 180 ms. Jamais deux chiffres entiers superposés.">
          <FlapDemo />
        </Sec>

        {/* --------------------------------------------------- 07 Rang */}
        <Sec n={7} id="rang" title="Le Passage et l'avance d'un cran" note="La tête se relève comme un volet (rotateX 88°) puis s'efface ; 200 ms après, la file avance de la tête vers la queue. La latte qui passe garde sa place jusqu'à la fin : la mise en page ne bouge qu'une fois, après le mouvement. Relief = tranche dure de 2 px. Aucune vibration ici (haptics est faux par défaut).">
          <RangDemo />
        </Sec>

        {/* ---------------------------------------------------- 08 Sol */}
        <Sec n={8} id="sol" title="La file couchée au sol" note="FloorScene : rendu pur, compatible serveur. Une mise à jour des lattes anime l'avance par --pos. Tailles sm (140 px), md (320 px) et lg (hauteur du parent).">
          <div className={styles.floorGrid}>
            <figure className={styles.floorFig}>
              <FloorDemo />
              <figcaption className="t-label">md · interactive · spill</figcaption>
            </figure>
            <figure className={styles.floorFig}>
              <FloorScene
                size="md"
                slats={[
                  { id: 'k0', state: 'serving' },
                  { id: 'k1', state: 'kept', label: 'Camille', hint: 'Place gardée' },
                  { id: 'k2', state: 'wait' },
                  { id: 'k3', state: 'fallen' },
                  { id: 'k4', state: 'wait' },
                ]}
              />
              <figcaption className="t-label">serving · kept · wait · fallen</figcaption>
            </figure>
            <figure className={styles.floorFig}>
              <FloorScene
                size="md"
                turn={-6}
                seuil="Sortie"
                slats={[
                  { id: 'b0', state: 'back', label: 'Camille', hint: 'De retour' },
                  { id: 'b1', state: 'wait' },
                  { id: 'b2', state: 'ghost', label: 'Votre place' },
                  { id: 'b3', state: 'hidden' },
                ]}
              />
              <figcaption className="t-label">back · wait · ghost · hidden · turn -6</figcaption>
            </figure>
            <figure className={styles.floorFig}>
              <FloorScene
                size="md"
                tilt={40}
                turn={0}
                slats={[
                  { id: 't0', state: 'passed' },
                  { id: 't1', state: 'turn', label: 'Camille', hint: 'À vous' },
                  { id: 't2', state: 'wait' },
                  { id: 't3', state: 'wait' },
                ]}
              />
              <figcaption className="t-label">passed · turn · tilt 40</figcaption>
            </figure>
          </div>
          <div className={styles.floorSmall}>
            <figure className={styles.floorFig}>
              <FloorScene
                size="sm"
                slats={[
                  { id: 's0', state: 'serving' },
                  { id: 's1', state: 'wait' },
                  { id: 's2', state: 'wait' },
                  { id: 's3', state: 'self', label: 'Vous' },
                ]}
              />
              <figcaption className="t-label">sm · bandeau d&apos;authentification</figcaption>
            </figure>
            <figure className={styles.floorFig}>
              <FloorScene
                size="sm"
                positions={false}
                slats={[
                  { id: 'e0', state: 'wait' },
                  { id: 'e1', state: 'wait' },
                  { id: 'e2', state: 'ghost', label: '—' },
                ]}
              />
              <figcaption className="t-label">sm · seuil vide (404)</figcaption>
            </figure>
          </div>
        </Sec>

        {/* ------------------------------------------------- 09 Plaque */}
        <Sec n={9} id="plaque" title="Un carreau os de 12 px" note="Poses rest, front, flat et none. Tranches haute et droite, ombre de contact hors de l'arbre 3D, arcs NFC qui émettent une fois.">
          <div className={styles.plaques}>
            <figure className={styles.plaqueFig}>
              <Plaque width={170} pose="rest" />
              <figcaption className="t-label">rest · sans QR</figcaption>
            </figure>
            <figure className={styles.plaqueFig}>
              <Plaque width={170} pose="front" qr={<span dangerouslySetInnerHTML={{ __html: qr }} />} />
              <figcaption className="t-label">front · QR réel</figcaption>
            </figure>
            <figure className={styles.plaqueFig}>
              <Plaque width={170} pose="rest" interactive qr={<span dangerouslySetInnerHTML={{ __html: qr }} />} name="Barber House" />
              <figcaption className="t-label">rest · interactive · nom</figcaption>
            </figure>
            <figure className={styles.plaqueFig}>
              <Plaque width={170} pose="flat" qr={<span dangerouslySetInnerHTML={{ __html: qr }} />} />
              <figcaption className="t-label">flat · désactivée</figcaption>
            </figure>
          </div>
          <PlaqueDemo qr={qr} />
        </Sec>

        {/* -------------------------------------------------- 10 Seuil */}
        <Sec n={10} id="seuil" title="La sortie de la file" note="Deux poteaux et un linteau de 3 px. Tons signal, encre (sur vermillon) et os. Dessin unique au montage.">
          <div className={styles.seuils}>
            <Seuil className={styles.seuilBox}>
              <p className="t-section">Ton signal</p>
              <p className="t-small t-muted">Fin d&apos;onboarding, séquence d&apos;accueil.</p>
            </Seuil>
            <Seuil tone="bone" label="Sortie" className={styles.seuilBox}>
              <p className="t-section">Ton os</p>
              <p className="t-small t-muted">Libellé personnalisé.</p>
            </Seuil>
            <SeuilDemo />
          </div>
        </Sec>

        {/* ------------------------------------------------- 11 États */}
        <Sec n={11} id="etats" title="Chargement, pastilles, puces" note="Deux boucles seulement sur tout le site : l'anneau de .pip--live et la barre de sécurité du pass. Le squelette respire en opacité.">
          <div className={styles.states}>
            <div className={styles.stateCell}>
              <span className="t-label">.loading-slats</span>
              <div className="loading-slats" aria-hidden="true">
                <span /><span /><span /><span />
              </div>
            </div>
            <div className={styles.stateCell}>
              <span className="t-label">.skeleton</span>
              <div className="stack g2" aria-hidden="true">
                <span className={`skeleton ${styles.skelTitle}`} />
                <span className={`skeleton ${styles.skelLine}`} />
                <span className={`skeleton ${styles.skelBlock}`} />
              </div>
            </div>
            <div className={styles.stateCell}>
              <span className="t-label">Pastilles et puces</span>
              <div className="stack g3">
                <span className="row g2 t-small"><span className="pip pip--live" />File ouverte</span>
                <span className="row g2 t-small"><span className="pip pip--warn" />En pause</span>
                <span className="row g2 t-small"><span className="pip pip--off" />File fermée</span>
                <span className="row g2 wrap">
                  <span className="chip">Ardoise</span>
                  <span className="chip chip--signal">Le plus choisi</span>
                  <span className="chip chip--jade">Terminé</span>
                  <span className="chip chip--copper">Absent</span>
                  <span className="chip chip--brique">Retiré</span>
                </span>
              </div>
            </div>
            <div className={styles.stateCell}>
              <span className="t-label">Bandeaux</span>
              <div className="stack g2">
                <p className="banner banner--warn">Plus qu&apos;une personne devant vous. Commencez à revenir.</p>
                <p className="banner banner--error">La file vient de fermer.</p>
              </div>
            </div>
          </div>
        </Sec>

        {/* -------------------------------------------- 12 Révélation */}
        <Sec n={12} id="revelation" title="Entrer une seule fois" note="Seul un élément situé sous la fenêtre est armé puis révélé. Sans JavaScript et en mouvement réduit, tout est visible.">
          <ol className="rail-list board">
            {[
              ['Rise', 'Montée de 12 px et fondu.', 'rise'],
              ['Slat', 'Dépliage depuis le rail, comme une latte.', 'slat'],
              ['Fade', 'Fondu seul, pour les grands blocs.', 'fade'],
              ['Décalage', 'Chaque ligne attend 60 ms de plus que la précédente.', 'rise'],
            ].map(([k, v, variant], i) => (
              <Reveal as="li" key={k} index={i} variant={variant as 'rise' | 'slat' | 'fade'}>
                <span className="t-board">{k}</span>
                <span className="t-body t-muted">{v}</span>
                <code className={styles.code}>variant=&quot;{variant}&quot;</code>
              </Reveal>
            ))}
          </ol>
          <InViewDemo />
        </Sec>

        {/* ------------------------------------------ 13 Passes Wallet */}
        <Sec n={13} id="wallet" title="Le billet dans la poche" note="Aperçu. Billets d’événement seulement : le Wallet ne sert qu’aux drops, pour passer le contrôle. Mêmes mots aux mêmes moments sur Apple et Google. Aucun bouton d’ajout actif ici.">
          <WalletPreview />
        </Sec>
      </main>
    </div>
  );
}
