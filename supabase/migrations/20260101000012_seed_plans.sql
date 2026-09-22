-- =====================================================================
-- VotreTour — 0012 : catalogue d'offres (prix modifiables en super-admin)
-- =====================================================================
-- -1 = illimité. Les identifiants Stripe sont renseignés depuis
-- l'espace super-admin ou par variable d'environnement au déploiement.

insert into public.plans (
  code, name, tagline, description, price_month_cents, price_year_cents,
  trial_days, max_locations, max_staff, max_plates, max_queues, history_days,
  features, sort_order
) values
  (
    'starter', 'Starter',
    'Un commerce, une file, zéro friction.',
    'Pour un salon, un garage ou une boutique qui veut arrêter de faire patienter les gens sur une chaise.',
    1900, 19000, 14, 1, 3, 2, 1, 30,
    jsonb_build_object(
      'realtime', true, 'webPush', true, 'appClip', true, 'qr', true, 'nfc', true,
      'googleReview', true, 'stats', 'basic', 'export', false,
      'customBranding', false, 'multiQueue', false, 'api', false, 'support', 'email'
    ),
    10
  ),
  (
    'pro', 'Pro',
    'Plusieurs professionnels, une file qui suit.',
    'File commune ou file par professionnel, statistiques détaillées et plaques illimitées.',
    4900, 49000, 14, 3, 12, -1, 4, 180,
    jsonb_build_object(
      'realtime', true, 'webPush', true, 'appClip', true, 'qr', true, 'nfc', true,
      'googleReview', true, 'stats', 'advanced', 'export', true,
      'customBranding', true, 'multiQueue', true, 'api', false, 'support', 'priority'
    ),
    20
  ),
  (
    'business', 'Business',
    'Plusieurs établissements, un seul tableau de bord.',
    'Multi-établissements, rôles avancés, historique long et accès API.',
    12900, 129000, 14, -1, -1, -1, -1, 730,
    jsonb_build_object(
      'realtime', true, 'webPush', true, 'appClip', true, 'qr', true, 'nfc', true,
      'googleReview', true, 'stats', 'advanced', 'export', true,
      'customBranding', true, 'multiQueue', true, 'api', true, 'support', 'dedicated'
    ),
    30
  )
on conflict (code) do update set
  name              = excluded.name,
  tagline           = excluded.tagline,
  description       = excluded.description,
  max_locations     = excluded.max_locations,
  max_staff         = excluded.max_staff,
  max_plates        = excluded.max_plates,
  max_queues        = excluded.max_queues,
  history_days      = excluded.history_days,
  features          = excluded.features,
  sort_order        = excluded.sort_order;
