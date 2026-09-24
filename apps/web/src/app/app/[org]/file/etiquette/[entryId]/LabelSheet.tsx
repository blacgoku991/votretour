'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, useTransition } from 'react';
import { DeviceGlyph, DEVICE_LABEL } from '@/components/objects/DeviceGlyph';
import { Immatriculation } from '@/components/objects/Immatriculation';
import { TicketNumber } from '@/components/objects/TicketNumber';
import { asMaskedRegistration } from '@/lib/profiles/registration';
import type { DeviceKind, RegistrationCountry } from '@/lib/profiles/types';
import { issueTrackingLink, type TrackingLink } from '@/server/actions/profile-queue';
import { labelKind, shortRef } from '../../boards/logic';
import styles from './etiquette.module.css';

/**
 * La feuille d'impression : l'aperçu de l'étiquette, puis le geste
 * « Imprimer ». Le QR de suivi est émis À CE MOMENT (jeton à usage unique,
 * dont la base ne garde que l'empreinte), posé sur l'étiquette, et la
 * boîte d'impression du navigateur s'ouvre. Si la fiche est déjà suivie
 * par un téléphone, l'étiquette s'imprime sans QR, et sans la zone du QR :
 * elle garde son rôle de repère entre la clé (ou le sachet) et la fiche.
 */

/**
 * La page imprimée a exactement la taille de l'étiquette, sur fond blanc
 * (voir etiquette.module.css). Posée par un `<style>` rendu avec la
 * feuille : elle n'existe que sur cette page et disparaît avec elle ; un
 * module CSS ne peut pas viser `html` seul.
 */
const PRINT_PAGE_CSS = `@media print {
  html, body {
    width: 62mm !important; height: 100mm !important; min-height: 0 !important;
    margin: 0 !important; padding: 0 !important; overflow: hidden !important;
    background: #FFFFFF !important;
  }
}`;

export interface LabelData {
  profile: 'vehicle' | 'device';
  locationName: string;
  /** Fuseau de l'établissement : l'échéance du QR se lit à son heure. */
  timeZone: string;
  /** Déjà masquée côté serveur (`••-••3-CD`) ; jamais la forme complète. */
  maskedRegistration: string | null;
  country: RegistrationCountry;
  ticketNo: string | null;
  model: string | null;
  deviceKind: DeviceKind | null;
  subject: string;
}

export function LabelSheet({
  orgSlug, entryId, backHref, label,
}: { orgSlug: string; entryId: string; backHref: string; label: LabelData }) {
  const [link, setLink] = useState<TrackingLink | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [printNow, setPrintNow] = useState(false);
  const [pending, startTransition] = useTransition();
  const printed = useRef(false);
  const masked = asMaskedRegistration(label.maskedRegistration);
  const ref = label.ticketNo ?? shortRef(entryId);
  const kind = labelKind(label.profile);
  // Sur l'étiquette de dépôt, le numéro de dossier est déjà écrit en
  // grand : la ligne « Réf. » le répéterait.
  const showRef = label.profile === 'vehicle' || !label.ticketNo;

  // L'impression attend que le QR soit posé dans la page.
  useEffect(() => {
    if (!printNow || printed.current) return;
    printed.current = true;
    const t = window.setTimeout(() => { window.print(); setPrintNow(false); printed.current = false; }, 60);
    return () => window.clearTimeout(t);
  }, [printNow, link]);

  const printWithQr = () => {
    setError(null);
    startTransition(async () => {
      const result = await issueTrackingLink(orgSlug, { entryId });
      if (!result.ok) { setError(result.error); return; }
      setLink(result.data);
      setPrintNow(true);
    });
  };

  const expires = link
    ? new Intl.DateTimeFormat('fr-FR', {
        weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: label.timeZone,
      }).format(new Date(link.expiresAt))
    : null;

  return (
    <div className={`shell ${styles.page}`}>
      <style>{PRINT_PAGE_CSS}</style>
      <div className={styles.intro}>
        <p className="t-label">{kind.title}</p>
        <h1 className={styles.title}>Imprimer l’étiquette</h1>
        <p className="t-body t-muted">
          Format 62 × 100 mm. Le QR est créé au moment d’imprimer : il remplace celui du poste,
          sert une seule fois et reste valable 24 h.
        </p>
      </div>

      <div className={styles.stage}>
        <article
          className={styles.label}
          data-qr={link ? '1' : undefined}
          aria-label={`${kind.title}, ${label.profile === 'vehicle' ? 'véhicule' : 'dossier'} ${ref}`}
        >
          <span className={styles.hole} aria-hidden="true" />
          <p className={styles.place}>{label.locationName}</p>

          {label.profile === 'vehicle' ? (
            <div className={styles.plate}>
              {masked ? (
                <Immatriculation maskedValue={masked} country={label.country} width={196} />
              ) : (
                <span className={styles.noPlate}>Sans immatriculation</span>
              )}
            </div>
          ) : (
            <div className={styles.dossier}>
              <DeviceGlyph kind={label.deviceKind ?? 'other'} size={26} />
              {label.ticketNo ? <TicketNumber value={label.ticketNo} kind="dossier" size="2.25rem" /> : null}
            </div>
          )}

          <p className={styles.model}>
            {label.model ?? (label.deviceKind ? DEVICE_LABEL[label.deviceKind] : '')}
          </p>
          {showRef && (
            <p className={styles.ref}>
              <span>Réf.</span> <strong>{ref}</strong>
            </p>
          )}

          <div className={styles.qrZone}>
            {link ? (
              // SVG produit par notre serveur (bibliothèque qrcode).
              <div className={styles.qr} role="img" aria-label="QR de suivi" dangerouslySetInnerHTML={{ __html: link.qrSvg }} />
            ) : (
              <div className={styles.qrPlaceholder} aria-hidden="true">
                <span>QR créé<br />à l’impression</span>
              </div>
            )}
            <p className={styles.scan}>
              Scannez pour suivre votre {label.subject}.
              {expires && <span className={styles.expires}>Usage unique · jusqu’au {expires}</span>}
            </p>
          </div>
        </article>

        <div className={styles.actions}>
          <button type="button" className="btn btn--solid btn--lg" disabled={pending} onClick={printWithQr}>
            {pending ? 'Création du QR…' : 'Imprimer avec le QR de suivi'}
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => { setLink(null); setPrintNow(true); }}>
            Imprimer sans QR
          </button>
          {error && (
            <p className={styles.error} role="alert">
              {error} Vous pouvez imprimer l’étiquette sans QR.
            </p>
          )}
          <Link href={backHref} className={styles.back}>← Retour à l’atelier</Link>
        </div>
      </div>
    </div>
  );
}
