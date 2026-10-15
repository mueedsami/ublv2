UBL V2 v2.19.1 — Vercel / Next.js 16 TypeScript Build Hotfix

This hotfix fixes the two errors shown in the Vercel build:

1) app/api/enlistment/export/route.ts
   TS2345: Buffer<ArrayBufferLike> is not assignable to BodyInit
   Fix: copy the Node Buffer into a standard Uint8Array before passing it
   to NextResponse.

2) lib/dashboard-report-data.ts
   TS7015: Element implicitly has an 'any' type because index expression
   is not of type 'number'
   Fix: narrow the dynamic Supabase select result to
   Array<Record<string, unknown>> before indexing it with dateColumn.

No Supabase/database change is required.

Install
-------
Replace these two files in the project:
- app/api/enlistment/export/route.ts
- lib/dashboard-report-data.ts

Then run locally:
  npm run build

If successful:
  git add app/api/enlistment/export/route.ts lib/dashboard-report-data.ts
  git commit -m "Fix Vercel TypeScript build"
  git push

Vercel is now building the `main` branch according to the supplied build log.
