import 'server-only';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { isStockCode } from '@/lib/plate-stock';

export interface UnassignedStockPlate {
  code: string;
  serial: number;
  status: 'available' | 'void';
}

/**
 * Une plaque de stock pas (ou plus) en service.
 *
 * Appelée seulement quand un lien public ne mène à aucune file : le
 * visiteur tient peut-être une plaque livrée mais pas encore attribuée.
 * On le lui dit, au lieu d'une page introuvable.
 */
export async function findUnassignedStockPlate(slug: string): Promise<UnassignedStockPlate | null> {
  const code = slug.trim().toLowerCase();
  if (!isStockCode(code)) return null;

  const { data } = await supabaseAdmin()
    .from('plate_stock')
    .select('code, serial, status')
    .eq('code', code)
    .in('status', ['available', 'void'])
    .maybeSingle();

  return data ? (data as UnassignedStockPlate) : null;
}
