# Excel reader fix — V2.0.1

The original V2 package used `@ayocore/exceljs`. Its dependency chain included `unzipper`, whose S3 helper caused Next.js/Turbopack to require `@aws-sdk/client-s3` at build time even though this application never uses S3.

V2.0.1 removes that dependency chain completely. XLSX files are read server-side using a small read-only parser built on Node's built-in `zlib` support.

Validated against:

- `ONly actives for now....xlsx`: 236 products, 1,601 account mappings.
- `othoba 5 oct.xlsx`: October sheet detected, `Sku` suggested as the identifier, `Current Stock` suggested as stock, 453 SKU rows, total stock 24,445.
- Daraz, Pandamart and Shajgoj master workbooks: workbook/header reading verified.

If upgrading from the first V2 package, delete `node_modules`, `.next`, and `package-lock.json`, then run `npm install` again so the old ExcelJS/unzipper packages are removed from your local install.
