/**
 * Mouvement — fonctions pures, sans DOM, testées (tests/motion.test.ts).
 *
 * Elles servent au moteur de défilement de l'accueil : la géométrie de la
 * caméra est une fonction pure de la position de défilement. Aucune
 * dépendance, aucun état : même entrée, même sortie, et jamais de NaN.
 */

/** Borne v entre min et max (0 et 1 par défaut). */
export const clamp = (v: number, min = 0, max = 1): number => Math.min(max, Math.max(min, v));

/** Interpolation linéaire de a vers b selon k. */
export const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;

/** 0 avant a, 1 après b, linéaire entre les deux. Renvoie 1 si a === b et v >= b. */
export function progress(a: number, b: number, v: number): number {
  if (!Number.isFinite(v)) return v > 0 ? 1 : 0;
  if (b === a) return v >= b ? 1 : 0;
  return clamp((v - a) / (b - a));
}

/**
 * Courbe de Bézier cubique CSS (`cubic-bezier(x1, y1, x2, y2)`).
 * On inverse x(t) par Newton-Raphson (8 itérations), avec repli par
 * dichotomie quand la pente est trop faible ou que Newton n'a pas convergé.
 * f(0) = 0 et f(1) = 1 exactement ; monotone dès que x1 et x2 sont dans [0, 1].
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const ax1 = clamp(x1);
  const ax2 = clamp(x2);
  // Coefficients polynomiaux : B(t) = ((a·t + b)·t + c)·t
  const cx = 3 * ax1;
  const bx = 3 * (ax2 - ax1) - cx;
  const axx = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;

  const sampleX = (t: number) => ((axx * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const slopeX = (t: number) => (3 * axx * t + 2 * bx) * t + cx;

  const solveT = (x: number): number => {
    // Newton-Raphson
    let t = x;
    for (let i = 0; i < 8; i += 1) {
      const err = sampleX(t) - x;
      if (Math.abs(err) < 1e-7) return t;
      const d = slopeX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    // Repli : dichotomie, toujours convergente puisque x(t) est monotone
    let lo = 0;
    let hi = 1;
    t = x;
    for (let i = 0; i < 40; i += 1) {
      const v = sampleX(t);
      if (Math.abs(v - x) < 1e-7) return t;
      if (v < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return t;
  };

  return (x: number): number => {
    if (!(x > 0)) return 0; // couvre aussi NaN
    if (x >= 1) return 1;
    return sampleY(solveT(x));
  };
}

/** Courbe signature des lattes (--ease-slat). */
export const easeSlat: (x: number) => number = cubicBezier(0.22, 0.92, 0.2, 1);
/** Courbe de la caméra de l'accueil (--ease-camera). */
export const easeCamera: (x: number) => number = cubicBezier(0.45, 0.05, 0.2, 1);
/** Départ lent, sortie franche (--ease-in). */
export const easeIn: (x: number) => number = cubicBezier(0.55, 0, 1, 0.45);

/**
 * Interpolation par morceaux d'un scalaire sur des clés [t, valeur] triées.
 * Avant la première clé : sa valeur ; après la dernière : sa valeur ; sur
 * une clé : sa valeur exacte. La courbe `ease` est appliquée à chaque segment.
 */
export function keyframes(
  t: number,
  keys: ReadonlyArray<readonly [number, number]>,
  ease: (x: number) => number = (x) => x,
): number {
  const first = keys[0];
  if (!first) return 0;
  if (!(t > first[0])) return first[1]; // t <= première clé, ou NaN
  const last = keys[keys.length - 1] as readonly [number, number];
  if (t >= last[0]) return last[1];
  for (let i = 1; i < keys.length; i += 1) {
    const b = keys[i] as readonly [number, number];
    if (t < b[0]) {
      const a = keys[i - 1] as readonly [number, number];
      if (t === a[0]) return a[1];
      return lerp(a[1], b[1], ease(progress(a[0], b[0], t)));
    }
    if (t === b[0]) return b[1];
  }
  return last[1];
}

/** Arrondi à 3 décimales (chaînes de transform stables). */
export const round3 = (v: number): number => Math.round(v * 1000) / 1000;
