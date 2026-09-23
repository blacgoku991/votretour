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
        <li><strong>Un prénom</strong>, uniquement si l&apos;établissement l&apos;a demandé, et uniquement pour vous appeler.</li>
        <li><strong>Un identifiant d&apos;appareil</strong> : un jeton aléatoire conservé sur votre téléphone. Notre base n&apos;en stocke qu&apos;une empreinte cryptographique, jamais le jeton lui-même.</li>
        <li><strong>Une empreinte d&apos;adresse IP</strong>, irréversible, uniquement pour empêcher les inscriptions automatisées. L&apos;adresse elle-même n&apos;est jamais enregistrée.</li>
        <li><strong>Un jeton de notification</strong>, si vous acceptez d&apos;être prévenu. Pour un App Clip iPhone, Apple limite sa validité à 8 heures après chaque lancement.</li>
      </ul>
    ),
  },
  {
    id: 'etablissement',
    title: "Ce que l'établissement voit",
    body: (
      <p>
        Uniquement le prénom que vous avez donné, votre position dans la file, et les
        horodatages de votre passage. Il n&apos;a accès ni à votre jeton d&apos;appareil,
        ni à votre abonnement aux notifications, ni à votre empreinte d&apos;adresse IP :
        ces informations sont inaccessibles depuis son tableau de bord, y compris à
        travers l&apos;interface de la base de données.
      </p>
    ),
  },
  {
    id: 'autres-clients',
    title: 'Ce que les autres clients voient',
    body: (
      <p>
        Rien. L&apos;écran d&apos;un client n&apos;affiche qu&apos;un nombre de
        personnes devant lui. Le flux temps réel qui alimente cet écran ne transporte
        aucun prénom : uniquement des identifiants de ticket opaques que seul
        l&apos;appareil concerné peut reconnaître.
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
          d&apos;appareil. Seules subsistent des statistiques agrégées, qui ne
          contiennent aucune donnée personnelle.
        </p>
        <p>
          Les abonnements aux notifications expirés sont supprimés, et les journaux
          d&apos;envoi sont conservés 30 jours.
        </p>
      </>
    ),
  },
  {
    id: 'professionnel',
    title: 'Pour un professionnel',
    body: (
      <p>
        La création d&apos;un compte demande un nom, une adresse e-mail et un mot de
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
        Vous pouvez demander l&apos;accès, la rectification ou l&apos;effacement de vos
        données auprès de l&apos;établissement concerné, ou directement auprès de nous.
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
          Rangvia est une file d&apos;attente. Pour la tenir, il faut savoir qui est
          arrivé avant qui — pas qui vous êtes. Ce document décrit exactement ce que
          nous collectons.
        </>
      }
      sections={SECTIONS}
    />
  );
}
