from __future__ import annotations

from pathlib import Path
import typer
from .master_import import import_master
from .runner import run_ola
from .cpp import run_cpp_scrape
from .sos import ingest_sos_csv
from .dh_import import import_dh_file
from .marketplace_import import import_marketplace_file
from .daraz_dod import import_daraz_dod
from .shajgoj_ola import import_shajgoj_ola

app = typer.Typer(no_args_is_help=True, help="UBL Digital Shelf local collector")

@app.command("shajgoj-ola-import")
def shajgoj_ola_import_cmd(
    file_path: Path = typer.Argument(..., exists=True, dir_okay=False, help="Path to Shajgoj stock dump .xlsx file"),
    sheet: str = typer.Option(None, "--sheet", help="Specific sheet name (default: auto-detect latest Stock dump)"),
    as_of: str = typer.Option(None, "--as-of", help="Stock as-of date (YYYY-MM-DD). If omitted, defaults to sales window end + 1."),
    start_date: str = typer.Option(None, "--start-date", help="Sales window start date (YYYY-MM-DD)."),
    end_date: str = typer.Option(None, "--end-date", help="Sales window end date (YYYY-MM-DD)."),
    dry_run: bool = typer.Option(False, "--dry-run", help="Dry run mode: compute OLA and print summary without writing to DB"),
):
    """Import Shajgoj stock dump Excel into Supabase and compute Shajgoj OLA."""
    result = import_shajgoj_ola(
        file_path.resolve(),
        sheet_name=sheet,
        as_of_date=as_of,
        start_date=start_date,
        end_date=end_date,
        dry_run=dry_run,
    )
    if dry_run:
        print("Dry run result:", result)


@app.command("daraz-dod-import")
def daraz_dod_import_cmd(
    file_path: Path = typer.Argument(..., exists=True, dir_okay=False, help="Path to Daraz DOD .xlsx file"),
    date: str = typer.Option(None, "--date", help="Snapshot date (YYYY-MM-DD). If omitted, parsed from filename."),
    dry_run: bool = typer.Option(False, "--dry-run", help="Dry run mode: validate and print summary without writing to DB"),
):
    """Import Daraz DOD Excel into Supabase and compute Daraz OLA."""
    result = import_daraz_dod(file_path.resolve(), snapshot_date=date, dry_run=dry_run)
    if dry_run:
        print("Dry run result:", result)


@app.command("dh-import")
def dh_import_cmd(file_path: Path = typer.Argument(..., exists=True, dir_okay=False, help="Path to Pandamart DH .xlsx file")):
    """Import Pandamart DH sales & store-wise stock Excel into Supabase."""
    print(import_dh_file(file_path.resolve()))

@app.command("othoba-import")
def othoba_import_cmd(
    file_path: Path = typer.Argument(..., exists=True, dir_okay=False, help="Path to Othoba stock & sales .xlsx file"),
    sheet: str = typer.Option(None, help="Specific sheet name to import (default: auto-detect)"),
    period: str = typer.Option(None, help="Custom period label (default: auto-detect)"),
):
    """Import Othoba monthly stock & sales report Excel into Supabase."""
    print(import_marketplace_file(file_path.resolve(), account_code="othoba", sheet_name=sheet, period_label=period))

@app.command("marketplace-import")
def marketplace_import_cmd(
    file_path: Path = typer.Argument(..., exists=True, dir_okay=False, help="Path to marketplace .xlsx file"),
    account: str = typer.Option("othoba", help="Account code (e.g. othoba, shajgoj, daraz)"),
    sheet: str = typer.Option(None, help="Specific sheet name to import"),
    period: str = typer.Option(None, help="Custom period label"),
):
    """Import generic marketplace stock & sales report Excel into Supabase."""
    print(import_marketplace_file(file_path.resolve(), account_code=account, sheet_name=sheet, period_label=period))

@app.command("master-import")
def master_import(legacy_root: Path = typer.Option(..., exists=True, file_okay=False)):
    """Import current Excel SKU/Basepack mappings into Supabase."""
    print(import_master(legacy_root.resolve()))

@app.command("ola")
def ola(accounts: str = typer.Option("all", help="all or comma-separated account codes")):
    selected = None if accounts.strip().lower() == "all" else [x.strip().lower() for x in accounts.split(",") if x.strip()]
    print(run_ola(selected))

@app.command("cpp")
def cpp(
    accounts: str = typer.Option("all", help="all or comma-separated scraper account codes"),
    checkpoint: str = typer.Option("manual", help="am, pm, or manual"),
):
    """Run the CPP scraper/checker using the active Supabase CPP reference sets."""
    selected = None if accounts.strip().lower() == "all" else [x.strip().lower() for x in accounts.split(",") if x.strip()]
    print(run_cpp_scrape(selected, checkpoint=checkpoint))


@app.command("cpp-scrape")
def cpp_scrape(
    accounts: str = typer.Option("all", help="all or comma-separated scraper account codes"),
    checkpoint: str = typer.Option("manual", help="am, pm, or manual"),
):
    """Explicit alias for the twice-daily CPP scraper/checker."""
    selected = None if accounts.strip().lower() == "all" else [x.strip().lower() for x in accounts.split(",") if x.strip()]
    print(run_cpp_scrape(selected, checkpoint=checkpoint))

@app.command("sos-import")
def sos_import(path: Path = typer.Argument(..., exists=True), campaign: str = typer.Option("Default SoS")):
    print(ingest_sos_csv(path.resolve(), campaign))

if __name__ == "__main__":
    app()
