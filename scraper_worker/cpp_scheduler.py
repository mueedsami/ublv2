from __future__ import annotations

from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.cron import CronTrigger

from .runner import CPP_SUPPORTED_ACCOUNTS, run_many
from .settings import settings


def main() -> None:
    times = settings.parsed_cpp_run_times()
    scheduler = BlockingScheduler(timezone=settings.timezone)
    for index, (hour, minute) in enumerate(times):
        checkpoint = "am" if index == 0 else "pm"
        scheduler.add_job(
            run_many,
            CronTrigger(hour=hour, minute=minute),
            kwargs={
                "accounts": CPP_SUPPORTED_ACCOUNTS,
                "checkpoint": checkpoint,
                "target_source": "cpp",
                "parallel": True,
                "max_workers": settings.cpp_max_workers,
            },
            id=f"cpp_price_{checkpoint}",
            replace_existing=True,
            max_instances=1,
            coalesce=True,
            misfire_grace_time=1800,
        )
    print(
        f"UBL CPP scheduled in {settings.timezone}: "
        f"AM={times[0][0]:02d}:{times[0][1]:02d}, PM={times[1][0]:02d}:{times[1][1]:02d}; "
        f"parallel workers={settings.cpp_max_workers}"
    )
    scheduler.start()


if __name__ == "__main__":
    main()
