import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { makeXlsx, type XlsxCell } from '@/lib/xlsx-writer';

export const ENLISTMENT_STATUSES = ['pending','ready','sent','under_review','enlisted','needs_correction','rejected'] as const;
export type EnlistmentStatus = typeof ENLISTMENT_STATUSES[number];

export type AccountSummary = { id: string; code: string; name: string };

export async function getEnlistmentPanelData() {
  const supabase = getSupabaseAdmin();
  const [{ data: accounts, error: accountError }, { data: products, error: productError }, { data: imports }, { data: exports }] = await Promise.all([
    supabase.from('accounts').select('id,code,name').eq('active', true).order('name'),
    supabase.from('enlistment_products').select('*').eq('active', true).order('updated_at', { ascending: false }).limit(1000),
    supabase.from('enlistment_imports').select('*').order('imported_at', { ascending: false }).limit(8),
    supabase.from('enlistment_exports').select('id,account_id,export_format,file_name,row_count,exported_at').order('exported_at', { ascending: false }).limit(12),
  ]);
  if (accountError) throw accountError;
  if (productError) throw productError;

  const productIds = (products || []).map((p: any) => p.id);
  let targets: any[] = [];
  if (productIds.length) {
    const { data, error } = await supabase.from('enlistment_targets').select('*').in('enlistment_id', productIds);
    if (error) throw error;
    targets = data || [];
  }

  const accountById = new Map((accounts || []).map((a: any) => [a.id, a]));
  const targetsByProduct = new Map<string, any[]>();
  for (const target of targets) {
    const account = accountById.get(target.account_id) as any;
    const row = { ...target, account: account ? { code: account.code, name: account.name } : null };
    const current = targetsByProduct.get(target.enlistment_id) || [];
    current.push(row);
    targetsByProduct.set(target.enlistment_id, current);
  }

  const exportRows = (exports || []).map((row: any) => {
    const account = accountById.get(row.account_id) as any;
    return { ...row, account: account ? { code: account.code, name: account.name } : null };
  });

  return {
    accounts: accounts || [],
    products: (products || []).map((product: any) => ({ ...product, targets: targetsByProduct.get(product.id) || [] })),
    imports: imports || [],
    exports: exportRows,
    statuses: ENLISTMENT_STATUSES,
  };
}

