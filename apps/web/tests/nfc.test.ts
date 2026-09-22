import { describe, it, expect } from 'vitest';
import {
  buildUrlMessage, describeNfcError, explainNoNfc,
  readUrlFromRecords, samePlateUrl,
} from '../src/lib/nfc';

/**
 * La programmation NFC écrit sur un objet physique qu'on collera sur un
 * comptoir. Une erreur ici se corrige avec un tournevis, pas avec un
 * redéploiement : ces tests verrouillent le contenu écrit et la
 * comparaison de relecture.
 */

const view = (text: string) => {
  const bytes = new TextEncoder().encode(text);
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
};

describe('buildUrlMessage', () => {
  it('écrit un unique enregistrement URI', () => {
    const message = buildUrlMessage('https://votretour.fr/e/barber-house-comptoir');
    expect(message.records).toHaveLength(1);
    expect(message.records[0]).toEqual({
      recordType: 'url',
      data: 'https://votretour.fr/e/barber-house-comptoir',
    });
  });

  it('refuse tout ce qui n’est pas une URL https', () => {
    expect(() => buildUrlMessage('http://votretour.fr/e/x')).toThrow(TypeError);
    expect(() => buildUrlMessage('ftp://votretour.fr/e/x')).toThrow(TypeError);
    expect(() => buildUrlMessage('javascript:alert(1)')).toThrow(TypeError);
    expect(() => buildUrlMessage('votretour.fr/e/x')).toThrow(TypeError);
    expect(() => buildUrlMessage('')).toThrow(TypeError);
    // Une URL avec espace casserait l'enregistrement URI.
    expect(() => buildUrlMessage('https://votretour.fr/e/a b')).toThrow(TypeError);
  });

  it('accepte http sur localhost, que le navigateur traite en contexte sécurisé', () => {
    // Sans cela, impossible d'essayer la programmation en développement.
    expect(buildUrlMessage('http://localhost:3000/e/x').records[0]?.data)
      .toBe('http://localhost:3000/e/x');
    expect(buildUrlMessage('http://127.0.0.1:3000/e/x').records[0]?.data)
      .toBe('http://127.0.0.1:3000/e/x');
  });

  it('tolère les espaces autour', () => {
    expect(buildUrlMessage('  https://votretour.fr/e/x  ').records[0]?.data)
      .toBe('https://votretour.fr/e/x');
  });
});

describe('readUrlFromRecords', () => {
  it('retrouve l’URL d’un tag relu', () => {
    const records = [{ recordType: 'url', data: view('https://votretour.fr/e/abc') }];
    expect(readUrlFromRecords(records)).toBe('https://votretour.fr/e/abc');
  });

  it('ignore les enregistrements texte laissés par un autre outil', () => {
    const records = [
      { recordType: 'text', data: view('Bienvenue') },
      { recordType: 'url', data: view('https://votretour.fr/e/abc') },
    ];
    expect(readUrlFromRecords(records)).toBe('https://votretour.fr/e/abc');
  });

  it('renvoie null sur un tag vierge', () => {
    expect(readUrlFromRecords([])).toBeNull();
    expect(readUrlFromRecords([{ recordType: 'empty', data: null }])).toBeNull();
  });
});

describe('samePlateUrl', () => {
  it('accepte une barre oblique finale et une casse d’hôte différente', () => {
    expect(samePlateUrl('https://votretour.fr/e/abc', 'https://VotreTour.fr/e/abc/')).toBe(true);
  });

  it('refuse une autre plaque', () => {
    expect(samePlateUrl('https://votretour.fr/e/abc', 'https://votretour.fr/e/abd')).toBe(false);
  });

  it('refuse un autre domaine — c’est le cas qui compte', () => {
    // Un tag reprogrammé par un tiers pointerait ailleurs : la relecture
    // doit le dire, sinon on afficherait « vérifiée » sur une plaque
    // détournée.
    expect(samePlateUrl('https://votretour.fr/e/abc', 'https://pirate.example/e/abc')).toBe(false);
  });
});

describe('describeNfcError', () => {
  it('traduit chaque erreur de la spécification', () => {
    const named = (name: string) => {
      const error = new Error('x');
      error.name = name;
      return describeNfcError(error);
    };
    expect(named('NotAllowedError')).toMatch(/Autorisation refusée/);
    expect(named('NotSupportedError')).toMatch(/NTAG213/);
    expect(named('NotReadableError')).toMatch(/Activez le NFC/);
    expect(named('NetworkError')).toMatch(/retirée trop tôt/);
    expect(named('AbortError')).toMatch(/interrompue/);
  });

  it('reste compréhensible sur une erreur inconnue', () => {
    const message = describeNfcError(new DOMException('?', 'WeirdError'));
    expect(message).toContain('WeirdError');
    expect(message).toMatch(/Réessayez/);
  });
});

describe('explainNoNfc', () => {
  it('dit la vérité sur iPhone plutôt que de masquer le bouton', () => {
    const reason = explainNoNfc('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari');
    expect(reason.title).toMatch(/iPhone/);
    expect(reason.detail).toMatch(/NFC Tools/);
  });

  it('oriente vers Chrome sur un Android non compatible', () => {
    const reason = explainNoNfc('Mozilla/5.0 (Linux; Android 14) FirefoxAndroid');
    expect(reason.detail).toMatch(/Chrome/);
  });

  it('explique le cas de l’ordinateur', () => {
    const reason = explainNoNfc('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome');
    expect(reason.title).toMatch(/ordinateur/i);
  });
});
