import asyncio, json, random, re
from datetime import datetime
from pathlib import Path
from playwright.async_api import async_playwright, Page, BrowserContext
from playwright_stealth import Stealth
from browserforge.fingerprints import FingerprintGenerator
from config import ScraperConfig
from models import Listing, DataStore

CARD_LINK = 'a[href*="/marketplace/item/"]'
PRICE_RX = re.compile(r'(?:IDR|Rp|[$€£¥₩])\s*[0-9]')
_fp_gen = FingerprintGenerator(slim=True)

_cached_city_id = None


async def detect_city_id(page: Page) -> str:
    global _cached_city_id
    if _cached_city_id: return _cached_city_id
    try:
        await page.goto("https://www.facebook.com/marketplace", wait_until="load", timeout=45000)
        await asyncio.sleep(2)
        html = await page.content()
        ids = re.findall(r'"buy_location".*?"id":"(\d+)"', html)
        if ids: _cached_city_id = ids[0]; return ids[0]
    except: pass
    return ""


def _price(t): return bool(PRICE_RX.search(t))


def _has_number(t): return bool(re.search(r'[0-9]', t))


def parse_card(txt: list, aria: str = "") -> dict:
    r = {"title": "", "price": "", "location": "", "posted": ""}
    if not txt: return r
    r["location"] = txt[-1].strip()
    for t in txt:
        if _price(t.strip()): r["price"] = t.strip()
    for t in txt:
        t = t.strip()
        if t and t != r["price"] and t != r["location"]:
            if not r["title"] and not _price(t) and len(t) > 2: r["title"] = t
    pass  # posted extracted from detail page or card text
    if aria and (not r["title"] or len(r["title"]) < 5 or (r["title"].istitle() and len(r["title"]) < 15 and not _has_number(r["title"]))):
        parts = [p.strip() for p in aria.replace("+"," ").split(",") if p.strip() and not _price(p.strip())]
        parts = [p for p in parts if not re.match(r'^[0-9.\s]+$', p.strip()) and len(p.strip()) > 2]
        if parts and parts[0] != r["location"]: r["title"] = parts[0]
    return r


def load_cookies(fp: Path) -> list:
    if not fp.exists(): return []
    raw = json.loads(fp.read_text())
    out = []
    for c in raw:
        pw = {"name": c["name"], "value": c["value"], "domain": c["domain"],
              "path": c.get("path", "/"), "secure": c.get("secure", False),
              "httpOnly": c.get("httpOnly", False)}
        ss = c.get("sameSite")
        if ss:
            ss = "".join(p.capitalize() for p in ss.split("_"))
            pw["sameSite"] = ss if ss in ("Lax", "Strict", "None") else "None"
        if c.get("expirationDate"): pw["expires"] = int(float(c["expirationDate"]))
        out.append(pw)
    return out


def _bezier(t, p0, p1, p2, p3):
    u = 1 - t; return u**3*p0 + 3*u**2*t*p1 + 3*u*t**2*p2 + t**3*p3


async def human_mouse(page: Page, tx, ty):
    sx, sy = random.randint(100, 600), random.randint(60, 400)
    cp1x, cp1y = sx + random.randint(-200, 200), sy + random.randint(-100, 100)
    cp2x, cp2y = tx + random.randint(-150, 150), ty + random.randint(-100, 100)
    for i in range(random.randint(15, 30) + 1):
        t_val = i / random.randint(15, 30)
        await page.mouse.move(_bezier(t_val, sx, cp1x, cp2x, tx), _bezier(t_val, sy, cp1y, cp2y, ty))
        await asyncio.sleep(random.uniform(0.003, 0.012))


async def S(a=1.0, b=4.0): await asyncio.sleep(random.uniform(a, b))


async def close_chat(page: Page):
    try:
        for b in await page.query_selector_all('[aria-label="Tutup chat"], [aria-label="Close chat"]'):
            if await b.is_visible(): await b.click(); await asyncio.sleep(0.3); return True
    except: pass
    return False


async def human_scroll(page: Page):
    await page.evaluate(f"window.scrollBy({{top: {random.randint(400, 800)}, behavior: 'smooth'}})")
    await asyncio.sleep(random.uniform(0.8, 1.5))
    await close_chat(page)


