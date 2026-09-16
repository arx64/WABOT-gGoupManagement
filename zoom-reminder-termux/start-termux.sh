#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

cd "$(dirname "$0")"

export TZ="${TZ:-Asia/Jakarta}"
export PYTHON_BIN="${PYTHON_BIN:-python}"
export NODE_ENV="${NODE_ENV:-production}"

mkdir -p auth_info_baileys logs tmp

if [ ! -f .env ]; then
  echo "File .env belum ada. Jalankan: cp .env.termux.example .env"
  exit 1
fi

node index.js
