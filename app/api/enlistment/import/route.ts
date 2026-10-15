import { NextRequest, NextResponse } from 'next/server';
import { parseEnlistmentFile } from '@/lib/enlistment-parser';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return NextResponse.json({ error: 'Choose an enlistment CSV or XLSX file.' }, { status: 400 });

    const preview = await parseEnlistmentFile(file);
    const mode = request.nextUrl.searchParams.get('mode') || 'preview';
    if (mode === 'preview') {
      return NextResponse.json({
        fileName: file.name,
        rowsTotal: preview.rows.length,
        sourceColumns: preview.sourceColumns,
        warnings: preview.warnings,
        sample: preview.rows.slice(0, 8).map((row) => ({
          sourceRow: row.source_row,
          barcode: row.barcode,
          name: row.name,
          brand: row.brand,
          category: row.category,
          tp: row.tp,
          mrp: row.mrp,
        })),
      });
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.rpc('commit_enlistment_import_v1', {
      payload: {
        source_file_name: file.name,
        warnings: preview.warnings,
        rows: preview.rows,
      },
    });
    if (error) throw error;
    return NextResponse.json({ ok: true, result: data, warnings: preview.warnings });
  } catch (error) {
    console.error('Enlistment import failed:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to import enlistment file.' }, { status: 400 });
  }
}
