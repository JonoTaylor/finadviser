"""Application configuration management."""

from __future__ import annotations

import os
from pathlib import Path

from pydantic import BaseModel, Field


def _default_data_dir() -> Path:
    return Path(os.environ.get("FINADVISER_DATA_DIR", Path.home() / ".finadviser"))


class AppConfig(BaseModel):
    """Root application configuration."""

    data_dir: Path = Field(default_factory=_default_data_dir)
    db_path: Path | None = None
    bank_configs_dir: Path | None = None
    anthropic_api_key: str = ""
    currency_symbol: str = "£"

    def model_post_init(self, __context: object) -> None:
        if self.db_path is None:
            self.db_path = self.data_dir / "finadviser.db"
        if self.bank_configs_dir is None:
            self.bank_configs_dir = self.data_dir / "bank_configs"

    def ensure_dirs(self) -> None:
        """Create data directories if they don't exist."""
        self.data_dir.mkdir(parents=True, exist_ok=True)
        if self.bank_configs_dir:
            self.bank_configs_dir.mkdir(parents=True, exist_ok=True)


def load_config() -> AppConfig:
    """Load configuration from environment variables."""
    config = AppConfig(
        anthropic_api_key=os.environ.get("ANTHROPIC_API_KEY", ""),
        db_path=Path(p) if (p := os.environ.get("FINADVISER_DB_PATH")) else None,
        bank_configs_dir=Path(p) if (p := os.environ.get("FINADVISER_BANK_CONFIGS_DIR")) else None,
    )
    config.ensure_dirs()
    return config
