import os
import time
import ssl
import requests
from bs4 import BeautifulSoup
from requests.adapters import HTTPAdapter
from urllib3.poolmanager import PoolManager

# =========================
# KONFIGURASI DASAR
# =========================

BASE_URL = 'https://bokepindoh.wtf/'
HOSTNAME = 'bokepindoh.wtf'
DEST_IP = '104.21.1.137'   # IP dari DevTools browser (Cloudflare)

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
                  'AppleWebKit/537.36 (KHTML, like Gecko) '
                  'Chrome/115.0.0.0 Safari/537.36'
}

SAVE_FOLDER = 'videos'
LINKS_FILE = 'links.txt'
os.makedirs(SAVE_FOLDER, exist_ok=True)

# =========================
# ADAPTER DNS BYPASS
# =========================

class HostHeaderSSLAdapter(HTTPAdapter):
    def __init__(self, dest_ip, hostname):
        self.dest_ip = dest_ip
        self.hostname = hostname
        super().__init__()

    def init_poolmanager(self, connections, maxsize, block=False):
        context = ssl.create_default_context()
        context.check_hostname = True
        context.verify_mode = ssl.CERT_REQUIRED

        self.poolmanager = PoolManager(
            num_pools=connections,
            maxsize=maxsize,
            block=block,
            ssl_context=context,
            server_hostname=self.hostname
        )

    def send(self, request, **kwargs):
        request.url = request.url.replace(self.hostname, self.dest_ip)
        request.headers['Host'] = self.hostname
        return super().send(request, **kwargs)

# =========================
# SESSION GLOBAL
# =========================

session = requests.Session()
session.headers.update(HEADERS)
session.mount(
    f'https://{HOSTNAME}',
    HostHeaderSSLAdapter(DEST_IP, HOSTNAME)
)

# =========================
# UTIL LINK TRACKING
# =========================

def load_existing_links():
    if os.path.exists(LINKS_FILE):
        with open(LINKS_FILE, 'r', encoding='utf-8') as f:
            return set(line.strip() for line in f)
    return set()

def append_link_if_new(link, known_links):
    if link and link not in known_links:
        with open(LINKS_FILE, 'a', encoding='utf-8') as f:
            f.write(link + '\n')
        known_links.add(link)
        print(f"[+] Link baru disimpan")
    else:
        print(f"[=] Duplikat / kosong di-skip")

# =========================
# AMBIL VIDEO URL
# =========================

def get_video_url(detail_url):
    try:
        resp = session.get(detail_url, timeout=15)
        if resp.status_code != 200:
            return None

        soup = BeautifulSoup(resp.text, 'html.parser')

        video = soup.find('video', src=True)
        if video:
            return video['src']

        iframe = soup.find('iframe', src=True)
        if iframe:
            return iframe['src']

        return None
    except Exception as e:
        print(f"[!] Error ambil video: {e}")
        return None

# =========================
# DOWNLOAD VIDEO
# =========================

def download_video(video_url, filename):
    try:
        resp = session.get(video_url, stream=True, timeout=30)
        if resp.status_code == 200:
            path = os.path.join(SAVE_FOLDER, filename)
            with open(path, 'wb') as f:
                for chunk in resp.iter_content(1024 * 1024):
                    if chunk:
                        f.write(chunk)
            print(f"[✓] Video disimpan: {filename}")
        else:
            print(f"[!] Gagal download video")
    except Exception as e:
        print(f"[!] Error download: {e}")

# =========================
# SCRAPER UTAMA
# =========================

def scrape_page(start_url, max_pages=5):
    page = 1
    url = start_url
    known_links = load_existing_links()

    while url and page <= max_pages:
        print(f"\n📄 Scraping halaman {page}: {url}")

        resp = session.get(url, timeout=15)
        if resp.status_code != 200:
            print("[!] Gagal akses halaman")
            break

        soup = BeautifulSoup(resp.text, 'html.parser')
        articles = soup.find_all('article')

        for i, article in enumerate(articles, 1):
            a = article.find('a', href=True)
            if not a:
                continue

            title = a.get('data-title') or a.get('title') or 'no_title'
            link = a['href']

            duration_tag = article.find('span', class_='duration')
            duration = duration_tag.text.strip() if duration_tag else '-'

            video_url = get_video_url(link)

            print(f"{i}. Judul  : {title}")
            print(f"   Link   : {link}")
            print(f"   Durasi : {duration}")
            print(f"   Video  : {video_url}")

            append_link_if_new(video_url, known_links)

            if video_url and video_url.endswith('.mp4'):
                safe_title = title[:50].replace(' ', '_').replace('|', '')
                download_video(video_url, f"{safe_title}.mp4")
            else:
                print("   ⚠️ Video tidak bisa diunduh")

            print('-' * 50)

        next_btn = soup.find('a', string='Next')
        if next_btn and next_btn.get('href'):
            url = next_btn['href']
            page += 1
            print("⏳ Delay 60 detik...")
            time.sleep(60)
        else:
            break

# =========================
# START
# =========================

scrape_page(BASE_URL, max_pages=111)
