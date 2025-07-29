import os
import requests
import time
from bs4 import BeautifulSoup

base_url = 'https://bokepindoh.pics/'
headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
}

# Folder tempat simpan video
# save_folder = 'videos'
# os.makedirs(save_folder, exist_ok=True)

# Tambahkan di bagian atas
LINKS_FILE = "links.txt"

def load_existing_links():
    if os.path.exists(LINKS_FILE):
        with open(LINKS_FILE, 'r') as f:
            return set(line.strip() for line in f.readlines())
    return set()

def append_link_if_new(link, known_links):
    if link not in known_links:
        with open(LINKS_FILE, 'a') as f:
            f.write(link + "\n")
        known_links.add(link)
        print(f"[+] Link baru disimpan: {link}")
    else:
        print(f"[=] Duplikat di-skip: {link}")


def get_video_url(detail_url):
    try:
        resp = requests.get(detail_url, headers=headers, timeout=10)
        if resp.status_code != 200:
            return None

        soup = BeautifulSoup(resp.text, 'html.parser')

        # Cari tag <video>
        video_tag = soup.find('video', src=True)
        if video_tag:
            return video_tag['src']

        # Coba cari <iframe>
        iframe_tag = soup.find('iframe', src=True)
        if iframe_tag:
            return iframe_tag['src']

        return None
    except Exception:
        return None

# def download_video(video_url, filename):
#     try:
#         resp = requests.get(video_url, headers=headers, stream=True, timeout=15)
#         if resp.status_code == 200:
#             with open(os.path.join(save_folder, filename), 'wb') as f:
#                 for chunk in resp.iter_content(1024*1024):
#                     f.write(chunk)
#             print(f"[✓] Video disimpan: {filename}")
#         else:
#             print(f"[!] Gagal download: {video_url}")
#     except Exception as e:
#         print(f"[!] Error saat download: {e}")

def scrape_page(url, max_pages=3):
    page = 1
    known_links = load_existing_links()  # Load existing links to avoid duplicates
    while url and page <= max_pages:
        print(f"\n📄 Scraping halaman {page}: {url}")
        resp = requests.get(url, headers=headers)
        if resp.status_code != 200:
            print(f"Gagal mengakses {url}")
            break

        soup = BeautifulSoup(resp.text, 'html.parser')
        articles = soup.find_all('article')

        for i, article in enumerate(articles, 1):
            a_tag = article.find('a', href=True, attrs={'data-title': True}) or \
                    article.find('a', href=True, attrs={'title': True})
            if not a_tag:
                continue

            title = a_tag.get('data-title') or a_tag.get('title')
            link = a_tag['href']

            # Durasi
            duration_tag = article.find('span', class_='duration')
            duration = duration_tag.text.strip() if duration_tag else 'Durasi tidak ditemukan'

            # Ambil video
            video_url = get_video_url(link)
            print(f"{i}. Judul   : {title}")
            print(f"   Link    : {link}")
            print(f"   Durasi  : {duration}")
            print(f"   Video   : {video_url}")
            append_link_if_new(video_url, known_links)

            # Download jika URL valid
            # if video_url and video_url.endswith('.mp4'):
            #     filename = f"{title[:50].replace(' ', '_').replace('|','')}.mp4"
            #     download_video(video_url, filename)
            # else:
            #     print("   ⚠️ Video tidak bisa didownload.")

            print('-' * 50)

        # Cari link next page
        next_link_tag = soup.find('a', string='Next')
        if next_link_tag and next_link_tag.get('href'):
            url = next_link_tag['href']
            page += 1
        else:
            break
        print("Delay 60s sebelum lanjut ke halaman berikutnya...")
        time.sleep(60)  # Delay 60 detik sebelum lanjut ke halaman berikutnya
        print(f"Berlanjut ke halaman {page}...")

# Mulai scraping dan download
scrape_page(base_url, max_pages=111)  # Ganti max_pages sesuai kebutuhan
