"""Apply the shared site shell without sacrificing canonical search landing pages.

The nightly pipeline still owns each page's title, description, structured data,
prose and prize table. This small postprocessor only replaces its legacy shell,
connects it to the single-page tool, and labels retained snapshots when a game
leaves the current source feed. It uses only the Python standard library.
"""
from __future__ import annotations

import html
import json
from pathlib import Path
import re
from typing import Any
from urllib.parse import urlparse
import xml.etree.ElementTree as ET

SITE = "https://flscratchstats.com"
SITEMAP_NS = "http://www.sitemaps.org/schemas/sitemap/0.9"
_START = "<!-- discovery:content:start -->"
_END = "<!-- discovery:content:end -->"
_ARCHIVE_START = "<!-- discovery:archive:start -->"
_ARCHIVE_END = "<!-- discovery:archive:end -->"


def _attribute(tag: str, name: str) -> str | None:
    match = re.search(r"\b" + re.escape(name) + r"\s*=\s*([\"'])(.*?)\1", tag, re.I | re.S)
    return html.unescape(match.group(2)) if match else None


def _set_attribute(tag: str, name: str, value: str) -> str:
    escaped = html.escape(value, quote=True)
    pattern = r"(\b" + re.escape(name) + r"\s*=\s*)([\"'])(.*?)\2"
    if re.search(pattern, tag, re.I | re.S):
        return re.sub(pattern, lambda m: m.group(1) + '"' + escaped + '"', tag, count=1, flags=re.I | re.S)
    return tag.rstrip(">").rstrip("/").rstrip() + f' {name}="{escaped}">'


def _canonical(document: str) -> str | None:
    for match in re.finditer(r"<link\b[^>]*>", document, re.I | re.S):
        tag = match.group(0)
        if (_attribute(tag, "rel") or "").lower() == "canonical":
            return _attribute(tag, "href")
    return None


def _header() -> str:
    links = [("tickets", "All tickets"), ("new-games", "New games"),
             ("changes", "What's changed"), ("deadlines", "Deadlines"),
             ("methodology", "How it works"), ("support", "Support")]
    nav = "".join(f'<a href="/#{target}">{label}</a>' for target, label in links)
    return ('<a class="skip-link" href="#main-content">Skip to content</a>\n'
            '<header class="site-header"><a class="site-brand" href="/" aria-label="FL Scratch Stats home">'
            '<img src="/assets/flamingo.svg" width="30" height="40" alt="" aria-hidden="true">'
            '<span>FL Scratch Stats<small>Florida scratch-off data, made clear.</small></span></a>'
            f'<nav class="site-nav" aria-label="Main navigation">{nav}</nav></header>')


def _footer() -> str:
    return ('<footer class="landing-footer"><p>Independent Florida scratch-off statistics. '
            'Not affiliated with or endorsed by the Florida Lottery or the State of Florida.</p>'
            '<p>Published odds describe the game; estimates are not a guarantee of remaining inventory. '
            'Verify current game status and prize counts with the '
            '<a href="https://floridalottery.com/games/scratch-offs">Florida Lottery</a>. '
            'Every game has a house edge by design. 18+.</p>'
            '<nav aria-label="More information"><a href="/#methodology">Sources &amp; methodology</a>'
            '<a href="/#support">Support this project</a>'
            '<a href="https://github.com/liambr123-hash/fl-scratch-off">View the source</a>'
            '<a href="/">Back to all tickets</a></nav></footer>')


def _interactive_url(path: str) -> str:
    game = re.fullmatch(r"/g/([A-Za-z0-9_-]+)", path)
    if game:
        return f"/?game={game.group(1)}#tickets"
    price = re.fullmatch(r"/florida-(\d+)-scratch-offs", path)
    if price:
        return f"/?price={price.group(1)}#tickets"
    return {"/best-value": "/?sort=ev#tickets", "/new-florida-scratch-offs": "/?sort=new#tickets",
            "/florida-scratch-offs-most-prizes-left": "/?sort=jackpot#tickets",
            "/florida-scratch-offs-ending-soon": "/#deadlines", "/about": "/#methodology"}.get(path, "/#tickets")


