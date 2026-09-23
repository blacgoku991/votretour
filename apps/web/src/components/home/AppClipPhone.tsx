import { FlapNumber } from '@/components/FlapNumber';
import { Reveal } from '@/components/motion/Reveal';
import styles from './AppClipPhone.module.css';

/**
 * LE TÉLÉPHONE APP CLIP — objet CSS, contenu réel.
 *
 * L'écran montre ce que voit vraiment le client : l'en-tête de
 * l'établissement et le volet (atténués), et par-dessus la fiche App Clip
 * que propose iOS quand on approche l'iPhone de la plaque. Le texte reste
 * à plat dans l'écran (2D) ; seul l'objet tourne, au défilement
 * (animation-timeline: view(), avec une pose fixe en repli).
 *
 * Rendu serveur ; seule la fiche passe par <Reveal> (elle monte une fois).
 */
export function AppClipPhone(): React.JSX.Element {
  return (
    <div className={styles.stage} aria-hidden="true">
      <span className={styles.shadow} />
      <div className={styles.phone}>
        <span className={styles.edge} />
        <div className={styles.screen}>
          <span className={styles.island} />
          <div className={styles.behind}>
            <div className={styles.head}>
              <span className={styles.logo}>BH</span>
              <span className={styles.headText}>
                <span className={styles.place}>Barber House</span>
                <span className={styles.city}>Paris 11ᵉ</span>
              </span>
            </div>
            <div className={styles.count}>
              <FlapNumber static value={3} size="4.25rem" label="3 personnes dans la file" />
              <span className={`t-label ${styles.countLabel}`}>personnes dans la file</span>
            </div>
            <div className={styles.rang}>
              <span className={styles.slat} data-k="serving" />
              <span className={styles.slat} />
              <span className={styles.slat} />
              <span className={`${styles.slat} ${styles.ghost}`} />
            </div>
          </div>
          {/* L'élément observé reste en place (sinon, rogné par l'écran, il
              ne serait jamais « vu ») : c'est la fiche, dedans, qui monte. */}
          <Reveal variant="rise" threshold={0.5} className={styles.sheet}>
            <span className={styles.sheetCard}>
              <span className={styles.sheetBand}>
                <span className={styles.sheetIcon}>
                  <span />
                </span>
              </span>
              <span className={styles.sheetBody}>
                <span className={styles.sheetText}>
                  <span className={styles.sheetTitle}>Barber House</span>
                  <span className={styles.sheetSub}>Rejoindre la file · Paris 11ᵉ</span>
                </span>
                <span className={styles.open}>Ouvrir</span>
              </span>
            </span>
          </Reveal>
        </div>
      </div>
    </div>
  );
}
