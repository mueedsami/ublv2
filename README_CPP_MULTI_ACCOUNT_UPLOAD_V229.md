# UBL V2 v2.29.0 — Multi-Account CPP Upload

This patch expands Uploads → CPP Reference from Daraz + Shajgoj to all current CPP scraper accounts:

- Daraz
- Pandamart
- Shajgoj
- Othoba
- Arogga
- Shwapno

## Existing fixed profiles

### Daraz
Unchanged:
- Daraz SKU is read directly
- expected CPP = MRP − October Backmargin

### Shajgoj
Unchanged:
- expected CPP = Selling Price
- marketplace SKU is resolved from the current master using the existing conservative Packsize/product matching flow

## New direct-SKU accounts

Pandamart, Othoba, Arogga and Shwapno now use a simple direct-SKU CPP uploader.

After choosing the workbook, the page automatically inspects it and shows a column-mapping panel.

Required:
- Marketplace SKU / Product ID
- Approved CPP price

Optional:
- Product name
- Brand
- Category
- MRP / original price

The system suggests likely columns where possible, but the user confirms the mapping before preview/activation.

## Important behavior

For the new direct-SKU accounts:
- the selected marketplace SKU/Product ID is authoritative
- no fuzzy SKU matching is performed
- exact current-master mapping is used only for enrichment
- a valid direct SKU remains scrapable even when it is outside the current master
- unmapped rows are clearly shown in preview
- duplicate SKUs are skipped with warnings
- invalid CPP prices are skipped with warnings

This matches the new CPP scraper architecture: the active CPP reference supplies the exact marketplace IDs that the scraper checks.

## Effective dates

If the filename contains a month and year, e.g. `Pandamart CPP October 26.xlsx`, the uploader suggests that calendar month as the effective range. The dates can still be overridden before activation.

## No database migration

No schema/RPC change is required. This patch continues using:
- `cpp_reference_sets`
- `cpp_targets`
- `v_cpp_master_lookup`
- `v_cpp_scrapable_targets`
- `commit_cpp_reference_set_v2`

## Files

- `components/UploadCenter.tsx`
- `lib/cpp-parser.ts`
- `app/api/cpp/reference/route.ts`

## Validation

- all modified TS/TSX files passed TypeScript syntax transpilation
- the generic workbook inspector/parser was tested with a sample Pandamart workbook
- detected Marketplace SKU, Approved CPP, Product Name, Brand and MRP correctly
- October 2026 dates were inferred correctly from the filename
