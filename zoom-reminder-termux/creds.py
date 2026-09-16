import os
from google.oauth2 import service_account
from googleapiclient.discovery import build

# Path ke file json Anda
SERVICE_ACCOUNT_FILE = './whatsappbot-drive.json'

try:
    credentials = service_account.Credentials.from_service_account_file(
        SERVICE_ACCOUNT_FILE, scopes=['https://www.googleapis.com/auth/cloud-platform'])
    
    # Coba bangun service untuk memverifikasi
    service = build('cloudresourcemanager', 'v1', credentials=credentials)
    print("Kredensial valid dan berfungsi!")
except Exception as e:
    print(f"Kredensial tidak valid: {e}")
