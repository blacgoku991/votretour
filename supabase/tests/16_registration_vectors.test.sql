-- =====================================================================
-- Rangvia — vecteurs d'immatriculation partagés avec le registre TS
-- ---------------------------------------------------------------------
-- apps/web/src/lib/profiles/registration-vectors.json est rejoué ici par
-- internal.normalize_registration / internal.mask_registration, et par
-- vitest côté TypeScript : les deux côtés doivent donner la même clé de
-- recherche et le même masquage (l'écran TV ne lit que le SQL).
-- =====================================================================
\set vectors `cat "$(git rev-parse --show-toplevel)/apps/web/src/lib/profiles/registration-vectors.json"`
select set_config('test.registration_vectors', :'vectors', false) \g /dev/null

do $t$
declare
  v jsonb := current_setting('test.registration_vectors')::jsonb;
  r jsonb;
  got text;
  n int := 0;
begin
  for r in select * from jsonb_array_elements(v -> 'normalize') loop
    got := coalesce(internal.normalize_registration(r ->> 0), '');
    if got <> r ->> 1 then
      raise exception 'normalize(%) = %, attendu %', r ->> 0, got, r ->> 1;
    end if;
    n := n + 1;
  end loop;
  for r in select * from jsonb_array_elements(v -> 'mask') loop
    got := coalesce(internal.mask_registration(r ->> 0), '');
    if got <> r ->> 1 then
      raise exception 'mask(%) = %, attendu %', r ->> 0, got, r ->> 1;
    end if;
    n := n + 1;
  end loop;
  if n = 0 then
    raise exception 'aucun vecteur lu';
  end if;
  raise notice '✅ % vecteurs d’immatriculation identiques au registre TS', n;
end
$t$;
