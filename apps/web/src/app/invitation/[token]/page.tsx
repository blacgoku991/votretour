import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getSessionUser } from '@/server/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { hashInviteToken } from '@/lib/crypto';
import { audit } from '@/server/audit';
import { AuthFrame } from '../../(auth)/AuthFrame';
import { FloorPanel } from '../../(auth)/panels';
import styles from '../../(auth)/auth.module.css';

export const metadata: Metadata = { title: 'Invitation', robots: { index: false } };
export const dynamic = 'force-dynamic';

const ROLE_LABEL: Record<string, string> = {
  owner: 'propriétaire', admin: 'administrateur',
  manager: 'responsable', member: 'équipier',
};

/**
 * Acceptation d'une invitation.
 *
 * Le lien porte un jeton en clair ; la base n'en stocke que le
 * condensat. On exige en outre que le compte connecté ait la MÊME
 * adresse e-mail que celle invitée : un lien qui fuite ne suffit donc
 * pas à entrer dans l'organisation de quelqu'un d'autre.
 */
export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const user = await getSessionUser();

  if (!user) {
    redirect(`/connexion?next=${encodeURIComponent(`/invitation/${token}`)}`);
  }

  const db = supabaseAdmin();
  const { data: invite } = await db
    .from('organization_members')
    .select('id, organization_id, role, status, invited_email, invite_expires_at, organizations(name, slug)')
    .eq('invite_token_hash', hashInviteToken(token))
    .maybeSingle();

  const organization = Array.isArray(invite?.organizations)
    ? invite?.organizations[0] : invite?.organizations;

  const problem = (() => {
    if (!invite) return "Cette invitation n'existe pas ou a déjà été utilisée.";
    if (invite.status === 'active') return 'Cette invitation a déjà été acceptée.';
    if (invite.invite_expires_at && new Date(invite.invite_expires_at) < new Date()) {
      return 'Cette invitation a expiré. Demandez-en une nouvelle.';
    }
    if (
      invite.invited_email &&
      user.email &&
      invite.invited_email.toLowerCase() !== user.email.toLowerCase()
    ) {
      return `Cette invitation a été envoyée à ${invite.invited_email}. Connectez-vous avec cette adresse.`;
    }
    return null;
  })();

  if (problem || !invite || !organization) {
    // Personne n'attend à cette place : une latte fantôme.
    return (
      <AuthFrame
        switchHref="/app"
        switchLabel="Mon espace"
        band={[
          { id: 'i0', state: 'wait' },
          { id: 'i1', state: 'wait' },
          { id: 'i2', state: 'ghost' },
        ]}
        aside={
          <FloorPanel
            slats={[
              { id: 'i0', state: 'serving' },
              { id: 'i1', state: 'wait' },
              { id: 'i2', state: 'ghost', label: 'Place libre' },
            ]}
            caption="Une invitation, une place dans l’équipe."
          />
        }
      >
        <div className={styles.head}>
          <h1 className="t-display">Invitation indisponible</h1>
          <p className={styles.problem}>{problem}</p>
        </div>
        <Link href="/app" className="btn btn--ghost btn--lg btn--block">Aller à mon espace</Link>
      </AuthFrame>
    );
  }

  // L'invitation est valide : on la convertit en appartenance.
  await db.from('organization_members').update({
    user_id: user.id,
    status: 'active',
    accepted_at: new Date().toISOString(),
    invite_token_hash: null,
    invite_expires_at: null,
  }).eq('id', invite.id);

  await audit({
    organizationId: invite.organization_id,
    actorUserId: user.id,
    action: 'member.accepted',
    targetType: 'member',
    targetId: invite.id,
    metadata: { role: invite.role },
  });

  return (
    <AuthFrame
      band={[
        { id: 'a0', state: 'serving' },
        { id: 'a1', state: 'wait' },
        { id: 'a2', state: 'self' },
      ]}
      aside={
        <FloorPanel
          spill
          slats={[
            { id: 'a0', state: 'serving' },
            { id: 'a1', state: 'wait' },
            { id: 'a2', state: 'self', label: 'Vous', hint: shortName(organization.name) },
          ]}
          caption="Votre place dans l’équipe est prête."
        />
      }
    >
      <div className={styles.head}>
        <p className={`t-label ${styles.accepted}`}>Invitation acceptée</p>
        <h1 className="t-display">Bienvenue chez {organization.name}</h1>
        <p className={`t-lead ${styles.lead}`}>
          Vous y êtes {ROLE_LABEL[invite.role] ?? invite.role}.
        </p>
      </div>
      <Link href={`/app/${organization.slug}/file`} className="btn btn--signal btn--lg btn--block">
        Ouvrir la file
      </Link>
    </AuthFrame>
  );
}

/** La latte n'a qu'une ligne : un nom long est raccourci proprement. */
function shortName(name: string): string {
  const max = 24;
  return name.length > max ? `${name.slice(0, max - 1).trimEnd()}…` : name;
}
