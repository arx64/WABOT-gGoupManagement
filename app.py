# ==========================================================
#   AUTOMATION KRS, KHS, TRANSKRIP & KTM (AUTO DRIVER + TANGGAL + PDF)
# ==========================================================

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

import time
import requests
from urllib.parse import quote
import os
import base64
import io
import argparse
import zipfile
import fitz
from PIL import Image

# ==========================================================
# KONFIGURASI USER
# ==========================================================
parser = argparse.ArgumentParser()
parser.add_argument("--email", default=os.environ.get("SIAKAD_EMAIL", ""))
parser.add_argument("--password", default=os.environ.get("SIAKAD_PASSWORD", ""))
args = parser.parse_args()

EMAIL = args.email
PASSWORD = args.password
if not EMAIL or not PASSWORD:
    raise SystemExit("Email/password wajib diisi lewat --email/--password atau env SIAKAD_EMAIL/SIAKAD_PASSWORD")
NIM = "220141013"
ANGKATAN = "2022"
IDUNIT = "59201"

IDPERIODE_LIST = [
    "20252", "20251", "20242", "20241", "20232", "20231", "20222", "20221"
]
BASE_URL = "https://pelitanusantara.siakadcloud.com"
URL_LOGIN = f"{BASE_URL}/gate/login"
URL_KRS = f"{BASE_URL}/siakad/rep_krsmahasiswa"
URL_KHS = f"{BASE_URL}/siakad/rep_khsmahasiswa"
URL_TRANSKRIP = f"{BASE_URL}/siakad/rep_transkripsmt"
URL_DATA_MAHASISWA = f"{BASE_URL}/siakad/data_mahasiswa"
XPATH_DROPDOWN_KTM = "/html/body/div[4]/div/aside/section[2]/div/div/div/div[1]/div/div/div/button"
XPATH_CETAK_KTM = "/html/body/div[4]/div/aside/section[2]/div/div/div/div[1]/div/div/div/ul/li[2]/a"

# ==========================================================
# MAPPING TANGGAL SESUAI KETENTUAN
# ==========================================================
tanggal_map = {
    # Ganjil 2022/2023
    "20221": {
        "krs": "Medan, 01 September 2022",
        "khs": "Medan, 25 Februari 2023",
    },
    # Genap 2022/2023
    "20222": {
        "krs": "Medan, 05 Maret 2023",
        "khs": "Medan, 05 September 2023",
    },
    # Ganjil 2023/2024
    "20231": {
        "krs": "Medan, 01 September 2023",
        "khs": "Medan, 25 Februari 2024",
    },
    # Genap 2023/2024
    "20232": {
        "krs": "Medan, 05 Maret 2024",
        "khs": "Medan, 05 September 2024",
    },
    # Ganjil 2024/2025
    "20241": {
        "krs": "Medan, 01 September 2024",
        "khs": "Medan, 25 Februari 2025",
    },
    # Genap 2024/2025
    "20242": {
        "krs": "Medan, 05 Maret 2025",
        "khs": "Medan, 05 September 2025",
    },
    # Ganjil 2025/2026
    "20251": {
        "krs": "Medan, 01 September 2025",
        "khs": "Medan, 25 Februari 2026",
    },
    # Genap 2025/2026
    "20252": {
        "krs": "Medan, 05 Maret 2026",
        "khs": "Medan, 31 Juli 2026",
    },
}

# Tanggal Transkrip (bisa disetting seperti KRS/KHS)
TANGGAL_TRANSKRIP = "Medan, 31 Juli 2026"
XPATH_TANGGAL_TRANSKRIP = "/html/body/div/div/div/table[4]/tbody/tr/td/table[2]/tbody/tr/td[2]/text()[1]"

# ==========================================================
# MODE BROWSER
# True  = headless (tanpa GUI)
# False = tampilkan browser
# ==========================================================
HEADLESS = True

