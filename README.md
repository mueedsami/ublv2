# Shajgoj Tertiary September Import Fix

Replace only `lib/tertiary-parser.ts` in your Next.js project with the matching file in this patch. Restart `npm run dev`.

This fixes the uploaded `Shajgoj September.xlsx` format:
- Column I has an Excel **date header** (serial 46266 = September 1, 2026). The parser now selects the column by matching the requested month, rather than expecting the text `September 2026`.
- Column K (`Total Sold`) supplies reported revenue; column I supplies units sold.
- Identical duplicate SKU lines with the same quantity and revenue are safely deduplicated without double counting. Specifically, SKU `36810`, rows 130 and 131, repeats the same 5 units and 401 reported revenue, despite a slightly different name. Conflicting duplicates still block approval.

### Test
1. Tertiary Report → Account-wise Uploads.
2. Account = Shajgoj; month = 2026-09.
3. Upload `Shajgoj September.xlsx`; leave Sheet name blank (it is `shajgoj`).
4. Click **Inspect & Preview Upload**. Check its sales quantities and revenue before approving.
5. Click **Approve Monthly Import**.

No Supabase migration required; other accounts and Sales & Stock imports are unchanged.
