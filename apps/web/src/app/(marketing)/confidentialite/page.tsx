import type { Metadata } from 'next';
import { LegalDoc, type LegalSection } from '../_legal/LegalDoc';

export const metadata: Metadata = {
  title: 'Politique de confidentialité',
  description: 'Quelles données Rangvia collecte, pourquoi, et combien de temps elles sont conservées.',
};

const SECTIONS: LegalSection[] = [
  {
    id: 'client',
    title: 'Pour un client qui rejoint une file',
    body: (
      <ul>
        <li><strong>Aucun compte, aucun mot de passe, aucun e-mail, aucun numéro de téléphone.</strong></li>
        <li><strong>Un prénom</strong>, uniquement si l’établissement l’a demandé, et uniquement pour vous appeler.</li>
        <li><strong>Un identifiant d’appareil</strong> : un jeton aléatoire conservé sur votre téléphone. Notre base n’en stocke qu’une empreinte cryptographique, jamais le jeton lui-même.</li>
        <li><strong>Une empreinte d’adresse IP</strong>, irréversible, uniquement pour empêcher les inscriptions automatisées. L’adresse elle-même n’est jamais enregistrée.</li>
        <li><strong>Un jeton de notification</strong>, si vous acceptez d’être prévenu. Pour un App Clip iPhone, Apple limite sa validité à 8 heures après chaque lancement.</li>
      </ul>
    ),
  },
  {
    id: 'etablissement',
    title: "Ce que l’établissement voit",
    body: (
      <p>
        Uniquement le prénom que vous avez donné, votre position dans la file, et les
        horodatages de votre passage. Il n’a accès ni à votre jeton d’appareil,
        ni à votre abonnement aux notifications, ni à votre empreinte d’adresse IP :
        ces informations sont inaccessibles depuis son tableau de bord, y compris à
        travers l’interface de la base de données.
      </p>
    ),
  },
  {
    id: 'autres-clients',
    title: 'Ce que les autres clients voient',
    body: (
      <p>
        Rien. L’écran d’un client n’affiche qu’un nombre de
        personnes devant lui. Le flux temps réel qui alimente cet écran ne transporte
        aucun prénom : uniquement des identifiants de ticket opaques que seul
        l’appareil concerné peut reconnaître.
      </p>
    ),
  },
  {
    id: 'duree',
    title: 'Combien de temps',
    body: (
      <>
        <p>
          Chaque établissement choisit sa durée de conservation, entre 1 et 730 jours.
          Au-delà, une purge automatique efface les prénoms et supprime les sessions
          d’appareil. Seules subsistent des statistiques agrégées, qui ne
          contiennent aucune donnée personnelle.
        </p>
        <p>
          Les abonnements aux notifications expirés sont supprimés, et les journaux
          d’envoi sont conservés 30 jours.
        </p>
      </>
    ),
  },
  {
    id: 'professionnel',
    title: 'Pour un professionnel',
    body: (
      <p>
        La création d’un compte demande un nom, une adresse e-mail et un mot de
        passe, gérés par Supabase Auth. Les actions sensibles (équipe, réglages,
        facturation) sont journalisées avec leur auteur.
      </p>
    ),
  },
  {
    id: 'droits',
    title: 'Vos droits',
    body: (
      <p>
        Vous pouvez demander l’accès, la rectification ou l’effacement de vos
        données auprès de l’établissement concerné, ou directement auprès de nous.
        Un client dans une file peut à tout moment la quitter depuis son écran : son
        ticket est immédiatement retiré.
      </p>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <LegalDoc
      title="Le minimum, et rien de plus"
      intro={
        <>
          Rangvia est une file d’attente. Pour la tenir, il faut savoir qui est
          arrivé avant qui — pas qui vous êtes. Ce document décrit exactement ce que
          nous collectons.
        </>
      }
      sections={SECTIONS}
    />
  );
}