def _archive_head(head: str) -> str:
    suffix = " — archived snapshot"
    def title(match: re.Match[str]) -> str:
        text = html.unescape(match.group(1))
        if not text.endswith(suffix):
            text += suffix
        return "<title>" + html.escape(text) + "</title>"
    head = re.sub(r"<title>(.*?)</title>", title, head, count=1, flags=re.I | re.S)
    def metadata(match: re.Match[str]) -> str:
        tag = match.group(0)
        key = (_attribute(tag, "name") or _attribute(tag, "property") or "").lower()
        if key in {"description", "og:description", "twitter:description"}:
            return _set_attribute(tag, "content", "Archived Florida scratch-off statistics. This saved snapshot is no longer in the current game feed; verify game status, claim deadlines and prize counts with the Florida Lottery.")
        if key in {"og:title", "twitter:title"}:
            value = _attribute(tag, "content") or "Florida scratch-off"
            return _set_attribute(tag, "content", value if value.endswith(suffix) else value + suffix)
        return tag
    return re.sub(r"<meta\b[^>]*>", metadata, head, flags=re.I | re.S)


def _last_modified(head: str) -> str | None:
    for match in re.finditer(r'<script\b[^>]*type=[\"\']application/ld\+json[\"\'][^>]*>(.*?)</script>', head, re.I | re.S):
        try:
            obj = json.loads(match.group(1))
        except (ValueError, TypeError):
            continue
        values = obj if isinstance(obj, list) else [obj]
        while values:
            value = values.pop()
            if isinstance(value, dict):
                candidate = value.get("dateModified")
                if isinstance(candidate, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}(?:T.*)?", candidate):
                    return candidate[:10]
                values.extend(v for v in value.values() if isinstance(v, (list, dict)))
            elif isinstance(value, list):
                values.extend(value)
    return None


def _decorate(document: str, path: str, archived: bool, quarantined: bool = False) -> tuple[str, str | None]:
    head_match = re.search(r"<head\b[^>]*>(.*?)</head>", document, re.I | re.S)
    main_match = re.search(r"<main\b[^>]*>(.*?)</main>", document, re.I | re.S)
    if not head_match or not main_match:
        raise ValueError(f"Cannot decorate {path}: expected a head and main element")
    head = head_match.group(1).strip()
    # These generated pages carry a complete legacy CSS block. Keep all metadata
    # and JSON-LD intact, replacing only visual styles with the shared stylesheet.
    head = re.sub(r"<style\b[^>]*>.*?</style>\s*", "", head, flags=re.I | re.S)
    head = re.sub(r"<link\b[^>]*>", lambda m: "" if (_attribute(m.group(0), "rel") or "").lower() == "stylesheet" else m.group(0), head, flags=re.I | re.S)
    head = head.strip() + '\n<link rel="stylesheet" href="/assets/site.css">'
    modified = _last_modified(head)
    content = main_match.group(1).strip()
    if _START in content and _END in content:
        content = content.split(_START, 1)[1].split(_END, 1)[0].strip()
    content = re.sub(re.escape(_ARCHIVE_START) + r".*?" + re.escape(_ARCHIVE_END), "", content, flags=re.S).strip()
    # The About heading used to live in its discarded site header.
    if not re.search(r"<h1\b", content, re.I):
        title = re.search(r"<title>(.*?)</title>", head, re.I | re.S)
        heading = "About & methodology" if path == "/about" else html.unescape(title.group(1)) if title else "Florida scratch-off statistics"
        content = "<h1>" + html.escape(heading) + "</h1>\n" + content
    # Replace the legacy two-app jump with the real inline-detail contract.
    content = re.sub(r'(<a\b[^>]*href=)([\"\'])/#game/([A-Za-z0-9_-]+)\2([^>]*>).*?</a>',
                     lambda m: m.group(1) + '"/?game=' + m.group(3) + '#tickets"' + m.group(4) + 'Explore this game in the comparison tool &rarr;</a>',
                     content, flags=re.I | re.S)
    if archived or quarantined:
        # Archived or quarantined data must not gain a live-comparison link just
        # because the shared shell derives a return URL from its canonical path.
        content = re.sub(r'<p\b[^>]*>\s*<a\b[^>]*href=[\"\']/\?game=[^>]*>.*?</a>\s*</p>', "", content, flags=re.I | re.S)
    if archived:
        head = _archive_head(head)
        content = (_ARCHIVE_START + '<aside class="archive-notice" role="note"><strong>Archived game snapshot</strong>'
                   '<p>This game is no longer in the current data feed. Figures below are a saved snapshot, '
                   'not confirmation of current sales, prize availability or claim eligibility. '
                   'Check the <a href="https://floridalottery.com/games/scratch-offs">official Florida Lottery</a> '
                   'for current status and deadlines.</p></aside>' + _ARCHIVE_END + "\n" + content)
    cta = "/#tickets" if archived or quarantined else _interactive_url(path)
    cta_label = "Explore verified games" if quarantined else "Back to the comparison tool"
    bottom = '<p class="landing-return"><a class="button" href="' + html.escape(cta, quote=True) + '">' + cta_label + ' &rarr;</a></p>'
    body = (_header() + '\n<main id="main-content" class="landing-main"><article class="landing-content"'
            + (' data-archived="true"' if archived else '') + '>' + _START + '\n' + content + '\n' + _END
            + bottom + '</article></main>\n' + _footer())
    return ('<!doctype html>\n<html lang="en"><head>\n' + head + '\n</head>\n'
            '<body class="landing-page">\n' + body + '\n</body></html>\n'), modified


