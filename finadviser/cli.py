"""CLI entry point for finadviser."""

from __future__ import annotations

import click

from finadviser.config import load_config


@click.group(invoke_without_command=True)
@click.pass_context
def main(ctx: click.Context) -> None:
    """Personal financial adviser TUI application."""
    ctx.ensure_object(dict)
    ctx.obj["config"] = load_config()

    if ctx.invoked_subcommand is None:
        from finadviser.ui.app import FinAdviserApp

        app = FinAdviserApp(config=ctx.obj["config"])
        app.run()


@main.command()
@click.argument("csv_path", type=click.Path(exists=True))
@click.option("--bank", required=True, help="Bank config name")
@click.option("--account", required=True, help="Account name to import into")
def import_csv(csv_path: str, bank: str, account: str) -> None:
    """Import transactions from a CSV file."""
    from pathlib import Path

    from finadviser.db.connection import get_connection, initialize_database
    from finadviser.importing.import_pipeline import ImportPipeline

    config = load_config()
    conn = get_connection(config.db_path)
    initialize_database(conn)

    pipeline = ImportPipeline(conn, config)
    result = pipeline.run(Path(csv_path), bank_config_name=bank, account_name=account)
    click.echo(f"Imported {result.imported_count} transactions ({result.duplicate_count} duplicates skipped)")


@main.command()
def seed():
    """Seed the database with property data (20 Denbigh Road & 249 Francis Road)."""
    from finadviser.db.connection import get_connection
    from finadviser.db.connection import initialize_database
    from finadviser.seed_properties import seed_properties

    config = load_config()
    conn = get_connection(config.db_path)
    initialize_database(conn)
    seed_properties(conn)
    conn.close()


if __name__ == "__main__":
    main()
