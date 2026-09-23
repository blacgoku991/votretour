/**
 * L'AFFICHE — la séquence figée, pour le mouvement réduit et sans
 * JavaScript.
 *
 * Écrite sur des ATTRIBUTS (data-story-*, data-slot) et sur les classes
 * globales (.slot3d__…), car les classes des modules CSS sont hachées.
 * Injectée deux fois par Story : sous @media (prefers-reduced-motion:
 * reduce) et dans <noscript><style>. (CSP : style-src 'unsafe-inline'.)
 *
 * La file est en relief, figée : seuil debout, flaque au sol, deux
 * personnes derrière la place libre (« Votre place ») ; la Plaque est
 * visible, le téléphone masqué. La scène n'est plus collante, et chaque
 * étape affiche sa vignette d'état.
 */
export const POSTER_CSS = [
  '[data-story-stage]{position:relative!important;top:auto!important}',
  '[data-story-world]{transform:translate3d(var(--poster-tx,0px),24px,0) rotateX(50deg) rotateZ(6deg) scale(1.04)!important}',
  '[data-story-seuil],[data-story-floor]{opacity:1!important}',
  '[data-story-rail]{transform:translateZ(.5px)!important}',
  '[data-story-spill]{opacity:.35!important}',
  "[data-slot='b1'] .slot3d__lift,[data-slot='b2'] .slot3d__lift{scale:1 1!important}",
  "[data-slot='b1'] :is(.slot3d__face,.slot3d__edge,.slot3d__notch),[data-slot='b2'] :is(.slot3d__face,.slot3d__edge,.slot3d__notch){opacity:.5!important}",
  '[data-story-plaque]{opacity:1!important}',
  '[data-story-phone]{opacity:0!important}',
  '[data-story-progress]{display:none!important}',
  '[data-story-hint]{display:none!important}',
  '[data-story-state]{display:flex!important}',
  '[data-story-step]{min-height:0!important}',
  // Ordinateur : la scène n'occupe que la hauteur du héros ; les six étapes,
  // lues d'un bloc, s'étalent sur deux colonnes (plus de rail de lecture).
  '@media (min-width:1024px){' +
    '[data-story-stage]{grid-row:1!important}' +
    '[data-story-steps]{grid-column:1/-1!important;display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr));column-gap:96px;padding:24px 40px 96px 0!important}' +
    '[data-story-steps]::before,[data-story-step] p::before,[data-story-step] p::after{display:none!important}' +
    '[data-story-step]{padding-block:40px!important;align-items:flex-start!important}' +
  '}',
].join('');