# ==========================================================
# SETUP SELENIUM (AUTO DRIVER)
# ==========================================================
chrome_options = Options()
chrome_options.add_argument("--disable-blink-features=AutomationControlled")
chrome_options.add_argument("--window-size=1920,1080")

if HEADLESS:
    chrome_options.add_argument("--headless=new")
    chrome_options.add_argument("--disable-gpu")
    chrome_options.add_argument("--no-sandbox")
    print("[*] Mode: HEADLESS")
else:
    chrome_options.add_argument("--start-maximized")
    print("[*] Mode: GUI (browser tampil)")

driver = webdriver.Chrome(options=chrome_options)
wait = WebDriverWait(driver, 15)

# ==========================================================
# LOGIN
# ==========================================================
print("[*] Login...")

driver.get(URL_LOGIN)

wait.until(EC.presence_of_element_located((By.XPATH, '//*[@id="email"]'))).send_keys(EMAIL)
driver.find_element(By.XPATH, '//*[@id="password"]').send_keys(PASSWORD)
driver.find_element(By.XPATH, '/html/body/div/div/div/div[2]/form/div[2]/div[5]/button').click()

# klik SIM Akademik (sesuai script awalmu)
driver.find_element(By.XPATH, '//*[@id="navigation"]/li/div').click()
driver.find_element(By.XPATH, '//*[@id="siakad"]/div/div[2]').click()

# tutup modal
time.sleep(5)
driver.find_element(By.XPATH, '//*[@id="modal-pengumuman-slider"]/div/div/button').click()
driver.find_element(By.XPATH, '//*[@id="toggle-profile"]').click()

# Ambil nama mahasiswa dari navbar / profile text
try:
    nama_elem = driver.find_element(By.XPATH, '//*[@id="profile-content"]/div/div[1]/div/div[2]/h4')
    NAMA_MAHASISWA = nama_elem.text.strip().replace(" ", "_")
except Exception:
    NAMA_MAHASISWA = NIM  # fallback
print(f"[INFO] Nama terdeteksi: {NAMA_MAHASISWA}")

try:
    driver.get(URL_DATA_MAHASISWA)
    time.sleep(2)
    identity = driver.execute_script("""
    const valueOf = (selectors) => {
        for (const selector of selectors) {
            const el = document.querySelector(selector);
            if (!el) continue;
            const val = (el.value || el.getAttribute('value') || el.textContent || '').trim();
            if (val) return val;
        }
        return '';
    };

    const body = document.body ? document.body.innerText : '';
    const nimInput = valueOf(['input[name="nim"]', '#nim', '[name="nim"]']);
    const idunitInput = valueOf(['input[name="idunit"]', 'select[name="idunit"]', '#idunit', '[name="idunit"]']);
    const angkatanInput = valueOf(['input[name="angkatan"]', 'select[name="angkatan"]', '#angkatan', '[name="angkatan"]']);
    const nimMatch = (nimInput || body).match(/\b\d{9,12}\b/);
    const idunitMatch = idunitInput.match(/\d+/);
    const angkatanMatch = angkatanInput.match(/20\d{2}/);

    return {
        nim: nimMatch ? nimMatch[0] : '',
        idunit: idunitMatch ? idunitMatch[0] : '',
        angkatan: angkatanMatch ? angkatanMatch[0] : '',
    };
    """)

    if identity.get("nim"):
        NIM = identity["nim"]
        ANGKATAN = identity.get("angkatan") or ("20" + NIM[:2])
    if identity.get("idunit"):
        IDUNIT = identity["idunit"]

    print(f"[INFO] NIM terdeteksi: {NIM}")
    print(f"[INFO] Angkatan: {ANGKATAN}")
    print(f"[INFO] IDUNIT: {IDUNIT}")
except Exception as e:
    print(f"[WARN] Auto-deteksi NIM/IDUNIT gagal, pakai fallback ({e})")

def nama_file(jenis, periode):
    return f"{jenis.upper()}_{NAMA_MAHASISWA}_{periode}.pdf"

