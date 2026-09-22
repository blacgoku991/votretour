import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Sonde de santé.
 *
 * Utilisée par Docker, par un répartiteur de charge ou par une
 * supervision externe. Elle vérifie ce qui compte vraiment : que la
 * base répond. Un serveur qui démarre mais ne joint plus PostgreSQL
 * n'est pas en bonne santé, même s'il renvoie du HTML.
 *
 * Aucune information interne n'est divulguée : ni version, ni trace, ni
 * nom d'hôte. Juste un état et une durée.
 */
export async function GET() {
  const startedAt = Date.now();
  try {
    const { error } = await supabaseAdmin()
      .from('plans')
      .select('code')
      .limit(1);
    if (error) throw error;

    return NextResponse.json(
      { status: 'ok', databaseMs: Date.now() - startedAt },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return NextResponse.json(
      { status: 'degraded', databaseMs: Date.now() - startedAt },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
