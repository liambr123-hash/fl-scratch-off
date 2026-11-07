#!/usr/bin/env python3
"""Build the accessible visual ticket shelf and preserve searchable entry pages."""
import csv
import html
import io
import json
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path: sys.path.insert(0, str(ROOT))
PUB = ROOT / 'public'
SITE = 'https://flscratchstats.com'
PRICES = [1, 2, 3, 5, 10, 20, 30, 50]

def esc(value): return html.escape(str(value if value is not None else ''), quote=True)
def money(value):
    return '—' if value is None else '$' + f'{value:,.0f}'

def eligible(g):
    return bool(g.get('recommendation_eligible', g.get('on_sale') and g.get('value_per_dollar_now') is not None))

ICONS = {
    'ticket':'<path d="M3 7h18v4a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4V7Z"/><path d="M8 7v11"/>',
    'new':'<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z"/>',
    'calendar':'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18m-13 4h2m4 0h2"/>',
    'help':'<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4m0 3h.01"/>',
    'heart':'<path d="M20.5 5.5a5 5 0 0 0-7 0L12 7l-1.5-1.5a5 5 0 0 0-7 7L12 21l8.5-8.5a5 5 0 0 0 0-7Z"/>',
    'search':'<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
    'cup':'<path d="M4 8h13v7a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V8Zm13 1h2a3 3 0 0 1 0 6h-2M7 3v2m5-2v2M2 23h19"/>',
    'arrow':'<path d="M5 12h14m-6-6 6 6-6 6"/>',
    'chevron':'<path d="m6 9 6 6 6-6"/>',
    'check':'<path d="m5 12 4 4L20 5"/>',
}
def icon(name):
    return '<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+ICONS.get(name, ICONS['ticket'])+'</svg>'

def ticket_row(g, artwork, rank=0):
    gid=str(g['game_no']); art=artwork.get(gid,{}); src=art.get('thumb') if isinstance(art,dict) else None
    remaining=g.get('top_prizes_remaining'); total=g.get('top_prizes_total')
    pct=max(0,min(100,100*remaining/total)) if total and remaining is not None else 0
    picture=(f'<img src="{esc(src)}" alt="" width="640" height="480" loading="lazy" decoding="async">' if src else '<span class="art-fallback" aria-hidden="true">'+icon('ticket')+'</span>')
    return f'''<article class="ticket-card"><div class="ticket-art"><a href="/g/{esc(gid)}" data-open-game="{esc(gid)}" aria-label="Open {esc(g['game_name'])}">{picture}</a><span class="ticket-price">${g['ticket_price']:g}</span></div><div class="ticket-body"><h3><a href="/g/{esc(gid)}" data-open-game="{esc(gid)}">{esc(g['game_name'])}</a></h3><span class="game-number">#{esc(gid)}</span><div class="prize-main"><span>Top prize</span><strong>{money(g.get('top_prize_value_num'))}</strong></div><div class="prize-left"><span>Top prizes left</span><strong>{remaining if remaining is not None else '—'} of {total if total else '—'}</strong></div><div class="prize-meter" aria-hidden="true"><i style="width:{pct:.2f}%"></i></div><div class="ticket-actions"><button type="button" class="button primary" data-open-game="{esc(gid)}" aria-label="Details for {esc(g['game_name'])}">Details {icon('arrow')}</button><label class="compare-check"><input type="checkbox" data-compare value="{esc(gid)}" aria-label="Compare {esc(g['game_name'])}"><span>Compare</span></label></div></div></article>'''

def calendar(value, label):
    try: d=datetime.strptime(value,'%Y-%m-%d'); month=d.strftime('%b'); day=str(d.day); year=str(d.year)
    except (ValueError,TypeError): return '<span>Not listed</span>'
    return f'<div class="date-stamp"><span>{label}</span><time datetime="{esc(value)}"><span>{month}</span><strong>{day}</strong><span>{year}</span></time></div>'

