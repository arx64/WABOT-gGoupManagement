import tkinter as tk
from tkinter import filedialog, messagebox
from PIL import Image
import numpy as np

# ==== FUNGSI UTAMA ====
def _to_bits(data: bytes):
    for byte in data:
        for i in range(8):
            yield (byte >> (7 - i)) & 1

def embed_text(cover_image_path, out_image_path, secret_text):
    img = Image.open(cover_image_path)
    if img.mode != 'RGB':
        img = img.convert('RGB')
    arr = np.array(img)
    h, w, _ = arr.shape

    data = secret_text.encode('utf-8') + b'\0'
    bits = list(_to_bits(data))
    total_pixels = h * w
    if len(bits) > total_pixels:
        raise ValueError("Pesan terlalu panjang untuk gambar ini.")

    idx = 0
    for y in range(h):
        for x in range(w):
            if idx >= len(bits):
                break
            r, g, b = arr[y, x]
            b = (b & ~1) | bits[idx]
            arr[y, x] = [r, g, b]
            idx += 1
        if idx >= len(bits):
            break

    out = Image.fromarray(arr)
    out.save(out_image_path, 'PNG')

def extract_text(stego_image_path):
    img = Image.open(stego_image_path)
    if img.mode != 'RGB':
        img = img.convert('RGB')
    arr = np.array(img)
    h, w, _ = arr.shape

    bits = []
    for y in range(h):
        for x in range(w):
            b = arr[y, x, 2]
            bits.append(b & 1)

    bytes_out = bytearray()
    for i in range(0, len(bits), 8):
        byte = 0
        for j in range(8):
            if i + j < len(bits):
                byte = (byte << 1) | bits[i + j]
        if byte == 0:
            break
        bytes_out.append(byte)
    return bytes_out.decode('utf-8', errors='ignore')

# ==== GUI TKINTER ====
class StegoApp:
    def __init__(self, master):
        self.master = master
        master.title("🔒 Steganografi LSB - Embed & Extract")
        master.geometry("500x400")
        master.resizable(False, False)

        self.file_path = ""
        self.output_path = ""

        tk.Label(master, text="🔹 Steganografi LSB (PNG Only)", font=("Arial", 14, "bold")).pack(pady=10)

        # Tombol pilih gambar
        tk.Button(master, text="Pilih Gambar (PNG)", command=self.choose_file, bg="#4CAF50", fg="white").pack(pady=5)

        self.file_label = tk.Label(master, text="Belum ada file dipilih", fg="gray")
        self.file_label.pack()

        # Input teks
        tk.Label(master, text="Pesan Rahasia:", font=("Arial", 11, "bold")).pack(pady=5)
        self.text_entry = tk.Text(master, height=5, width=50)
        self.text_entry.pack()

        # Tombol embed
        tk.Button(master, text="🔐 Embed Pesan", command=self.embed_action, bg="#2196F3", fg="white").pack(pady=5)

        # Tombol extract
        tk.Button(master, text="🔎 Extract Pesan", command=self.extract_action, bg="#FF9800", fg="white").pack(pady=5)

        # Output hasil
        tk.Label(master, text="Hasil Ekstraksi:", font=("Arial", 11, "bold")).pack(pady=5)
        self.result_box = tk.Text(master, height=4, width=50, state='disabled', fg="blue")
        self.result_box.pack()

    def choose_file(self):
        file_path = filedialog.askopenfilename(
            title="Pilih gambar PNG",
            filetypes=[("Gambar PNG", "*.png")]
        )
        if file_path:
            self.file_path = file_path
            self.file_label.config(text=file_path.split("/")[-1], fg="black")

    def embed_action(self):
        if not self.file_path:
            messagebox.showerror("Error", "Pilih gambar PNG terlebih dahulu!")
            return
        secret_text = self.text_entry.get("1.0", tk.END).strip()
        if not secret_text:
            messagebox.showerror("Error", "Masukkan teks rahasia terlebih dahulu!")
            return
        save_path = filedialog.asksaveasfilename(
            defaultextension=".png",
            filetypes=[("PNG", "*.png")],
            title="Simpan gambar hasil"
        )
        if not save_path:
            return
        try:
            embed_text(self.file_path, save_path, secret_text)
            messagebox.showinfo("Sukses", f"Pesan berhasil disisipkan!\nDisimpan di:\n{save_path}")
        except Exception as e:
            messagebox.showerror("Error", str(e))

    def extract_action(self):
        if not self.file_path:
            messagebox.showerror("Error", "Pilih gambar terlebih dahulu!")
            return
        try:
            message = extract_text(self.file_path)
            self.result_box.config(state='normal')
            self.result_box.delete("1.0", tk.END)
            self.result_box.insert(tk.END, message if message else "(tidak ada pesan ditemukan)")
            self.result_box.config(state='disabled')
        except Exception as e:
            messagebox.showerror("Error", str(e))

# ==== RUN PROGRAM ====
if __name__ == "__main__":
    root = tk.Tk()
    app = StegoApp(root)
    root.mainloop()
