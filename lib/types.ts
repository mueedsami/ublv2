export type MasterProduct = {
  ubl_code: string;
  name: string;
  status: 'active' | 'inactive';
  brand: string | null;
  tp: number | null;
  mrp: number | null;
  packsize: string;
  sku_label: string | null;
  weight_type: string | null;
  weight: number | null;
  business_group: string | null;
  product_type: string | null;
  retail_type: string | null;
  category: string | null;
  sub_category: string | null;
  variant: string | null;
  description: string | null;
  highlights: string | null;
  hero_image_url: string | null;
  account_ids: Record<string, string[]>;
};

export type MasterPreview = {
  sheetName: string;
  rowCount: number;
  basepackCount: number;
  activeCount: number;
  inactiveCount: number;
  mappingCount: number;
  duplicateAccountIds: number;
  accountCounts: Record<string, number>;
  products: MasterProduct[];
};

export type StockInspectResult = {
  sheets: Array<{
    name: string;
    headerRow: number;
    columns: string[];
    suggestedSkuColumn: string | null;
    suggestedStockColumns: string[];
    sampleRows: Record<string, string | number | null>[];
    suggestedSnapshotDate: string | null;
    locked: boolean;
    profileName: string | null;
    note: string | null;
    excludedColumns: string[];
    excludedUnits: number;
  }>;
};

export type ParsedStockRow = {
  account_sku: string;
  stock_qty: number;
};


export type PandamartBranchStockRow = {
  account_sku: string;
  branch_code: string;
  stock_qty: number;
};

export type PandamartSalesRow = {
  sale_date: string;
  account_sku: string;
  item_name: string | null;
  gfv_local: number;
  sold_qty: number;
};

export type PandamartParsedWorkbook = {
  stockDate: string;
  networkRows: ParsedStockRow[];
  branchStockRows: PandamartBranchStockRow[];
  salesRows: PandamartSalesRow[];
  stockInputRows: number;
  duplicateSkuRows: number;
  storeUnits: number;
  dcUnits: number;
  salesDateStart: string | null;
  salesDateEnd: string | null;
  salesSkuCount: number;
  totalSoldQty: number;
  totalGfv: number;
  branchCodes: string[];
};

export type ShajgojStockRow = {
  account_sku: string;
  item_name: string | null;
  stock_qty: number;
};

export type ShajgojSalesCumulativeRow = {
  period_start: string;
  period_end: string;
  account_sku: string;
  item_name: string | null;
  sold_qty: number;
  sales_value: number;
  source_sheet: string;
  is_complete_month: boolean;
};

export type ShajgojSalesPeriodSummary = {
  sourceSheet: string;
  periodStart: string;
  periodEnd: string;
  isCompleteMonth: boolean;
  skuCount: number;
  soldQty: number;
  salesValue: number;
};

export type ShajgojParsedWorkbook = {
  stockDate: string;
  currentSheet: string;
  skuColumn: string;
  stockColumn: string;
  soldQtyColumn: string;
  salesValueColumn: string | null;
  networkRows: ParsedStockRow[];
  stockRows: ShajgojStockRow[];
  salesRows: ShajgojSalesCumulativeRow[];
  currentSalesPeriod: ShajgojSalesPeriodSummary;
  historicalSalesPeriods: ShajgojSalesPeriodSummary[];
  stockInputRows: number;
  duplicateSkuRows: number;
  totalUnits: number;
};

export type FoodiStockRow = {
  account_sku: string;
  item_name: string | null;
  stock_qty: number;
};

export type FoodiSales30dRow = {
  stock_date: string;
  period_start: string;
  period_end: string;
  account_sku: string;
  item_name: string | null;
  sold_qty: number;
  tp: number | null;
  mrp: number | null;
  selling_price: number | null;
};

export type FoodiParsedWorkbook = {
  stockDate: string;
  currentSheet: string;
  skuColumn: string;
  stockColumn: string;
  salesQtyColumn: string;
  networkRows: ParsedStockRow[];
  stockRows: FoodiStockRow[];
  salesRows: FoodiSales30dRow[];
  stockInputRows: number;
  duplicateSkuRows: number;
  totalUnits: number;
  salesPeriodStart: string;
  salesPeriodEnd: string;
  salesSkuCount: number;
  sellingSkuCount: number;
  totalSoldQty: number;
};

export type OthobaStockRow = {
  account_sku: string;
  item_name: string | null;
  stock_qty: number;
};

export type OthobaSalesSnapshotRow = {
  period_start: string;
  period_end: string;
  account_sku: string;
  item_name: string | null;
  sold_qty: number;
  run_rate: number | null;
  mrp: number | null;
  tp: number | null;
  stock_value: number | null;
  sales_value: number | null;
  source_sheet: string;
  is_complete_month: boolean;
};

export type OthobaMonthlySalesRow = {
  month_start: string;
  month_end: string;
  account_sku: string;
  item_name: string | null;
  sold_qty: number;
  total_product_cost: number;
  total_amount: number;
  source_sheet: string;
};

export type OthobaPeriodSummary = {
  sourceSheet: string;
  periodStart: string;
  periodEnd: string;
  isCompleteMonth: boolean;
  skuCount: number;
  soldQty: number;
  salesValue: number;
};

export type OthobaMonthlySalesSummary = {
  sourceSheet: string;
  monthStart: string;
  monthEnd: string;
  skuCount: number;
  soldQty: number;
  totalProductCost: number;
  totalAmount: number;
};

export type OthobaParsedWorkbook = {
  stockDate: string;
  currentSheet: string;
  skuColumn: string;
  stockColumn: string;
  salesQtyColumn: string;
  networkRows: ParsedStockRow[];
  stockRows: OthobaStockRow[];
  salesSnapshotRows: OthobaSalesSnapshotRow[];
  monthlySalesRows: OthobaMonthlySalesRow[];
  currentSalesPeriod: OthobaPeriodSummary;
  historicalSalesPeriods: OthobaPeriodSummary[];
  monthlySalesPeriods: OthobaMonthlySalesSummary[];
  stockInputRows: number;
  duplicateSkuRows: number;
  totalUnits: number;
};


export type DarazStockRow = {
  account_sku: string;
  item_name: string | null;
  stock_qty: number;
  stock_valuation: number;
  aging_60d_qty: number;
  aging_valuation: number;
  mrp: number | null;
  sale_price: number | null;
  tp: number | null;
  gis: number | null;
  gmv: number | null;
  nmv: number | null;
  nis: number | null;
};

export type DarazParsedWorkbook = {
  stockDate: string;
  currentSheet: string;
  skuColumn: string;
  stockColumn: string;
  valuationColumn: string;
  statusColumn: string;
  networkRows: ParsedStockRow[];
  stockRows: DarazStockRow[];
  stockInputRows: number;
  normalInputRows: number;
  ignoredNonNormalRows: number;
  duplicateSkuRows: number;
  totalUnits: number;
  totalStockValuation: number;
};
