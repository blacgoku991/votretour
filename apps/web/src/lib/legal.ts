import 'server-only';

/**
 * Informations légales de l'éditeur, lues dans l'environnement du
 * serveur À CHAQUE REQUÊTE : on les renseigne dans le .env du VPS, on
 * redémarre, et les pages légales se complètent, sans nouvelle version.
 *
 * Rien n'est inventé : tant qu'une information manque, elle ne s'affiche
 * pas, et la page « Mentions légales » n'existe pas (404, lien absent du
 * pied de page).
 */

export interface LegalInfo {
  /** Raison sociale, ou nom et prénom de l'entrepreneur individuel. */
  company: string | null;
  /** Forme juridique : « Entrepreneur individuel », « SAS au capital de 1 000 € »… */
  form: string | null;
  address: string | null;
  siret: string | null;
  /** TVA intracommunautaire, si l'entreprise y est assujettie. */
  vat: string | null;
  /** Directeur ou directrice de la publication. */
  director: string | null;
  email: string | null;
  phone: string | null;
  hostName: string | null;
  hostAddress: string | null;
  /** Date de dernière mise à jour des documents (texte libre : « 1er octobre 2026 »). */
  updatedAt: string | null;
}

const read = (name: string): string | null => {
  const value = process.env[name]?.trim();
  return value ? value : null;
};

export function legalInfo(): LegalInfo {
  return {
    company: read('LEGAL_COMPANY'),
    form: read('LEGAL_FORM'),
    address: read('LEGAL_ADDRESS'),
    siret: read('LEGAL_SIRET'),
    vat: read('LEGAL_VAT'),
    director: read('LEGAL_DIRECTOR'),
    email: read('LEGAL_EMAIL'),
    phone: read('LEGAL_PHONE'),
    hostName: read('LEGAL_HOST_NAME'),
    hostAddress: read('LEGAL_HOST_ADDRESS'),
    updatedAt: read('LEGAL_UPDATED_AT'),
  };
}

/**
 * La page « Mentions légales » ne se publie que complète : éditeur
 * identifié (nom, adresse, SIRET), contact, hébergeur (loi pour la
 * confiance dans l'économie numérique, art. 6 III).
 */
export function hasLegalNotice(info: LegalInfo = legalInfo()): boolean {
  return Boolean(info.company && info.address && info.siret && info.email && info.hostName && info.hostAddress);
}

/* ====================================================================
   Politique de confidentialité : Apple Wallet et Google Wallet
   ==================================================================== */

export interface WalletPrivacyNotice {
  /** Ancre du titre dans la politique de confidentialité. */
  id: 'wallet';
  title: string;
  paragraphs: string[];
}

/**
 * Paragraphe Wallet de la politique (§ 12 du plan Wallet), rédigé
 * seulement pour les fournisseurs RÉELLEMENT configurés sur ce serveur
 * (integrationStatus) : tant qu'aucun ne l'est, le Wallet est invisible
 * dans le produit et la politique n'en parle pas. Un seul configuré :
 * l'autre n'est pas cité (on ne nomme pas un destinataire qui ne reçoit
 * rien).
 *
 * Décision du propriétaire : le Wallet ne sert qu'aux billets
 * d'événement (drops), pour le contrôle d'entrée ; le texte le dit.
 */
export function walletPrivacyNotice(configured: { apple: boolean; google: boolean }): WalletPrivacyNotice | null {
  const { apple, google } = configured;
  if (!apple && !google) return null;

  const names = apple && google ? 'Apple Wallet ou Google Wallet' : apple ? 'Apple Wallet' : 'Google Wallet';
  const paragraphs: string[] = [
    `Lors d’un événement ou d’un drop, vous pouvez ajouter votre billet à ${names} pour le présenter au contrôle d’entrée depuis votre téléphone. Cette possibilité ne concerne que les billets d’événement : une file d’attente classique ne la propose pas. Elle est facultative et vient de vous seul : vous touchez le badge d’ajout, puis vous confirmez dans la fenêtre de votre téléphone. Le billet se met ensuite à jour tout seul (attente, ouverture de votre vague, accès utilisé ou expiré).`,
    'Le billet ne contient ni votre prénom, ni votre numéro de téléphone, ni votre adresse e-mail : seulement le nom et le logo du commerce, le nom de l’événement, votre numéro de billet et votre vague, votre position, les heures utiles et, pendant votre accès, le QR d’entrée. De notre côté, nous conservons le lien entre ce billet et votre place dans la file, et aucune adresse IP.',
  ];
  if (apple) {
    paragraphs.push(
      'Apple Wallet : pour mettre le billet à jour, nous conservons l’identifiant technique de l’appareil et le jeton de notification qu’Apple nous transmet. Ce sont des identifiants pseudonymes, qui ne disent pas qui vous êtes. Apple achemine les mises à jour jusqu’à votre téléphone.',
    );
  }
  if (google) {
    paragraphs.push(
      'Google Wallet : Google Ireland Limited reçoit le contenu du billet et le traite selon sa propre politique de confidentialité. Le billet est rattaché à votre compte Google, chez Google : nous ne recevons jamais votre adresse e-mail.',
    );
  }
  const duration =
    'Durée : ces informations de mise à jour sont effacées au plus tard 24 heures après la fin de votre passage (billet utilisé, accès expiré ou événement terminé) ; les dernières traces techniques disparaissent 7 jours plus tard.';
  paragraphs.push(
    google
      ? `${duration} Google ne permet pas de supprimer un billet à distance : nous en effaçons le contenu. Vous pouvez à tout moment supprimer le billet de votre téléphone, sans perdre votre place.`
      : `${duration} Vous pouvez à tout moment supprimer le billet de votre téléphone, sans perdre votre place.`,
  );

  return {
    id: 'wallet',
    title: `Billets d’événement dans ${apple && google ? 'Apple Wallet et Google Wallet' : names}`,
    paragraphs,
  };
}