def _preserve_sitemap(public_dir: Path, pages: list[tuple[str, str | None]]) -> None:
    """Keep retained canonical game snapshots discoverable without faking freshness."""
    target = public_dir / "sitemap.xml"
    if target.exists():
        root = ET.fromstring(target.read_text(encoding="utf-8"))
    else:
        root = ET.Element(f"{{{SITEMAP_NS}}}urlset")
    locations = {element.text for element in root.iter() if element.tag.rsplit("}", 1)[-1] == "loc"}
    for canonical, modified in pages:
        if canonical in locations:
            continue
        entry = ET.SubElement(root, f"{{{SITEMAP_NS}}}url")
        ET.SubElement(entry, f"{{{SITEMAP_NS}}}loc").text = canonical
        if modified:
            ET.SubElement(entry, f"{{{SITEMAP_NS}}}lastmod").text = modified
        locations.add(canonical)
    ET.register_namespace("", SITEMAP_NS)
    ET.indent(root, space="  ")
    target.write_text('<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(root, encoding="unicode") + '\n', encoding="utf-8")


def decorate_landing_pages(public_dir: str | Path, D: dict[str, Any]) -> dict[str, int]:
    """Give canonical HTML routes a shared shell, retaining their unique content.

    Call after the generator has written landing pages and sitemap, and before
    publication. The generator must retain old game files rather than pruning
    them. index.html is intentionally owned by the single-page homepage builder.
    """
    public_dir = Path(public_dir)
    current_games = {str(game.get("game_no")): game for game in D.get("games", []) if game.get("game_no")}
    pages: list[tuple[str, str | None]] = []
    counts = {"decorated": 0, "archived": 0}
    for target in sorted(public_dir.rglob("*.html")):
        if target == public_dir / "index.html":
            continue
        document = target.read_text(encoding="utf-8")
        canonical = _canonical(document)
        if not canonical:
            continue
        parsed = urlparse(canonical)
        if parsed.scheme != "https" or parsed.netloc != "flscratchstats.com" or parsed.query or parsed.fragment:
            continue
        path = parsed.path.rstrip("/") or "/"
        # Do not wrap arbitrary HTML assets or an accidental duplicate homepage.
        relative = target.relative_to(public_dir).as_posix()
        expected = relative[:-5]
        if path != "/" + expected:
            continue
        game = re.fullmatch(r"/g/([A-Za-z0-9_-]+)", path)
        archived = bool(game and game.group(1) not in current_games)
        quarantined = bool(game and current_games.get(game.group(1), {}).get("source_status") == "quarantined")
        output, modified = _decorate(document, path, archived, quarantined=quarantined)
        if output != document:
            target.write_text(output, encoding="utf-8")
        pages.append((canonical, modified))
        counts["decorated"] += 1
        counts["archived"] += int(archived)
    _preserve_sitemap(public_dir, pages)
    return counts