# tunggu beberapa detik biar load selesai
time.sleep(3)

# Pindah cookies ke requests Session
session = requests.Session()
for cookie in driver.get_cookies():
    session.cookies.set(cookie['name'], cookie['value'])

print("[✓] Login sukses.\n")

# ==========================================================
# FUNGSI AMBIL HTML (POST REQUEST)
# ==========================================================
def ambil_html(url, periode):
    payload = {
        "nim": NIM,
        "idperiode": periode,
        "idunit": IDUNIT,
        "noback": "1",
        "iskop": "1",
        "backlink": f"set_krs/{NIM}"
    }
    response = session.post(url, data=payload)
    return response.text

def ambil_html_transkrip():
    payload = {
        "idunit": IDUNIT,
        "nim": NIM,
        "angkatan": ANGKATAN,
        "format": "html",
        "iskop": "1",
    }
    response = session.post(URL_TRANSKRIP, data=payload)
    return response.text

def download_ktm_via_ui():
    """
    Flow KTM:
    1. Buka data_mahasiswa
    2. Klik tombol dropdown
    3. Klik menu cetak KTM (xpath)
    4. Jendela baru terbuka (sudah PDF / viewer)
    5. Simpan PDF dari jendela baru
    """
    main_handle = driver.current_window_handle
    before_handles = set(driver.window_handles)

    print("    • Buka data_mahasiswa")
    driver.get(URL_DATA_MAHASISWA)

    # 1) buka dropdown dulu
    try:
        dropdown_btn = wait.until(
            EC.element_to_be_clickable((By.XPATH, XPATH_DROPDOWN_KTM))
        )
        dropdown_btn.click()
        time.sleep(0.5)
        print("    • Dropdown dibuka")
    except Exception:
        print("    ❌ Tombol dropdown KTM tidak ditemukan")
        return False

    # 2) klik menu cetak KTM
    try:
        link = wait.until(EC.element_to_be_clickable((By.XPATH, XPATH_CETAK_KTM)))
    except Exception:
        print("    ❌ Link cetak KTM tidak ditemukan")
        return False

    # pastikan link buka tab/window baru
    try:
        driver.execute_script("arguments[0].setAttribute('target', '_blank');", link)
    except Exception:
        pass

    link.click()
    print("    • Klik cetak KTM")

    # tunggu window baru
    new_handle = None
    for _ in range(20):
        time.sleep(0.5)
        after_handles = set(driver.window_handles)
        diff = after_handles - before_handles
        if diff:
            new_handle = diff.pop()
            break

    if not new_handle:
        # fallback: mungkin same-tab navigation
        print("    ⚠ Window baru tidak muncul, coba simpan di tab aktif")
        time.sleep(2)
        current_url = driver.current_url
        if "rep_ktm" in current_url or "ktm" in current_url.lower() or current_url != URL_DATA_MAHASISWA:
            save_pdf("KTM")
            driver.get(URL_DATA_MAHASISWA)
            return True
        print("    ❌ Gagal membuka KTM")
        return False

    driver.switch_to.window(new_handle)
    time.sleep(2)

    # tunggu load (PDF viewer / halaman cetak)
    try:
        WebDriverWait(driver, 15).until(
            lambda d: d.execute_script("return document.readyState") == "complete"
        )
    except Exception:
        pass

    # Beberapa browser buka chrome-extension PDF viewer / blob / direct PDF URL.
    # Page.printToPDF tetap jalan di halaman yang ter-render.
    current_url = driver.current_url
    print(f"    • Tab KTM: {current_url}")

    # Kalau URL langsung file PDF, coba download via requests dulu (lebih murni)
    saved = False
    if current_url.startswith("http") and ("rep_ktm" in current_url or current_url.lower().endswith(".pdf")):
        try:
            resp = session.get(current_url)
            if resp.status_code == 200 and (
                resp.content.startswith(b"%PDF")
                or "pdf" in (resp.headers.get("Content-Type") or "").lower()
            ):
                path = os.path.join(BASE_DIR, "KTM", f"KTM_{NAMA_MAHASISWA}.pdf")
                pdf_bytes = putihkan_teks_ktm_pdf_bytes(resp.content)
                with open(path, "wb") as f:
                    f.write(pdf_bytes)
                print(f"    📄 PDF saved: {path}")
                saved = True
        except Exception as e:
            print(f"    ⚠ Download direct gagal ({e}), fallback printToPDF")

    if not saved:
        save_pdf("KTM")

    # tutup tab KTM, balik ke main
    driver.close()
    driver.switch_to.window(main_handle)
    return True

