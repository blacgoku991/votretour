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