async def dismiss(page: Page):
    for _ in range(2):
        try: await page.keyboard.press("Escape"); await asyncio.sleep(0.3)
        except: pass
    try: await page.mouse.click(150, 150); await asyncio.sleep(0.3)
    except: pass
    for sel in ('[aria-label="Close"]', 'text="Not Now"', '[aria-label="Tutup"]'):
        try:
            el = page.locator(sel).first
            if await el.is_visible(timeout=2000):
                box = await el.bounding_box()
                if box and box["y"] < 500: await el.click(); await asyncio.sleep(0.3)
        except: pass
    try:
        a = page.locator('text=Allow all cookies').first
        if await a.is_visible(timeout=2000): await a.click()
    except: pass
    await close_chat(page)


async def init_stealth(page: Page, fp):
    try: s = Stealth(webgl_vendor_override=fp.navigator.vendor); await s.apply_stealth_async(page)
    except: pass
    await page.add_init_script("""
        Object.defineProperty(navigator,'webdriver',{get:()=>undefined});
        Object.defineProperty(navigator,'plugins',{get:()=>[1,2,3,4,5]});
        window.chrome={runtime:{},loadTimes:function(){},csi:function(){}};
        const _q=navigator.permissions.query;
        navigator.permissions.query=p=>p.name==='notifications'?
            Promise.resolve({state:Notification.permission}):_q(p);
    """)


async def mkctx(p, cfg):
    while True:
        fp = _fp_gen.generate(); ua = fp.navigator.userAgent
        if 'Mobile' not in ua and 'iPhone' not in ua and 'Android' not in ua:
            fp.screen.width = max(fp.screen.width, 1280); fp.screen.height = max(fp.screen.height, 720)
            break
    br = await p.chromium.launch(headless=cfg.headless, args=[
        "--disable-blink-features=AutomationControlled", "--no-sandbox", "--disable-dev-shm-usage",
        "--disable-infobars", f"--window-size={fp.screen.width},{fp.screen.height}"])
    ctx = await br.new_context(user_agent=ua, viewport={"width": fp.screen.width, "height": fp.screen.height},
                                locale="id-ID", timezone_id="Asia/Jakarta",
                                device_scale_factor=fp.screen.devicePixelRatio)
    cks = load_cookies(cfg.cookies_file)
    if cks: await ctx.add_cookies(cks)
    return ctx, fp


async def scroll_load(page: Page, cfg):
    n = 0; prev = 0; stall = 0
    for i in range(cfg.max_scrolls):
        await human_scroll(page); n += 1
        cur = len(await page.query_selector_all(CARD_LINK))
        if cur == prev: stall += 1
        else: stall = 0
        prev = cur
        if stall >= 3 or cur >= cfg.max_listings * 2: break


async def extract_cards(page: Page):
    return await page.evaluate("""
        () => {
            const r=[], s=new Set();
            document.querySelectorAll('a[href*="/marketplace/item/"]').forEach(a => {
                const h=a.getAttribute('href'); if(!h||s.has(h))return; s.add(h);
                const aria=(a.getAttribute('aria-label')||'').trim();
                const img=a.querySelector('img');
                r.push({aria, txt: a.innerText.split('\\n').map(t=>t.trim()).filter(Boolean),
                    url:h.startsWith('http')?h:'https://www.facebook.com'+h, image_url:img?img.src:''});
            });
            return r;
        }
    """)


