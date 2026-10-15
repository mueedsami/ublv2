from __future__ import annotations

from urllib.parse import urlparse
from .settings import settings

EXPECTED_HOST = "swuogverexpxefenoujq.supabase.co"
PLACEHOLDER_MARKERS = ("YOUR_PROJECT", "YOUR_BACKEND", "PASTE_BACKEND", "<project>", "<secret")


def main() -> None:
    errors: list[str] = []
    url = settings.supabase_url
    key = settings.service_key

    if not url:
        errors.append("SUPABASE_URL is missing from .env")
    elif any(x.lower() in url.lower() for x in PLACEHOLDER_MARKERS):
        errors.append("SUPABASE_URL still contains a placeholder")
    else:
        parsed = urlparse(url)
        if parsed.scheme != "https" or not parsed.hostname:
            errors.append("SUPABASE_URL must be a valid https:// URL")
        elif parsed.hostname != EXPECTED_HOST:
            errors.append(
                f"SUPABASE_URL points to {parsed.hostname}; expected {EXPECTED_HOST} for UBL Availability V2"
            )

    if not key:
        errors.append("SUPABASE_SECRET_KEY / SUPABASE_SERVICE_ROLE_KEY is missing from .env")
    elif any(x.lower() in key.lower() for x in PLACEHOLDER_MARKERS):
        errors.append("Supabase backend key still contains the placeholder value")

    if errors:
        print("\nCONFIGURATION NOT READY")
        for e in errors:
            print(f" - {e}")
        print("\nOpen the .env file in this folder, paste the backend Supabase key, save it, then rerun.")
        raise SystemExit(2)

    print("Configuration looks ready.")
    print(f"Supabase host: {EXPECTED_HOST}")


if __name__ == "__main__":
    main()
