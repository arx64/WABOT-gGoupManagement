# Disaster recovery VPS

Dokumen ini memulihkan bot pada VPS Ubuntu baru. **Jangan commit atau mengirim `.env`, `auth_info_baileys/`, Google secret/refresh token, atau token Cloudflare.**

## 1. Backup dari VPS lama

Jalankan dari PowerShell Windows. Arsip dibuat di folder lokal dan tidak diunggah ke GitHub:

```powershell
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = "D:\zoom-reminder-backup-$stamp"
New-Item -ItemType Directory -Force $backup | Out-Null

scp -P 20561 -i "$env:USERPROFILE\.ssh\id_ed25519" `
  deployadmin@31.58.103.5:/opt/WABOT-gGoupManagement/.env `
  "$backup\.env"

scp -P 20561 -i "$env:USERPROFILE\.ssh\id_ed25519" -r `
  deployadmin@31.58.103.5:/opt/WABOT-gGoupManagement/auth_info_baileys `
  "$backup\auth_info_baileys"

scp -P 20561 -i "$env:USERPROFILE\.ssh\id_ed25519" -r `
  deployadmin@31.58.103.5:/opt/WABOT-gGoupManagement/uploads `
  "$backup\uploads"

scp -P 20561 -i "$env:USERPROFILE\.ssh\id_ed25519" `
  deployadmin@31.58.103.5:/opt/WABOT-gGoupManagement/*.json `
  "$backup\"

Compress-Archive -Path "$backup\*" -DestinationPath "$backup.zip"
```

Simpan `D:\zoom-reminder-backup-*.zip` di drive terenkripsi/cloud storage pribadi. File ini berisi kredensial aktif.

## 2. Siapkan VPS baru

Login sebagai user sudo-capable, lalu jalankan:

```bash
sudo apt-get update
sudo apt-get install -y git curl ca-certificates
```

Salin script recovery dari repository:

```bash
git clone https://github.com/arx64/WABOT-gGoupManagement.git /tmp/WABOT-gGoupManagement
chmod +x /tmp/WABOT-gGoupManagement/docs/recover-vps.sh
sudo APP_USER="$USER" APP_DIR=/opt/WABOT-gGoupManagement \
  /tmp/WABOT-gGoupManagement/docs/recover-vps.sh
```

Script akan memasang Node.js 20, Cloudflared, clone branch `main`, `npm ci`, dan membuat service `wabot.service`. Script berhenti sebelum start jika `.env` atau `auth_info_baileys/` belum dipulihkan.

## 3. Restore rahasia dan data

Dari PowerShell:

```powershell
scp -P <SSH_PORT> -i "$env:USERPROFILE\.ssh\id_ed25519" `
  "$backup\.env" deployadmin@<NEW_IP>:/tmp/.env

scp -P <SSH_PORT> -i "$env:USERPROFILE\.ssh\id_ed25519" -r `
  "$backup\auth_info_baileys" deployadmin@<NEW_IP>:/tmp/auth_info_baileys

scp -P <SSH_PORT> -i "$env:USERPROFILE\.ssh\id_ed25519" -r `
  "$backup\uploads" deployadmin@<NEW_IP>:/tmp/uploads
```

Di VPS baru:

```bash
sudo install -o deployadmin -g deployadmin -m 600 /tmp/.env /opt/WABOT-gGoupManagement/.env
sudo cp -a /tmp/auth_info_baileys /opt/WABOT-gGoupManagement/
sudo cp -a /tmp/uploads /opt/WABOT-gGoupManagement/ 2>/dev/null || true
sudo chown -R deployadmin:deployadmin /opt/WABOT-gGoupManagement/.env /opt/WABOT-gGoupManagement/auth_info_baileys /opt/WABOT-gGoupManagement/uploads
sudo chmod 700 /opt/WABOT-gGoupManagement/auth_info_baileys
sudo systemctl restart wabot
sudo systemctl status wabot --no-pager
```

Sesuaikan `GOOGLE_REDIRECT_URI` di `.env` jika domain/callback berubah. Jika sesi WhatsApp tidak dapat dipulihkan, hapus hanya `auth_info_baileys/` dan lakukan pairing code baru.

## 4. Pulihkan Cloudflare Tunnel

Di Cloudflare Dashboard buat/ambil tunnel baru, lalu jalankan **command install token** pada VPS baru. Jangan memasukkan token ke repository atau chat:

```bash
sudo cloudflared service install <TOKEN_FROM_CLOUDFLARE_DASHBOARD>
sudo systemctl enable --now cloudflared
```

Public Hostname:

```text
arifin.ai.id -> http://127.0.0.1:2004
```

Tes:

```bash
curl -i http://127.0.0.1:2004/
curl -sS http://127.0.0.1:2004/api/status
sudo systemctl is-active wabot cloudflared
```

## 5. Setelah pulih

```bash
sudo journalctl -u wabot -n 80 --no-pager
sudo journalctl -u cloudflared -n 40 --no-pager
curl -sS https://arifin.ai.id/api/status
```

Jangan menjalankan `npm start` manual bersamaan dengan `wabot.service`; dua proses WhatsApp menyebabkan konflik koneksi.
