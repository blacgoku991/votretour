import { describe, expect, it } from 'vitest';
import {
  displayRegistration,
  formatRegistrationInput,
  maskRegistration,
  maskedTail,
  normalizeRegistration,
  parseRegistration,
  registrationMatches,
} from '@/lib/profiles/registration';
import { registrationKeyOf } from '@/lib/profiles/details';

/**
 * Immatriculations : la clé de recherche est normalisée comme en SQL, et
 * hors du poste du pro, seule la forme masquée circule.
 */

describe('normalisation', () => {
  it('garde lettres et chiffres, en majuscules', () => {
    expect(normalizeRegistration('ab 123-cd')).toBe('AB123CD');
    expect(normalizeRegistration(' Ab.123_cD ')).toBe('AB123CD');
    expect(normalizeRegistration('')).toBe('');
    expect(normalizeRegistration(null)).toBe('');
  });

  it('fait tomber les accents avec leur lettre de base', () => {
    expect(normalizeRegistration('éb-123-çd')).toBe('EB123CD');
  });
});

describe('SIV (depuis 2009)', () => {
  it('valide et met en forme AB-123-CD', () => {
    const r = parseRegistration('ab123cd');
    expect(r).toEqual({ ok: true, format: 'siv', key: 'AB123CD', display: 'AB-123-CD', warnings: [] });
  });

  it('refuse les lettres I, O et U, avec une explication', () => {
    for (const raw of ['IB-123-CD', 'AO-123-CD', 'AB-123-CU']) {
      const r = parseRegistration(raw);
      expect(r.ok, raw).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/I, O et U/);
    }
  });

  it('avertit sans refuser les combinaisons douteuses (SS, 000)', () => {
    const ss = parseRegistration('SS-123-AB');
    expect(ss.ok).toBe(true);
    if (ss.ok) expect(ss.warnings.length).toBe(1);
    const zero = parseRegistration('AB-000-CD');
    expect(zero.ok).toBe(true);
    if (zero.ok) expect(zero.warnings[0]).toMatch(/000/);
  });
});

describe('FNI (ancien format)', () => {
  it('reconnaît chiffres, lettres et département', () => {
    const r = parseRegistration('1234ab75');
    expect(r).toMatchObject({ ok: true, format: 'fni', key: '1234AB75', display: '1234 AB 75' });
  });

  it('accepte la Corse et les outre-mer', () => {
    expect(parseRegistration('56 XZ 2A')).toMatchObject({ ok: true, display: '56 XZ 2A' });
    expect(parseRegistration('123 AB 2B')).toMatchObject({ ok: true, display: '123 AB 2B' });
    expect(parseRegistration('123 AB 971')).toMatchObject({ ok: true, display: '123 AB 971' });
    expect(parseRegistration('123 AB 976')).toMatchObject({ ok: true, display: '123 AB 976' });
  });

  it('refuse un département inexistant', () => {
    expect(parseRegistration('123 AB 96').ok).toBe(false);
    expect(parseRegistration('123 AB 977').ok).toBe(false);
    expect(parseRegistration('123 AB 00').ok).toBe(false);
  });
});

describe('plaque étrangère', () => {
  it('accepte 2 à 12 caractères, sans contrôle de forme', () => {
    expect(parseRegistration('M-AB 1234', 'other')).toMatchObject({ ok: true, format: 'other', key: 'MAB1234', display: 'M-AB 1234' });
    expect(parseRegistration('A', 'other').ok).toBe(false);
    expect(parseRegistration('ABCDEFGHIJKLM', 'other').ok).toBe(false);
  });

  it('refuse une plaque vide en France', () => {
    expect(parseRegistration('  ').ok).toBe(false);
  });
});

describe('mise en forme pendant la frappe', () => {
  it('pose les tirets du SIV au fil des touches, jamais en fin de saisie', () => {
    expect(formatRegistrationInput('a')).toBe('A');
    expect(formatRegistrationInput('ab')).toBe('AB');
    expect(formatRegistrationInput('ab1')).toBe('AB-1');
    expect(formatRegistrationInput('ab123')).toBe('AB-123');
    expect(formatRegistrationInput('ab123c')).toBe('AB-123-C');
    expect(formatRegistrationInput('ab123cd')).toBe('AB-123-CD');
    expect(formatRegistrationInput('AB-123-CDE')).toBe('AB-123-CD');
  });

  it('suit l’ancien format quand la saisie commence par un chiffre', () => {
    expect(formatRegistrationInput('12')).toBe('12');
    expect(formatRegistrationInput('1234ab')).toBe('1234 AB');
    expect(formatRegistrationInput('1234ab75')).toBe('1234 AB 75');
  });

  it('forme d’affichage stable, quelle que soit la saisie', () => {
    expect(displayRegistration('ab 123 cd')).toBe('AB-123-CD');
    expect(displayRegistration('m-ab 1234', 'other')).toBe('M-AB 1234');
  });
});

describe('masquage', () => {
  it('ne laisse lisibles que les trois derniers caractères, séparateurs gardés', () => {
    expect(maskRegistration('AB-123-CD')).toBe('••-••3-CD');
    expect(maskRegistration('1234 AB 75')).toBe('•••• •B 75');
  });

  it('masque toujours au moins un caractère d’une plaque courte', () => {
    expect(maskRegistration('AB12')).toBe('•B12');
    expect(maskRegistration('A12')).toBe('•12');
    expect(maskRegistration('A1')).toBe('•1');
    expect(maskRegistration('A')).toBe('•');
  });

  it('ne contient jamais la clé complète', () => {
    for (const reg of ['AB-123-CD', '1234 AB 75', 'M-AB 1234']) {
      const masked = maskRegistration(reg);
      expect(normalizeRegistration(masked)).not.toBe(normalizeRegistration(reg));
      expect(masked).not.toContain(reg);
    }
  });

  it('donne la fin lisible aux lecteurs d’écran', () => {
    expect(maskedTail('••-••3-CD')).toBe('3-CD');
    expect(maskedTail('•••• •B 75')).toBe('B 75');
  });
});

describe('recherche et clé dérivée', () => {
  it('trouve une immatriculation par morceau, sans tenir compte des séparateurs', () => {
    expect(registrationMatches('ab 123-cd', 'AB123CD')).toBe(true);
    expect(registrationMatches('123', 'AB123CD')).toBe(true);
    expect(registrationMatches('124', 'AB123CD')).toBe(false);
    expect(registrationMatches('', 'AB123CD')).toBe(false);
    expect(registrationMatches('AB', null)).toBe(false);
  });

  it('dérive registration_key des détails', () => {
    expect(registrationKeyOf({ registration: 'AB-123-CD' })).toBe('AB123CD');
    expect(registrationKeyOf({})).toBeNull();
    expect(registrationKeyOf(null)).toBeNull();
  });
});
