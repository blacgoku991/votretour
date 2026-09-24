import { describe, it, expect, afterEach } from 'vitest';
import { hasLegalNotice, legalInfo, walletPrivacyNotice } from '../src/lib/legal';

/**
 * Les mentions légales ne se publient jamais à trous : tant que
 * l'éditeur n'est pas identifié en entier, la page n'existe pas.
 */

const KEYS = ['LEGAL_COMPANY', 'LEGAL_ADDRESS', 'LEGAL_SIRET', 'LEGAL_EMAIL', 'LEGAL_HOST_NAME', 'LEGAL_HOST_ADDRESS'];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('mentions légales', () => {
  it('rien de renseigné : pas de page', () => {
    for (const k of KEYS) delete process.env[k];
    expect(hasLegalNotice()).toBe(false);
    expect(legalInfo().company).toBeNull();
  });

  it('une seule information manquante suffit à ne rien publier', () => {
    for (const k of KEYS) process.env[k] = 'x';
    process.env.LEGAL_SIRET = '   ';
    expect(hasLegalNotice()).toBe(false);
  });

  it('éditeur complet : la page existe', () => {
    for (const k of KEYS) process.env[k] = 'valeur';
    expect(hasLegalNotice()).toBe(true);
  });
});

/**
 * Politique de confidentialité : paragraphe Apple Wallet / Google Wallet
 * (§ 12 du plan Wallet). Il n'existe que si un fournisseur est configuré,
 * ne parle que des billets d'événement, et ne cite que les fournisseurs
 * réellement branchés.
 */
describe('confidentialité : billets d’événement dans Wallet', () => {
  const all = (n: ReturnType<typeof walletPrivacyNotice>) => (n ? [n.title, ...n.paragraphs].join('\n') : '');

  it('aucun fournisseur configuré : pas de paragraphe', () => {
    expect(walletPrivacyNotice({ apple: false, google: false })).toBeNull();
  });

  it('les deux : finalité, données, destinataires, durée, base', () => {
    const notice = walletPrivacyNotice({ apple: true, google: true });
    const text = all(notice);
    expect(notice?.id).toBe('wallet');
    expect(notice?.title).toBe('Billets d’événement dans Apple Wallet et Google Wallet');
    // Billets d'événement seulement, jamais la file classique.
    expect(text).toContain('ne concerne que les billets d’événement');
    // Minimisation : ni prénom, ni téléphone, ni e-mail dans le pass.
    expect(text).toContain('ni votre prénom, ni votre numéro de téléphone, ni votre adresse e-mail');
    // Données techniques Apple, pseudonymes.
    expect(text).toContain('identifiant technique de l’appareil et le jeton de notification');
    // Destinataires.
    expect(text).toContain('Google Ireland Limited');
    expect(text).toContain('nous ne recevons jamais votre adresse e-mail');
    // Durée : un délai tenu même quand la purge passe tard (cron horaire,
    // file d'envoi, filet de 2 h), contenu Google effacé faute de suppression.
    expect(text).toContain('dans les 48 heures qui suivent la fin de votre passage');
    expect(text).toContain('en pratique au bout d’environ 24 heures');
    expect(text).not.toContain('au plus tard 24 heures');
    expect(text).toContain('7 jours plus tard');
    expect(text).toContain('Google ne permet pas de supprimer un billet à distance');
    // Base : geste volontaire du client, confirmé dans la feuille du système.
    expect(text).toContain('vous touchez le badge d’ajout, puis vous confirmez');
    // Typographie française.
    expect(text).not.toMatch(/'/);
  });

  it('Apple seul : Google n’est pas cité', () => {
    const text = all(walletPrivacyNotice({ apple: true, google: false }));
    expect(text).toContain('Apple Wallet');
    expect(text).not.toContain('Google');
  });

  it('Google seul : Apple n’est pas cité', () => {
    const text = all(walletPrivacyNotice({ apple: false, google: true }));
    expect(text).toContain('Google Ireland Limited');
    expect(text).not.toContain('Apple');
  });
});
