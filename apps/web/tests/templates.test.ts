import { describe, expect, it } from 'vitest';
import { PROFILES, QUEUE_PROFILES } from '@/lib/profiles';
import {
  TEMPLATE_KEY_RE,
  TEMPLATE_LABEL_MAX,
  TEMPLATE_MAX_LENGTH,
  containsUrl,
  renderTemplate,
  typographie,
  validateTemplateBody,
} from '@/lib/profiles/templates';

/**
 * Un message du pro part sur l'écran verrouillé du client, sous le nom du
 * commerce : aucune adresse web, aucune variable inconnue, 180 caractères.
 */

describe('modèles par défaut', () => {
  it('chaque modèle du code passe ses propres contrôles', () => {
    for (const p of QUEUE_PROFILES) {
      for (const t of PROFILES[p].templates) {
        expect(TEMPLATE_KEY_RE.test(t.key), `${p}.${t.key}`).toBe(true);
        expect(t.label.length, `${p}.${t.key}`).toBeLessThanOrEqual(TEMPLATE_LABEL_MAX);
        const check = validateTemplateBody(t.body, p);
        expect(check.errors, `${p}.${t.key}`).toEqual([]);
        expect(t.body, `${p}.${t.key}`).not.toMatch(/\p{L}'\p{L}/u);
      }
    }
  });

  it('les clés sont uniques par profil', () => {
    for (const p of QUEUE_PROFILES) {
      const keys = PROFILES[p].templates.map((t) => t.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});

describe('variables', () => {
  it('liste blanche : une variable inconnue est refusée', () => {
    expect(validateTemplateBody('Bonjour {prenom}', 'vehicle').errors[0]).toMatch(/Variable inconnue : \{prenom\}/);
    expect(validateTemplateBody('Guichet : {guichet}', 'vehicle').ok).toBe(false);
    expect(validateTemplateBody('Guichet : {guichet}', 'desk').ok).toBe(true);
  });

  it('liste les variables employées, sans doublon', () => {
    const r = validateTemplateBody('{heure_fermeture}, {heure_ouverture} et {heure_fermeture}', 'vehicle');
    expect(r.variables).toEqual(['heure_fermeture', 'heure_ouverture']);
  });

  it('refuse une accolade orpheline', () => {
    expect(validateTemplateBody('Nous fermons à {heure_fermeture', 'vehicle').ok).toBe(false);
  });

  it('rend les valeurs et signale celles qui manquent, sans les vider', () => {
    const ok = renderTemplate('Nous fermons à {heure_fermeture}.', { heure_fermeture: '19 h 00' });
    expect(ok).toEqual({ ok: true, text: 'Nous fermons à 19 h 00.', missing: [], errors: [] });
    const missing = renderTemplate('Nous fermons à {heure_fermeture}.', {});
    expect(missing.ok).toBe(false);
    expect(missing.missing).toEqual(['heure_fermeture']);
    expect(missing.text).toContain('{heure_fermeture}');
  });
});

describe('adresses web', () => {
  it('refuse toute forme d’adresse', () => {
    for (const body of [
      'Payez ici : https://exemple.fr',
      'Voir http://x.y',
      'www.garage-martin.fr',
      'bit.ly/abc',
      'Rendez-vous sur exemple.fr pour payer',
      'EXEMPLE.COM',
    ]) {
      expect(containsUrl(body), body).toBe(true);
      expect(validateTemplateBody(body, 'vehicle').ok, body).toBe(false);
    }
  });

  it('laisse passer heures, montants et ponctuation ordinaire', () => {
    for (const body of ['Nous fermons à 19 h 00.', 'Devis de 184,00 €', 'Prêt. Merci !', 'Retard de 12.5 min', 'n° 1234']) {
      expect(containsUrl(body), body).toBe(false);
    }
  });

  it('une valeur de variable ne fait pas passer un lien', () => {
    const r = renderTemplate('Chez {etablissement}', { etablissement: 'promo.example.com' });
    expect(r.ok).toBe(false);
  });
});

describe('longueur et typographie', () => {
  it('180 caractères au plus', () => {
    expect(validateTemplateBody('a'.repeat(TEMPLATE_MAX_LENGTH), 'vehicle').ok).toBe(true);
    expect(validateTemplateBody('a'.repeat(TEMPLATE_MAX_LENGTH + 1), 'vehicle').ok).toBe(false);
    const long = renderTemplate('{etablissement}', { etablissement: 'x'.repeat(300) });
    expect(Array.from(long.text)).toHaveLength(TEMPLATE_MAX_LENGTH);
    expect(long.text.endsWith('…')).toBe(true);
  });

  it('rétablit l’apostrophe typographique', () => {
    expect(typographie("Vos clés sont à l'accueil, c'est prêt")).toBe('Vos clés sont à l’accueil, c’est prêt');
    expect(renderTemplate("C'est prêt chez {etablissement}", { etablissement: "L'Atelier" }).text).toBe(
      'C’est prêt chez L’Atelier',
    );
  });

  it('refuse un message vide', () => {
    expect(validateTemplateBody('   ', 'vehicle').ok).toBe(false);
  });
});
