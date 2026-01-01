import asyncio
import math
import os
import re
import pandas as pd
import nodriver as uc 

BASE_URL = "https://taqeem.gov.sa"
PER_PAGE = 50

def list_url(page: int) -> str:
    return (
        f"{BASE_URL}/en/authority-members/page/{page}"
        f"?sector=machinery&category=all&region=all"
        f"&search=&search_in=all&step={PER_PAGE}"
    )

def clean(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "")).strip()

def is_cloudflare(html: str) -> bool:
    h = (html or "").lower()
    return (
        "checking your browser" in h
        or "attention required" in h
        or "cloudflare" in h
        or "cf-chl" in h
    )

def extract_total_count_from_html(html: str) -> int:
    m = re.search(r"from\s+(\d+)", html, re.IGNORECASE)
    if not m:
        raise RuntimeError("Could not find total count (text like: 'from 203').")
    return int(m.group(1))

def extract_detail_urls_from_html(html: str):
    # Extract href="/en/authority-partner/2129000"
    rels = re.findall(r'href="(/en/authority-partner/\d+)"', html)
    # make absolute + dedupe preserving order
    urls = []
    seen = set()
    for r in rels:
        u = BASE_URL + r
        if u not in seen:
            seen.add(u)
            urls.append(u)
    return urls

def parse_detail_fields_from_html(html: str):
    soup = BeautifulSoup(html, "lxml")
    data = {}

    # Name (header)
    name_el = soup.select_one(".text-l-bold")
    if name_el:
        data["Name"] = clean(name_el.get_text(" ", strip=True))
    else:
        data["Name"] = ""

    # Main details container (your big block)
    container = soup.select_one("div.row.border.rounded.p-3")
    scope = container if container else soup

    # label/value pairs inside d-flex rows
    for row in scope.select("div.d-flex"):
        divs = row.find_all("div", recursive=False)
        if len(divs) >= 2:
            label = clean(divs[0].get_text(" ", strip=True)).rstrip(":")
            value = clean(divs[1].get_text(" ", strip=True))
            if label:
                # merge duplicates
                if label not in data or not data[label]:
                    data[label] = value
                elif value and data[label] != value:
                    data[label] = f"{data[label]} | {value}"

    # badges like "Has fellowship certificate"
    badges = [clean(b.get_text(" ", strip=True)) for b in scope.select(".ot-rec-muted")]
    badges = [b for b in badges if b]
    if badges:
        data["Diploma & licences"] = " | ".join(badges)

    return data

async def safe_get_content(tab, retries=5):
    last = ""
    for _ in range(retries):
        try:
            html = await tab.get_content()
            last = html or ""
            # if CF, wait and retry
            if is_cloudflare(last):
                await asyncio.sleep(3)
                continue
            return last
        except Exception:
            await asyncio.sleep(1.5)
    return last

async def try_click_show_more(tab):
    """
    Best-effort expand details without relying on unstable element handles.
    We try executing JS to click buttons/links containing 'Show more' / 'عرض المزيد'.
    If nodriver version doesn’t support evaluate, it will just skip.
    """
    js = r"""
    (() => {
      const texts = ["Show more", "عرض المزيد"];
      const candidates = Array.from(document.querySelectorAll("button, a"));
      let clicked = 0;
      for (const el of candidates) {
        const t = (el.innerText || "").trim();
        if (texts.some(x => t.includes(x))) {
          el.click();
          clicked++;
        }
      }
      return clicked;
    })();
    """
    for _ in range(3):
        try:
            # nodriver versions vary: evaluate() or eval()
            if hasattr(tab, "evaluate"):
                await tab.evaluate(js)
            elif hasattr(tab, "eval"):
                await tab.eval(js)
            else:
                break
            await asyncio.sleep(0.8)
        except Exception:
            break

async def main():
    profile_dir = os.path.abspath("./taqeem_profile")
    os.makedirs(profile_dir, exist_ok=True)

    browser = await uc.start(
        headless=False,
        user_data_dir=profile_dir,
        browser_args=[
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-dev-shm-usage",
        ],
    )

    try:
        tab = await browser.get(list_url(1))
        await asyncio.sleep(2)

        html1 = await safe_get_content(tab)
        if is_cloudflare(html1):
            print("⚠️ Cloudflare page detected on page 1. Please wait in the opened browser until it finishes, then rerun.")
            return

        total = extract_total_count_from_html(html1)
        pages = math.ceil(total / PER_PAGE)
        print(f"✅ Total members: {total}")
        print(f"📄 Pages: {pages}")

        results = []

        for p in range(1, pages + 1):
            print(f"\n🔹 Listing page {p}/{pages}")
            await tab.get(list_url(p))
            await asyncio.sleep(2)

            html = await safe_get_content(tab)
            if is_cloudflare(html):
                print("   ⚠️ Cloudflare detected on listing page, skipping page.")
                continue

            detail_urls = extract_detail_urls_from_html(html)
            print(f"   Found {len(detail_urls)} members")

            for i, url in enumerate(detail_urls, start=1):
                print(f"     [{i}/{len(detail_urls)}] {url}")
                try:
                    dtab = await browser.get(url)
                    await asyncio.sleep(2)

                    # expand (best-effort)
                    await try_click_show_more(dtab)
                    await asyncio.sleep(1)

                    dhtml = await safe_get_content(dtab)
                    if is_cloudflare(dhtml):
                        print("       ⚠️ Cloudflare on detail page (skipped)")
                        continue

                    row = parse_detail_fields_from_html(dhtml)
                    row["Details URL"] = url
                    row["List Page"] = p

                    # only append if has something
                    if row.get("Name") or len(row.keys()) > 3:
                        results.append(row)

                except Exception as e:
                    print(f"       ❌ Error: {e}")

                await asyncio.sleep(1.0)

        df = pd.DataFrame(results)
        df.to_excel("taqeem_members.xlsx", index=False)
        print("\n✅ Saved: taqeem_members.xlsx")

    finally:
        # nodriver: stop() is the reliable method
        try:
            await browser.stop()
        except:
            pass

if __name__ == "__main__":
    asyncio.run(main())
