import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { hasLegalNotice, legalInfo } from '@/lib/legal';
import { LegalDoc, type LegalSection } from '../_legal/LegalDoc';

export const metadata: Metadata = {
  title: 'Mentions légales',
  description: 'Éditeur, directeur de la publication et hébergeur du site Rangvia.',
};

// Lu à chaque requête : les informations viennent du .env du serveur.
export const dynamic = 'force-dynamic';

export default function LegalNoticePage() {
  const info = legalInfo();
  // Jamais de mentions à trous : tant que l'éditeur n'est pas renseigné
  // en entier, la page n'existe pas (et le pied de page n'y renvoie pas).
  if (!hasLegalNotice(info)) notFound();

  const sections: LegalSection[] = [
    {
      id: 'editeur',
      title: 'Éditeur du site',
      body: (
        <p>
          <strong>{info.company}</strong>
          {info.form && <>, {info.form}</>}
          <br />
          {info.address}
          <br />
          SIRET : {info.siret}
          {info.vat && <><br />TVA intracommunautaire : {info.vat}</>}
          <br />
          E-mail : <a href={`mailto:${info.email}`}>{info.email}</a>
          {info.phone && <><br />Téléphone : <a href={`tel:${info.phone.replace(/\s+/g, '')}`}>{info.phone}</a></>}
        </p>
      ),
    },
    {
      id: 'publication',
      title: 'Directeur de la publication',
      body: <p>{info.director ?? info.company}</p>,
    },
    {
      id: 'hebergeur',
      title: 'Hébergeur',
      body: (
        <p>
          <strong>{info.hostName}</strong>
          <br />
          {info.hostAddress}
        </p>
      ),
    },
    {
      id: 'donnees',
      title: 'Données personnelles',
      body: (
        <p>
          Ce que Rangvia collecte, pourquoi et combien de temps est décrit dans la{' '}
          <a href="/confidentialite">politique de confidentialité</a>.
        </p>
      ),
    },
  ];

  return (
    <LegalDoc
      title="Mentions légales"
      intro={<>Qui édite Rangvia, et où le site est hébergé.</>}
      sections={sections}
      updatedAt={info.updatedAt}
    />
  );
}
