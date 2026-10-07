import { NextResponse } from 'next/server';
import { parseDarazWorkbook, parseFoodiWorkbook, parseOthobaWorkbook, parsePandamartWorkbook, parseShajgojWorkbook, parseStockWorkbook, resolveAccountStockConfig } from '@/lib/stock-parser';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export const runtime = 'nodejs';

function configFrom(form: FormData) {
  return {
    accountCode: String(form.get('accountCode') ?? ''),
    snapshotDate: String(form.get('snapshotDate') ?? ''),
    sheetName: String(form.get('sheetName') ?? ''),
    headerRow: Number(form.get('headerRow') ?? 1),
    skuColumn: String(form.get('skuColumn') ?? ''),
    stockColumns: JSON.parse(String(form.get('stockColumns') ?? '[]')) as string[],
    mode: (String(form.get('mode') ?? 'quantity') === 'availability' ? 'availability' : 'quantity') as 'quantity' | 'availability',
  };
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return NextResponse.json({ error: 'Stock file is required.' }, { status: 400 });
    const cfg = configFrom(form);
    if (!cfg.accountCode) return NextResponse.json({ error: 'Account is required.' }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const resolved = await resolveAccountStockConfig(buffer, cfg.accountCode, {
      sheetName: cfg.sheetName,
      headerRow: cfg.headerRow,
      skuColumn: cfg.skuColumn,
      stockColumns: cfg.stockColumns,
      mode: cfg.mode,
    }, cfg.snapshotDate || undefined);
    const snapshotDate = resolved.snapshotDate ?? cfg.snapshotDate;
    if (!snapshotDate) return NextResponse.json({ error: 'Snapshot date is required.' }, { status: 400 });

    const supabase = getSupabaseAdmin();
    const { data: mappings, error } = await supabase
      .from('v_account_mappings')
      .select('basepack_id,account_sku,status')
      .eq('account_code', cfg.accountCode)
      .range(0, 4999);
    if (error) throw error;

    const activeMappings = ((mappings ?? []) as Array<{ basepack_id: string; account_sku: string; status: string }>).filter((m) => m.status === 'active');
    const expectedBasepacks = new Set<string>(activeMappings.map((m) => m.basepack_id));
    const idsToBasepacks = new Map<string, string[]>();
    for (const m of activeMappings) {
      const arr = idsToBasepacks.get(m.account_sku) ?? [];
      if (!arr.includes(m.basepack_id)) arr.push(m.basepack_id);
      idsToBasepacks.set(m.account_sku, arr);
    }


    if (cfg.accountCode === 'daraz') {
      const parsed = await parseDarazWorkbook(buffer, snapshotDate);
      const availableBasepacks = new Set<string>();
      const unmatched: string[] = [];
      let matchedIds = 0;
      let matchedStockUnits = 0;
      let matchedStockValuation = 0;
      for (const row of parsed.stockRows) {
        const basepackIds = idsToBasepacks.get(row.account_sku);
        if (!basepackIds) unmatched.push(row.account_sku);
        else {
          matchedIds++; matchedStockUnits += row.stock_qty; matchedStockValuation += row.stock_valuation;
          if (row.stock_qty > 0) basepackIds.forEach((id) => availableBasepacks.add(id));
        }
      }
      const pct = expectedBasepacks.size ? Math.round((10000 * availableBasepacks.size) / expectedBasepacks.size) / 100 : null;
      return NextResponse.json({
        accountCode: cfg.accountCode, snapshotDate, inputRows: parsed.stockInputRows, uniqueSkus: parsed.networkRows.length,
        duplicateSkuRows: parsed.duplicateSkuRows, totalUnits: parsed.totalUnits, matchedInputIds: matchedIds,
        unmatchedInputIds: unmatched.length, unmatchedSample: unmatched.slice(0,20), expectedBasepacks: expectedBasepacks.size,
        availableBasepacks: availableBasepacks.size, unavailableBasepacks: Math.max(expectedBasepacks.size-availableBasepacks.size,0),
        availabilityPct: pct, profileName: resolved.profileName, profileNote: resolved.note, excludedColumns: resolved.excludedColumns, excludedUnits: parsed.ignoredNonNormalRows,
        normalInputRows: parsed.normalInputRows, ignoredNonNormalRows: parsed.ignoredNonNormalRows, totalStockValuation: parsed.totalStockValuation,
        matchedStockUnits, matchedStockValuation,
      });
    }

    if (cfg.accountCode === 'pandamart') {
      const parsed = await parsePandamartWorkbook(buffer);
      const stockBySkuBranch = new Map<string, Map<string, number>>();
      for (const row of parsed.branchStockRows) {
        if (row.branch_code === 'DC') continue;
        const byBranch = stockBySkuBranch.get(row.account_sku) ?? new Map<string, number>();
        byBranch.set(row.branch_code, (byBranch.get(row.branch_code) ?? 0) + row.stock_qty);
        stockBySkuBranch.set(row.account_sku, byBranch);
      }

      const unmatched: string[] = [];
      let matchedIds = 0;
      for (const row of parsed.networkRows) {
        if (idsToBasepacks.has(row.account_sku)) matchedIds++;
        else unmatched.push(row.account_sku);
      }

      const basepackIds = [...expectedBasepacks];
      const basepackToSkus = new Map<string, Set<string>>();
      for (const [sku, bps] of idsToBasepacks.entries()) {
        for (const bp of bps) {
          const set = basepackToSkus.get(bp) ?? new Set<string>();
          set.add(sku);
          basepackToSkus.set(bp, set);
        }
      }

      const branchOla = parsed.branchCodes.map((branchCode) => {
        let available = 0;
        for (const bp of basepackIds) {
          const skus = basepackToSkus.get(bp) ?? new Set<string>();
          if ([...skus].some((sku) => (stockBySkuBranch.get(sku)?.get(branchCode) ?? 0) > 0)) available++;
        }
        const expected = basepackIds.length;
        return {
          branchCode,
          expectedBasepacks: expected,
          availableBasepacks: available,
          unavailableBasepacks: Math.max(expected - available, 0),
          olaPct: expected ? Math.round((10000 * available) / expected) / 100 : null,
        };
      });

      const availableBranchCells = branchOla.reduce((n, r) => n + r.availableBasepacks, 0);
      const totalBranchCells = branchOla.reduce((n, r) => n + r.expectedBasepacks, 0);
      const branchOlaPct = totalBranchCells ? Math.round((10000 * availableBranchCells) / totalBranchCells) / 100 : null;

      let networkAvailable = 0;
      for (const bp of basepackIds) {
        const skus = basepackToSkus.get(bp) ?? new Set<string>();
        const availableSomewhere = parsed.branchCodes.some((branchCode) =>
          [...skus].some((sku) => (stockBySkuBranch.get(sku)?.get(branchCode) ?? 0) > 0),
        );
        if (availableSomewhere) networkAvailable++;
      }
      const networkCoveragePct = basepackIds.length ? Math.round((10000 * networkAvailable) / basepackIds.length) / 100 : null;

      return NextResponse.json({
        accountCode: cfg.accountCode,
        snapshotDate: parsed.stockDate,
        inputRows: parsed.stockInputRows,
        uniqueSkus: parsed.networkRows.length,
        duplicateSkuRows: parsed.duplicateSkuRows,
        totalUnits: parsed.storeUnits,
        matchedInputIds: matchedIds,
        unmatchedInputIds: unmatched.length,
        unmatchedSample: unmatched.slice(0, 20),
        expectedBasepacks: basepackIds.length,
        availableBasepacks: networkAvailable,
        unavailableBasepacks: Math.max(basepackIds.length - networkAvailable, 0),
        availabilityPct: networkCoveragePct,
        networkCoveragePct,
        branchOlaPct,
        availableBranchCells,
        totalBranchCells,
        branchOla,
        salesRows: parsed.salesRows.length,
        salesSkuCount: parsed.salesSkuCount,
        salesDateStart: parsed.salesDateStart,
        salesDateEnd: parsed.salesDateEnd,
        totalSoldQty: parsed.totalSoldQty,
        totalGfv: parsed.totalGfv,
        profileName: resolved.profileName,
        profileNote: resolved.note,
        excludedColumns: resolved.excludedColumns,
        excludedUnits: parsed.dcUnits,
      });
    }

    if (cfg.accountCode === 'shajgoj') {
      const parsed = await parseShajgojWorkbook(buffer, snapshotDate);
      const availableBasepacks = new Set<string>();
      const unmatched: string[] = [];
      let matchedIds = 0;
      for (const row of parsed.networkRows) {
        const basepackIds = idsToBasepacks.get(row.account_sku);
        if (!basepackIds) unmatched.push(row.account_sku);
        else {
          matchedIds++;
          if (row.stock_qty > 0) basepackIds.forEach((id) => availableBasepacks.add(id));
        }
      }
      const pct = expectedBasepacks.size
        ? Math.round((10000 * availableBasepacks.size) / expectedBasepacks.size) / 100
        : null;
      return NextResponse.json({
        accountCode: cfg.accountCode,
        snapshotDate,
        inputRows: parsed.stockInputRows,
        uniqueSkus: parsed.networkRows.length,
        duplicateSkuRows: parsed.duplicateSkuRows,
        totalUnits: parsed.totalUnits,
        matchedInputIds: matchedIds,
        unmatchedInputIds: unmatched.length,
        unmatchedSample: unmatched.slice(0, 20),
        expectedBasepacks: expectedBasepacks.size,
        availableBasepacks: availableBasepacks.size,
        unavailableBasepacks: Math.max(expectedBasepacks.size - availableBasepacks.size, 0),
        availabilityPct: pct,
        profileName: resolved.profileName,
        profileNote: resolved.note,
        excludedColumns: [],
        excludedUnits: 0,
        salesPeriodStart: parsed.currentSalesPeriod.periodStart,
        salesPeriodEnd: parsed.currentSalesPeriod.periodEnd,
        totalSoldQty: parsed.currentSalesPeriod.soldQty,
        totalSalesValue: parsed.currentSalesPeriod.salesValue,
        historicalSalesMonths: parsed.historicalSalesPeriods.map((period) => ({
          sourceSheet: period.sourceSheet,
          periodStart: period.periodStart,
          periodEnd: period.periodEnd,
          isCompleteMonth: period.isCompleteMonth,
          soldQty: period.soldQty,
          salesValue: period.salesValue,
        })),
      });
    }


    if (cfg.accountCode === 'othoba') {
      const parsed = await parseOthobaWorkbook(buffer, snapshotDate);
      const availableBasepacks = new Set<string>();
      const unmatched: string[] = [];
      let matchedIds = 0;
      for (const row of parsed.networkRows) {
        const basepackIds = idsToBasepacks.get(row.account_sku);
        if (!basepackIds) unmatched.push(row.account_sku);
        else {
          matchedIds++;
          if (row.stock_qty > 0) basepackIds.forEach((id) => availableBasepacks.add(id));
        }
      }
      const pct = expectedBasepacks.size ? Math.round((10000 * availableBasepacks.size) / expectedBasepacks.size) / 100 : null;
      return NextResponse.json({
        accountCode: cfg.accountCode, snapshotDate, inputRows: parsed.stockInputRows, uniqueSkus: parsed.networkRows.length,
        duplicateSkuRows: parsed.duplicateSkuRows, totalUnits: parsed.totalUnits, matchedInputIds: matchedIds,
        unmatchedInputIds: unmatched.length, unmatchedSample: unmatched.slice(0,20), expectedBasepacks: expectedBasepacks.size,
        availableBasepacks: availableBasepacks.size, unavailableBasepacks: Math.max(expectedBasepacks.size-availableBasepacks.size,0),
        availabilityPct: pct, profileName: resolved.profileName, profileNote: resolved.note, excludedColumns: [], excludedUnits: 0,
        salesPeriodStart: parsed.currentSalesPeriod.periodStart, salesPeriodEnd: parsed.currentSalesPeriod.periodEnd,
        totalSoldQty: parsed.currentSalesPeriod.soldQty, totalSalesValue: parsed.currentSalesPeriod.salesValue,
        historicalSalesMonths: parsed.historicalSalesPeriods, monthlySalesPeriods: parsed.monthlySalesPeriods,
      });
    }

    if (cfg.accountCode === 'foodi') {
      const parsed = await parseFoodiWorkbook(buffer, snapshotDate);
      const availableBasepacks = new Set<string>();
      const unmatched: string[] = [];
      let matchedIds = 0;
      for (const row of parsed.networkRows) {
        const basepackIds = idsToBasepacks.get(row.account_sku);
        if (!basepackIds) unmatched.push(row.account_sku);
        else {
          matchedIds++;
          if (row.stock_qty > 0) basepackIds.forEach((id) => availableBasepacks.add(id));
        }
      }
      const pct = expectedBasepacks.size
        ? Math.round((10000 * availableBasepacks.size) / expectedBasepacks.size) / 100
        : null;
      return NextResponse.json({
        accountCode: cfg.accountCode,
        snapshotDate,
        inputRows: parsed.stockInputRows,
        uniqueSkus: parsed.networkRows.length,
        duplicateSkuRows: parsed.duplicateSkuRows,
        totalUnits: parsed.totalUnits,
        matchedInputIds: matchedIds,
        unmatchedInputIds: unmatched.length,
        unmatchedSample: unmatched.slice(0, 20),
        expectedBasepacks: expectedBasepacks.size,
        availableBasepacks: availableBasepacks.size,
        unavailableBasepacks: Math.max(expectedBasepacks.size - availableBasepacks.size, 0),
        availabilityPct: pct,
        profileName: resolved.profileName,
        profileNote: resolved.note,
        excludedColumns: [],
        excludedUnits: 0,
        salesPeriodStart: parsed.salesPeriodStart,
        salesPeriodEnd: parsed.salesPeriodEnd,
        salesSkuCount: parsed.salesSkuCount,
        sellingSkuCount: parsed.sellingSkuCount,
        totalSoldQty: parsed.totalSoldQty,
      });
    }

    const parsed = await parseStockWorkbook(buffer, resolved.config);
    const availableBasepacks = new Set<string>();
    const unmatched: string[] = [];
    let matchedIds = 0;
    for (const row of parsed.rows) {
      const basepackIds = idsToBasepacks.get(row.account_sku);
      if (!basepackIds) unmatched.push(row.account_sku);
      else {
        matchedIds++;
        if (row.stock_qty > 0) basepackIds.forEach((id) => availableBasepacks.add(id));
      }
    }

    const pct = expectedBasepacks.size ? Math.round((10000 * availableBasepacks.size) / expectedBasepacks.size) / 100 : null;
    return NextResponse.json({
      accountCode: cfg.accountCode,
      snapshotDate,
      inputRows: parsed.rowCount,
      uniqueSkus: parsed.rows.length,
      duplicateSkuRows: parsed.duplicateSkuRows,
      totalUnits: parsed.totalUnits,
      matchedInputIds: matchedIds,
      unmatchedInputIds: unmatched.length,
      unmatchedSample: unmatched.slice(0, 20),
      expectedBasepacks: expectedBasepacks.size,
      availableBasepacks: availableBasepacks.size,
      unavailableBasepacks: Math.max(expectedBasepacks.size - availableBasepacks.size, 0),
      availabilityPct: pct,
      profileName: resolved.profileName,
      profileNote: resolved.note,
      excludedColumns: resolved.excludedColumns,
      excludedUnits: resolved.excludedUnits,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : (error && typeof error === 'object' && 'message' in error ? String(error.message) : 'Stock preview failed.');
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
