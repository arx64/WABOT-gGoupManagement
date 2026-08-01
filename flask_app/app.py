from flask import Flask, render_template, request
from scraper_logic import scrape_single_page, BASE_URL

app = Flask(__name__)

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