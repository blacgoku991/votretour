'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader, Section, Toggle, EmptyState } from '@/components/Page';
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
 *
 * Présentation : chaque personne est une latte accrochée au rail
 * (initiales sur carreau, prénom, rôle, point d'état, passages du jour).
 * Une invitation en attente est une latte en pointillés.
 */

const ACCENTS = [
  { value: 'signal', label: 'Vermillon' },
  { value: 'jade', label: 'Jade' },
  { value: 'cobalt', label: 'Cobalt' },
  { value: 'copper', label: 'Cuivre' },
  { value: 'brique', label: 'Brique' },
  { value: 'ardoise', label: 'Ardoise' },
] as const;
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

type StaffState = 'serving' | 'available' | 'break' | 'away' | 'off';
const STATE_LABEL: Record<StaffState, string> = {
  serving: 'En prestation',
  available: 'Disponible',
  break: 'En pause',
  away: 'Hors file',
  off: 'Désactivé',
};

export function TeamManager({
  organizationId, canManage, currentUserId, staff, locations, members, quota,
  passagesToday = {}, servingStaffIds = [],
}: {
  organizationId: string;
  canManage: boolean;
  currentUserId: string;
  staff: Staff[];
  locations: { id: string; name: string }[];
  members: Member[];
  quota: { used: number; limit: number; allowed: boolean } | null;
  /** Passages terminés aujourd'hui, par professionnel. */
  passagesToday?: Record<string, number>;
  /** Professionnels actuellement en prestation. */
  servingStaffIds?: string[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [newName, setNewName] = useState('');
  const [newLocation, setNewLocation] = useState(locations[0]?.id ?? '');
  const [invite, setInvite] = useState({ email: '', role: 'manager' as 'admin' | 'manager' | 'member' });
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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

  const stateOf = (s: Staff): StaffState => {
    if (!s.is_active) return 'off';
    if (servingStaffIds.includes(s.id)) return 'serving';
    if (s.is_on_break) return 'break';
    if (!s.accepts_queue) return 'away';
    return 'available';
  };

  const submitStaff = () => {
    if (!newName.trim() || !newLocation) return;
    run(async () => {
      const r = await addStaff({
        organizationId, locationId: newLocation, displayName: newName.trim(),
      });
      if (r.ok) setNewName('');
      return r;
    });
  };

  const activeMembers = members.filter((m) => m.status !== 'invited');
  const invited = members.filter((m) => m.status === 'invited');

  return (
    <div className={`shell ${styles.page}`}>
      <PageHeader
        title="Équipe"
        description="Les professionnels apparaissent dans la file. Les accès ouvrent le tableau de bord. Les deux sont indépendants."
        actions={quota && quota.limit >= 0 ? (
          <span className={styles.quota}>
            <span className={styles.quotaNum}>{quota.used}</span>
            <span className={styles.quotaSep}>/</span>
            <span className={styles.quotaNum}>{quota.limit}</span>
            <span className={styles.quotaLbl}>professionnels</span>
          </span>
        ) : undefined}
      />

      {error && <div className="banner banner--error" role="alert"><span>{error}</span></div>}

      {/* ---------------- Professionnels ---------------- */}
      <Section
        title="Professionnels"
        description="Ce sont eux qui prennent les clients. Aucun compte n’est nécessaire."
      >
        {staff.length === 0 && (
          <EmptyState
            title="Aucun professionnel"
            description="Ajoutez au moins une personne pour pouvoir attribuer les clients."
          />
        )}

        <ul className={styles.rang} aria-label="Professionnels">
          {staff.map((member) => {
            const state = stateOf(member);
            const count = passagesToday[member.id] ?? 0;
            const where = locations.length > 1
              ? locations.find((l) => l.id === member.location_id)?.name
              : null;
            return (
              <li key={member.id} className={styles.slat} data-state={state}>
                <span className={styles.tile} data-accent={member.accent} aria-hidden="true">
                  {initials(member.display_name)}
                </span>

                <div className={styles.who}>
                  {canManage ? (
                    <input
                      className={styles.inlineInput}
                      defaultValue={member.display_name}
                      maxLength={60}
                      aria-label={`Prénom de ${member.display_name}`}
                      onBlur={(e) => {
                        const value = e.target.value.trim();
                        if (!value || value === member.display_name) return;
                        run(() => updateStaff({ organizationId, staffId: member.id, displayName: value }));
                      }}
                    />
                  ) : (
                    <p className={styles.name}>{member.display_name}</p>
                  )}
                  <p className={styles.meta}>
                    <span className="chip">{member.role_title || 'Professionnel'}</span>
                    {where && <span>{where}</span>}
                    {member.user_id && <span>a un accès</span>}
                  </p>
                </div>

                <div className={styles.stats}>
                  <span className={styles.state}>
                    <span className={styles.dot} data-state={state} aria-hidden="true" />
                    {STATE_LABEL[state]}
                  </span>
                  <span className={styles.count}>
                    <span className={`t-num ${styles.countNum}`}>{count}</span>
                    <span className={styles.countLbl}>
                      passage{count > 1 ? 's' : ''} aujourd’hui
                    </span>
                  </span>
                </div>

                {canManage && (
                  <div className={styles.controls}>
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
                      {ACCENTS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                    </select>

                    <Toggle
                      checked={member.is_active}
                      label={`Activer ${member.display_name}`}
                      onChange={(value) =>
                        run(() => updateStaff({ organizationId, staffId: member.id, isActive: value }))}
                    />
                  </div>
                )}
              </li>
            );
          })}

          {canManage && (
            <li className={`${styles.slat} ${styles.ghost}`}>
              <span className={`${styles.tile} ${styles.tileGhost}`} aria-hidden="true">+</span>
              <div className={styles.addForm}>
                <input
                  className="input"
                  placeholder="Prénom du professionnel"
                  aria-label="Prénom du professionnel"
                  value={newName}
                  maxLength={60}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') submitStaff(); }}
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
                  onClick={submitStaff}
                >
                  Ajouter
                </button>
              </div>
            </li>
          )}
        </ul>
      </Section>

      {/* ---------------- Accès au tableau de bord ---------------- */}
      <Section
        title="Accès au tableau de bord"
        description="Qui peut se connecter et avec quels droits."
      >
        <ul className={styles.rang} aria-label="Accès">
          {activeMembers.map((member) => {
            const profile = profileOf(member);
            const isSelf = member.user_id === currentUserId;
            const label = profile?.full_name || profile?.email || member.invited_email || 'Compte';
            return (
              <li key={member.id} className={`${styles.slat} ${styles.slatAccess}`} data-self={isSelf ? '1' : undefined}>
                <span className={`${styles.tile} ${styles.tileBone}`} aria-hidden="true">{initials(label)}</span>
                <div className={styles.who}>
                  <p className={styles.name}>
                    {label}
                    {isSelf && <span className={styles.you}>vous</span>}
                  </p>
                  {profile?.email && profile.email !== label && (
                    <p className={`${styles.meta} ${styles.email}`}>{profile.email}</p>
                  )}
                </div>
                <div className={styles.roleCtl}>
                  {canManage && !isSelf ? (
                    <select
                      className="select"
                      value={member.role}
                      aria-label={`Rôle de ${label}`}
                      onChange={(e) =>
                        run(() => updateMember({
                          organizationId, memberId: member.id, role: e.target.value as never,
                        }))}
                    >
                      {Object.entries(ROLE_LABEL).map(([value, text]) => (
                        <option key={value} value={value}>{text}</option>
                      ))}
                    </select>
                  ) : (
                    <span className="chip">{ROLE_LABEL[member.role] ?? member.role}</span>
                  )}
                </div>
              </li>
            );
          })}

          {invited.map((member) => (
            <li key={member.id} className={`${styles.slat} ${styles.slatAccess} ${styles.pending}`}>
              <span className={`${styles.tile} ${styles.tileGhost}`} aria-hidden="true">
                {initials(member.invited_email)}
              </span>
              <div className={styles.who}>
                <p className={styles.name}>{member.invited_email ?? 'Invitation'}</p>
                <p className={styles.meta}>
                  <span className={styles.pendingTag}>Invitation en attente</span>
                </p>
              </div>
              <div className={styles.roleCtl}>
                {canManage ? (
                  <select
                    className="select"
                    value={member.role}
                    aria-label={`Rôle de ${member.invited_email ?? 'l’invité'}`}
                    onChange={(e) =>
                      run(() => updateMember({
                        organizationId, memberId: member.id, role: e.target.value as never,
                      }))}
                  >
                    {Object.entries(ROLE_LABEL).map(([value, text]) => (
                      <option key={value} value={value}>{text}</option>
                    ))}
                  </select>
                ) : (
                  <span className="chip">{ROLE_LABEL[member.role] ?? member.role}</span>
                )}
              </div>
            </li>
          ))}

          {canManage && (
            <li className={`${styles.slat} ${styles.ghost}`}>
              <span className={`${styles.tile} ${styles.tileGhost}`} aria-hidden="true">@</span>
              <div className={styles.addForm}>
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
                    setCopied(false);
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
            </li>
          )}
        </ul>

        {inviteUrl && (
          <div className={styles.inviteResult}>
            <p className="t-small">
              Invitation créée. <strong>Transmettez ce lien vous-même</strong> : nous n’envoyons
              pas d’e-mail à votre place.
            </p>
            <div className={styles.inviteUrl}>
              <code>{inviteUrl}</code>
              <button type="button" className="btn btn--ghost btn--sm"
                onClick={() => {
                  navigator.clipboard.writeText(inviteUrl).then(() => setCopied(true), () => {});
                }}>
                {copied ? 'Copié' : 'Copier'}
              </button>
            </div>
          </div>
        )}

        <dl className={styles.roleLegend}>
          {Object.entries(ROLE_HINT).map(([role, hint]) => (
            <div key={role} className={styles.roleLine}>
              <dt>{ROLE_LABEL[role]}</dt>
              <dd>{hint}</dd>
            </div>
          ))}
        </dl>
      </Section>
    </div>
  );
}
