"""Where things live on disk."""
from __future__ import annotations

import os
from pathlib import Path

PKG_DIR = Path(__file__).resolve().parent
DATA_TOOLS_DIR = PKG_DIR.parent.parent          # <repo>/data-tools
REPO_ROOT = DATA_TOOLS_DIR.parent
DESCRIPTOR_DIR = DATA_TOOLS_DIR / "datasets"


def data_root() -> Path:
    """Downloads go to <repo>/data (git-ignored). Override with GRAVITUNES_DATA_DIR."""
    return Path(os.environ.get("GRAVITUNES_DATA_DIR", REPO_ROOT / "data"))


def dataset_dir(svs_id: str | int) -> Path:
    return data_root() / "nasa-svs" / str(svs_id)


def earth_dir() -> Path:
    return data_root() / "earth"
