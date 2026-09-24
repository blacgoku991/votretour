/**
 * L'APERÇU EN BOUCLE — quand a-t-on le droit de le lancer tout seul ?
 *
 * Règle de [SEO § 10.6] : rien n'est téléchargé avant un geste du
 * visiteur, SAUF un court aperçu muet, et seulement si toutes ces
 * conditions sont réunies :
 *  - le montage en a produit un (`files.teaser`) ;
 *  - le visiteur n'a pas demandé à réduire les animations ;
 *  - le lecteur est réellement à l'écran (au moins à moitié) ;
 *  - le navigateur n'a pas activé l'économie de données (`saveData`) ;
 *  - la connexion n'est pas une 2G (`effectiveType` « 2g » ou « slow-2g »).
 *
 * Dans le doute (API absente, observateur de visibilité indisponible), on
 * ne lance rien : l'affiche et le bouton suffisent. Fonction pure, testée
 * dans demo-video.test.ts.
 */

export interface PreviewContext {
  hasTeaser: boolean;
  reducedMotion: boolean;
  visible: boolean;
  saveData: boolean;
  effectiveType: string | null;
}

export function previewAllowed(ctx: PreviewContext): boolean {
  if (!ctx.hasTeaser || ctx.reducedMotion || !ctx.visible || ctx.saveData) return false;
  return !/(^|-)2g$/i.test(ctx.effectiveType ?? '');
}

/** Ce que dit `navigator.connection` (API facultative, absente de Safari et de Firefox). */
export interface ConnectionHints {
  saveData: boolean;
  effectiveType: string | null;
}

export function readConnection(nav: unknown): ConnectionHints {
  const connection =
    typeof nav === 'object' && nav !== null && 'connection' in nav
      ? (nav as { connection?: { saveData?: unknown; effectiveType?: unknown } }).connection
      : undefined;
  return {
    saveData: connection?.saveData === true,
    effectiveType: typeof connection?.effectiveType === 'string' ? connection.effectiveType : null,
  };
}
