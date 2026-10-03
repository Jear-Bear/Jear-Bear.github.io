#!/usr/bin/env python3
"""build.py — builds Jared's Ultimate Japanese Guide.

Chapters are written as HTML fragments in guide/_chapters/NN-slug.html
(Jekyll doesn't publish folders that start with "_"). Each starts with a
META comment:

    <!--META {"title": "...", "ja": "...", "kanji": "始", "minutes": 8,
              "lede": "...", "stage": "Everyone"} -->

and may use these shorthands, expanded here:

    <yt id="VIDEO_ID">Title</yt>                 lazy YouTube embed (click to load)
    <shot name="file.png" ratio="16/9">What to capture</shot>
                                                screenshot placeholder; drop the real
                                                image at images/guide/file.png and it
                                                shows up on its own
    <photo name="file.jpg">What photo</photo>   same, for photos of you
    {{root}}                                    relative path to the site root
    {{link:migaku}}                             shared links (LINKS below)

Run:  python3 scripts/guide/build.py
Writes guide/index.html and guide/<slug>/index.html.
"""

import html
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "guide" / "_chapters"
OUT = ROOT / "guide"
TEMPLATE = ROOT / "tools" / "crossword" / "index.html"   # shared header/footer source (two levels deep)

GUIDE_TITLE = "Jared’s Ultimate Japanese Guide"
GUIDE_JA = "日本語ガイド"

# Shared links, in one place (no affiliate links)
LINKS = {
    "migaku": "https://migaku.com/",
    "italki": "https://www.italki.com/",
    "discord": "https://discord.gg/SqeuUd39sJ",
    "youtube": "https://youtube.com/@jareddesu",
    "kaishi": "https://ankiweb.net/shared/info/1196762551",
    "anki": "https://apps.ankiweb.net/",
    "ankiconnect": "https://ankiweb.net/shared/info/2055492159",
    "yomitan": "https://yomitan.wiki/",
    "jimaku": "https://jimaku.cc/",
    "asbplayer": "https://github.com/killergerbah/asbplayer",
    "gsm": "https://github.com/bpwhelan/GameSentenceMiner",
    "lapis": "https://github.com/donkuri/lapis",
    "donkuri": "https://donkuri.github.io/learn-japanese/",
    "lazyguide": "https://lazyguidejp.github.io/jp-lazy-guide/",
    "jpdb": "https://jpdb.io/",
    "immersionkit": "https://www.immersionkit.com/",
    "taekim": "https://guidetojapanese.org/learn/",
    "sakubi": "https://sakubi.neocities.org/",
    "ttsu": "https://reader.ttsu.app/",
    "nhkeasy": "https://www3.nhk.or.jp/news/easy/",
    "nhk": "https://www3.nhk.or.jp/news/",
    "tadoku": "https://tadoku.org/japanese/en/free-books-en/",
    "livingjapanese": "https://www.livingjapanese.com/",
    "kotu": "https://kotu.io/tests/ja/pitchAccent/perception/minimalPairs",
    "praat": "https://www.praat.org/",
    "toggl": "https://toggl.com/track/",
    "vpngate": "https://www.vpngate.net/en/",
    "tmw": "https://learnjapanese.moe/",
    "sevenstop": "https://www.youtube.com/@sevenstop7",
    "tiger": "https://www.youtube.com/@HypotheticalTiger",
    "furretar": "https://www.youtube.com/@Furretar",
    "mattvsjapan": "https://www.youtube.com/@mattvsjapan",
    "nihongonomori": "https://www.youtube.com/@nihongonomori2013",
}


def read_chapters():
    chapters = []
    for f in sorted(SRC.glob("[0-9][0-9]-*.html")):
        text = f.read_text(encoding="utf-8")
        m = re.match(r"\s*<!--META\s*(\{.*?\})\s*-->", text, re.S)
        if not m:
            raise SystemExit(f"{f.name}: missing META comment")
        meta = json.loads(m.group(1))
        meta["num"] = int(f.name[:2])
        meta["slug"] = f.stem[3:]
        meta["body"] = text[m.end():]
        chapters.append(meta)
    return chapters


KANJI_NUM = "〇一二三四五六七八九十"


def kanji_num(n):
    if n == 0:
        return "序"
    if n <= 10:
        return KANJI_NUM[n]
    return "十" + KANJI_NUM[n - 10]


