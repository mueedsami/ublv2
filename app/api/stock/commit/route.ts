import { NextResponse } from 'next/server';
import { parseDarazWorkbook, parseFoodiWorkbook, parseOthobaWorkbook, parsePandamartWorkbook, parseShajgojWorkbook, parseStockWorkbook, resolveAccountStockConfig } from '@/lib/stock-parser';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export const runtime = 'nodejs';

type SupabaseLikeError = { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const e = error as SupabaseLikeError;
    const parts = [e.message, e.details, e.hint].filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
    const code = typeof e.code === 'string' && e.code ? ` [${e.code}]` : '';
    if (parts.length) return `${parts.join(' — ')}${code}`;
  }
  return 'Stock upload failed.';
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return NextResponse.json({ error: 'Stock file is required.' }, { status: 400 });
    const accountCode = String(form.get('accountCode') ?? '');
    const requestedSnapshotDate = String(form.get('snapshotDate') ?? '');
    const fallback = {
      sheetName: String(form.get('sheetName') ?? ''),
      headerRow: Number(form.get('headerRow') ?? 1),
      skuColumn: String(form.get('skuColumn') ?? ''),
      stockColumns: JSON.parse(String(form.get('stockColumns') ?? '[]')) as string[],
      mode: (String(form.get('mode') ?? 'quantity') === 'availability' ? 'availability' : 'quantity') as 'quantity' | 'availability',
    };

    if (!accountCode) return NextResponse.json({ error: 'Account is required.' }, { status: 400 });
    const buffer = Buffer.from(await file.arrayBuffer());
    const resolved = await resolveAccountStockConfig(buffer, accountCode, fallback, requestedSnapshotDate || undefined);
    const snapshotDate = resolved.snapshotDate ?? requestedSnapshotDate;
    if (!snapshotDate) return NextResponse.json({ error: 'Snapshot date is required.' }, { status: 400 });

    const supabase = getSupabaseAdmin();


    if (accountCode === 'daraz') {
      const parsed = await parseDarazWorkbook(buffer, snapshotDate);
      const { data, error } = await supabase.rpc('commit_daraz_upload_v2', { p_payload: {
        snapshot_date: snapshotDate, file_name: file.name, sheet_name: parsed.currentSheet,
        input_rows: parsed.stockInputRows, normal_input_rows: parsed.normalInputRows, ignored_non_normal_rows: parsed.ignoredNonNormalRows,
        duplicate_sku_rows: parsed.duplicateSkuRows, total_units: parsed.totalUnits, total_stock_valuation: parsed.totalStockValuation,
        rows: parsed.networkRows, stock_rows: parsed.stockRows,
      }});
      if (error) {
        console.error('commit_daraz_upload_v2 failed', error);
        return NextResponse.json({ error: errorText(error), code: error.code ?? null }, { status: 500 });
      }
      return NextResponse.json({ result: data, snapshotDate, profileName: resolved.profileName });
    }

    if (accountCode === 'pandamart') {
      const parsed = await parsePandamartWorkbook(buffer);
      const { data, error } = await supabase.rpc('commit_pandamart_upload_v2', {
        p_payload: {
          snapshot_date: parsed.stockDate,
          file_name: file.name,
          sheet_name: resolved.config.sheetName,
          stock_columns: parsed.branchCodes,
          input_rows: parsed.stockInputRows,
          duplicate_sku_rows: parsed.duplicateSkuRows,
          total_units: parsed.storeUnits,
          rows: parsed.networkRows,
          branch_stock: parsed.branchStockRows,
          sales: parsed.salesRows,
        },
      });
      if (error) {
        console.error('commit_pandamart_upload_v2 failed', error);
        return NextResponse.json({ error: errorText(error), code: error.code ?? null }, { status: 500 });
      }
      return NextResponse.json({ result: data, snapshotDate: parsed.stockDate, profileName: resolved.profileName });
    }

    if (accountCode === 'shajgoj') {
      const parsed = await parseShajgojWorkbook(buffer, snapshotDate);
      const { data, error } = await supabase.rpc('commit_shajgoj_upload_v2', {
        p_payload: {
          snapshot_date: snapshotDate,
          file_name: file.name,
          sheet_name: parsed.currentSheet,
          input_rows: parsed.stockInputRows,
          duplicate_sku_rows: parsed.duplicateSkuRows,
          total_units: parsed.totalUnits,
          rows: parsed.networkRows,
          stock_rows: parsed.stockRows,
          sales_rows: parsed.salesRows,
        },
      });
      if (error) {
        console.error('commit_shajgoj_upload_v2 failed', error);
        return NextResponse.json({ error: errorText(error), code: error.code ?? null }, { status: 500 });
      }
      return NextResponse.json({
        result: data,
        snapshotDate,
        profileName: resolved.profileName,
        currentSalesPeriod: parsed.currentSalesPeriod,
        historicalSalesPeriods: parsed.historicalSalesPeriods,
      });
    }


    if (accountCode === 'othoba') {
      const parsed = await parseOthobaWorkbook(buffer, snapshotDate);
      const { data, error } = await supabase.rpc('commit_othoba_upload_v2', { p_payload: {
        snapshot_date: snapshotDate, file_name: file.name, sheet_name: parsed.currentSheet,
        input_rows: parsed.stockInputRows, duplicate_sku_rows: parsed.duplicateSkuRows, total_units: parsed.totalUnits,
        rows: parsed.networkRows, stock_rows: parsed.stockRows, sales_snapshot_rows: parsed.salesSnapshotRows,
        monthly_sales_rows: parsed.monthlySalesRows,
      }});
      if (error) {
        console.error('commit_othoba_upload_v2 failed', error);
        return NextResponse.json({ error: errorText(error), code: error.code ?? null }, { status: 500 });
      }
      return NextResponse.json({ result: data, snapshotDate, profileName: resolved.profileName, currentSalesPeriod: parsed.currentSalesPeriod, historicalSalesPeriods: parsed.historicalSalesPeriods, monthlySalesPeriods: parsed.monthlySalesPeriods });
    }

    if (accountCode === 'foodi') {
      const parsed = await parseFoodiWorkbook(buffer, snapshotDate);
      const { data, error } = await supabase.rpc('commit_foodi_upload_v2', {
        p_payload: {
          snapshot_date: snapshotDate,
          file_name: file.name,
          sheet_name: parsed.currentSheet,
          input_rows: parsed.stockInputRows,
          duplicate_sku_rows: parsed.duplicateSkuRows,
          total_units: parsed.totalUnits,
          rows: parsed.networkRows,
          stock_rows: parsed.stockRows,
          sales_rows: parsed.salesRows,
        },
      });
      if (error) {
        console.error('commit_foodi_upload_v2 failed', error);
        return NextResponse.json({ error: errorText(error), code: error.code ?? null }, { status: 500 });
      }
      return NextResponse.json({
        result: data,
        snapshotDate,
        profileName: resolved.profileName,
        salesPeriodStart: parsed.salesPeriodStart,
        salesPeriodEnd: parsed.salesPeriodEnd,
        totalSoldQty: parsed.totalSoldQty,
      });
    }

    const parsed = await parseStockWorkbook(buffer, resolved.config);
    const { data, error } = await supabase.rpc('commit_stock_upload_v2', {
      p_payload: {
        account_code: accountCode,
        snapshot_date: snapshotDate,
        file_name: file.name,
        sheet_name: resolved.config.sheetName,
        sku_column: resolved.config.skuColumn,
        stock_columns: resolved.config.stockColumns,
        stock_mode: resolved.config.mode,
        input_rows: parsed.rowCount,
        duplicate_sku_rows: parsed.duplicateSkuRows,
        total_units: parsed.totalUnits,
        rows: parsed.rows,
      },
    });
    if (error) {
      console.error('commit_stock_upload_v2 failed', error);
      return NextResponse.json({ error: errorText(error), code: error.code ?? null }, { status: 500 });
    }
    return NextResponse.json({ result: data, snapshotDate, profileName: resolved.profileName });
  } catch (error) {
    console.error('Stock commit failed', error);
    return NextResponse.json({ error: errorText(error) }, { status: 500 });
  }
}
