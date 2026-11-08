# OLA local environment setup (Windows)

1. Copy `runner/ola_upload.py`, `runner/.env.ola.local.example`, and `runner/.gitignore` into **the root of your OLA scraper folder**, next to `run_ola_local.py` and `sync_ola_sku_lists.py`. If you already have a `.gitignore`, **merge the rules** rather than replacing it.
2. Rename `.env.ola.local.example` to `.env.ola.local` (or make a copy of it, keeping the example file).
3. Open `.env.ola.local` in a text editor. Replace `PASTE_YOUR_PRIVATE_SERVICE_ROLE_KEY_HERE` with your Supabase **service_role** key. Do not include angle brackets. The URL is already set to your UBL Supabase project.
4. From PowerShell in that directory, run:

   ```powershell
   python sync_ola_sku_lists.py --preview --accounts daraz arogga othoba shwapno
   python run_ola_local.py --accounts daraz --max-workers 1 --upload
   ```

No need to set `$env:...` variables each session. Environment variables set manually still take precedence over this file. Never send this file to ChatGPT, publish it, or commit it. If Git was already tracking the secrets file, remove it from tracking with `git rm --cached -- .env.ola.local` and rotate the exposed key.

This is a minimal patch to the previous 10-file Supabase Master Integration package. The original runner and SKU sync scripts don't need to change: both import the credentials helper from `ola_upload.py`.
