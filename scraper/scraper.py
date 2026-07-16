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
    return br, ctx, fp


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


async def extract_detail_from_dom(page: Page) -> dict:
    """Ekstraksi field detail langsung dari DOM/HTML saat ini."""
    d = {}
    # ── Meta tags OpenGraph ────────────────────────────────────────────────
    for sel, attr, key in [
        ('meta[property="og:title"]', "content", "title"),
        ('meta[property="og:price:amount"]', "content", "price"),
        ('meta[property="og:description"]', "content", "og_description"),
    ]:
        try:
            el = await page.query_selector(sel)
            if el:
                v = (await el.get_attribute(attr) or "").strip()
                if v: d[key] = v
        except: pass

    # ── Title fallback dari H1 ─────────────────────────────────────────────
    if not d.get("title"):
        for sel in ("h1 span", "h1"):
            try:
                el = await page.query_selector(sel)
                if el:
                    v = (await el.text_content() or "").strip()
                    if v and not _price(v) and len(v) > 2: d["title"] = v; break
            except: pass

    # ── Ambil full body text untuk parsing berbagai field ──────────────────
    try:
        full = await page.evaluate("() => document.body.innerText")
    except:
        full = ""
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

    if not d.get("condition"):
        for i in range(len(lines) - 1):
            key_line = lines[i]; val_line = lines[i+1]
            if len(key_line) < 10 and len(val_line) < 25 and len(val_line) > 3:
                if any(x in val_line for x in ("-", "–", "—")) and all(len(p.strip()) < 15 for p in re.split(r'[-–—]', val_line)) \
                        and not re.search(r'[🔥🎉🎊⭐💥✅📱😍]', val_line):
                    d["condition"] = val_line; break

    # ── Posted time ──────────────────────────────────────────────────────
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

    # ── Delivery ──────────────────────────────────────────────────────────
    DELIVERY_KEYWORDS = ['dikirim dari', 'pengiriman', 'delivery', 'ongkir', 'cod', 'antar']
    for line in lines:
        if any(kw in line.lower() for kw in DELIVERY_KEYWORDS) and len(line) < 80:
            d["delivery"] = line.strip(); break

    # ── Seller dari link profile ───────────────────────────────────────────
    try:
        profile_links = await page.query_selector_all('a[href*="/marketplace/profile/"]')
        found_first = False
        for link in profile_links:
            name = (await link.text_content() or "").strip()
            if name and len(name) > 3 and len(name) < 60 and "/" not in name:
                if not found_first: found_first = True; continue
                d["seller"] = name
                d["seller_url"] = await link.get_attribute("href") or ""; break
    except: pass

    # Fallback seller dari body text
    if not d.get("seller"):
        for i in range(len(lines) - 1):
            if lines[i].lower() in ("detail penjual", "seller details"):
                d["seller"] = lines[i+1].strip()
                break

    return d


async def scrape_detail(page: Page, url: str) -> dict:
    """Scrape halaman detail listing untuk mendapatkan data lengkap.
    Strategi 3-tier:
      Tier 0: Intercept GraphQL response dari Facebook API (tercepat, paling andal)
      Tier 1: Early DOM extraction setelah domcontentloaded
      Tier 2: Scroll fallback + re-extract
    """
    d = {}
    captured_desc = ""

    # ── Tier 0: GraphQL Response Interception ──────────────────────────────
    # Facebook memuat data produk via GraphQL API. Kita tangkap response-nya
    # langsung saat browser melakukan fetch, tanpa perlu parsing DOM.
    async def capture_graphql(response):
        nonlocal captured_desc
        try:
            resp_url = response.url
            if "graphql" not in resp_url and "api/graphql" not in resp_url:
                return
            if response.status != 200:
                return
            ct = response.headers.get("content-type", "")
            if "json" not in ct and "text" not in ct:
                return
            body = await response.text()
            if not body or len(body) < 200:
                return
            # Cari deskripsi di dalam response body
            desc_patterns = [
                r'"redacted_description"\s*:\s*\{[^}]*"text"\s*:\s*"([^"]{10,})"',
                r'"description"\s*:\s*\{[^}]*"text"\s*:\s*"([^"]{10,})"',
                r'"body"\s*:\s*\{[^}]*"text"\s*:\s*"([^"]{10,})"',
                r'"marketplace_listing_renderable_target"\s*:\s*\{[^}]*"redacted_description"\s*:\s*\{[^}]*"text"\s*:\s*"([^"]{10,})"',
            ]
            for pat in desc_patterns:
                m = re.search(pat, body)
                if m and not captured_desc:
                    raw = m.group(1)
                    # Decode unicode escapes (Facebook sering encode \n, \u00xx, dll)
                    try:
                        raw = raw.encode().decode('unicode_escape')
                    except:
                        pass
                    captured_desc = raw.strip()
                    break
        except:
            pass

    try:
        # Intercept resources + GraphQL capture
        async def block_resources(route):
            if route.request.resource_type in ("image", "font", "media"):
                await route.abort()
            else:
                await route.continue_()
        await page.route("**/*", block_resources)
        page.on("response", capture_graphql)

        # Load halaman
        await page.goto(url, wait_until="domcontentloaded", timeout=45000)

        # Tunggu: beri waktu GraphQL response masuk + DOM hydrate
        try:
            await page.wait_for_selector(
                '[data-testid="marketplace_pdp_description"]', timeout=5000)
        except:
            # Bahkan kalau selector timeout, GraphQL mungkin sudah tertangkap
            await asyncio.sleep(1.5)

        # ── Tier 1: Early DOM extraction ──────────────────────────────────
        d = await extract_detail_from_dom(page)

        # Gunakan GraphQL captured desc jika DOM tidak punya
        if captured_desc and (not d.get("description") or len(captured_desc) > len(d.get("description", ""))):
            d["description"] = captured_desc

        if d.get("description") and len(d["description"]) > 20:
            return d

        # ── Tier 2: Scroll fallback (lebih agresif) ───────────────────────
        await dismiss(page)
        for _ in range(4):
            await page.evaluate(f"window.scrollBy(0, {random.randint(300, 600)})")
            await asyncio.sleep(random.uniform(0.4, 0.8))

        # Tunggu sebentar agar lazy-loaded content muncul
        await asyncio.sleep(1.5)

        # Klik area konten untuk memicu rendering yang mungkin tertunda
        try:
            await page.mouse.click(400, 350)
            await asyncio.sleep(0.5)
        except:
            pass

        # Ekstraksi ulang
        d2 = await extract_detail_from_dom(page)
        d.update({k: v for k, v in d2.items() if v})

        # Cek ulang GraphQL capture (mungkin baru masuk setelah scroll)
        if captured_desc and (not d.get("description") or len(captured_desc) > len(d.get("description", ""))):
            d["description"] = captured_desc

    except Exception as e:
        pass
    finally:
        try:
            page.remove_listener("response", capture_graphql)
        except:
            pass
    return d


