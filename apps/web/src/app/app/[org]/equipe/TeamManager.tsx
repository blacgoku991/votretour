'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader, Section, SettingRow, Toggle, EmptyState } from '@/components/Page';
import { addStaff, updateStaff, inviteMember, updateMember } from '@/server/actions/team';
import { initials } from '@/lib/format';
import styles from './team.module.css';

/**
 * ÉQUIPE.
 *
 * Deux notions distinctes, et c'est volontaire :
 *
 *  • les PROFESSIONNELS apparaissent dans la file et prennent des
 *    clients. Un prénom suffit : ils n'ont pas besoin de compte.
 *
 *  • les ACCÈS sont les comptes qui peuvent ouvrir le tableau de bord.
 *    Un barbier n'a pas forcément besoin d'un accès, et un gérant
 *    n'apparaît pas forcément dans la file.
 */

const ACCENTS = ['signal', 'jade', 'cobalt', 'copper', 'brique', 'ardoise'] as const;
const ROLE_LABEL: Record<string, string> = {
  owner: 'Propriétaire', admin: 'Administrateur',
  manager: 'Responsable', member: 'Équipier',
};
const ROLE_HINT: Record<string, string> = {
  owner: 'Tous les droits, y compris la facturation et la suppression.',
  admin: 'Tout sauf la suppression de l’organisation.',
  manager: 'File, plaques et statistiques.',
  member: 'Peut seulement faire avancer la file.',
};

interface Staff {
  id: string; display_name: string; role_title: string | null; accent: string;
  is_active: boolean; accepts_queue: boolean; is_on_break: boolean;
  sort_order: number; location_id: string; user_id: string | null;
}
interface Member {
  id: string; role: string; status: string; invited_email: string | null;
  user_id: string | null; created_at: string;
  profiles: { full_name: string | null; email: string | null }[] | { full_name: string | null; email: string | null } | null;
}

