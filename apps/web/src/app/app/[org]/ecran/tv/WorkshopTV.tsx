'use client';

import { useMemo } from 'react';
import type { WorkshopDisplaySnapshot } from '@/server/display';
import { DeviceGlyph, DEVICE_LABEL } from '@/components/objects/DeviceGlyph';
import { Immatriculation } from '@/components/objects/Immatriculation';
import { TicketNumber } from '@/components/objects/TicketNumber';
import { maskedTail } from '@/lib/profiles/registration';
import { densityOf, plural, sinceOf, workshopView, type WorkshopTvRow } from './model';
import { TvAnnounce, TvFoot, TvHead, TvIdle, TvMini, TvStat, TvTag, useNow } from './TvParts';
import { useAnnouncements } from './useAnnouncements';
import common from './tvProfile.module.css';
import styles from './workshop.module.css';

/**
 * « VÉHICULES PRÊTS » — l'écran de la réception d'un atelier (garage,
 * centre auto, réparation d'appareils).
 *
 * Seules lignes montrées : ce qui est PRÊT, ce que le client cherche des
 * yeux en entrant. Chaque ligne est une fiche d'atelier (une latte percée
 * d'un œillet d'étiquette de clé) qui porte la plaque dessinée, MASQUÉE :
 * seuls les trois derniers caractères se lisent (••-••3-CD). Le masquage
 * est fait en SQL (display_snapshot) ; ici, `asMaskedRegistration` refuse
 * encore toute valeur qui n'arriverait pas masquée (tv/model.ts). En
 * atelier appareil : le numéro de dossier et le pictogramme, jamais le
 * modèle.
 *
 * À droite, l'atelier en chiffres : ce qui est en cours, la répartition
 * du planning (sans dire qui attend un devis), les dépôts du jour.
 */

function speechOf(row: WorkshopTvRow, device: boolean): string {
  if (row.plate) {
    const tail = maskedTail(row.plate);
    return `Véhicule prêt, immatriculation se terminant par ${tail}`;
  }
  if (row.ticketNo) return `${device ? 'Appareil prêt' : 'Véhicule prêt'}, dossier ${row.ticketNo}`;
  return device ? 'Un appareil est prêt' : 'Un véhicule est prêt';
}

