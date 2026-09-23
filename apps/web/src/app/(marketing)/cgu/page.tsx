import type { Metadata } from 'next';
import { LegalDoc, type LegalSection } from '../_legal/LegalDoc';

export const metadata: Metadata = {
  title: "Conditions d'utilisation",
  description: "Les conditions d'utilisation du service Rangvia.",
};

const SECTIONS: LegalSection[] = [
  {
    id: 'service',
    title: 'Le service',
    body: (
      <p>
        Rangvia met à disposition une file d&apos;attente virtuelle : vos clients
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
        attribuer un rôle ; chacun n&apos;accède qu&apos;à ce que son rôle autorise.
      </p>
    ),
  },
  {
    id: 'clients',
    title: 'Vos clients',
    body: (
      <p>
        Vous vous engagez à utiliser le service de bonne foi : ne pas inscrire
        quelqu&apos;un sans son accord, ne pas se servir des notifications à des fins
        promotionnelles, et proposer le lien d&apos;avis sans discrimination — le
        produit ne permet d&apos;ailleurs pas de filtrer qui le reçoit.
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
        L&apos;acheminement des notifications dépend d&apos;Apple et des éditeurs de
        navigateurs. Nous ne pouvons pas le garantir. Le produit n&apos;affiche jamais
        qu&apos;une notification a été envoyée sans confirmation du fournisseur, et
        l&apos;écran client indique toujours quand aucun canal n&apos;est disponible.
      </p>
    ),
  },
  {
    id: 'abonnement',
    title: 'Abonnement',
    body: (
      <p>
        L&apos;abonnement est mensuel ou annuel, résiliable à tout moment depuis votre
        espace. La résiliation prend effet à la fin de la période en cours. Vos données
        restent accessibles jusqu&apos;à cette date.
      </p>
    ),
  },
  {
    id: 'suspension',
    title: 'Suspension',
    body: (
      <p>
        Nous pouvons suspendre un compte en cas d&apos;usage manifestement abusif. Une
        suspension ferme les files et bloque l&apos;accès, mais ne détruit aucune
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

export default function TermsPage() {
  return (
    <LegalDoc
      title="Conditions d'utilisation"
      intro={<>Ce document encadre l&apos;usage de Rangvia. Il est rédigé pour être lu.</>}
      sections={SECTIONS}
    />
  );
}
