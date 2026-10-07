# Current master profile used for V2.1

Source workbook: `ONly actives for now...(1).xlsx`

- UBL SKU rows: **236**
- Unique `Packsize` / basepacks: **229**
- Active rows: **236**
- Total parsed account-ID mappings: **1,601**
- Missing Packsize rows: **0**

Exact hierarchy fields available in the workbook:

- Brand
- BUSINESS GROUP
- Type
- Retail Type
- Packsize
- UBL CAT
- Sub Category
- VARIANT

Also preserved: SKU label, type of weight, weight, TP, MRP, description, highlights, and hero image.

There are seven basepacks containing more than one UBL SKU in this active master. This is why availability is now calculated at basepack level rather than counting every UBL Code as a separate denominator.

`Type` can legitimately vary inside the same basepack (for example Regular vs CP), so classification fields are stored at SKU level and rolled up as distinct values for filtering/display.