async def scrape_detail(page: Page, url: str) -> dict:
    """Scrape halaman detail listing untuk mendapatkan data lengkap.
    Extended dari versi original untuk mengambil: description, posted, delivery.
    """
    d = {}
    try:
        await page.goto(url, wait_until="load", timeout=45000)
        await S(2, 3); await dismiss(page)
        # Scroll agresif untuk trigger semua lazy-loaded content
        for _ in range(5):
            await page.evaluate(f"window.scrollBy(0, {random.randint(300,700)})")
            await asyncio.sleep(random.uniform(0.5, 1.0))
        try: await page.mouse.click(500, 400); await asyncio.sleep(0.5)
        except: pass
        await asyncio.sleep(2)

        # ── Meta tags OpenGraph ────────────────────────────────────────────────
        for sel, attr, key in [
            ('meta[property="og:title"]', "content", "title"),
            ('meta[property="og:price:amount"]', "content", "price"),
            ('meta[property="og:description"]', "content", "og_description"),
        ]:
            el = await page.query_selector(sel)
            if el:
                v = (await el.get_attribute(attr) or "").strip()
                if v: d[key] = v

        # ── Title fallback dari H1 ─────────────────────────────────────────────
        if not d.get("title"):
            for sel in ("h1 span", "h1"):
                el = await page.query_selector(sel)
                if el:
                    v = (await el.text_content() or "").strip()
                    if v and not _price(v) and len(v) > 2: d["title"] = v; break

        # ── Ambil full body text untuk parsing berbagai field ──────────────────
        full = await page.evaluate("() => document.body.innerText")
        lines = [l.strip() for l in full.splitlines() if l.strip()]

        # ── Description ────────────────────────────────────────────────────────
        # Strategi 1: Cari section description via selector
        for desc_sel in [
            '[data-testid="marketplace_pdp_description"]',
            '[data-testid="marketplace_pdp_description"] span',
            '[data-testid="marketplace-pdp-description"]',
            '[class*="description"]',
        ]:
            try:
                el = await page.query_selector(desc_sel)
                if el:
                    v = (await el.text_content() or "").strip()
                    if v and len(v) > 20:
                        d["description"] = v; break
            except: pass

        # Strategi 2: Gunakan og:description jika lebih panjang dari title
        if not d.get("description") and d.get("og_description"):
            og_desc = d.pop("og_description", "")
            parts = og_desc.split(" · ")
            if len(parts) >= 3:
                d["description"] = " · ".join(parts[2:])
            elif len(og_desc) > len(d.get("title", "")) + 15:
                d["description"] = og_desc
        elif "og_description" in d:
            d.pop("og_description", None)

        # Strategi 3: Heuristik dari body text — cari blok setelah header "Detail"
        if not d.get("description") and lines:
            detail_idx = -1
            for idx, line in enumerate(lines):
                if line.lower() in ("detail", "details", "deskripsi", "description", "rincian"):
                    detail_idx = idx
                    break
            
            if detail_idx != -1:
                end_idx = -1
                LOCATION_LANDMARKS = ("perkiraan lokasi", "location is approximate", "informasi penjual",
                                      "kirim pesan", "seller information", "send seller", "detail penjual",
                                      "lindungi pembelian", "peta lokasi", "map location", "seller details")
                for idx in range(detail_idx + 1, len(lines)):
                    if any(x in lines[idx].lower() for x in LOCATION_LANDMARKS):
                        end_idx = idx; break
                if end_idx == -1:
                    end_idx = min(detail_idx + 40, len(lines))
                
                # Kumpul baris deskripsi, skip label dan nilai kondisi/merek
                SKIP_LABELS = ("kondisi", "condition", "merek", "brand", "bahan", "material",
                               "ukuran", "size", "warna", "color", "nama perangkat", "device name")
                SKIP_VALUES = ("bekas", "baru", "used", "new", "like new", "good", "seperti baru",
                               "cukup baik", "baik", "rusak")
                desc_lines = []
                skip_next = False
                for idx in range(detail_idx + 1, end_idx):
                    line = lines[idx]
                    if skip_next:
                        skip_next = False; continue
                    if line.lower() in SKIP_LABELS:
                        skip_next = True; continue
                    if any(line.lower().startswith(x + ":") for x in SKIP_LABELS): continue
                    if any(x in line.lower() for x in (" - ", " – ", " — ")) and any(x in line.lower() for x in SKIP_VALUES): continue
                    if line.strip().lower() in ("detail", "details", "kondisi", "condition", "rincian"): continue
                    desc_lines.append(line)
                
                if desc_lines:
                    desc_text = "\n".join(desc_lines).strip()
                    if len(desc_text) > 10:
                        d["description"] = desc_text

        # Strategi 4: Cari teks setelah nilai kondisi hingga landmark lokasi
        # Dipakai saat halaman tidak memiliki header "Detail" tersendiri.
        if not d.get("description") and lines:
            LOCATION_LANDMARKS = ("perkiraan lokasi", "location is approximate", "informasi penjual",
                                  "kirim pesan", "seller information", "detail penjual", "seller details")
            CONDITION_PATTERNS = re.compile(
                r'^(?:bekas|baru|used|new|like new|good|baik|cukup baik|rusak|seperti baru)'
                r'(?:\s*[-–—]\s*\w+)?$', re.IGNORECASE
            )
            cond_val_idx = -1
            for idx, line in enumerate(lines):
                if CONDITION_PATTERNS.match(line.strip()):
                    cond_val_idx = idx; break
            
            if cond_val_idx != -1:
                end_idx = len(lines)
                for idx in range(cond_val_idx + 1, len(lines)):
                    if any(x in lines[idx].lower() for x in LOCATION_LANDMARKS):
                        end_idx = idx; break
                
                # Batasi pencarian tidak terlalu jauh (max 30 baris setelah kondisi)
                end_idx = min(end_idx, cond_val_idx + 30)
                desc_lines = [l for l in lines[cond_val_idx + 1:end_idx]
                              if len(l) > 3 and not _price(l)
                              and not re.match(r'^(Kirim|Bagikan|Laporkan|Simpan|Beli|Tanya|Like|Follow)', l)
                              and 'facebook.com' not in l.lower()]
                if desc_lines:
                    desc_text = "\n".join(desc_lines).strip()
                    if len(desc_text) > 10:
                        d["description"] = desc_text

        # ── Condition ──────────────────────────────────────────────────────────
        for i in range(len(lines) - 1):
            if lines[i].lower() in ("kondisi", "condition"):
                d["condition"] = lines[i+1].strip()
                break
        
        if not d.get("condition"):
            for line in lines:
                if line.lower().startswith("kondisi:") or line.lower().startswith("condition:"):
                    d["condition"] = line.split(":", 1)[1].strip()
                    break

        # Fallback lama untuk kondisi jika cara di atas gagal
        if not d.get("condition"):
            for i in range(len(lines) - 1):
                key_line = lines[i]; val_line = lines[i+1]
                if len(key_line) < 10 and len(val_line) < 25 and len(val_line) > 3:
                    if any(x in val_line for x in ("-", "–", "—")) and all(len(p.strip()) < 15 for p in re.split(r'[-–—]', val_line)) \
                            and not re.search(r'[🔥🎉🎊⭐💥✅📱😍]', val_line):
                        d["condition"] = val_line; break

        # ── Posted time: cari teks waktu relatif ──────────────────────────────
        TIME_PATTERNS = [
            r'\d+\s+(?:menit|jam|hari|minggu|bulan|tahun)\s+(?:yang\s+lalu|lalu)',
            r'(?:Kemarin|Hari\s+ini)(?:\s+pukul\s+[\d:]+)?',
            r'\d+\s+(?:minute|hour|day|week|month|year)s?\s+ago',
            r'(?:Yesterday|Today)(?:\s+at\s+[\d:]+\s*(?:AM|PM)?)?',
        ]
        for line in lines:
            for pat in TIME_PATTERNS:
                if re.search(pat, line, re.IGNORECASE):
                    d["posted"] = line.strip(); break
            if d.get("posted"): break

        # ── Delivery: cari info pengiriman ────────────────────────────────────
        DELIVERY_KEYWORDS = ['dikirim dari', 'pengiriman', 'delivery', 'ongkir', 'cod', 'antar']
        for line in lines:
            if any(kw in line.lower() for kw in DELIVERY_KEYWORDS) and len(line) < 80:
                d["delivery"] = line.strip(); break

        # ── Seller dari link profile ───────────────────────────────────────────
        profile_links = await page.query_selector_all('a[href*="/marketplace/profile/"]')
        found_first = False
        for link in profile_links:
            name = (await link.text_content() or "").strip()
            if name and len(name) > 3 and len(name) < 60 and "/" not in name:
                if not found_first: found_first = True; continue
                d["seller"] = name
                d["seller_url"] = await link.get_attribute("href") or ""; break

        # Fallback seller dari body text
        if not d.get("seller"):
            for i in range(len(lines) - 1):
                if lines[i].lower() in ("detail penjual", "seller details"):
                    d["seller"] = lines[i+1].strip()
                    break

    except Exception as e:
        pass  # Error ter-suppress — jangan crash pipeline karena 1 listing
    return d


