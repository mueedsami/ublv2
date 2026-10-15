from __future__ import annotations

from datetime import datetime
import subprocess
from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger
from .runner import run_ola
from .cpp import run_cpp_scrape
from .settings import settings


def hhmm(value: str):
    h, m = value.split(":", 1)
    return int(h), int(m)


def cpp_times() -> list[str]:
    values = [x.strip() for x in settings.cpp_run_times.split(",") if x.strip()]
    if len(values) != 2:
        raise RuntimeError(
            "CPP_RUN_TIMES must contain exactly two comma-separated HH:MM values "
            "(for example 10:00,18:00)."
        )
    # Validate both values before registering either job.
    for value in values:
        hhmm(value)
    return values


def main():
    sched = BlockingScheduler(timezone=settings.timezone)
    oh, om = hhmm(settings.ola_run_time)
    sh, sm = hhmm(settings.sos_run_time)

    sched.add_job(run_ola, CronTrigger(hour=oh, minute=om), id="ola_daily", replace_existing=True, max_instances=1, coalesce=True)

    times = cpp_times()
    for index, value in enumerate(times):
        hour, minute = hhmm(value)
        checkpoint = "am" if index == 0 else "pm"
        sched.add_job(
            run_cpp_scrape,
            CronTrigger(hour=hour, minute=minute),
            kwargs={"checkpoint": checkpoint},
            id=f"cpp_{checkpoint}",
            replace_existing=True,
            max_instances=1,
            coalesce=True,
        )

    def sos_job():
        if not settings.sos_command:
            print("SoS schedule reached, but SOS_COMMAND is blank. Use cli sos-import or configure a native command.")
            return
        subprocess.run(settings.sos_command, shell=True, check=False)

    sched.add_job(
        sos_job,
        IntervalTrigger(days=settings.sos_interval_days, start_date=datetime.now().replace(hour=sh, minute=sm, second=0, microsecond=0)),
        id="sos_15day",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )

    print("UBL Digital Shelf scheduler running")
    print(f"OLA daily {settings.ola_run_time}; CPP daily {', '.join(times)}; SoS every {settings.sos_interval_days} days")
    sched.start()


if __name__ == "__main__":
    main()
