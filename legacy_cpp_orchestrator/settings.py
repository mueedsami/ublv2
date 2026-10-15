from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")

@dataclass(frozen=True)
class Settings:
    supabase_url: str = os.getenv("SUPABASE_URL", "").strip()
    service_key: str = (os.getenv("SUPABASE_SECRET_KEY", "").strip() or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip())
    timezone: str = os.getenv("TIMEZONE", "Asia/Dhaka").strip()
    ola_run_time: str = os.getenv("OLA_RUN_TIME", "09:00").strip()
    cpp_run_time: str = os.getenv("CPP_RUN_TIME", "10:00").strip()  # legacy single-time setting
    cpp_day_of_week: str = os.getenv("CPP_DAY_OF_WEEK", "mon").strip()  # legacy; no longer used by scheduler
    cpp_run_times: str = os.getenv("CPP_RUN_TIMES", "10:00,18:00").strip()
    sos_run_time: str = os.getenv("SOS_RUN_TIME", "11:00").strip()
    sos_interval_days: int = int(os.getenv("SOS_INTERVAL_DAYS", "15"))
    sos_command: str = os.getenv("SOS_COMMAND", "").strip()

    @property
    def runtime_dir(self) -> Path:
        return ROOT / "runtime"

    @property
    def legacy_root(self) -> Path:
        return ROOT / "legacy_ola"

    def validate(self) -> None:
        missing = []
        if not self.supabase_url:
            missing.append("SUPABASE_URL")
        if not self.service_key:
            missing.append("SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY")
        if missing:
            raise RuntimeError("Missing collector environment variable(s): " + ", ".join(missing))

settings = Settings()
LOW_STOCK_THRESHOLD = 10
