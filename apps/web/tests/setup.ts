/**
 * Environnement minimal pour les tests unitaires.
 * Le noyau de configuration est obligatoire au chargement du module
 * env : on lui donne des valeurs factices, jamais de vraies clés.
 */
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'anon-de-test';
process.env.NEXT_PUBLIC_SITE_URL ??= 'https://votretour.test';
process.env.SESSION_HASH_SECRET ??= 'poivre-de-test-0123456789';
