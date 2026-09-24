// =====================================================================
// Rangvia — gestes filmés : toucher visible, saisie, défilement
// ---------------------------------------------------------------------
// SURCOUCHE DE TOURNAGE. Le téléphone et la tablette du pro sont des
// écrans tactiles : sans repère, on verrait l'interface réagir sans
// savoir où le doigt s'est posé. `TOUCH_OVERLAY` injecte, dans chaque
// document filmé, un anneau qui apparaît au point touché puis s'efface.
//
// Il ne modifie PAS l'interface : un hôte `position: fixed` sans
// interaction (`pointer-events: none`), isolé dans une racine fantôme
// fermée (aucun style n'entre ni ne sort), ajouté seulement au premier
// toucher, donc après l'hydratation de React. Il n'anime que `transform`
// et `opacity`.
// =====================================================================

/** Script injecté par `context.addInitScript` (s'exécute dans la page). */
export const TOUCH_OVERLAY = `(() => {
  let root = null;
  function mount() {
    if (root) return root;
    const host = document.createElement('div');
    host.setAttribute('data-demo-overlay', 'toucher');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;contain:strict;';
    root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = [
      '.at{position:absolute;left:0;top:0;width:0;height:0}',
      '.ring{position:absolute;left:-24px;top:-24px;width:48px;height:48px;border-radius:50%;',
      'box-sizing:border-box;border:2px solid rgba(250,249,246,.9);background:rgba(250,249,246,.18);',
      'box-shadow:0 0 0 1px rgba(5,7,10,.45),0 6px 18px rgba(5,7,10,.35);',
      'opacity:0;transform:scale(.5);',
      'transition:transform 170ms cubic-bezier(.16,1,.3,1),opacity 170ms ease-out}',
      '.on .ring{opacity:1;transform:scale(1)}',
      '.off .ring{opacity:0;transform:scale(1.4);',
      'transition:transform 460ms cubic-bezier(.16,1,.3,1),opacity 460ms ease-out}',
    ].join('');
    root.append(style);
    document.documentElement.append(host);
    return root;
  }
  const live = new Map();
  addEventListener('pointerdown', (e) => {
    const r = mount();
    const at = document.createElement('div');
    at.className = 'at';
    // Position posée une fois (non animée) ; seuls transform et opacity bougent.
    at.style.left = e.clientX + 'px';
    at.style.top = e.clientY + 'px';
    at.innerHTML = '<div class="ring"></div>';
    r.append(at);
    at.dataset.born = String(performance.now());
    requestAnimationFrame(() => at.classList.add('on'));
    live.set(e.pointerId, at);
  }, true);
  const release = (e) => {
    const at = live.get(e.pointerId);
    if (!at) return;
    live.delete(e.pointerId);
    // Visible au moins 180 ms, même pour un toucher bref.
    const wait = Math.max(0, 180 - (performance.now() - Number(at.dataset.born)));
    setTimeout(() => {
      at.classList.remove('on');
      at.classList.add('off');
      setTimeout(() => at.remove(), 520);
    }, wait);
  };
  addEventListener('pointerup', release, true);
  addEventListener('pointercancel', release, true);
})();`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Amène l'élément au centre de l'écran par un défilement doux (celui
 * qu'un doigt produirait), puis attend que la page soit immobile.
 */
export async function bringIntoView(locator) {
  await locator.waitFor({ state: 'visible' });
  const moved = await locator.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const margin = 24;
    const inView = box.top >= margin && box.bottom <= innerHeight - margin;
    if (inView) return false;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return true;
  });
  if (!moved) return;
  const page = locator.page();
  let last = -1;
  let still = 0;
  for (let i = 0; i < 60 && still < 4; i += 1) {
    await sleep(50);
    const y = await page.evaluate(() => scrollY);
    still = y === last ? still + 1 : 0;
    last = y;
  }
}

/** Touche un élément, comme un doigt : défilement si besoin, puis toucher. */
export async function tap(locator, { settle = 120 } = {}) {
  await bringIntoView(locator);
  await sleep(settle);
  await locator.tap();
}

/** Saisie au rythme d'une personne (environ 9 caractères par seconde). */
export async function type(locator, text) {
  await tap(locator);
  await locator.pressSequentially(text, { delay: 115 });
}
