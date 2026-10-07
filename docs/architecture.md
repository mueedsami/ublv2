# V2.1 Architecture

```text
MASTER WORKBOOK

Packsize  ───────────────> BASEPACK
                              |
                              | 1 : many
                              v
UBL Code / SKU -----------> PRODUCT
  Brand
  Business Group
  Category
  Sub Category
  Type
  Retail Type
  Variant
  Weight
  TP / MRP
  + account-wise IDs
                              |
                              v
                     product_account_ids
                              |
                              |
DAILY STOCK DUMP             |
Account + date               |
Account SKU + stock          |
        |                    |
        v                    v
 stock_uploads ----------> stock_rows
                              |
                              v
                 v_basepack_availability
                              |
                  filters + account matrix
```

## Roll-up rule

A basepack can contain multiple active UBL SKUs. For each account, all unique marketplace IDs attached to those SKUs are evaluated once. If any of them has stock > 0 in the latest dump, the basepack is Available.

This avoids double-counting CP/promotional UBL rows as separate availability items.
