import tkinter as tk
from tkinter import filedialog, messagebox
import hashlib
import os
from datetime import datetime

# --- Fungsi untuk menghitung hash file ---
def calculate_hashes(file_path):
    hashes = {
        'MD5': hashlib.md5(),
        'SHA1': hashlib.sha1(),
        'SHA256': hashlib.sha256()
    }
    with open(file_path, 'rb') as f:
        while chunk := f.read(8192):
            for h in hashes.values():
                h.update(chunk)
    return {name: h.hexdigest() for name, h in hashes.items()}

# --- Simpan hasil verifikasi ke log file ---
def save_log(file_path, result_text):
    os.makedirs("logs", exist_ok=True)
    with open("logs/verification_log.txt", "a") as log:
        log.write(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}]\n")
        log.write(f"File: {file_path}\n{result_text}\n\n")

# --- Fungsi tombol 'Pilih File' ---
def browse_file():
    path = filedialog.askopenfilename(title="Pilih File")
    if path:
        entry_file.delete(0, tk.END)
        entry_file.insert(0, path)

# --- Fungsi tombol 'Generate Hash' ---
def generate_hash():
    file_path = entry_file.get()
    if not file_path or not os.path.exists(file_path):
        messagebox.showwarning("Peringatan", "Pilih file terlebih dahulu!")
        return
    
    hashes = calculate_hashes(file_path)
    text_md5.delete(0, tk.END)
    text_sha1.delete(0, tk.END)
    text_sha256.delete(0, tk.END)
    text_md5.insert(0, hashes['MD5'])
    text_sha1.insert(0, hashes['SHA1'])
    text_sha256.insert(0, hashes['SHA256'])

    messagebox.showinfo("Selesai", "Hash berhasil dihitung!")

# --- Fungsi tombol 'Verifikasi' ---
def verify_hash():
    file_path = entry_file.get()
    user_hash = entry_verify.get().strip().lower()

    if not file_path or not os.path.exists(file_path):
        messagebox.showwarning("Peringatan", "Pilih file terlebih dahulu!")
        return
    if not user_hash:
        messagebox.showwarning("Peringatan", "Masukkan hash pembanding!")
        return

    hashes = calculate_hashes(file_path)
    result_text = ""
    valid = False

    for name, val in hashes.items():
        if val.lower() == user_hash:
            valid = True
            result_text += f"✅ {name} cocok!\n"
        else:
            result_text += f"❌ {name} berbeda.\n"

    lbl_result.config(text=result_text, fg="green" if valid else "red")
    save_log(file_path, result_text)
    messagebox.showinfo("Hasil Verifikasi", result_text)

# --- GUI setup ---
root = tk.Tk()
root.title("🔐 Hash File Verifier")
root.geometry("650x420")
root.resizable(False, False)

# --- Frame utama ---
frame = tk.Frame(root, padx=15, pady=15)
frame.pack(fill=tk.BOTH, expand=True)

# --- Pilih file ---
tk.Label(frame, text="Pilih File:").grid(row=0, column=0, sticky="w")
entry_file = tk.Entry(frame, width=50)
entry_file.grid(row=0, column=1, padx=5)
tk.Button(frame, text="Browse", command=browse_file).grid(row=0, column=2)

# --- Tombol Generate Hash ---
tk.Button(frame, text="Generate Hash", command=generate_hash, bg="#0078D7", fg="white").grid(row=1, column=1, pady=10)

# --- Hasil hash ---
tk.Label(frame, text="MD5:").grid(row=2, column=0, sticky="w")
text_md5 = tk.Entry(frame, width=70)
text_md5.grid(row=2, column=1, columnspan=2, pady=3)

tk.Label(frame, text="SHA1:").grid(row=3, column=0, sticky="w")
text_sha1 = tk.Entry(frame, width=70)
text_sha1.grid(row=3, column=1, columnspan=2, pady=3)

tk.Label(frame, text="SHA256:").grid(row=4, column=0, sticky="w")
text_sha256 = tk.Entry(frame, width=70)
text_sha256.grid(row=4, column=1, columnspan=2, pady=3)

# --- Input hash pembanding ---
tk.Label(frame, text="\nMasukkan Hash Pembanding:").grid(row=5, column=0, sticky="w")
entry_verify = tk.Entry(frame, width=70)
entry_verify.grid(row=5, column=1, columnspan=2, pady=5)

# --- Tombol Verifikasi ---
tk.Button(frame, text="Verifikasi Hash", command=verify_hash, bg="#28A745", fg="white").grid(row=6, column=1, pady=10)

# --- Hasil verifikasi ---
lbl_result = tk.Label(frame, text="", font=("Arial", 11, "bold"))
lbl_result.grid(row=7, column=0, columnspan=3, pady=10)

tk.Label(frame, text="© 2025 Digital Forensics Project", fg="gray").grid(row=8, column=0, columnspan=3, pady=5)

root.mainloop()
