// =====================================================================
// Rangvia — la feuille de tournage (timeline.json)
// ---------------------------------------------------------------------
// Le tournage est continu ; le montage n'en garde que des « plans »
// (beats) : une étape du scénario, de l'état stable qui la précède à la
// fin de sa pause de lecture. Entre deux plans, les temps morts
// (chargements, attentes du réseau) sont coupés, et chaque coupe se voit
// (fondu de 200 ms) : aucune accélération cachée ([SEO § 10.1, règle 3]).
//
// Toutes les heures sont en secondes depuis l'époque, sur l'horloge de la
// machine : celle des images du screencast (`metadata.timestamp`).
// =====================================================================

import { writeFileSync } from 'node:fs';

const now = () => Date.now() / 1000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class Timeline {
  constructor({ metier, scenario }) {
    this.metier = metier;
    this.scenario = scenario;
    this.started = now();
    this.beats = [];
    this.marks = [];
    this.current = null;
  }

  /**
   * Un plan. `caption` : le texte de la bande sous la tablette pendant ce
   * plan. `fn` enchaîne les gestes et ATTEND des états réels ; sa pause de
   * lecture finale fait partie du plan.
   */
  async beat(id, caption, fn) {
    if (this.current) throw new Error(`plan « ${id} » ouvert dans le plan « ${this.current.id} »`);
    const beat = { id, caption, start: now(), end: null, overlays: [] };
    this.current = beat;
    try {
      await fn();
    } finally {
      beat.end = now();
      this.current = null;
    }
    this.beats.push(beat);
    return beat;
  }

  /**
   * Un carton posé par-dessus le plan en cours, pendant `seconds`, à
   * partir de maintenant. Le plan doit durer au moins jusque-là : la
   * pause qui suit est comprise dans l'appel.
   */
  async overlay(card, seconds, data = {}) {
    if (!this.current) throw new Error(`carton « ${card} » hors d'un plan`);
    const from = now();
    this.current.overlays.push({ card, from, to: from + seconds, data });
    await sleep(seconds * 1000 + 250);
  }

  /** Un instant remarquable (l'affiche de la vidéo, le début de l'aperçu…). */
  mark(label) {
    this.marks.push({ label, t: now() });
  }

  /** Pause de lecture : le spectateur voit le changement qui vient d'arriver. */
  static read(ms = 1200) {
    return sleep(ms);
  }

  save(file, extra) {
    const doc = {
      version: 1,
      metier: this.metier,
      scenario: this.scenario,
      recordedAt: new Date(this.started * 1000).toISOString(),
      started: this.started,
      ended: now(),
      beats: this.beats,
      marks: this.marks,
      ...extra,
    };
    writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
    return doc;
  }
}
