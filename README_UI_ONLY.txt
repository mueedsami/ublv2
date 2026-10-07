UBL Availability V2.3.1 — Pandamart UI tabs

UI-only patch. No database/API/parser/upload/OLA/flag logic changes.

Changes:
- New sidebar item: Pandamart -> /pandamart
- New dedicated /pandamart page
- Removed the long embedded Pandamart analytics panel from the unified Availability page
- Pandamart content split into in-page tabs:
  1. Overview
  2. Branch OLA
  3. Flags
  4. Daily History
  5. Monthly History
- Existing /api/pandamart endpoint is reused unchanged

Replace the included files at the same relative paths.