# ==========================================================
# BUKA HTML DI TAB BARU (tanpa edit tanggal)
# ==========================================================
def render_html(html, edit_ktm=False):
    driver.execute_script("window.open('about:blank','_blank');")
    driver.switch_to.window(driver.window_handles[-1])
    driver.get("data:text/html;charset=utf-8," + quote(html))

    WebDriverWait(driver, 10).until(
        lambda d: d.execute_script("return document.readyState") == "complete"
    )

    if edit_ktm:
        js = """
        const nodes = Array.from(document.querySelectorAll('body, body *'));
        let changed = 0;

        for (const el of nodes) {
            el.style.setProperty('color', '#ffffff', 'important');
            el.style.setProperty('-webkit-text-fill-color', '#ffffff', 'important');
            el.style.setProperty('text-shadow', 'none', 'important');
            changed += 1;
        }

        return changed;
        """
        changed = driver.execute_script(js)
        print(f"    ? Teks KTM diputihkan: {changed} elemen")

    time.sleep(1)
    return True


def recolor_ktm_pdf_bytes(pdf_bytes):
    src = fitz.open(stream=pdf_bytes, filetype="pdf")
    out = fitz.open()

    for page in src:
        pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
        img = Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB")
        pixels = img.load()
        width, height = img.size

        for y in range(height):
            for x in range(width):
                r, g, b = pixels[x, y]
                if r < 90 and g < 90 and b < 90:
                    pixels[x, y] = (255, 255, 255)

        buf = io.BytesIO()
        img.save(buf, format="PNG")
        rect = fitz.Rect(0, 0, page.rect.width, page.rect.height)
        new_page = out.new_page(width=page.rect.width, height=page.rect.height)
        new_page.insert_image(rect, stream=buf.getvalue())

    result = out.tobytes(garbage=3, deflate=True)
    src.close()
    out.close()
    return result

def putihkan_teks_ktm_pdf_bytes(pdf_bytes):
    """
    Ubah font-color teks KTM dari hitam -> putih.
    Bukan menyembunyikan: teks tetap ada, hanya warnanya diganti.
    """
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    total = 0

    for page in doc:
        spans = []
        data = page.get_text("dict")

        for block in data.get("blocks", []):
            if block.get("type") != 0:
                continue
            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    text = span.get("text") or ""
                    if not text:
                        continue

                    # color PDF = 0xRRGGBB integer
                    color = span.get("color", 0) or 0
                    r = (color >> 16) & 255
                    g = (color >> 8) & 255
                    b = color & 255

                    # hanya teks hitam / hampir hitam
                    if r > 40 or g > 40 or b > 40:
                        continue

                    spans.append({
                        "text": text,
                        "bbox": fitz.Rect(span["bbox"]),
                        "origin": fitz.Point(span["origin"]),
                        "size": float(span.get("size") or 6),
                        "font": span.get("font") or "",
                    })

        if not spans:
            continue

        # 1) hapus teks hitam lama (background image dibiarkan)
        for span in spans:
            page.add_redact_annot(span["bbox"], fill=None)
        page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE)

        # 2) tulis ulang teks yang sama, warna putih
        for span in spans:
            fontname = "hebo" if "bold" in span["font"].lower() else "helv"
            page.insert_text(
                span["origin"],
                span["text"],
                fontsize=span["size"],
                fontname=fontname,
                color=(1, 1, 1),
            )
            total += 1

    result = doc.tobytes(garbage=3, deflate=True)
    doc.close()
    print(f"    • Font color KTM hitam->putih: {total} span")
    return result

