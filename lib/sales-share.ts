export type SalesShareProduct = {
  id: string;
  name: string | null;
  brand: string | null;
  product_type: string | null;
};

export type SalesShareMapping = {
  account_sku: string;
  product_id: string;
};

export type SalesShareInputRow = {
  account_sku: string;
  item_name?: string | null;
  sold_qty?: number | string | null;
  sales_value?: number | string | null;
};

export type SalesShareSlice = {
  label: string;
  sold_qty: number;
  sales_value: number;
  sku_count: number;
};

export type SalesSharePeriod = {
  key: string;
  label: string;
  period_start: string;
  period_end: string;
  is_partial: boolean;
  totals: {
    sold_qty: number;
    sales_value: number;
    sku_count: number;
    mapped_sold_qty: number;
    mapped_sales_value: number;
    mapped_sku_count: number;
    mapping_coverage_pct: number;
  };
  brand: SalesShareSlice[];
  format: SalesShareSlice[];
};

type ResolvedProduct = SalesShareProduct | null;

function normalizeName(value: string | null | undefined) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[’‘`]/g, "'")
    .replace(/[^a-z0-9]+/g, '');
}

export function createSalesShareResolver(mappings: SalesShareMapping[], products: SalesShareProduct[]) {
  const productById = new Map(products.map((product) => [product.id, product]));
  const bySku = new Map<string, SalesShareProduct>();
  for (const mapping of mappings) {
    const product = productById.get(mapping.product_id);
    if (product && mapping.account_sku && !bySku.has(mapping.account_sku)) bySku.set(mapping.account_sku, product);
  }

  const uniqueByName = new Map<string, SalesShareProduct>();
  const duplicateNames = new Set<string>();
  for (const product of products) {
    const key = normalizeName(product.name);
    if (!key || duplicateNames.has(key)) continue;
    if (uniqueByName.has(key)) {
      uniqueByName.delete(key);
      duplicateNames.add(key);
    } else {
      uniqueByName.set(key, product);
    }
  }

  return (accountSku: string, itemName?: string | null): ResolvedProduct => {
    const direct = bySku.get(accountSku);
    if (direct) return direct;
    const key = normalizeName(itemName);
    return key ? uniqueByName.get(key) ?? null : null;
  };
}

function addSlice(map: Map<string, { sold_qty: number; sales_value: number; skus: Set<string> }>, label: string, row: SalesShareInputRow) {
  const current = map.get(label) ?? { sold_qty: 0, sales_value: 0, skus: new Set<string>() };
  current.sold_qty += Number(row.sold_qty ?? 0) || 0;
  current.sales_value += Number(row.sales_value ?? 0) || 0;
  if (row.account_sku) current.skus.add(row.account_sku);
  map.set(label, current);
}

function serialize(map: Map<string, { sold_qty: number; sales_value: number; skus: Set<string> }>): SalesShareSlice[] {
  return [...map.entries()]
    .map(([label, value]) => ({ label, sold_qty: value.sold_qty, sales_value: value.sales_value, sku_count: value.skus.size }))
    .sort((a, b) => b.sales_value - a.sales_value || b.sold_qty - a.sold_qty || a.label.localeCompare(b.label));
}

export function buildSalesSharePeriod(
  rows: SalesShareInputRow[],
  resolveProduct: (accountSku: string, itemName?: string | null) => ResolvedProduct,
  meta: Pick<SalesSharePeriod, 'key' | 'label' | 'period_start' | 'period_end' | 'is_partial'>,
): SalesSharePeriod {
  const brandMap = new Map<string, { sold_qty: number; sales_value: number; skus: Set<string> }>();
  const formatMap = new Map<string, { sold_qty: number; sales_value: number; skus: Set<string> }>();
  const totalSkus = new Set<string>();
  const mappedSkus = new Set<string>();
  let soldQty = 0;
  let salesValue = 0;
  let mappedSoldQty = 0;
  let mappedSalesValue = 0;

  for (const row of rows) {
    const qty = Number(row.sold_qty ?? 0) || 0;
    const value = Number(row.sales_value ?? 0) || 0;
    soldQty += qty;
    salesValue += value;
    if (row.account_sku) totalSkus.add(row.account_sku);

    const product = resolveProduct(row.account_sku, row.item_name);
    const brand = product?.brand?.trim() || (product ? 'Unspecified brand' : 'Unmapped');
    const format = product?.product_type?.trim() || (product ? 'Unspecified' : 'Unmapped');
    if (product) {
      mappedSoldQty += qty;
      mappedSalesValue += value;
      if (row.account_sku) mappedSkus.add(row.account_sku);
    }
    addSlice(brandMap, brand, row);
    addSlice(formatMap, format, row);
  }

  const coverageBase = salesValue > 0 ? salesValue : soldQty;
  const mappedBase = salesValue > 0 ? mappedSalesValue : mappedSoldQty;
  return {
    ...meta,
    totals: {
      sold_qty: soldQty,
      sales_value: salesValue,
      sku_count: totalSkus.size,
      mapped_sold_qty: mappedSoldQty,
      mapped_sales_value: mappedSalesValue,
      mapped_sku_count: mappedSkus.size,
      mapping_coverage_pct: coverageBase > 0 ? (mappedBase / coverageBase) * 100 : 0,
    },
    brand: serialize(brandMap),
    format: serialize(formatMap),
  };
}
