-- =====================================================================
-- Rangvia — 0014 : suivi des clics vers les avis Google
-- ---------------------------------------------------------------------
-- Mesure uniquement des événements techniques : aucun prénom, e-mail,
-- téléphone ou autre donnée client n'est nécessaire pour ces statistiques.
-- Un passage terminé ne compte qu'une fois, même si le client clique
-- plusieurs fois sur le bouton d'avis.
-- =====================================================================

alter table public.notification_deliveries
  add column if not exists location_id uuid references public.locations (id) on delete set null;

update public.notification_deliveries d
set location_id = e.location_id
from public.queue_entries e
where d.location_id is null
  and d.queue_entry_id = e.id;

create index if not exists notification_deliveries_location_idx
  on public.notification_deliveries (location_id, created_at desc);

create table if not exists public.review_clicks (
  id               bigint generated always as identity primary key,
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  location_id      uuid not null references public.locations (id) on delete cascade,
  queue_entry_id   uuid not null references public.queue_entries (id) on delete cascade,
  entry_public_id  text not null,
  source           text not null default 'unknown'
                   check (source in ('notification', 'appclip_done', 'web_done', 'unknown')),
  created_at       timestamptz not null default now()
);

create unique index if not exists review_clicks_one_per_visit
  on public.review_clicks (queue_entry_id);

create index if not exists review_clicks_location_idx
  on public.review_clicks (location_id, created_at desc);

alter table public.review_clicks enable row level security;
revoke all on table public.review_clicks from anon, authenticated;
grant all on table public.review_clicks to service_role;

comment on table public.review_clicks is
  'Clic unique par passage terminé vers la fiche Google. Aucun identifiant personnel n''est stocké.';