def build_home(D, artwork=None):
    artwork=artwork or {}; games=D['games']; meta=D['meta']; built=meta['built']; verified=[g for g in games if eligible(g)]
    ranked=sorted(verified,key=lambda g:(g.get('launch_date') or '',int(g['game_no'])),reverse=True)
    try: updated=datetime.strptime(built,'%Y-%m-%d').strftime('%b %-d')
    except ValueError: updated=built
    byid={str(g['game_no']):g for g in games}
    winners=sorted([w for w in D.get('winners',[]) if w[1]],key=lambda w:w[1],reverse=True)[:6]
    deadlines=[x for x in D.get('deadlines',{}).get('items',[]) if x.get('status')!='expired']
    def deadline(x):
        return f'<article class="date-card"><h3><a href="/g/{esc(x.get("id"))}">{esc(x.get("name"))}</a></h3><div class="date-pair">{calendar(x.get("last_sell"),"Sales end" if (x.get("last_sell") or "")>=built else "Sales ended")}<span aria-hidden="true">→</span>{calendar(x.get("last_redeem"),"Claim by")}</div></article>'
    def claim(w):
        return f'<li><time datetime="{esc(w[1])}">{esc(w[1])}</time><strong>{money(w[6])}</strong><a href="/g/{esc(w[0])}" data-open-game="{esc(w[0])}">{esc(byid.get(str(w[0]),{}).get("game_name","#"+str(w[0])))}</a></li>'
    schema={'@context':'https://schema.org','@graph':[
        {'@type':'WebSite','@id':SITE+'/#website','name':'Florida Scratch-Off Statistician','alternateName':'FL Scratch Stats','url':SITE+'/', 'inLanguage':'en-US'},
        {'@type':'WebPage','@id':SITE+'/#webpage','url':SITE+'/','name':'Florida Scratch-Off Odds & Prizes Remaining','dateModified':meta.get('built_at',built),'isPartOf':{'@id':SITE+'/#website'}},
        {'@type':'Dataset','name':'Florida Scratch-Off Game Statistics','description':'Official Florida Lottery prize counts and published odds with clearly labeled payout estimates.','url':SITE+'/#tickets','dateModified':meta.get('built_at',built),'isAccessibleForFree':True,'creator':{'@type':'Organization','name':'Florida Scratch-Off Statistician'},'distribution':{'@type':'DataDownload','encodingFormat':'application/json','contentUrl':SITE+'/data.json'}}]}
    structured_json=json.dumps(schema,separators=(',',':')).replace('<','\\u003c')
    art_json=json.dumps(artwork,separators=(',',':')).replace('<','\\u003c')
    nav=f'''<a href="#tickets">{icon('ticket')}<span>Tickets</span></a><a href="/new-florida-scratch-offs" data-sort-filter="new">{icon('new')}<span>New</span></a><a href="#deadlines" data-open-section>{icon('calendar')}<span>Dates</span></a><a href="#methodology" data-open-section>{icon('help')}<span>Help</span></a><a href="#support" data-open-section>{icon('heart')}<span>Support</span></a>'''
    text=f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#173f35"><title>Florida Scratch-Off Odds & Prizes Remaining | FL Scratch Stats</title><meta name="description" content="Find Florida scratch-off tickets by price. See ticket pictures, top prizes remaining, published odds and clear payout estimates. Updated daily."><link rel="canonical" href="{SITE}/"><link rel="icon" href="/assets/flamingo.svg" type="image/svg+xml"><link rel="stylesheet" href="/assets/site.css?v=2"><link rel="stylesheet" href="/assets/visual.css?v=3"><meta property="og:type" content="website"><meta property="og:site_name" content="Florida Scratch-Off Statistician"><meta property="og:title" content="Florida scratch-offs, made simple."><meta property="og:description" content="Ticket pictures. Clear prize counts. Updated daily."><meta property="og:url" content="{SITE}/"><meta property="og:image" content="{SITE}/og-home.png"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="{SITE}/og-home.png"><script type="application/ld+json">{structured_json}</script><script type="application/json" id="game-artwork">{art_json}</script><script src="/data.js" defer></script><script src="/assets/site.js?v=3" defer></script></head><body class="visual-page">