# ==========================================================
# UPDATE DOM TANGGAL KRS/KHS
# ==========================================================
def render_edit(html, is_khs, periode):
    driver.execute_script("window.open('about:blank','_blank');")
    driver.switch_to.window(driver.window_handles[-1])
    driver.get("data:text/html;charset=utf-8," + quote(html))

    WebDriverWait(driver, 10).until(
        lambda d: d.execute_script("return document.readyState") == "complete"
    )

    jenis = "khs" if is_khs else "krs"
    tanggal_baru = tanggal_map.get(periode, {}).get(jenis)

    if not tanggal_baru:
        print(f"    ⚠ Tidak ada mapping tanggal {jenis.upper()} periode {periode}. Skip.")
        return False

    xpath_target = (
        "/html/body/div/div/table[4]/tbody/tr[1]/td[2]/span"
        if is_khs else
        "/html/body/div/div/table[3]/tbody/tr[1]/td[3]/span"
    )

    js = """
    const xpath = arguments[0];
    const tgl = arguments[1];
    let el = document.evaluate(xpath, document, null,
        XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;

    if (!el) {
        const spans = Array.from(document.querySelectorAll('span'));
        el = spans.find(s => s.textContent.includes('Medan'));
    }

    if (el) {
        el.textContent = tgl;
        return el.textContent;
    }
    return null;
    """

    hasil = driver.execute_script(js, xpath_target, tanggal_baru)

    if hasil:
        print(f"    ✅ Tanggal updated: {hasil}")
        return True
    else:
        print("    ❌ Elemen span tanggal tidak ditemukan")
        return False

# ==========================================================
# UPDATE DOM TANGGAL TRANSKRIP
# ==========================================================
def render_edit_transkrip(html, tanggal_baru=TANGGAL_TRANSKRIP):
    driver.execute_script("window.open('about:blank','_blank');")
    driver.switch_to.window(driver.window_handles[-1])
    driver.get("data:text/html;charset=utf-8," + quote(html))

    WebDriverWait(driver, 10).until(
        lambda d: d.execute_script("return document.readyState") == "complete"
    )

    js = """
    const xpath = arguments[0];
    const tgl = arguments[1];

    // XPath bisa menunjuk text node (text()[1])
    let node = document.evaluate(
        xpath, document, null,
        XPathResult.FIRST_ORDERED_NODE_TYPE, null
    ).singleNodeValue;

    if (node) {
        if (node.nodeType === Node.TEXT_NODE) {
            node.nodeValue = tgl;
            return node.nodeValue;
        }
        node.textContent = tgl;
        return node.textContent;
    }

    // Fallback: cari text "Medan" di dalam cell tanggal
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
        const n = walker.currentNode;
        if (n.nodeValue && n.nodeValue.includes('Medan')) {
            n.nodeValue = tgl;
            return n.nodeValue;
        }
    }
    return null;
    """

    hasil = driver.execute_script(js, XPATH_TANGGAL_TRANSKRIP, tanggal_baru)

    if hasil:
        print(f"    ✅ Tanggal Transkrip updated: {hasil}")
        return True
    else:
        print("    ❌ Text node tanggal Transkrip tidak ditemukan")
        return False

# ==========================================================
# SIMPAN PDF
# ==========================================================
BASE_DIR = os.path.join(os.getcwd(), f"KRS-KHS_{NAMA_MAHASISWA}")
os.makedirs(os.path.join(BASE_DIR, "KRS"), exist_ok=True)
os.makedirs(os.path.join(BASE_DIR, "KHS"), exist_ok=True)
os.makedirs(os.path.join(BASE_DIR, "TRANSKRIP"), exist_ok=True)
os.makedirs(os.path.join(BASE_DIR, "KTM"), exist_ok=True)

