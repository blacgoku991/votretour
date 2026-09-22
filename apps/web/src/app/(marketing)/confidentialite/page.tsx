import type { Metadata } from 'next';
import styles from '../../marketing.module.css';

export const metadata: Metadata = {
  title: 'Politique de confidentialité',
  description: "Quelles données VotreTour collecte, pourquoi, et combien de temps elles sont conservées.",
};

export default function PrivacyPage() {
  return (
    <main className={`shell ${styles.doc}`}>
      <p className="t-label">Confidentialité</p>
      <h1 className="t-display">Le minimum, et rien de plus</h1>
      <p>
        VotreTour est une file d&apos;attente. Pour la tenir, il faut savoir qui est
        arrivé avant qui — pas qui vous êtes. Ce document décrit exactement ce que
        nous collectons.
      </p>

      <h2>Pour un client qui rejoint une file</h2>
      <ul>
        <li><strong>Aucun compte, aucun mot de passe, aucun e-mail, aucun numéro de téléphone.</strong></li>
        <li><strong>Un prénom</strong>, uniquement si l&apos;établissement l&apos;a demandé, et uniquement pour vous appeler.</li>
        <li><strong>Un identifiant d&apos;appareil</strong> : un jeton aléatoire conservé sur votre téléphone. Notre base n&apos;en stocke qu&apos;une empreinte cryptographique, jamais le jeton lui-même.</li>
        <li><strong>Une empreinte d&apos;adresse IP</strong>, irréversible, uniquement pour empêcher les inscriptions automatisées. L&apos;adresse elle-même n&apos;est jamais enregistrée.</li>
        <li><strong>Un jeton de notification</strong>, si vous acceptez d&apos;être prévenu. Pour un App Clip iPhone, Apple limite sa validité à 8 heures après chaque lancement.</li>
      </ul>

      <h2>Ce que l&apos;établissement voit</h2>
      <p>
        Uniquement le prénom que vous avez donné, votre position dans la file, et les
        horodatages de votre passage. Il n&apos;a accès ni à votre jeton d&apos;appareil,
        ni à votre abonnement aux notifications, ni à votre empreinte d&apos;adresse IP :
        ces informations sont inaccessibles depuis son tableau de bord, y compris à
        travers l&apos;interface de la base de données.
      </p>

      <h2>Ce que les autres clients voient</h2>
      <p>
        Rien. L&apos;écran d&apos;un client n&apos;affiche qu&apos;un nombre de
        personnes devant lui. Le flux temps réel qui alimente cet écran ne transporte
        aucun prénom : uniquement des identifiants de ticket opaques que seul
        l&apos;appareil concerné peut reconnaître.
      </p>

      <h2>Combien de temps</h2>
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

      <h2>Pour un professionnel</h2>
      <p>
        La création d&apos;un compte demande un nom, une adresse e-mail et un mot de
        passe, gérés par Supabase Auth. Les actions sensibles (équipe, réglages,
        facturation) sont journalisées avec leur auteur.
      </p>

      <h2>Vos droits</h2>
      <p>
        Vous pouvez demander l&apos;accès, la rectification ou l&apos;effacement de vos
        données auprès de l&apos;établissement concerné, ou directement auprès de nous.
        Un client dans une file peut à tout moment la quitter depuis son écran : son
        ticket est immédiatement retiré.
      </p>
    </main>
  );
}
