from __future__ import annotations

from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.cron import CronTrigger

from .runner import run_many
from .settings import settings


def main() -> None:
    times = settings.parsed_run_times()
    scheduler = BlockingScheduler(timezone=settings.timezone)
    for index, (hour, minute) in enumerate(times):
        checkpoint = "am" if index == 0 else "pm"
        scheduler.add_job(
            run_many,
            CronTrigger(hour=hour, minute=minute),
            kwargs={"checkpoint": checkpoint, "target_source": "master"},
            id=f"price_scrape_{checkpoint}",
            replace_existing=True,
            max_instances=1,
            coalesce=True,
            misfire_grace_time=1800,
        )
    print(f"UBL scraper worker scheduled in {settings.timezone}: AM={times[0][0]:02d}:{times[0][1]:02d}, PM={times[1][0]:02d}:{times[1][1]:02d}")
    scheduler.start()


if __name__ == "__main__":
    main()
