from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env")
load_dotenv(ROOT.parent / ".env", override=False)


@dataclass(frozen=True)
class Settings:
    supabase_url: str = os.getenv("SUPABASE_URL", "").strip()
    service_key: str = (
        os.getenv("SUPABASE_SECRET_KEY", "").strip()
        or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    )
    timezone: str = os.getenv("TIMEZONE", "Asia/Dhaka").strip()
    run_times: str = os.getenv("SCRAPER_RUN_TIMES", "10:00,18:00").strip()
    cpp_run_times: str = os.getenv("CPP_RUN_TIMES", "10:00,18:00").strip()
    request_timeout: int = int(os.getenv("SCRAPER_REQUEST_TIMEOUT", "20"))
    delay_seconds: float = float(os.getenv("SCRAPER_DELAY_SECONDS", "0.35"))
    daraz_headless: bool = os.getenv("DARAZ_HEADLESS", "true").lower() not in {"0", "false", "no"}
    worker_version: str = os.getenv("SCRAPER_WORKER_VERSION", "2.28.1-cpp-progress-parallel").strip()
    cpp_max_workers: int = max(1, int(os.getenv("CPP_MAX_WORKERS", "6")))

    def validate_supabase(self) -> None:
        missing = []
        if not self.supabase_url:
            missing.append("SUPABASE_URL")
        if not self.service_key:
            missing.append("SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY")
        if missing:
            raise RuntimeError("Missing environment variable(s): " + ", ".join(missing))

    @staticmethod
    def _parse_times(raw: str, label: str) -> list[tuple[int, int]]:
        values = [x.strip() for x in raw.split(",") if x.strip()]
        if len(values) != 2:
            raise RuntimeError(f"{label} must contain exactly two HH:MM values")
        parsed = []
        for value in values:
            h, m = value.split(":", 1)
            h_i, m_i = int(h), int(m)
            if not (0 <= h_i <= 23 and 0 <= m_i <= 59):
                raise RuntimeError(f"Invalid run time: {value}")
            parsed.append((h_i, m_i))
        return parsed

    def parsed_run_times(self) -> list[tuple[int, int]]:
        return self._parse_times(self.run_times, "SCRAPER_RUN_TIMES")

    def parsed_cpp_run_times(self) -> list[tuple[int, int]]:
        return self._parse_times(self.cpp_run_times, "CPP_RUN_TIMES")


settings = Settings()
