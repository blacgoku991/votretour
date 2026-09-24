import type { Metadata } from 'next';
import { legalInfo, type LegalInfo } from '@/lib/legal';
import { LegalDoc, type LegalSection } from '../_legal/LegalDoc';

export const metadata: Metadata = {
  title: "Conditions d’utilisation",
  description: "Les conditions d’utilisation du service Rangvia.",
};

// Lu à chaque requête : l'éditeur et le contact viennent du .env du serveur.
export const dynamic = 'force-dynamic';

const SECTIONS: LegalSection[] = [
  {
    id: 'service',
    title: 'Le service',
    body: (
      <p>
        Rangvia met à disposition une file d’attente virtuelle : vos clients
        rejoignent la file depuis leur téléphone, suivent leur position en temps réel
        et reçoivent une notification quand leur tour approche.
      </p>
    ),
  },
  {
    id: 'compte',
    title: 'Votre compte',
    body: (
      <p>
        Vous êtes responsable de la confidentialité de vos identifiants et des actions
        menées depuis votre espace. Vous pouvez inviter des collaborateurs et leur
        attribuer un rôle ; chacun n’accède qu’à ce que son rôle autorise.
      </p>
    ),
  },
  {
    id: 'clients',
    title: 'Vos clients',
    body: (
      <p>
        Vous vous engagez à utiliser le service de bonne foi : ne pas inscrire
        quelqu’un sans son accord, ne pas se servir des notifications à des fins
        promotionnelles, et proposer le lien d’avis sans discrimination — le
        produit ne permet d’ailleurs pas de filtrer qui le reçoit.
      </p>
    ),
  },
  {
    id: 'disponibilite',
    title: 'Disponibilité',
    body: (
      <p>
        Nous faisons de notre mieux pour que le service reste disponible, sans garantie
        de fonctionnement ininterrompu. En cas de coupure, votre file reste accessible
        depuis votre tableau de bord et vos clients peuvent toujours se présenter au
        comptoir.
      </p>
    ),
  },
  {
    id: 'notifications',
    title: 'Notifications',
    body: (
      <p>
        L’acheminement des notifications dépend d’Apple et des éditeurs de
        navigateurs. Nous ne pouvons pas le garantir. Le produit n’affiche jamais
        qu’une notification a été envoyée sans confirmation du fournisseur, et
        l’écran client indique toujours quand aucun canal n’est disponible.
      </p>
    ),
  },
  {
    id: 'abonnement',
    title: 'Abonnement',
    body: (
      <>
        {/* Offre unique (0043) : un abonnement mensuel et des frais
            d'installation payés une fois. Texte à faire relire par le
            propriétaire avant la mise en service. */}
        <p>
          L’abonnement est mensuel, sans engagement, résiliable à tout moment depuis
          votre espace. La résiliation prend effet à la fin de la période en cours. Vos
          données restent accessibles jusqu’à cette date.
        </p>
        <p>
          Des frais d’installation s’y ajoutent, facturés une seule fois, à l’activation
          du premier abonnement&#8239;: ils rémunèrent l’installation et la configuration de
          votre métier par l’équipe Rangvia. Ils ne sont pas remboursables et ne sont pas
          facturés à nouveau si le même commerce se réabonne.
        </p>
        <p>
          L’essai gratuit ne demande aucun moyen de paiement. Si vous activez votre
          abonnement pendant l’essai, les frais d’installation sont réglés à l’activation
          et le premier mois n’est prélevé qu’à la fin de l’essai.
        </p>
        <p>
          Les prix sont indiqués hors taxes, TVA en sus.
        </p>
      </>
    ),
  },
  {
    id: 'suspension',
    title: 'Suspension',
    body: (
      <p>
        Nous pouvons suspendre un compte en cas d’usage manifestement abusif. Une
        suspension ferme les files et bloque l’accès, mais ne détruit aucune
        donnée : la réactivation les retrouve intactes.
      </p>
    ),
  },
  {
    id: 'modification',
    title: 'Modification',
    body: (
      <p>
        Ces conditions peuvent évoluer. Toute modification substantielle vous sera
        signalée avant son entrée en vigueur.
      </p>
    ),
  },
];

/** Éditeur et contact : seulement ce qui est renseigné, rien d'inventé. */
function editorSection(info: LegalInfo): LegalSection | null {
  if (!info.company && !info.email) return null;
  return {
    id: 'editeur',
    title: 'Éditeur et contact',
    body: (
      <p>
        {info.company && (
          <>
            Rangvia est édité par <strong>{info.company}</strong>
            {info.form && <>, {info.form}</>}
            {info.address && <>, {info.address}</>}.{' '}
          </>
        )}
        {info.email && (
          <>Pour toute question : <a href={`mailto:${info.email}`}>{info.email}</a>.</>
        )}
      </p>
    ),
  };
}

export default function TermsPage() {
  const info = legalInfo();
  const editor = editorSection(info);
  return (
    <LegalDoc
      title="Conditions d’utilisation"
      intro={<>Ce document encadre l’usage de Rangvia. Il est rédigé pour être lu.</>}
      sections={editor ? [...SECTIONS, editor] : SECTIONS}
      updatedAt={info.updatedAt}
    />
  );
}
