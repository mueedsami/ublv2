import { NextResponse } from 'next/server';
import { parseMasterWorkbook } from '@/lib/master-parser';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export const runtime = 'nodejs';

type SupabaseLikeError = {
  message?: unknown;
  details?: unknown;
  hint?: unknown;
  code?: unknown;
};

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const e = error as SupabaseLikeError;
    const parts = [e.message, e.details, e.hint]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
    const code = typeof e.code === 'string' && e.code ? ` [${e.code}]` : '';
    if (parts.length) return `${parts.join(' — ')}${code}`;
  }
  return 'Master import failed.';
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Master file is required.' }, { status: 400 });
    }

    const parsed = await parseMasterWorkbook(Buffer.from(await file.arrayBuffer()));
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.rpc('replace_master_v2', {
      p_payload: {
        file_name: file.name,
        sheet_name: parsed.sheetName,
        products: parsed.products,
      },
    });

    if (error) {
      console.error('replace_master_v2 failed', error);
      return NextResponse.json(
        { error: errorText(error), code: error.code ?? null },
        { status: 500 },
      );
    }

    return NextResponse.json({
      result: data,
      preview: {
        rowCount: parsed.rowCount,
        basepackCount: parsed.basepackCount,
        activeCount: parsed.activeCount,
        inactiveCount: parsed.inactiveCount,
        mappingCount: parsed.mappingCount,
      },
    });
  } catch (error) {
    console.error('Master commit failed', error);
    return NextResponse.json({ error: errorText(error) }, { status: 500 });
  }
}
