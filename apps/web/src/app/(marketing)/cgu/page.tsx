import type { Metadata } from 'next';
import styles from '../../marketing.module.css';

export const metadata: Metadata = {
  title: "Conditions d'utilisation",
  description: "Les conditions d'utilisation du service VotreTour.",
};

export default function TermsPage() {
  return (
    <main className={`shell ${styles.doc}`}>
      <p className="t-label">Conditions</p>
      <h1 className="t-display">Conditions d&apos;utilisation</h1>
      <p>
        Ce document encadre l&apos;usage de VotreTour. Il est rédigé pour être lu.
      </p>

      <h2>1. Le service</h2>
      <p>
        VotreTour met à disposition une file d&apos;attente virtuelle : vos clients
        rejoignent la file depuis leur téléphone, suivent leur position en temps réel
        et reçoivent une notification quand leur tour approche.
      </p>

      <h2>2. Votre compte</h2>
      <p>
        Vous êtes responsable de la confidentialité de vos identifiants et des actions
        menées depuis votre espace. Vous pouvez inviter des collaborateurs et leur
        attribuer un rôle ; chacun n&apos;accède qu&apos;à ce que son rôle autorise.
      </p>

      <h2>3. Vos clients</h2>
      <p>
        Vous vous engagez à utiliser le service de bonne foi : ne pas inscrire
        quelqu&apos;un sans son accord, ne pas se servir des notifications à des fins
        promotionnelles, et proposer le lien d&apos;avis sans discrimination — le
        produit ne permet d&apos;ailleurs pas de filtrer qui le reçoit.
      </p>

      <h2>4. Disponibilité</h2>
      <p>
        Nous faisons de notre mieux pour que le service reste disponible, sans garantie
        de fonctionnement ininterrompu. En cas de coupure, votre file reste accessible
        depuis votre tableau de bord et vos clients peuvent toujours se présenter au
        comptoir.
      </p>

      <h2>5. Notifications</h2>
      <p>
        L&apos;acheminement des notifications dépend d&apos;Apple et des éditeurs de
        navigateurs. Nous ne pouvons pas le garantir. Le produit n&apos;affiche jamais
        qu&apos;une notification a été envoyée sans confirmation du fournisseur, et
        l&apos;écran client indique toujours quand aucun canal n&apos;est disponible.
      </p>

      <h2>6. Abonnement</h2>
      <p>
        L&apos;abonnement est mensuel ou annuel, résiliable à tout moment depuis votre
        espace. La résiliation prend effet à la fin de la période en cours. Vos données
        restent accessibles jusqu&apos;à cette date.
      </p>

      <h2>7. Suspension</h2>
      <p>
        Nous pouvons suspendre un compte en cas d&apos;usage manifestement abusif. Une
        suspension ferme les files et bloque l&apos;accès, mais ne détruit aucune
        donnée : la réactivation les retrouve intactes.
      </p>

      <h2>8. Modification</h2>
      <p>
        Ces conditions peuvent évoluer. Toute modification substantielle vous sera
        signalée avant son entrée en vigueur.
      </p>
    </main>
  );
}
