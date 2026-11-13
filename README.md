# Enlistment Bulk Hide — changed files only

Replace exactly these four paths in your Next.js application:

- `components/EnlistmentPanel.tsx`
- `lib/enlistment-data.ts`
- `app/api/enlistment/targets/route.ts`
- `app/globals.css`

## Bulk actions

- Select individual product rows (or header checkbox for all 50 on current page), then **Hide N selected**.
- **Hide all N matching** hides all products matching search/account/status filters across every page. Requires confirmation, max 5,000 per action.
- Switch Product visibility to **Hidden products**, then use equivalent Restore actions.
- Filters are applied server-side before selecting product IDs. The API checks the count and distinct IDs before making changes.
- Existing Supabase `enlistment_products.active` flag is updated. No product or account row is deleted. This visibility setting is shared by all dashboard users.
- The server updates in batches of 200; an interrupted/failed multi-batch request may have partially updated records. Check the hidden view if an error occurs.

Test on local Next.js before deployment. No migration required.
