# Central Availability Accounts Dropdown

Replace only the two project files from this ZIP, keeping their relative paths:
- `components/CentralAvailabilityDashboard.tsx`
- `app/globals.css`

This patch is based on the latest Sales & Stock / OLA separation project snapshot. Back up your working files first.

The old account-pill row is removed. Accounts is now a multi-select dropdown beside the other filters. All accounts are selected by default; tick or untick accounts; select all restores the full set; at least one must remain selected. Reset scope restores all accounts and default filters. Existing account-dependent calculations, SKU audit and export logic are unchanged.

Run `npm run dev` from the Next.js project directory. No new dependencies or database migrations required. If your local CentralAvailabilityDashboard.tsx contains newer edits than this snapshot, merge this patch instead of overwriting those edits.