def expand(body, root):
    def yt(m):
        vid, title = m.group(1), m.group(2).strip()
        t = html.escape(title, quote=True)
        return (
            f'<div class="g-yt" data-id="{vid}"><button type="button" class="g-yt-btn" aria-label="Play video: {t}">'
            f'<img src="https://i.ytimg.com/vi/{vid}/maxresdefault.jpg" alt="" loading="lazy" width="1280" height="720">'
            f'<span class="g-yt-play" aria-hidden="true"></span></button>'
            f'<p class="g-yt-cap"><span class="g-yt-tag">Video</span> {title}</p></div>'
        )

    def shot(kind):
        def f(m):
            name, ratio, cap = m.group(1), m.group(2) or "16/9", m.group(3).strip()
            label = "Screenshot needed" if kind == "shot" else "Photo needed"
            icon = "▢" if kind == "shot" else "◎"
            return (
                f'<figure class="g-shot" data-src="{root}images/guide/{name}" style="--r:{ratio}">'
                f'<div class="g-shot-ph"><span class="g-shot-label">{icon} {label}</span>'
                f'<span class="g-shot-what">{cap}</span><code>images/guide/{name}</code></div>'
                f'<figcaption>{cap}</figcaption></figure>'
            )
        return f

    body = re.sub(r'<yt id="([\w-]+)">(.*?)</yt>', yt, body, flags=re.S)
    body = re.sub(r'<shot name="([^"]+)"(?: ratio="([^"]+)")?>(.*?)</shot>', shot("shot"), body, flags=re.S)
    body = re.sub(r'<photo name="([^"]+)"(?: ratio="([^"]+)")?>(.*?)</photo>', shot("photo"), body, flags=re.S)
    body = re.sub(r"\{\{link:(\w+)\}\}", lambda m: LINKS[m.group(1)], body)
    body = body.replace("{{root}}", root)
    return body


def template_parts():
    t = TEMPLATE.read_text(encoding="utf-8")
    head_scripts = re.search(r"(<script>/\* theme:.*?</script>)", t, re.S).group(1)
    masthead = re.search(r'(  <a class="skip-link".*?</div>\n)\n  <main', t, re.S).group(1)
    footer = re.search(r"(  <footer class=\"colophon\">.*?</footer>)", t, re.S).group(1)
    beacon = re.search(r"(  <!-- Cloudflare Web Analytics.*?</script>)", t, re.S).group(1)
    return head_scripts, masthead, footer, beacon


def page(*, title, description, canonical, root, body, body_attrs=""):
    head_scripts, masthead, footer, beacon = template_parts()
    fix = lambda s: s.replace("../../", root)
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  {head_scripts}
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <title>{html.escape(title)}</title>
  <meta name="description" content="{html.escape(description, quote=True)}" />
  <link rel="canonical" href="{canonical}" />
  <meta property="og:title" content="{html.escape(title, quote=True)}" />
  <meta property="og:description" content="{html.escape(description, quote=True)}" />
  <meta property="og:type" content="article" />

  <link rel="icon" href="{root}images/logo.png">

  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Shippori+Mincho:wght@500;600;700&family=Zen+Kaku+Gothic+New:wght@400;500;700&display=swap" rel="stylesheet">

  <link rel="stylesheet" href="{root}styles/base.css?v=4">
  <link rel="stylesheet" href="{root}styles/guide.css?v=3">
{fix(beacon)}
</head>
<body data-page="guide"{body_attrs}>
  <div class="g-progress" aria-hidden="true"><span></span></div>

{fix(masthead)}
{body}

{fix(footer)}

  <script src="{root}scripts/site.js?v=3"></script>
  <script type="module" src="{root}scripts/guide/guide.js?v=1"></script>