async def detail_worker(queue: asyncio.Queue, ctx, cfg):
    """Worker background untuk memproses detail scraping tanpa memblokir loop utama.
    Selalu emit hasilnya — baik dengan atau tanpa deskripsi — agar pipeline
    tetap bisa memproses field lainnya (seller, condition, dll).
    """
    while True:
        l = await queue.get()
        try:
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
            except Exception as e:
                pass
            finally:
                await p2.close()

            # Selalu emit — pipeline tetap bisa analisis title, price, dll
            if cfg.api_mode:
                print(json.dumps(l.to_dict(), ensure_ascii=False), flush=True)
            else:
                has_desc = bool(l.description)
                tag = "[DETAIL]" if has_desc else "[DETAIL-NO-DESC]"
                t = l.title[:45] if l.title else "-"
                print(f"{tag} {t:45s} {l.price:15s} {l.location}")
        except Exception as e:
            pass
        finally:
            queue.task_done()


async def run(cfg=None):
    if cfg is None: cfg = ScraperConfig()
    cfg.max_detail_pages = cfg.max_listings
    
    seen_urls = set()
    detail_queue = asyncio.Queue()
    workers = []
    queued_count = 0

    async with async_playwright() as p:
        br, ctx, fp = await mkctx(p, cfg)
        try:
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
                return

            await dismiss(page)
            await human_mouse(page, random.randint(200, 600), random.randint(100, 400))
            try: await page.wait_for_selector(CARD_LINK, timeout=20000)
            except: pass

            # Jalankan worker detail di latar belakang
            if cfg.scrape_details:
                for _ in range(2):
                    task = asyncio.create_task(detail_worker(detail_queue, ctx, cfg))
                    workers.append(task)

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

                    # Emit listing instan (baik mode detail maupun non-detail)
                    if new_listings:
                        for l in new_listings:
                            if cfg.api_mode:
                                print(json.dumps(l.to_dict(), ensure_ascii=False), flush=True)
                            else:
                                t = l.title[:45] if l.title else "-"
                                print(f"[NEW] {t:45s} {l.price:15s} {l.location}")

                    # Masukkan ke antrean detail di latar belakang
                    if cfg.scrape_details and new_listings and queued_count < cfg.max_detail_pages:
                        slots = cfg.max_detail_pages - queued_count
                        to_queue = new_listings[:min(len(new_listings), slots)]
                        for l in to_queue:
                            await detail_queue.put(l)
                            queued_count += 1

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
        finally:
            if cfg.scrape_details:
                if not cfg.api_mode and detail_queue.qsize() > 0:
                    print(f"Menunggu {detail_queue.qsize()} tugas detail scraping di latar belakang selesai...")
                await detail_queue.join()
                for task in workers:
                    task.cancel()
                await asyncio.gather(*workers, return_exceptions=True)
            try: await ctx.close()
            except: pass
            try: await br.close()
            except: pass


if __name__ == "__main__":
    import sys
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except AttributeError:
        pass
    cookies_path = None
    min_price = 0
    max_price = 0
    for a in sys.argv:
        if a.startswith("--cookies="): cookies_path = a.split("=", 1)[1]
        if a.startswith("--minPrice="): 
            try: min_price = int(a.split("=", 1)[1])
            except: pass
        if a.startswith("--maxPrice="): 
            try: max_price = int(a.split("=", 1)[1])
            except: pass
    cfg = ScraperConfig(
        location=sys.argv[1] if len(sys.argv) > 1 else "",
        search_query=sys.argv[2] if len(sys.argv) > 2 else "",
        max_listings=int(sys.argv[3]) if len(sys.argv) > 3 else 50,
        min_price=min_price,
        max_price=max_price,
        headless="--headless" in sys.argv,
        scrape_details="--details" in sys.argv,
        api_mode="--api" in sys.argv,
        cookies_file=Path(cookies_path) if cookies_path else Path("cookies.json"),
    )
    asyncio.run(run(cfg))
