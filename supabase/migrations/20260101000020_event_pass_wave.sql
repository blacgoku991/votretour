-- =====================================================================
-- Numéro de vague d'un pass Event, compté en base
-- =====================================================================
--
-- Une vague est émise en une seule transaction : tous ses pass
-- partagent le même issued_at. Le numéro de vague d'un pass est donc le
-- nombre d'émissions distinctes de l'événement jusqu'à la sienne. La
-- page /pass le calculait en relisant les pass émis par pages de 1000,
-- à chaque affichage : jusqu'à 50 requêtes par client, au moment précis
-- où toute une vague ouvre son pass. Une seule requête suffit.
-- =====================================================================

create or replace function public.event_pass_wave(p_event_id uuid, p_issued_at timestamptz)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(distinct issued_at)::int
  from public.event_access_passes
  where event_id = p_event_id and issued_at <= p_issued_at;
$$;

revoke all on function public.event_pass_wave(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.event_pass_wave(uuid, timestamptz) to service_role;
