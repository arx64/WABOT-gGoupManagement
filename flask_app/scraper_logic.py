
import os
import re
import time
import ssl
import requests
from bs4 import BeautifulSoup
from requests.adapters import HTTPAdapter
from urllib3.poolmanager import PoolManager
from lxml import html


def _base62_char(n):
    if n > 35:
        return chr(n + 29)
    if n < 10:
        return chr(48 + n)
    return chr(87 + n)


def _base62(n):
    s = ''
    while True:
        n, rem = divmod(n, 62)
        s = _base62_char(rem) + s
        if n == 0:
            break
    return s


def _unpack_packed_js(body):
    m = re.search(r"eval\(function\(p,a,c,k,e,d\).*?\}\('(.+)',(\d+),(\d+),'([^']*)'\.split\('\|'\)", body, re.S)
    if not m:
        return None
    p = m.group(1)
    a = int(m.group(2))
    c = int(m.group(3))
    k = m.group(4).split('|')
    d = {}
    for i in range(c):
        d[_base62(i)] = k[i] if k[i] else _base62(i)
    return re.sub(r'\b([a-zA-Z0-9_]+)\b', lambda mm: d.get(mm.group(1), mm.group(1)), p)

# =========================
# KONFIGURASI DASAR
# =========================

BASE_URL = 'https://bokepindo13.llc/'
HOSTNAME = 'bokepindo13.llc'
DEST_IP = '104.21.1.137'   # IP dari DevTools browser (Cloudflare)

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
                  'AppleWebKit/537.36 (KHTML, like Gecko) '
                  'Chrome/115.0.0.0 Safari/537.36'
}

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
# AMBIL VIDEO URL DAN METADATA
# =========================

def get_video_src(detail_url):
    try:
        resp = session.get(detail_url, timeout=15)
        if resp.status_code != 200:
            return None

        if 'bebasbokep.online' in detail_url:
            parser = html.fromstring(resp.text)
            video_elements = parser.xpath('/html/body/div[2]/div[2]/div[3]/video')
            if video_elements:
                src = video_elements[0].get('src')
                if src:
                    return src
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
        print(f'[!] Error fetching video source for {detail_url}: {e}')
        return None

def resolve_final_video_url(video_url):
    if video_url and 'bebasbokep.online' in video_url:
        try:
            resp = session.get(video_url, timeout=15)
            if resp.status_code != 200:
                return video_url
            parser = html.fromstring(resp.text)
            video_elements = parser.xpath('/html/body/div[2]/div[2]/div[3]/video')
            if video_elements:
                src = video_elements[0].get('src')
                if src:
                    return src
            decoded = _unpack_packed_js(resp.text)
            if decoded:
                decoded = decoded.replace('\\\'', "'")
                file_matches = re.findall(r"'file'\s*:\s*'([^']+)'", decoded)
                for f in file_matches:
                    if f.endswith('.mp4'):
                        return f
        except Exception as e:
            print(f'[!] Error resolving video source for {video_url}: {e}')
    return video_url

def get_file_size_mb(url):
    if not url:
        return None
    try:
        resp = session.head(url, timeout=15, allow_redirects=True)
        if resp.status_code != 200:
            return None
        length = resp.headers.get('Content-Length')
        if not length:
            return None
        return round(int(length) / (1024 * 1024), 1)
    except Exception as e:
        print(f'[!] Error getting file size for {url}: {e}')
        return None

def scrape_single_page(url):
    videos_data = []
    try:
        resp = session.get(url, timeout=15)
        if resp.status_code != 200:
            print(f'[!] Gagal akses halaman: {url}')
            return videos_data

        soup = BeautifulSoup(resp.text, 'html.parser')
        # Use lxml for XPath parsing
        parser = html.fromstring(resp.text)

        articles = soup.find_all('article')

        for article_idx, article in enumerate(articles):
            a_tag = article.find('a', href=True)
            if not a_tag:
                continue

            title = a_tag.get('data-title') or a_tag.get('title') or 'No Title'
            detail_link = a_tag['href']

            # Extract duration using XPath
            # /html/body/div[1]/div/div/main/div[1]/article[1]/a/div[1]/span[2]
            # Adjusting XPath to be relative to the article tag
            # We need to find the index of the current article within all articles
            xpath_duration = f'./a/div[1]/span[@class=\
duration\]'
            duration_element = parser.xpath(f'(//article)[{article_idx + 1}]/a/div[1]/span[@class="duration"]')
            duration = duration_element[0].text_content().strip() if duration_element else 'N/A'

            # Extract image using XPath
            # /html/body/div[1]/div/div/main/div[1]/article[1]/a/div[1]/div[1]/img
            xpath_image = f'./a/div[1]/div[1]/img'
            image_element = parser.xpath(f'(//article)[{article_idx + 1}]/a/div[1]/div[1]/img')
            # print(image_element)
            # print(image_element[0].attrib)
            image_url = image_element[0].get('data-src') if image_element else 'No Image'
            # print(image_url)

            video_src = get_video_src(detail_link)
            video_src = resolve_final_video_url(video_src)
            file_size_mb = get_file_size_mb(video_src)

            videos_data.append({
                'title': title,
                'detail_link': detail_link,
                'video_url': video_src,
                'file_size_mb': file_size_mb,
                'image_url': image_url,
                'duration': duration
            })

    except Exception as e:
        print(f'[!] Error scraping page {url}: {e}')

    return videos_data

def get_next_page_url(current_page_url):
    try:
        resp = session.get(current_page_url, timeout=15)
        if resp.status_code != 200:
            return None
        soup = BeautifulSoup(resp.text, 'html.parser')
        next_btn = soup.find('a', string='Next')
        if next_btn and next_btn.get('href'):
            return next_btn['href']
        return None
    except Exception as e:
        print(f'[!] Error getting next page URL for {current_page_url}: {e}')
        return None

if __name__ == '__main__':
    # Example usage for testing
    print('Testing scraper_logic.py...')
    scraped_videos = scrape_single_page(BASE_URL)
    for video in scraped_videos:
        print(f"Title: {video['title']}")
        print(f"Detail Link: {video['detail_link']}")
        print(f"Video URL: {video['video_url']}")
        print(f"Image URL: {video['image_url']}")
        print(f"Duration: {video['duration']}")
        print("\n" + "-"*50 + "\n")
    
    next_page = get_next_page_url(BASE_URL)
    if next_page:
        print(f'Next page URL: {next_page}')

