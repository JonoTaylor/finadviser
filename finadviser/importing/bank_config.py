"""Bank configuration loading and management."""

from __future__ import annotations

from pathlib import Path

import yaml
from pydantic import BaseModel, Field


class ColumnMapping(BaseModel):
    """Maps CSV columns to transaction fields."""

    date: str = "Date"
    description: str = "Description"
    amount: str | None = "Amount"
    debit: str | None = None
    credit: str | None = None
    reference: str | None = None


class BankConfig(BaseModel):
    """Configuration for parsing a specific bank's CSV format."""

    name: str
    description: str = ""
    date_format: str = "%d/%m/%Y"
    columns: ColumnMapping = Field(default_factory=ColumnMapping)
    skip_rows: int = 0
    encoding: str = "utf-8"
    delimiter: str = ","
    sign_convention: str = "standard"  # "standard" = positive is credit, "inverted" = positive is debit
    amount_multiplier: float = 1.0


def load_bank_config(config_path: Path) -> BankConfig:
    """Load a bank config from a YAML file."""
    with open(config_path) as f:
        data = yaml.safe_load(f)
    return BankConfig(**data)


def load_bank_configs(config_dir: Path) -> dict[str, BankConfig]:
    """Load all bank configs from a directory."""
    configs: dict[str, BankConfig] = {}
    if not config_dir.exists():
        return configs

    for path in config_dir.glob("*.yaml"):
        try:
            config = load_bank_config(path)
            configs[config.name] = config
        except Exception:
            continue

    for path in config_dir.glob("*.yml"):
        try:
            config = load_bank_config(path)
            configs[config.name] = config
        except Exception:
            continue

    return configs


def get_builtin_configs() -> dict[str, BankConfig]:
    """Return built-in bank configurations."""
    builtin_dir = Path(__file__).parent / "bank_configs"
    return load_bank_configs(builtin_dir)


def get_all_configs(user_config_dir: Path | None = None) -> dict[str, BankConfig]:
    """Get all configs: built-in + user-defined (user overrides built-in)."""
    configs = get_builtin_configs()
    if user_config_dir:
        configs.update(load_bank_configs(user_config_dir))
    return configs
