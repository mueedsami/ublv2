# UBL Availability V2.8 — Central Availability + Pivot

The five completed account pipelines remain independent. V2.8 adds a read-only normalized management layer over their latest basepack snapshots.

## Accounts
- Pandamart: basepack score = available branches / expected branches.
- Shajgoj, Foodi, Othoba, Daraz: basepack score = 1 when available, otherwise 0.
- Only account/basepack combinations already present in each account's master scope are included.

## Central OLA
`Central OLA = average(availability_score)` across the currently filtered valid account × basepack cells.

Unmapped combinations are absent from the denominator and never treated as OOS.

## Filters
Business Unit → Category → Sub-category → Brand → Basepack, plus account toggles and text search.

## Pivot
Default rows are Brand → Basepack with one column per selected account plus Central OLA. Optional row dimensions: Brand, Business Unit, Category, Sub-category.

Every account column displays its own latest observation date so central reporting does not imply all account inputs were collected on the same day.
