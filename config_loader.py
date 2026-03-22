"""Load the same config as the Node server from config/app.json."""

from __future__ import annotations

import json
import os
import pathlib


def project_root() -> pathlib.Path:
    return pathlib.Path(__file__).resolve().parent


def load_app_config() -> dict:
    path = project_root() / "config" / "app.json"
    if not path.is_file():
        raise FileNotFoundError(
            f"Missing {path}. Copy config/app.example.json to config/app.json and edit publicUrl."
        )
    data = json.loads(path.read_text(encoding="utf-8"))
    public_url = (os.environ.get("PUBLIC_URL") or data.get("publicUrl") or "").strip().rstrip("/")
    secret = os.environ.get("SECRET_TOKEN") or data.get("secretToken") or "qutmess"
    if not public_url:
        raise ValueError("publicUrl is empty in config/app.json (or set PUBLIC_URL).")
    return {
        "public_url": public_url,
        "send_url": f"{public_url}/send",
        "secret_token": secret,
    }