export function WorkshopTV({ snapshot, hint }: { snapshot: WorkshopDisplaySnapshot; hint: string }) {
  const view = useMemo(() => workshopView(snapshot), [snapshot]);
  const now = useNow();
  const { device, rows, counts, readyWithoutRow } = view;
  const density = densityOf(rows.length);
  const subject = device ? ['appareil', 'appareils'] as const : ['véhicule', 'véhicules'] as const;

  // Le plus ancien d'abord : l'ordre dans lequel ils ont été prêts.
  const fresh = useMemo(() => rows.slice().reverse(), [rows]);
  const announce = useAnnouncements(fresh, (row) => row.id);
  const shown = announce.current;

  const planning = [
    { key: 'intake', label: 'À prendre en charge', value: counts.intake },
    { key: 'workshop', label: device ? 'En réparation' : 'En atelier', value: counts.workshop },
    { key: 'waiting', label: 'En attente', value: counts.waiting },
    { key: 'ready', label: 'Prêts', value: counts.ready },
  ] as const;
  const planningTotal = planning.reduce((sum, col) => sum + col.value, 0);

  return (
    <>
      <div className={common.body}>
        <section className={common.stage} aria-labelledby="tv-prets">
          <TvHead
            id="tv-prets"
            label={device ? 'Appareils prêts' : 'Véhicules prêts'}
            note={counts.ready > 0 ? (
              <>
                <strong className="t-num">{counts.ready}</strong> {plural(counts.ready, 'prêt', 'prêts')} à récupérer
                {rows.length > 0 && readyWithoutRow > 0 && <> · les {rows.length} derniers affichés</>}
              </>
            ) : null}
          />

          {rows.length > 0 ? (
            <ol className={styles.list} data-density={density} data-rows={Math.ceil(rows.length / 2)}>
              {rows.map((row, index) => (
                <li key={row.id} className={styles.card} data-latest={index === 0 ? 'true' : 'false'}>
                  <span className={styles.eyelet} aria-hidden="true" />
                  <span className={styles.ident}>
                    {row.plate ? (
                      <Immatriculation maskedValue={row.plate} size="lg" className={styles.plate} />
                    ) : (
                      <span className={styles.dossier}>
                        {row.deviceKind && (
                          <span className={styles.device}>
                            <DeviceGlyph kind={row.deviceKind} className={styles.glyph} />
                            <span className={styles.deviceLabel}>{DEVICE_LABEL[row.deviceKind]}</span>
                          </span>
                        )}
                        {row.ticketNo && (
                          <span className={styles.dossierNo}>
                            <span className={styles.dossierWord} aria-hidden="true">Dossier</span>
                            <TicketNumber value={row.ticketNo} kind="dossier" size="var(--ws-ticket)" />
                          </span>
                        )}
                      </span>
                    )}
                  </span>
                  <span className={styles.meta}>
                    <TvTag>Prêt</TvTag>
                    <span className={styles.since}>
                      {now ? <>depuis <strong className="t-num">{sinceOf(row.readySince, now)}</strong></> : ' '}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          ) : readyWithoutRow > 0 ? (
            // File réglée « compteurs seulement » : on dit combien, pas qui.
            <div className={styles.countOnly}>
              <TvStat
                value={readyWithoutRow}
                label={`${plural(readyWithoutRow, subject[0], subject[1])} ${plural(readyWithoutRow, 'prêt', 'prêts')}`}
                detail={`Présentez-vous à l’accueil pour ${plural(readyWithoutRow, 'le', 'les')} récupérer.`}
                size={220}
                tone="signal"
              />
            </div>
          ) : (
            <TvIdle
              title={device ? 'Aucun appareil prêt pour l’instant.' : 'Aucun véhicule prêt pour l’instant.'}
              line={`Votre téléphone vous prévient dès que votre ${subject[0]} est prêt : inutile d’attendre devant l’écran.`}
            />
          )}
        </section>

        <section className={common.aside} aria-labelledby="tv-atelier">
          <TvHead id="tv-atelier" label="À l’atelier" />
          <TvStat
            value={counts.inWorkshop}
            label={`${plural(counts.inWorkshop, subject[0], subject[1])} en cours`}
            size={180}
          />

          <div className={styles.planning}>
            <div
              className={styles.bar}
              role="img"
              aria-label={planning.map((col) => `${col.label} : ${col.value}`).join(', ')}
            >
              {planningTotal === 0 ? (
                <span className={styles.barEmpty} />
              ) : (
                planning.filter((col) => col.value > 0).map((col) => (
                  <span key={col.key} className={styles.seg} data-col={col.key} style={{ flexGrow: col.value }} />
                ))
              )}
            </div>
            <ul className={styles.legend} aria-hidden="true">
              {planning.map((col) => (
                <li key={col.key} data-col={col.key}>
                  <i />
                  <span>{col.label}</span>
                  <strong className="t-num">{col.value}</strong>
                </li>
              ))}
            </ul>
          </div>

          <div className={common.minis}>
            <TvMini label="Déposés aujourd’hui" value={counts.receivedToday} />
            <TvMini label="Rendus aujourd’hui" value={counts.handedOverToday} />
          </div>
        </section>
      </div>

      <TvFoot
        hint={hint}
        today={<><strong className="t-num">{counts.handedOverToday}</strong> {plural(counts.handedOverToday, 'rendu', 'rendus')} aujourd’hui</>}
      />

      <TvAnnounce
        phase={announce.phase}
        hold={announce.hold}
        kicker={device ? 'Appareil prêt' : 'Véhicule prêt'}
        speech={shown ? speechOf(shown, device) : null}
      >
        {shown && (
          <div className={styles.announceRow}>
            {shown.plate ? (
              <Immatriculation maskedValue={shown.plate} size="lg" className={styles.announcePlate} />
            ) : (
              <span className={styles.announceDossier}>
                {shown.deviceKind && <DeviceGlyph kind={shown.deviceKind} className={styles.announceGlyph} />}
                {shown.ticketNo && <TicketNumber value={shown.ticketNo} kind="dossier" size="calc(var(--u) * 190)" />}
              </span>
            )}
            <span className={styles.announceLine}>Présentez-vous à l’accueil</span>
          </div>
        )}
      </TvAnnounce>
    </>
  );
}