export function TeamManager({
  organizationId, canManage, currentUserId, staff, locations, members, quota,
}: {
  organizationId: string;
  canManage: boolean;
  currentUserId: string;
  staff: Staff[];
  locations: { id: string; name: string }[];
  members: Member[];
  quota: { used: number; limit: number; allowed: boolean } | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [newName, setNewName] = useState('');
  const [newLocation, setNewLocation] = useState(locations[0]?.id ?? '');
  const [invite, setInvite] = useState({ email: '', role: 'manager' as 'admin' | 'manager' | 'member' });
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) { setError(result.error ?? 'Action impossible.'); return; }
      router.refresh();
    });
  };

  const profileOf = (member: Member) => {
    const p = member.profiles;
    return Array.isArray(p) ? p[0] : p;
  };

  return (
    <div className={`shell ${styles.page}`}>
      <PageHeader
        title="Équipe"
        description="Les professionnels apparaissent dans la file. Les accès ouvrent le tableau de bord. Les deux sont indépendants."
        actions={quota && quota.limit >= 0 ? (
          <span className="chip">{quota.used} / {quota.limit} professionnels</span>
        ) : undefined}
      />

      {error && <div className="banner banner--error" role="alert"><span>{error}</span></div>}

      {/* ---------------- Professionnels ---------------- */}
      <Section
        title="Professionnels"
        description="Ce sont eux qui prennent les clients. Aucun compte n’est nécessaire."
      >
        {staff.length === 0 ? (
          <EmptyState
            title="Aucun professionnel"
            description="Ajoutez au moins une personne pour pouvoir attribuer les clients."
          />
        ) : (
          staff.map((member) => (
            <div key={member.id} className={styles.staffRow}>
              <span className={styles.avatar} data-accent={member.accent}>
                {initials(member.display_name)}
              </span>

              <div className={styles.staffText}>
                {canManage ? (
                  <input
                    className={styles.inlineInput}
                    defaultValue={member.display_name}
                    maxLength={60}
                    aria-label={`Nom de ${member.display_name}`}
                    onBlur={(e) => {
                      const value = e.target.value.trim();
                      if (!value || value === member.display_name) return;
                      run(() => updateStaff({ organizationId, staffId: member.id, displayName: value }));
                    }}
                  />
                ) : (
                  <p className={styles.staffName}>{member.display_name}</p>
                )}
                <p className="t-micro t-faint">
                  {member.role_title || 'Professionnel'}
                  {locations.length > 1 &&
                    ` · ${locations.find((l) => l.id === member.location_id)?.name ?? ''}`}
                  {member.user_id ? ' · a un accès' : ''}
                </p>
              </div>

              {canManage && (
                <div className={styles.staffControls}>
                  <select
                    className={styles.accentPicker}
                    value={member.accent}
                    aria-label={`Couleur de ${member.display_name}`}
                    data-accent={member.accent}
                    onChange={(e) =>
                      run(() => updateStaff({
                        organizationId, staffId: member.id, accent: e.target.value as never,
                      }))}
                  >
                    {ACCENTS.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>

                  <Toggle
                    checked={member.is_active}
                    label={`Activer ${member.display_name}`}
                    onChange={(value) =>
                      run(() => updateStaff({ organizationId, staffId: member.id, isActive: value }))}
                  />
                </div>
              )}
            </div>
          ))
        )}

        {canManage && (
          <div className={styles.addRow}>
            <input
              className="input"
              placeholder="Prénom du professionnel"
              value={newName}
              maxLength={60}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || !newName.trim()) return;
                run(async () => {
                  const r = await addStaff({
                    organizationId, locationId: newLocation, displayName: newName.trim(),
                  });
                  if (r.ok) setNewName('');
                  return r;
                });
              }}
            />
            {locations.length > 1 && (
              <select className="select" value={newLocation}
                onChange={(e) => setNewLocation(e.target.value)} aria-label="Établissement">
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            )}
            <button
              type="button" className="btn btn--solid"
              disabled={pending || !newName.trim() || !newLocation}
              onClick={() => run(async () => {
                const r = await addStaff({
                  organizationId, locationId: newLocation, displayName: newName.trim(),
                });
                if (r.ok) setNewName('');
                return r;
              })}
            >
              Ajouter
            </button>
          </div>
        )}
      </Section>

      {/* ---------------- Accès au tableau de bord ---------------- */}
      <Section
        title="Accès au tableau de bord"
        description="Qui peut se connecter et avec quels droits."
      >
        {members.map((member) => {
          const profile = profileOf(member);
          const isSelf = member.user_id === currentUserId;
          return (
            <SettingRow
              key={member.id}
              label={profile?.full_name || member.invited_email || 'Invitation en attente'}
              hint={
                member.status === 'invited'
                  ? `Invitation envoyée à ${member.invited_email}`
                  : `${profile?.email ?? ''}${isSelf ? ' · vous' : ''}`
              }
            >
              {canManage && !isSelf ? (
                <select
                  className="select"
                  value={member.role}
                  aria-label={`Rôle de ${profile?.full_name ?? member.invited_email}`}
                  onChange={(e) =>
                    run(() => updateMember({
                      organizationId, memberId: member.id, role: e.target.value as never,
                    }))}
                >
                  {Object.entries(ROLE_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              ) : (
                <span className="chip">{ROLE_LABEL[member.role] ?? member.role}</span>
              )}
            </SettingRow>
          );
        })}

        {canManage && (
          <div className={styles.addRow}>
            <input
              className="input" type="email" placeholder="collegue@votre-salon.fr"
              value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })}
              aria-label="Adresse e-mail à inviter"
            />
            <select className="select" value={invite.role}
              onChange={(e) => setInvite({ ...invite, role: e.target.value as never })}
              aria-label="Rôle">
              <option value="manager">Responsable</option>
              <option value="admin">Administrateur</option>
              <option value="member">Équipier</option>
            </select>
            <button
              type="button" className="btn btn--solid"
              disabled={pending || !invite.email.includes('@')}
              onClick={() => startTransition(async () => {
                setError(null);
                const result = await inviteMember({
                  organizationId, email: invite.email.trim(), role: invite.role,
                });
                if (!result.ok) { setError(result.error); return; }
                setInviteUrl(result.data.inviteUrl);
                setInvite({ ...invite, email: '' });
                router.refresh();
              })}
            >
              Inviter
            </button>
          </div>
        )}

        {inviteUrl && (
          <div className={styles.inviteResult}>
            <p className="t-small">
              Invitation créée. <strong>Transmettez ce lien vous-même</strong> — nous n’envoyons
              pas d’e-mail à votre place.
            </p>
            <div className={styles.inviteUrl}>
              <code>{inviteUrl}</code>
              <button type="button" className="btn btn--ghost btn--sm"
                onClick={() => navigator.clipboard.writeText(inviteUrl)}>
                Copier
              </button>
            </div>
          </div>
        )}

        <div className={styles.roleLegend}>
          {Object.entries(ROLE_HINT).map(([role, hint]) => (
            <p key={role} className="t-micro t-faint">
              <strong>{ROLE_LABEL[role]}</strong> — {hint}
            </p>
          ))}
        </div>
      </Section>
    </div>
  );
}
