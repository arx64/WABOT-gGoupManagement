from flask import Flask, render_template, request, Response, url_for
from scraper_logic import scrape_single_page, BASE_URL, session
import re

app = Flask(__name__)

@app.route('/download')
def download():
    video_url = request.args.get('url')
    if not video_url or not re.match(r'^https?://', video_url):
        return 'Invalid URL', 400

    resp = session.get(video_url, stream=True, timeout=30)
    if resp.status_code != 200:
        return 'Download failed', resp.status_code

    filename = video_url.rsplit('/', 1)[-1] or 'video.mp4'

    def generate():
        for chunk in resp.iter_content(1024 * 1024):
            if chunk:
                yield chunk

    return Response(
        generate(),
        headers={
            'Content-Disposition': f'attachment; filename="{filename}"',
            'Content-Type': 'video/mp4',
        },
    )

@app.route('/')
def index():
    page_param = request.args.get('page', '1')

    try:
        current_page_num = int(page_param)
    except ValueError:
        current_page_num = 1

    if current_page_num == 1:
        scrape_url = BASE_URL
    else:
        scrape_url = f"{BASE_URL.rstrip('/')}/page/{current_page_num}/"

    videos = scrape_single_page(scrape_url) or []

    next_page_url = None
    if videos:
        next_page_url = f"/?page={current_page_num + 1}"

    previous_page_url = None
    if current_page_num > 1:
        previous_page_url = f"/?page={current_page_num - 1}"

    return render_template(
        "index.html",
        videos=videos,
        current_page_num=current_page_num,
        next_page_url=next_page_url,
        previous_page_url=previous_page_url,
    )

if __name__ == "__main__":
    app.run(debug=True)