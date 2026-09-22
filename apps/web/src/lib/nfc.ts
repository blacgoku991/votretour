/**
 * Programmation des tags NFC depuis le navigateur — logique pure.
 *
 * Tout ce qui est testable sans navigateur vit ici ; le hook React
 * n'orchestre que les appels à l'API Web NFC.
 *
 * LIMITE À CONNAÎTRE, ET QUI N'EST PAS CONTOURNABLE
 * -------------------------------------------------
 * Web NFC n'existe que sur Android, dans les navigateurs Chromium :
 * Chrome 89+, Edge, Opera Mobile 64+, Samsung Internet 15+. WebKit ne
 * l'implémente pas, donc AUCUN navigateur sur iPhone ou iPad ne peut
 * écrire un tag — pas même Chrome iOS, qui n'est qu'une coque autour de
 * WebKit. Sur iPhone, programmer un tag passe forcément par une
 * application native (l'App Clip ne peut pas le faire non plus : l'écriture
 * NFC demande la capacité Core NFC d'une application complète).
 *
 * Conséquence produit : on ne cache pas le bouton sur iPhone, on explique
 * pourquoi il ne peut pas marcher et on donne le chemin qui marche.
 */

export type NfcSupport = 'supported' | 'unsupported';

/**
 * Détection de disponibilité. À n'appeler que dans le navigateur : le
 * rendu serveur ne peut pas savoir, et deviner casserait l'hydratation.
 */
export function detectNfcSupport(): NfcSupport {
  if (typeof window === 'undefined') return 'unsupported';
  return 'NDEFReader' in window ? 'supported' : 'unsupported';
}

/** Pourquoi ça ne marche pas ici, dit à quelqu'un qui n'est pas développeur. */
export function explainNoNfc(userAgent: string): {
  title: string;
  detail: string;
} {
  const ua = userAgent.toLowerCase();
  const isApple = /iphone|ipad|ipod/.test(ua)
    // iPadOS se fait passer pour un Mac ; le tactile le trahit.
    || (/macintosh/.test(ua) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1);

  if (isApple) {
    return {
      title: 'Un iPhone ne peut pas écrire un tag depuis le navigateur',
      detail:
        "Apple n'autorise aucun navigateur à écrire un tag NFC sur iPhone ou iPad — "
        + "ni Safari, ni Chrome, qui utilise le même moteur. Utilisez un téléphone "
        + "Android pour programmer vos plaques, ou l'application gratuite NFC Tools "
        + "sur l'iPhone : la marche à suivre est juste en dessous.",
    };
  }

  const isAndroid = /android/.test(ua);
  if (isAndroid) {
    return {
      title: 'Ce navigateur Android ne sait pas écrire les tags',
      detail:
        "L'écriture NFC demande Chrome, Edge, Opera ou Samsung Internet. Ouvrez "
        + 'cette page dans Chrome, et vérifiez que le NFC est activé dans les '
        + 'réglages du téléphone.',
    };
  }

  return {
    title: 'Un ordinateur ne peut pas écrire un tag NFC',
    detail:
      "L'écriture NFC depuis le navigateur n'existe que sur Android. Ouvrez cette "
      + 'page sur un téléphone Android avec Chrome — le lien de la plaque est juste '
      + 'en dessous, ou scannez son QR code.',
  };
}

/**
 * Messages d'erreur de l'API Web NFC, traduits.
 *
 * Les noms sont ceux de la spécification : NotAllowedError,
 * NotSupportedError, NotReadableError, NetworkError, AbortError.
 */
export function describeNfcError(error: unknown): string {
  const name = error instanceof Error ? error.name : String(error);
  switch (name) {
    case 'NotAllowedError':
      return "Autorisation refusée. Votre navigateur doit demander l'accès au NFC : "
        + 'réessayez et acceptez la demande.';
    case 'NotSupportedError':
      return "Ce téléphone n'a pas de puce NFC compatible, ou la plaque est trop "
        + "petite pour contenir l'adresse. Un tag NTAG213 ou plus grand convient.";
    case 'NotReadableError':
      return "Le navigateur n'accède pas à la puce NFC. Activez le NFC dans les "
        + 'réglages du téléphone, puis réessayez.';
    case 'NetworkError':
      return 'La plaque a été retirée trop tôt. Gardez-la contre le dos du téléphone '
        + "jusqu'au message de confirmation.";
    case 'AbortError':
      return 'Programmation interrompue.';
    case 'TypeError':
      return "L'adresse à écrire est invalide.";
    default:
      return `La programmation a échoué (${name}). Réessayez en gardant la plaque bien à plat.`;
  }
}

/**
 * Le message NDEF à écrire : un seul enregistrement URI.
 *
 * On exige https, la seule chose qu'une plaque posée dans un commerce
 * devrait porter — sauf sur localhost, que le navigateur considère
 * lui-même comme un contexte sécurisé et où Web NFC fonctionne donc.
 * C'est ce qui permet d'essayer la programmation en développement.
 */
export function buildUrlMessage(url: string): { records: { recordType: 'url'; data: string }[] } {
  const trimmed = url.trim();
  if (/\s/.test(trimmed)) throw new TypeError('URL de plaque invalide');

  let parsed: URL;
  try { parsed = new URL(trimmed); } catch { throw new TypeError('URL de plaque invalide'); }

  const isLocal = parsed.hostname === 'localhost'
    || parsed.hostname === '127.0.0.1'
    || parsed.hostname === '[::1]';
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLocal)) {
    throw new TypeError('URL de plaque invalide');
  }
  return { records: [{ recordType: 'url', data: trimmed }] };
}

/**
 * Extrait l'URL d'un message NDEF relu, pour la vérification.
 * Renvoie null si le tag ne porte pas d'enregistrement URI lisible.
 */
export function readUrlFromRecords(
  records: readonly { recordType: string; data: DataView | null }[],
  decode: (view: DataView) => string = (view) =>
    new TextDecoder().decode(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength)),
): string | null {
  for (const record of records) {
    if (record.recordType !== 'url' && record.recordType !== 'absolute-url') continue;
    if (!record.data) continue;
    try {
      const value = decode(record.data).trim();
      if (value) return value;
    } catch {
      // Enregistrement illisible : on passe au suivant.
    }
  }
  return null;
}

/**
 * Deux URL désignent-elles la même plaque ?
 *
 * On compare l'origine et le chemin, sans se laisser piéger par une
 * barre oblique finale ou une casse d'hôte différente : certains tags
 * relus renvoient l'URL normalisée par la puce.
 */
export function samePlateUrl(written: string, readBack: string): boolean {
  try {
    const a = new URL(written);
    const b = new URL(readBack);
    const path = (u: URL) => u.pathname.replace(/\/+$/, '').toLowerCase();
    return a.origin.toLowerCase() === b.origin.toLowerCase() && path(a) === path(b);
  } catch {
    return written.trim() === readBack.trim();
  }
}
