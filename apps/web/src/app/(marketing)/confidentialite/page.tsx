import type { Metadata } from 'next';
import { integrationStatus } from '@/lib/env';
import { legalInfo, walletPrivacyNotice, type WalletPrivacyNotice } from '@/lib/legal';
import { LegalDoc, type LegalSection } from '../_legal/LegalDoc';

export const metadata: Metadata = {
  title: 'Politique de confidentialité',
  description: 'Quelles données Rangvia collecte, pourquoi, et combien de temps elles sont conservées.',
};

// Lu à chaque requête : le contact et l'éditeur viennent du .env du serveur.
export const dynamic = 'force-dynamic';

function sections(
  contact: { company: string | null; email: string | null },
  wallet: WalletPrivacyNotice | null,
): LegalSection[] {
  return [
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
      <>
        <p>
          Sur leur téléphone, rien. L’écran d’un client n’affiche qu’un nombre de
          personnes devant lui. Le flux temps réel qui alimente cet écran ne transporte
          aucun prénom : uniquement des identifiants de ticket opaques que seul
          l’appareil concerné peut reconnaître.
        </p>
        <p>
          Si l’établissement affiche sa file sur un écran dans sa salle, les
          personnes en attente n’y apparaissent qu’en initiales ; au moment où vous
          êtes appelé au comptoir, l’écran montre le prénom que vous avez donné,
          pour que vous vous reconnaissiez. Sans prénom donné, rien ne s’affiche.
        </p>
      </>
    ),
  },
  {
    id: 'vehicules-appareils',
    title: 'Véhicules, appareils et autres informations de métier',
    body: (
      <>
        <p>
          Selon le métier de l’établissement, votre passage peut porter quelques
          informations de plus, toujours limitées à ce qu’il faut pour vous servir :
        </p>
        <ul>
          <li><strong>Garage</strong> : l’immatriculation (si le garage la demande), le modèle, le motif de la visite, et le devis (libellé, montant, votre accord ou votre refus).</li>
          <li><strong>Réparation</strong> : le type et le modèle de l’appareil, et son numéro de dossier.</li>
          <li><strong>Restaurant</strong> : le nombre de couverts.</li>
          <li><strong>Guichet</strong> : un numéro de ticket. Pour un établissement de santé, aucun prénom ni texte libre n’est demandé, et aucun avis n’est sollicité par défaut.</li>
        </ul>
        <p>
          Sur l’écran de la salle, une immatriculation n’apparaît jamais en entier :
          seuls ses trois derniers caractères sont visibles, ou seulement le modèle,
          ou rien, selon le réglage du garage. Ces informations sont effacées en même temps que le
          prénom, à la fin de la durée de conservation choisie par l’établissement.
        </p>
      </>
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
  // Billets d'événement dans Apple Wallet / Google Wallet : seulement si
  // un fournisseur est configuré sur ce serveur (sinon, la fonction
  // n'existe pas pour le client, et la politique n'en parle pas).
  ...(wallet
    ? [{
        id: wallet.id,
        title: wallet.title,
        body: <>{wallet.paragraphs.map((text) => <p key={text.slice(0, 32)}>{text}</p>)}</>,
      }]
    : []),
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
      <>
        <p>
          Vous pouvez demander l’accès, la rectification ou l’effacement de vos
          données auprès de l’établissement concerné, ou directement auprès de nous.
          Un client dans une file peut à tout moment la quitter depuis son écran : son
          ticket est immédiatement retiré.
        </p>
        {contact.email && (
          <p>
            Pour nous écrire{contact.company ? <> ({contact.company}, responsable du traitement)</> : null} :{' '}
            <a href={`mailto:${contact.email}`}>{contact.email}</a>.
          </p>
        )}
        <p>
          Si vous estimez que vos droits ne sont pas respectés, vous pouvez adresser
          une réclamation à la CNIL (<a href="https://www.cnil.fr/fr/plaintes" rel="noopener noreferrer" target="_blank">cnil.fr</a>).
        </p>
      </>
    ),
  },
  ];
}

export default function PrivacyPage() {
  const info = legalInfo();
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
      sections={sections(
        { company: info.company, email: info.email },
        walletPrivacyNotice({
          apple: integrationStatus().appleWalletConfigured,
          google: integrationStatus().googleWalletConfigured,
        }),
      )}
      updatedAt={info.updatedAt}
    />
  );
}
