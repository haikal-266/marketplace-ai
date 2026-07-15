# Facebook Marketplace Scraper

Stealth browser scraper — auto city detection, parallel detail pages, API JSON output. Zero hardcoded language words.

## Features

- **Zero hardcode** — all parsing via pattern matching, no language-specific words
- **Auto city ID** — detects location from Facebook cookies
- **Parallel detail pages** — 3 concurrent tabs scrape seller, condition, description
- **API mode** — clean JSON output, pipeable to `jq` or file
- **Stealth** — playwright-stealth + browserforge random fingerprints + Bezier mouse
- **Custom cookies** — switch accounts with `--cookies=path.json`
- **Search** — keyword search across any Marketplace category

## Install

```bash
git clone https://github.com/hyuwowo/fb-marketplace-scraper.git
cd fb-marketplace-scraper
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
playwright install chromium
```

## Get Cookies

### Method 1: EditThisCookie (recommended)

1. Install [EditThisCookie](https://chromewebstore.google.com/detail/editthiscookie/fngmhnnpilhplaeedifhccceomclgfbg) Chrome extension
2. Login to Facebook
3. Go to `facebook.com/marketplace`
4. Click the extension icon → Export (JSON)
5. Save as `cookies.json` in project folder

### Method 2: Chrome DevTools

1. Login to Facebook → F12 → Application → Cookies → `facebook.com`
2. Copy these cookie values: `c_user`, `xs`, `datr`, `fr`, `sb`
3. Create `cookies.json`:
```json
[
  {"name":"c_user","value":"YOUR_ID","domain":".facebook.com"},
  {"name":"xs","value":"YOUR_TOKEN","domain":".facebook.com"},
  {"name":"datr","value":"YOUR_DATR","domain":".facebook.com"},
  {"name":"fr","value":"YOUR_FR","domain":".facebook.com"},
  {"name":"sb","value":"YOUR_SB","domain":".facebook.com"}
]
```

## Usage

```bash
# Auto city from cookies, search "hp"
python scraper.py "" "hp" 30

# Custom city ID + search
python scraper.py "104092119625829" "iphone" 20

# Headless + detail pages + API JSON
python scraper.py "" "laptop" 10 --headless --details --api | jq

# Custom cookies file
python scraper.py "" "samsung" 20 --headless --api --cookies=akun2.json

# Table mode (saved to CSV + printed)
python scraper.py "" "motor" 30 --headless --details
```

## Arguments

```
python scraper.py <city> <query> <count> [flags]
```

| Arg | Default | Description |
|-----|---------|-------------|
| `city` | `""` (auto) | City slug or city ID, or empty for auto-detect |
| `query` | `""` (all) | Search keyword |
| `count` | `50` | Max listings to scrape |

## Flags

| Flag | Description |
|------|-------------|
| `--headless` | Run browser in background |
| `--details` | Visit detail pages for seller, condition, delivery |
| `--api` | Pure JSON output (pipeable) |
| `--cookies=PATH` | Custom cookies JSON file |

## Output Fields

| Field | Source | Notes |
|-------|--------|-------|
| `title` | Card + aria-label | Product name |
| `price` | Card | Currency-aware detection |
| `location` | Card | City/region |
| `url` | Card | Clean listing URL |
| `image_url` | Card | Thumbnail image |
| `seller` | Detail page | Seller name (--details) |
| `condition` | Detail page | e.g. "Bekas - Baik" (--details) |
| `posted` | Detail page | Posted time (--details) |
| `description` | Detail page | Full text (--details) |
| `delivery` | Detail page | Delivery method (--details) |
| `scraped_at` | System | ISO timestamp |

## Tests

```bash
pytest test_scraper.py -v
# 26 tests covering: price detection, card parsing, aria fallback,
# cookie loading, edge cases, batch real-world data
```

## Tech Stack

- **Playwright** — browser automation
- **playwright-stealth** — anti-detection fingerprint masking
- **browserforge** — unique browser fingerprints per session
- **Bezier curve mouse** — human-like movement patterns
- **asyncio.Semaphore** — parallel detail page scraping (3 tabs)

## Notes

- Max results limited by Facebook's available listings in your region
- Rate limiting built-in via random delays and human-like scrolling