</body>
</html>
"""


def toc(chapters, current, root):
    items = []
    for c in chapters:
        cur = ' aria-current="page"' if current and c["slug"] == current["slug"] else ""
        items.append(
            f'<li data-slug="{c["slug"]}"><a href="{root}guide/{c["slug"]}/"{cur}>'
            f'<span class="g-toc-n" lang="ja">{c["kanji"]}</span><span class="g-toc-t">{html.escape(c["title"])}</span>'
            f'<span class="g-toc-check" aria-hidden="true"></span></a></li>'
        )
    return "\n".join(items)


def chapter_page(chapters, i):
    c = chapters[i]
    root = "../../"
    prev_c = chapters[i - 1] if i > 0 else None
    next_c = chapters[i + 1] if i + 1 < len(chapters) else None
    body = expand(c["body"], root)

    def nav_card(x, label):
        if not x:
            return f'<a class="g-pn-card is-home" href="../">{label}<strong>Back to all chapters</strong></a>'
        return (
            f'<a class="g-pn-card" href="../{x["slug"]}/"><span class="g-pn-label">{label}</span>'
            f'<span class="g-pn-k" lang="ja">{x["kanji"]}</span><strong>{html.escape(x["title"])}</strong></a>'
        )

    main = f"""  <main id="main" class="g-main">
    <div class="container g-wrap">
      <aside class="g-side" aria-label="Guide chapters">
        <a class="g-side-home" href="../">{GUIDE_TITLE}</a>
        <div class="g-side-progress"><span class="g-side-bar"><span></span></span><span class="g-side-count">0 / {len(chapters)}</span></div>
        <ol class="g-toc">
{toc(chapters, c, root)}
        </ol>
        <p class="g-side-onpage-label">On this page</p>
        <ol class="g-onpage" id="onpage"></ol>
      </aside>

      <article class="g-article" data-slug="{c['slug']}">
        <header class="g-hero">
          <p class="g-hero-kicker"><a href="../">{GUIDE_TITLE}</a> <span aria-hidden="true">·</span> Chapter {c['num'] + 1} <span lang="ja">第{kanji_num(c['num'] + 1)}章</span></p>
          <h1 class="g-hero-title">{c['title_html'] if 'title_html' in c else html.escape(c['title'])}</h1>
          <p class="g-hero-ja" lang="ja">{c['ja']}</p>
          <p class="g-hero-lede">{c['lede']}</p>
          <p class="g-hero-meta"><span>{c['minutes']} min read</span><span>{c.get('stage', 'Everyone')}</span><span class="g-hero-done" hidden>✓ Read</span></p>
          <span class="g-hero-kanji" aria-hidden="true" lang="ja">{c['kanji']}</span>
        </header>

        <div class="g-body">
{body}
        </div>

        <footer class="g-chapter-end">
          <button type="button" class="g-done-btn" data-done="{c['slug']}"><span class="g-done-box" aria-hidden="true"></span><span class="g-done-text">Mark this chapter as read</span></button>
          <nav class="g-pn" aria-label="Chapters">
            {nav_card(prev_c, '← Previous')}
            {nav_card(next_c, 'Next →')}
          </nav>
        </footer>
      </article>
    </div>
  </main>"""
    title = f"{c['title']} · {GUIDE_TITLE}"
    desc = re.sub(r"<[^>]+>", "", c["lede"])
    return page(title=title, description=desc, canonical=f"https://www.jareddesu.com/guide/{c['slug']}/",
                root=root, body=main, body_attrs=f' data-chapter="{c["slug"]}"')


def hub_page(chapters):
    root = "../"
    hub = (SRC / "hub.html").read_text(encoding="utf-8")
    cards = []
    for c in chapters:
        cards.append(
            f'<li class="g-card g-reveal" data-slug="{c["slug"]}" style="--i:{c["num"]}"><a href="{c["slug"]}/">'
            f'<span class="g-card-k" lang="ja">{c["kanji"]}</span>'
            f'<span class="g-card-n">Chapter {c["num"] + 1} <span lang="ja">第{kanji_num(c["num"] + 1)}章</span></span>'
            f'<strong class="g-card-t">{html.escape(c["title"])}</strong>'
            f'<span class="g-card-l">{c["lede"]}</span>'
            f'<span class="g-card-meta"><span>{c["minutes"]} min</span><span>{c.get("stage", "Everyone")}</span><span class="g-card-done">✓ Read</span></span>'
            f"</a></li>"
        )
    hub = hub.replace("{{chapters}}", "\n".join(cards)).replace("{{count}}", str(len(chapters)))
    hub = hub.replace("{{first}}", chapters[0]["slug"])
    body = expand(hub, root)
    return page(title=f"{GUIDE_TITLE} · Jared P.",
                description="A free, interactive guide to learning Japanese through immersion (AJATT): what to do, in what order, and how to keep going. Written by まだまだJared, from 4,000+ hours of his own immersion.",
                canonical="https://www.jareddesu.com/guide/", root=root, body=body, body_attrs=' data-hub="1"')


def main():
    chapters = read_chapters()
    OUT.mkdir(exist_ok=True)
    (OUT / "index.html").write_text(hub_page(chapters), encoding="utf-8")
    for i, c in enumerate(chapters):
        d = OUT / c["slug"]
        d.mkdir(exist_ok=True)
        (d / "index.html").write_text(chapter_page(chapters, i), encoding="utf-8")
    # The chapter list for guide.js (titles and kanji for the hub's resume card)
    (OUT / "chapters.json").write_text(json.dumps(
        [{"slug": c["slug"], "title": c["title"], "kanji": c["kanji"], "num": c["num"]} for c in chapters],
        ensure_ascii=False), encoding="utf-8")
    print(f"Built hub + {len(chapters)} chapters")


if __name__ == "__main__":
    main()
