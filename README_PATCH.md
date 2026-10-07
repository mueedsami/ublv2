# UBL Availability V2.4 Shajgoj patch

Apply this patch on top of V2.3.1.

The live **UBL Availability V2** Supabase project (`swuogverexpxefenoujq`) has already been updated with the Shajgoj history schema/RPC/views. Do not run the included SQL against the previous/legacy database.

Main behavior:
- choose the true Shajgoj stock date X;
- `Total Stock QTY` is stock on X;
- the changing month-range column is cumulative sold quantity through X-1;
- `Total Sold` is cumulative sales value;
- missed stock dates remain missing (no forward-fill);
- older date backfills do not replace a newer current snapshot;
- completed/partial prior-month sheets in the same year are stored as sales history only;
- daily/monthly OLA uses frozen basepack snapshots from observed stock dates.