async def run(cfg=None):
    if cfg is None: cfg = ScraperConfig()
    cfg.max_detail_pages = cfg.max_listings
    
    seen_urls = set()

    async with async_playwright() as p:
        ctx, fp = await mkctx(p, cfg)
        page = await ctx.new_page()
        await init_stealth(page, fp)

        if not cfg.location:
            city_id = await detect_city_id(page)
            if city_id: cfg.location = city_id

        for attempt in range(cfg.max_retries):
            try:
                url = cfg.marketplace_url
                await page.goto(url, wait_until="domcontentloaded", timeout=45000)
                await S(3, 5); break
            except Exception as e:
                await asyncio.sleep(2**attempt*3)
        else:
            await ctx.close(); return

        await dismiss(page)
        await human_mouse(page, random.randint(200, 600), random.randint(100, 400))
        try: await page.wait_for_selector(CARD_LINK, timeout=20000)
        except: pass

        prev_len = 0
        stall = 0

        while True:
            try:
                await human_scroll(page)
                await asyncio.sleep(random.uniform(0.5, 1.2))
                
                raw = await extract_cards(page)
                cur_len = len(raw)
                if cur_len == prev_len: stall += 1
                else: stall = 0
                prev_len = cur_len

                new_listings = []
                for item in raw:
                    url = item["url"].split("?ref=")[0]
                    if url in seen_urls: continue
                    
                    info = parse_card(item.get("txt", []), item.get("aria", ""))
                    price = info["price"]
                    if price and len(price) > 50:
                        title_part = re.split(r'\s*(?:Rp|IDR|[$€£¥])\s*[0-9]', price)[0].strip()
                        if title_part and not info["title"]:
                            info["title"] = title_part
                        m = re.search(r'(?:Rp|IDR|[$€£¥])\s*[0-9][0-9.,]*\s*$', price)
                        if m: price = m.group().strip()
                    if price and len(price) < 40:
                        parts = re.split(r'(?<=[0-9])(?=[R][p])|(?<=[0-9])(?=[$€£¥])', price)
                        price = parts[0].strip()
                    
                    l = Listing(title=info["title"], price=price, location=info["location"],
                                posted=info.get("posted",""), url=url, image_url=item["image_url"])
                    if l.title: l.title = l.title.replace("+", " ").replace("  ", " ").strip()
                    
                    if l.title or l.price:
                        seen_urls.add(url)
                        new_listings.append(l)

                # Jika tidak ada detail scraping, emit langsung (non-details mode)
                if not cfg.scrape_details:
                    for l in new_listings:
                        if cfg.api_mode:
                            print(json.dumps(l.to_dict(), ensure_ascii=False), flush=True)
                        else:
                            t = l.title[:45] if l.title else "-"
                            print(f"[NEW] {t:45s} {l.price:15s} {l.location}")

                # Detail pages: scrape dulu, baru emit
                # Listing hanya di-emit setelah detail page selesai dikunjungi
                # agar description tersedia untuk deteksi barter/TT yang akurat.
                if cfg.scrape_details and new_listings:
                    to_detail = new_listings[:min(len(new_listings), cfg.max_detail_pages)]
                    sem = asyncio.Semaphore(3)
                    async def _detail(l):
                        async with sem:
                            p2 = await ctx.new_page()
                            try:
                                d = await scrape_detail(p2, l.url)
                                if d.get("title") and len(d.get("title","")) > len(l.title or ""): l.title = d["title"]
                                if d.get("price") and len(d.get("price","")) > len(l.price or ""): l.price = d["price"]
                                if d.get("location") and l.location != d["location"]: l.location = d["location"]
                                if d.get("seller"): l.seller = d["seller"]
                                if d.get("seller_url"): l.seller_url = d["seller_url"]
                                if d.get("posted"): l.posted = d["posted"]
                                if d.get("condition"): l.condition = d["condition"]
                                if d.get("description"): l.description = d["description"]
                                if d.get("delivery"): l.delivery = d["delivery"]
                            except: pass
                            finally: await p2.close()
                            # Hanya emit jika deskripsi berhasil diambil.
                            # Listing tanpa deskripsi tidak ditampilkan di UI
                            # agar filter barter/TT bisa bekerja dengan akurat.
                            if l.description:
                                if cfg.api_mode:
                                    print(json.dumps(l.to_dict(), ensure_ascii=False), flush=True)
                                else:
                                    t = l.title[:45] if l.title else "-"
                                    print(f"[DETAIL] {t:45s} {l.price:15s} {l.location}")
                            else:
                                if not cfg.api_mode:
                                    t = l.title[:45] if l.title else "-"
                                    print(f"[SKIP-NO-DESC] {t:45s} {l.price:15s} {l.location}")
                    await asyncio.gather(*[_detail(l) for l in to_detail])

                if stall >= 4:
                    if cfg.api_mode:
                        print(json.dumps({"status": "exhausted"}, ensure_ascii=False), flush=True)
                    break
                if cur_len >= cfg.max_listings * 5:
                    if cfg.api_mode:
                        print(json.dumps({"status": "exhausted"}, ensure_ascii=False), flush=True)
                    break

            except Exception as e:
                if not cfg.api_mode:
                    print(f"Exception in scraper loop: {e}")

            pass


if __name__ == "__main__":
    import sys
    cookies_path = None
    for a in sys.argv:
        if a.startswith("--cookies="): cookies_path = a.split("=", 1)[1]
    cfg = ScraperConfig(
        location=sys.argv[1] if len(sys.argv) > 1 else "",
        search_query=sys.argv[2] if len(sys.argv) > 2 else "",
        max_listings=int(sys.argv[3]) if len(sys.argv) > 3 else 50,
        headless="--headless" in sys.argv,
        scrape_details="--details" in sys.argv,
        api_mode="--api" in sys.argv,
        cookies_file=Path(cookies_path) if cookies_path else Path("cookies.json"),
    )
    asyncio.run(run(cfg))
