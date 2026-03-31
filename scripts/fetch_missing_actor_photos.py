from __future__ import annotations

import csv
import json
import re
import ssl
import urllib.parse
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
FACES_DIR = ROOT / "Actors Faces"
MISSING_CSV = ROOT / "missing_actor_photos.csv"
USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36"
SSL_CONTEXT = ssl.create_default_context()

PRIORITY_ACTORS = [
    "Nagarjuna Akkineni",
    "Nani",
    "Varun Tej",
    "Rana Daggubati",
    "Sumanth",
    "Nikhil Siddhartha",
    "Sharwanand",
    "Gopichand",
    "Nithiin",
    "Sai Durgha Tej",
]

COPY_EQUIVALENTS = {
    "Brahmanandham": "Bramhanandham",
}


def existing_actor_names() -> set[str]:
    return {path.stem.split("__")[0] for path in FACES_DIR.iterdir() if path.is_file()}


def request_text(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, context=SSL_CONTEXT, timeout=30) as response:
        return response.read().decode("utf-8", errors="ignore")


def request_bytes(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, context=SSL_CONTEXT, timeout=60) as response:
        return response.read()


def wikipedia_image_url(name: str) -> str | None:
    for title in wikipedia_title_candidates(name):
        url = wikipedia_image_url_for_title(title)
        if url:
            return url
    return None


def wikipedia_title_candidates(name: str) -> list[str]:
    candidates = [name]
    lowered = name.lower()
    if not any(tag in lowered for tag in ["actor", "actress", "director"]):
        candidates.extend([
            f"{name} (actor)",
            f"{name} (actress)",
            f"{name} actor",
            f"{name} actress",
            f"{name} Indian actor",
            f"{name} Indian actress",
        ])
    return candidates


def wikipedia_image_url_for_title(title: str) -> str | None:
    params = {
        "action": "query",
        "format": "json",
        "prop": "pageimages",
        "piprop": "thumbnail",
        "pithumbsize": "900",
        "redirects": "1",
        "titles": title,
    }
    url = "https://en.wikipedia.org/w/api.php?" + urllib.parse.urlencode(params)
    try:
        payload = json.loads(request_text(url))
    except Exception:
        return None

    pages = payload.get("query", {}).get("pages", {})
    for page in pages.values():
        thumb = page.get("thumbnail", {})
        source = thumb.get("source")
        if source:
            return source
    return None


def bing_search_urls(name: str) -> list[str]:
    queries = [
        f"{name} actor portrait",
        f"{name} actor",
        f"{name} portrait",
        name,
    ]
    collected = []
    seen = set()
    for query_text in queries:
        query = urllib.parse.quote_plus(query_text)
        url = f"https://www.bing.com/images/search?q={query}"
        try:
            html = request_text(url)
        except Exception:
            continue

        html = html.replace("&quot;", '"')
        matches = re.findall(r'murl":"(https?://[^"]+)"', html)
        for candidate in matches:
            if candidate not in seen:
                seen.add(candidate)
                collected.append(candidate)
    return collected


def bing_image_url(name: str) -> str | None:
    matches = bing_search_urls(name)
    for candidate in matches:
        if any(ext in candidate.lower() for ext in [".jpg", ".jpeg", ".png", ".webp"]):
            return candidate
    return matches[0] if matches else None


def pick_extension(url: str, content: bytes) -> str:
    lower = url.lower()
    if ".png" in lower[: lower.find("?") if "?" in lower else None]:
        return ".png"
    if ".webp" in lower:
        return ".webp"
    if content[:4] == b"\x89PNG":
        return ".png"
    if content[:4] == b"RIFF" and b"WEBP" in content[:16]:
        return ".webp"
    return ".jpg"


def write_image(name: str, url: str) -> bool:
    try:
        content = request_bytes(url)
    except Exception:
        return False
    if len(content) < 500:
        return False
    ext = pick_extension(url, content)
    destination = FACES_DIR / f"{name}{ext}"
    destination.write_bytes(content)
    return True


def copy_existing_alias(target_name: str, source_name: str) -> bool:
    for source in FACES_DIR.glob(f"{source_name}.*"):
        destination = FACES_DIR / f"{target_name}{source.suffix.lower()}"
        if destination.exists():
            return True
        destination.write_bytes(source.read_bytes())
        return True
    return False


def desired_names() -> list[str]:
    names = []
    seen = set()

    for actor in PRIORITY_ACTORS:
        if actor not in seen:
            names.append(actor)
            seen.add(actor)

    with MISSING_CSV.open(newline="", encoding="utf-8-sig") as handle:
        for row in csv.DictReader(handle):
            name = (row.get("Name") or "").strip()
            if name and name not in seen:
                names.append(name)
                seen.add(name)
    return names


def main() -> None:
    existing = existing_actor_names()
    added = []
    failed = []

    for name in desired_names():
        if name in existing:
            continue

        if name in COPY_EQUIVALENTS and copy_existing_alias(name, COPY_EQUIVALENTS[name]):
            existing.add(name)
            added.append((name, "copied"))
            print(f"ADDED {name} via copied alias")
            continue

        image_url = wikipedia_image_url(name) or bing_image_url(name)
        if image_url and write_image(name, image_url):
            existing.add(name)
            added.append((name, image_url))
            print(f"ADDED {name} from {image_url}")
        else:
            failed.append(name)
            print(f"FAILED {name}")

    print(f"Added {len(added)} actors")
    print(f"Failed {len(failed)} actors")
    if failed:
        print("FAILED_NAMES")
        for name in failed:
            print(name)


if __name__ == "__main__":
    main()
