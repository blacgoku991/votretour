-- =====================================================================
-- Rangvia — 0022 : rattrapage d'un pass Google devenu « tenu à jour »
-- ---------------------------------------------------------------------
-- Un objet Google est inséré au clic « Ajouter à Google Wallet », puis
-- marqué `live` par wallet_google_mark_live. Entre l'émission du pass et
-- ce marquage, la file d'envoi ignore le pass (enqueue_wallet_updates ne
-- retient que les passes `live`) : un changement survenu pendant
-- l'insertion (le client passe de 1 à 0 devant lui, par exemple) n'était
-- donc jamais poussé, et l'alerte correspondante était perdue.
--
-- Au marquage, on met désormais le pass en file, en priorité. Le vidage
-- recalcule l'empreinte : si rien n'a changé depuis l'insertion, aucun
-- PATCH n'est envoyé ; sinon l'objet est mis à jour, et decideAlertFor
-- décide seul d'une éventuelle alerte (le registre des alertes empêche
-- tout doublon).
-- =====================================================================
begin;

create or replace function public.wallet_google_mark_live(p_pass_id uuid, p_hash text)
returns boolean
language plpgsql
security definer
set search_path = public, internal, extensions, pg_temp
as $$
begin
  update public.wallet_passes
     set live = true,
         synced_hash = coalesce(p_hash, synced_hash),
         last_synced_at = now(),
         last_error = null
   where id = p_pass_id
     and provider = 'google'
     and state in ('active', 'final');
  if not found then
    return false;
  end if;
  perform internal.enqueue_wallet_updates(array[p_pass_id], 'live', true);
  return true;
end;
$$;

revoke all on function public.wallet_google_mark_live(uuid, text) from public, anon, authenticated;
grant execute on function public.wallet_google_mark_live(uuid, text) to service_role;

commit;

notify pgrst, 'reload schema';
