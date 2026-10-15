from __future__ import annotations

import argparse
import json
from pathlib import Path

from .runner import SUPPORTED_ACCOUNTS, run_many


def main() -> None:
    p = argparse.ArgumentParser(description="UBL marketplace price scraper worker")
    p.add_argument("--accounts", default="all", help="all or comma-separated account codes")
    p.add_argument("--checkpoint", choices=["am", "pm", "manual"], default="manual")
    p.add_argument("--target-source", choices=["master", "cpp", "csv"], default="master")
    p.add_argument("--targets-csv", type=Path)
    p.add_argument("--limit", type=int, default=None, help="Use a small number for smoke tests")
    p.add_argument("--export-csv", action="store_true", help="Write normalized local CSV output")
    p.add_argument("--output-dir", type=Path, default=Path("scraper_outputs"))
    p.add_argument("--no-db", action="store_true", help="Do not write runs/observations to Supabase")
    args = p.parse_args()

    accounts = SUPPORTED_ACCOUNTS if args.accounts.lower() == "all" else [x.strip().lower() for x in args.accounts.split(",") if x.strip()]
    result = run_many(
        accounts,
        args.checkpoint,
        target_source=args.target_source,
        csv_path=args.targets_csv,
        limit=args.limit,
        write_db=not args.no_db,
        export_dir=args.output_dir if args.export_csv else None,
    )
    print(json.dumps(result, indent=2, default=str))


if __name__ == "__main__":
    main()