<a class="skip-link" href="#tickets">Skip to tickets</a><header class="visual-header"><a class="visual-brand" href="/" aria-label="FL Scratch Stats home"><img src="/assets/flamingo.svg" width="32" height="44" alt=""><span>FL Scratch Stats</span></a><nav class="visual-nav" aria-label="Main navigation">{nav}</nav></header>
<main class="visual-main"><div class="visual-title"><h1>Florida scratch-offs</h1><span class="updated-label">{icon('check')}<span>Updated <time id="data-date" datetime="{esc(meta.get('built_at',built))}">{esc(updated)}</time></span><span id="freshness-note" class="sr-only">Source snapshot</span></span></div><span id="new-games" class="anchor-target"></span>
<section id="tickets" aria-label="Find a ticket"><form id="ticket-filters" class="visual-filters" role="search"><fieldset class="price-fieldset"><legend>Ticket price</legend><div class="visual-prices"><a class="price-chip active" href="#tickets" data-price="all" aria-current="true">All</a>{''.join(f'<a class="price-chip" href="/florida-{p}-scratch-offs" data-price="{p}">${p}</a>' for p in PRICES)}</div></fieldset><details id="filter-options" class="filter-options"><summary>{icon('search')}<span>Search & sort</span>{icon('chevron')}</summary><div class="visual-search-row"><label class="visual-search"><span class="sr-only">Game name or number</span>{icon('search')}<input id="game-search" name="q" type="search" placeholder="Name or number" autocomplete="off"></label><label class="visual-sort"><span>Sort</span><select id="game-sort" name="sort"><option value="new">Newest</option><option value="jackpot">Top prize</option><option value="ev">Estimated return</option><option value="profit">Profit odds</option></select></label></div><label class="visual-toggle"><input id="top-prize-only" type="checkbox"><span>With top prizes left</span></label></details></form><div class="visual-results-bar"><p><span id="results-count" aria-live="polite">{min(6,len(ranked))} of {len(verified)}</span> games</p><span id="sort-description" class="sr-only">Sorted by newest release</span><a href="#methodology" data-open-section class="quick-help">{icon('help')}<span>Help</span></a></div><div id="ticket-table"><div id="ticket-results" class="ticket-grid">{''.join(ticket_row(g,artwork,i+1) for i,g in enumerate(ranked[:6]))}</div></div><p id="no-results" class="visual-empty" hidden>Try another price or name.</p><button type="button" id="show-more" class="button more-games">More games {icon('chevron')}</button><noscript><p>Choose a price above, or use <a href="#all-games">all games</a>.</p></noscript></section>
<dialog id="game-detail" class="visual-dialog" aria-label="Game details"></dialog><dialog id="compare-panel" class="visual-dialog" aria-label="Compare games"></dialog>
<div class="visual-panels"><details id="deadlines" class="visual-panel"><summary>{icon('calendar')}<span>Dates</span><span class="panel-count">{len(deadlines)}</span>{icon('chevron')}</summary><div class="panel-body"><div class="date-grid">{''.join(deadline(x) for x in deadlines) if deadlines else '<p>No dates listed.</p>'}</div><a class="source-link" href="https://floridalottery.com/games/scratch-offs">Official dates ↗</a></div></details>
<details id="methodology" class="visual-panel"><summary>{icon('help')}<span>Help</span>{icon('chevron')}</summary><div class="panel-body help-body"><p><strong>No ticket guarantees a win.</strong></p><details><summary>The numbers</summary><p><strong>Top prizes left</strong> counts unclaimed top prizes. Some may already be on sold tickets.</p><p><strong>Estimated return</strong> is a modeled average payout per $1, using advertised prize values. Unsold ticket counts are unknown. It is not your chance of winning.</p><p><strong>Profit odds</strong> are published odds of winning more than the ticket price. They describe the original game.</p><p>{len(games)-len(verified)} source-limited game excluded. Verify figures with the Florida Lottery.</p><a href="/about">Full explanation ↗</a></details><details id="changes"><summary>Recent claims</summary><ul class="visual-claims">{''.join(claim(w) for w in winners)}</ul><p>Past winners do not improve a store’s odds.</p></details><details><summary>Sources & downloads</summary><div class="help-links"><a href="https://floridalottery.com/games/scratch-offs">Florida Lottery ↗</a><a href="/games.csv" download>Spreadsheet ↓</a><a href="/data.json" download>Full data ↓</a><button id="print-guide" type="button">Print</button><a href="/about">About & privacy</a></div></details><details id="all-games"><summary>All games</summary><ul class="game-directory">{''.join(f'<li><a href="/g/{esc(g["game_no"])}">{esc(g["game_name"])} <span>#{esc(g["game_no"])}</span></a></li>' for g in sorted(games,key=lambda g:g['game_name']))}</ul><p>By price: {''.join(f'<a href="/florida-{p}-scratch-offs">${p}</a> ' for p in PRICES)}</p><p><a href="/best-value">Estimated return</a> · <a href="/florida-scratch-offs-most-prizes-left">Top prizes</a></p></details></div></details>
<details id="support" class="visual-panel"><summary>{icon('heart')}<span>Support</span>{icon('chevron')}</summary><div class="panel-body support-options"><a class="visual-coffee" href="https://ko-fi.com/stuartmills" target="_blank" rel="noopener">{icon('cup')}<strong>Buy a coffee</strong><span>Ko-fi ↗</span></a><div class="visual-sponsor"><details id="sponsor-form-details"><summary>{icon('heart')}<strong>Sponsor</strong>{icon('chevron')}</summary><form id="sponsor-form" class="sponsor-form" method="post" action="/api/sponsorship"><noscript><p>This form needs JavaScript.</p></noscript><fieldset id="sponsor-fields" disabled><div class="form-two"><label>Name<input name="name" required minlength="2" maxlength="120" autocomplete="name"></label><label>Company<input name="company" required minlength="2" maxlength="160" autocomplete="organization"></label></div><label>Email<input type="email" name="email" required maxlength="254" autocomplete="email"></label><label>Message<textarea name="message" required minlength="20" maxlength="4000" rows="4"></textarea></label><label>Budget <span>(optional)</span><input name="budget" maxlength="120"></label><label class="form-honeypot" aria-hidden="true">Leave empty<input name="website" tabindex="-1" autocomplete="off"></label><label class="consent-label"><input type="checkbox" name="consent" required><span>Contact me about this inquiry. Private for 30 days.</span></label><button class="button primary" type="submit">Send {icon('arrow')}</button><p id="sponsor-status" role="status" aria-live="polite"></p></fieldset></form></details></div><p class="support-note">Free to use. Sponsors cannot change the numbers.</p></div></details></div>
<footer class="visual-footer"><span>Independent · 18+</span><a href="/about">Sources & privacy</a></footer></main><div id="compare-tray" class="compare-tray" hidden><span id="compare-count"></span><button type="button" id="compare-open" class="button primary">Compare</button><button type="button" id="compare-clear" class="icon-button" aria-label="Clear comparison">×</button></div><div id="site-status" class="sr-only" role="status" aria-live="polite"></div></body></html>'''
    (PUB/'index.html').write_text(text,encoding='utf-8')
    (PUB/'data.json').write_text(json.dumps(D,separators=(',',':')),encoding='utf-8')
    output=io.StringIO(); fields=['game_no','game_name','ticket_price','top_prize_display','top_prizes_remaining','top_prizes_total','overall_odds','value_per_dollar_now','launch_date','end_date','redemption_date','source_status']
    writer=csv.DictWriter(output,fieldnames=fields,extrasaction='ignore',lineterminator='\n'); writer.writeheader()
    for g in games: writer.writerow({k:g.get(k) for k in fields})
    (PUB/'games.csv').write_text(output.getvalue(),encoding='utf-8')
    return len(verified)

def build_site(D=None):
    if D is None:
        raw=(PUB/'data.js').read_text(encoding='utf-8').strip()
        D=json.loads(raw.removeprefix('const DATA=').removesuffix(';'))
        from pipeline.snapshot import repair_snapshot
        D=repair_snapshot(D)
        (PUB/'data.js').write_text('const DATA='+json.dumps(D,separators=(',',':'))+';',encoding='utf-8')
        from pipeline.refresh import write_stub_pages
        write_stub_pages(D)
    from pipeline.artwork import ensure_artwork
    artwork=ensure_artwork(PUB,[g for g in D['games'] if eligible(g)])
    count=build_home(D,artwork)
    from pipeline.discovery import decorate_landing_pages
    decorate_landing_pages(PUB,D)
    print(f'Built visual ticket shelf with {count} games; searchable pages preserved.')

if __name__=='__main__': build_site()
