import { NextResponse } from 'next/server';
import { z } from 'zod';
import { publicIdSchema } from '@/lib/api';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const querySchema = z.object({
  entry: publicIdSchema,
  source: z.enum(['notification', 'appclip_done', 'web_done']).catch('unknown'),
});

/**
 * Redirection mesurée vers l'avis Google.
 *
 * Le public_id du ticket est aléatoire et non devinable. Le lien Google
 * n'est révélé qu'une fois la prestation réellement terminée.
 * Un passage ne compte qu'un clic, même si le client retape le bouton.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    entry: url.searchParams.get('entry'),
    source: url.searchParams.get('source') ?? 'unknown',
  });

  if (!parsed.success) {
    return NextResponse.redirect(new URL('/', url), 302);
  }

  const db = supabaseAdmin();

  const { data: entry } = await db
    .from('queue_entries')
    .select('id, public_id, organization_id, location_id, status')
    .eq('public_id', parsed.data.entry)
    .maybeSingle();

  if (!entry || entry.status !== 'completed') {
    return NextResponse.redirect(new URL('/', url), 302);
  }

  const { data: location } = await db
    .from('locations')
    .select('google_review_url')
    .eq('id', entry.location_id)
    .maybeSingle();

  const target = location?.google_review_url;
  if (!target || !/^https:\/\//i.test(target)) {
    return NextResponse.redirect(new URL('/', url), 302);
  }

  await db.from('review_clicks').upsert(
    {
      organization_id: entry.organization_id,
      location_id: entry.location_id,
      queue_entry_id: entry.id,
      entry_public_id: entry.public_id,
      source: parsed.data.source,
    },
    { onConflict: 'queue_entry_id', ignoreDuplicates: true },
  );

  return NextResponse.redirect(target, 302);
}