export async function setProductAccounts(productId: string, accountCodes: string[]) {
  const supabase = getSupabaseAdmin();
  const { data: accounts, error: accountError } = await supabase.from('accounts').select('id,code').eq('active', true);
  if (accountError) throw accountError;
  const wanted = new Set(accountCodes.map((code) => code.toLowerCase()));
  const selectedIds = (accounts || []).filter((a: any) => wanted.has(String(a.code).toLowerCase())).map((a: any) => a.id);

  const { data: existing, error: existingError } = await supabase.from('enlistment_targets').select('id,account_id').eq('enlistment_id', productId);
  if (existingError) throw existingError;
  const existingByAccount = new Map((existing || []).map((row: any) => [row.account_id, row]));

  if (existing?.length) {
    const deselectIds = existing.filter((row: any) => !selectedIds.includes(row.account_id)).map((row: any) => row.id);
    if (deselectIds.length) {
      const { error } = await supabase.from('enlistment_targets').update({ selected: false, updated_at: new Date().toISOString() }).in('id', deselectIds);
      if (error) throw error;
    }
  }

  for (const accountId of selectedIds) {
    const old = existingByAccount.get(accountId) as any;
    if (old) {
      const { error } = await supabase.from('enlistment_targets').update({ selected: true, updated_at: new Date().toISOString() }).eq('id', old.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('enlistment_targets').insert({ enlistment_id: productId, account_id: accountId, selected: true, status: 'pending' });
      if (error) throw error;
    }
  }
}

export async function addAccountsToProducts(productIds: string[], accountCodes: string[]) {
  const supabase = getSupabaseAdmin();
  const { data: accounts, error: accountError } = await supabase.from('accounts').select('id,code').eq('active', true);
  if (accountError) throw accountError;
  const wanted = new Set(accountCodes.map((code) => code.toLowerCase()));
  const selectedAccounts = (accounts || []).filter((a: any) => wanted.has(String(a.code).toLowerCase()));

  for (const productId of productIds) {
    for (const account of selectedAccounts as any[]) {
      const { data: existing, error: e1 } = await supabase.from('enlistment_targets').select('id').eq('enlistment_id', productId).eq('account_id', account.id).maybeSingle();
      if (e1) throw e1;
      if (existing) {
        const { error } = await supabase.from('enlistment_targets').update({ selected: true, updated_at: new Date().toISOString() }).eq('id', existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('enlistment_targets').insert({ enlistment_id: productId, account_id: account.id, selected: true, status: 'pending' });
        if (error) throw error;
      }
    }
  }
}

export async function updateEnlistmentTarget(input: { targetId: string; status?: string; accountFields?: Record<string, unknown>; notes?: string }) {
  const supabase = getSupabaseAdmin();
  if (input.status && !ENLISTMENT_STATUSES.includes(input.status as EnlistmentStatus)) throw new Error('Invalid enlistment status.');
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.status) {
    update.status = input.status;
    if (input.status === 'ready') update.ready_at = new Date().toISOString();
    if (input.status === 'sent') update.sent_at = new Date().toISOString();
    if (input.status === 'enlisted') update.enlisted_at = new Date().toISOString();
  }
  if (input.accountFields) update.account_fields = input.accountFields;
  if (input.notes !== undefined) update.notes = input.notes || null;
  const { error } = await supabase.from('enlistment_targets').update(update).eq('id', input.targetId);
  if (error) throw error;
}

function computedMargin(product: any): number | null {
  const tp = Number(product.tp);
  const mrp = Number(product.mrp);
  if (Number.isFinite(tp) && Number.isFinite(mrp) && mrp > 0) return (mrp - tp) / mrp;
  const raw = String(product.margin_source || '').trim();
  if (!raw) return null;
  const n = Number(raw.replace('%', ''));
  if (!Number.isFinite(n)) return null;
  return raw.includes('%') ? n / 100 : n > 1 ? n / 100 : n;
}

function n(value: any): number | null {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export type ExportBuild = { headers: string[]; rows: XlsxCell[][]; format: 'daraz'|'pandamart'|'regular' };

export function buildAccountExport(accountCode: string, items: { product: any; target: any }[]): ExportBuild {
  const code = accountCode.toLowerCase();
  if (code === 'daraz') {
    const headers = [
      'Image Code','Brand Name','Suggested Category','Product Description','Product Weight','New Shop SKU','Daraz Seller SKU','SKU Name','NEW MRP','NEW SP','NEW TP','NEW COGP','Supplier Code','Supplier Name','Margin','Product Type("Food", "Liquid", "Dangerous Goods", "Other")','Shelf Life(Days) (If Shelf life flag is Yes, this value shouldn\'t be empty)','Reject at Inbound before Expiry Date(Days)','Alert before Expiry Date (Days)','Offline before Expiry Date (Days)(If Shelf life flag is Yes, this value shouldn\'t be empty)'
    ];
    const rows = items.map(({ product, target }) => {
      const f = target.account_fields || {};
      const tp = n(product.tp);
      const cogp = n(f.new_cogp) ?? (tp == null ? null : Math.round((tp / 1.05) * 100) / 100);
      return [
        product.image_url || '', product.brand || '', product.category || '', product.description || '',
        f.product_weight || '', f.new_shop_sku || '', f.daraz_seller_sku || '', product.name || '',
        n(product.mrp), n(f.new_sp), tp, cogp, f.supplier_code || '', product.supplier_name || '',
        computedMargin(product), f.product_type || '', n(product.shelf_life_days),
        n(f.reject_before_expiry_days), n(f.alert_before_expiry_days), n(f.offline_before_expiry_days),
      ];
    });
    return { headers, rows, format: 'daraz' };
  }

  if (code === 'pandamart') {
    const headers = ['SL','Barcode','Product \nDimensions \nLength: left to \nright (cm)','Product \nDimensions \nDepth: Front to \nBack (cm)','Product \nDimensions\nHeight: Top to \nBottom (cm)','Shelf Life \nTime (Day)','Name','Image Link','Product Description ( Detailed)','Dept','Category','SubCategory','Pcs Per CTN','TP','MRP','Margin','Cart Limit','Brand','Supplier Name','Country of Origin'];
    const rows = items.map(({ product }, index) => [
      index + 1, product.barcode || '', n(product.length_cm), n(product.depth_cm), n(product.height_cm), n(product.shelf_life_days),
      product.name || '', product.image_url || '', product.description || '', 'ABC', product.category || '', product.sub_category || '',
      n(product.pcs_per_crm), n(product.tp), n(product.mrp), computedMargin(product), '', product.brand || '', product.supplier_name || '', product.country_of_origin || '',
    ]);
    return { headers, rows, format: 'pandamart' };
  }

  const headers = ['Sku Updated Perfect Name','Brand','TP','MRP','UBL CAT','Description','Updated Hero Image'];
  const rows = items.map(({ product }) => [product.name || '', product.brand || '', n(product.tp), n(product.mrp), product.category || '', product.description || '', product.image_url || '']);
  return { headers, rows, format: 'regular' };
}

function csvEscape(value: XlsxCell): string {
  if (value == null) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function exportBuffer(accountName: string, build: ExportBuild, fileType: 'xlsx'|'csv') {
  if (fileType === 'csv') {
    const lines = [build.headers, ...build.rows].map((row) => row.map(csvEscape).join(','));
    return { buffer: Buffer.from(`\uFEFF${lines.join('\r\n')}`, 'utf8'), contentType: 'text/csv; charset=utf-8', extension: 'csv' };
  }
  return {
    buffer: makeXlsx(`${accountName} Enlistment`, build.headers, build.rows),
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    extension: 'xlsx',
  };
}