def save_pdf(jenis, periode=None):
    if periode:
        filename = f"{jenis.upper()}_{NAMA_MAHASISWA}_{periode}.pdf"
    else:
        filename = f"{jenis.upper()}_{NAMA_MAHASISWA}.pdf"

    path = os.path.join(BASE_DIR, jenis.upper(), filename)

    pdf = driver.execute_cdp_cmd("Page.printToPDF", {
        "printBackground": True,
        "scale": 1
    })

    pdf_bytes = base64.b64decode(pdf['data'])
    if jenis.upper() == "KTM":
        pdf_bytes = putihkan_teks_ktm_pdf_bytes(pdf_bytes)

    with open(path, "wb") as f:
        f.write(pdf_bytes)

    print(f"    📄 PDF saved: {path}")

# ==========================================================
# MAIN LOOP — FULL AUTO
# ==========================================================
for periode in IDPERIODE_LIST:
    print(f"\n[*] Periode: {periode}")

    # ---------- KRS ----------
    html_krs = ambil_html(URL_KRS, periode)
    print("    • Proses KRS")
    if render_edit(html_krs, is_khs=False, periode=periode):
        save_pdf("KRS", periode)
    driver.close()
    driver.switch_to.window(driver.window_handles[0])

    # ---------- KHS ----------
    html_khs = ambil_html(URL_KHS, periode)
    print("    • Proses KHS")

    render_edit(html_khs, is_khs=True, periode=periode)

    # cek apakah KHS punya nilai?
    nilai_ada = driver.execute_script(
        "return document.querySelectorAll('table:nth-of-type(3) tbody tr').length > 0;"
    )

    if not nilai_ada:
        print(f"    ⚠ KHS {periode} belum ada nilai → SKIP SEPENUHNYA")
        driver.close()
        driver.switch_to.window(driver.window_handles[0])
        continue

    save_pdf("KHS", periode)
    driver.close()
    driver.switch_to.window(driver.window_handles[0])

# ---------- TRANSKRIP ----------
print("\n[*] Proses Transkrip")
html_transkrip = ambil_html_transkrip()
if render_edit_transkrip(html_transkrip, TANGGAL_TRANSKRIP):
    save_pdf("TRANSKRIP")
driver.close()
driver.switch_to.window(driver.window_handles[0])

# ---------- KTM ----------
print("\n[*] Proses KTM")
if not download_ktm_via_ui():
    print("    ❌ KTM gagal diproses.")

print("\n🎉 Semua selesai diproses!")
# Sebelumnya: kode di bawah membuat Chrome tetap terbuka dan menunggu input/timeout.
# Penjelasan:
# Sebelumnya kode ini menunggu input atau timeout sehingga browser tetap terbuka
# setelah semua proses selesai. Untuk otomatisasi yang berjalan batch/non-interaktif,
# lebih baik menutup browser secara eksplisit supaya proses tidak menggantung dan
# resource (memori/proses Chrome) dibebaskan.
#
# Implementasi di bawah memanggil driver.quit() yang akan menutup semua jendela
# dan mengakhiri sesi WebDriver. Pemanggilan ini dibungkus try/except untuk
# menghindari error jika driver sudah tertutup atau tidak tersedia lagi.
try:
    # Tutup semua jendela browser dan hentikan sesi WebDriver.
    driver.quit()
except Exception:
    # Jika terjadi error saat menutup (mis. sesi sudah berakhir), lewati saja.
    pass

# Informasi singkat bahwa proses selesai dan browser telah ditutup.
print("    ✅ Browser ditutup. Semua proses selesai.")

zip_path = BASE_DIR + ".zip"
with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zip_file:
    for root, _, files in os.walk(BASE_DIR):
        for file in files:
            full_path = os.path.join(root, file)
            arcname = os.path.relpath(full_path, os.path.dirname(BASE_DIR))
            zip_file.write(full_path, arcname)

print(f"OUTPUT_ZIP:{zip_path}")
