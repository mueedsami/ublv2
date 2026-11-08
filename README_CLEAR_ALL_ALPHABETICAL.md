# Central Availability — account filter refinement

## Changes
- Account options sorted alphabetically by display name.
- Added **Clear all**, which leaves Arogga as the only selected account (the dashboard requires at least one selected account).
- **Select all** remains available; **Reset scope** is unchanged.
- BeautyBooth remains included, Ushop remains excluded.

## Install
Replace `components/CentralAvailabilityDashboard.tsx` in your Next.js project with the supplied file. No SQL or new dependencies needed. Restart `npm run dev`.

## Notes
Merge with any newer local edits to that file rather than overwriting them.
