#!/usr/bin/env python3
"""End-to-end refresh: pull live Florida Lottery data -> build lottery.db -> emit public/data.js.
Runs standalone (CI or local). No pre-existing database required.
  python3 pipeline/refresh.py
Sources: official getscratchinfo API, winner-report PDFs, retailer locator API, GeoNames ZIP centroids.
"""
import json, os, re, sys, sqlite3, statistics, io, zipfile, urllib.request, urllib.parse, time, html, hashlib
from collections import defaultdict
from datetime import date

ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path: sys.path.insert(0,ROOT)
PUB=os.path.join(ROOT,"public")
CACHE=os.path.join(ROOT,"pipeline",".cache"); os.makedirs(CACHE,exist_ok=True)
GW="https://apim-website-prod-eastus.azure-api.net"
HDR={"x-partner":"web","User-Agent":"Mozilla/5.0 (fl-scratch-stats refresh)"}
WKLIFE_HINT=("WK/LIFE","YR/LIFE","A WEEK FOR LIFE","A YR FOR LIFE","A YEAR FOR LIFE")

def get(url,headers=HDR,tries=4,timeout=45):
    last=None
    for i in range(tries):
        try:
            req=urllib.request.Request(url,headers=headers)
            with urllib.request.urlopen(req,timeout=timeout) as r: return r.read()
        except Exception as e:
            last=e; time.sleep(1.5*(i+1))
    raise last
def getj(url,**k): return json.loads(get(url,**k))

def money(x):
    if x is None: return None
    m=re.search(r"[\d,]+(?:\.\d+)?",str(x)); return float(m.group(0).replace(",","")) if m else None
def odds1in(s):
    if not s: return None
    m=re.search(r"1-?in-?([\d,\.]+)",str(s),re.I); return float(m.group(1).replace(",","")) if m else None
def clean(n):
    n=html.unescape(n or "").replace("&trade;","").replace("™","")
    return re.sub(r"\s+"," ",n).strip()
def ndate(s):
    if not s: return None
    m=re.search(r"(\d{1,2})/(\d{1,2})/(\d{4})",str(s))
    return f"{int(m.group(3)):04d}-{int(m.group(1)):02d}-{int(m.group(2)):02d}" if m else None

def iso_date(value):
    """Validate either upstream date format, without assigning a date to missing data."""
    text=str(value or "").strip()
    text=text[:10] if re.match(r"^\d{4}-\d{2}-\d{2}",text) else ndate(text)
    try: return date.fromisoformat(text).isoformat()
    except (TypeError,ValueError): return None

def prize_identity(value):
    """Compare advertised prizes before cash-option repricing, including annuity units."""
    text=clean(str(value or "")).upper()
    unit="week_life" if re.search(r"(?:WK|WEEK).*LIFE",text) else (
        "year_life" if re.search(r"(?:YR|YEAR).*LIFE",text) else "cash")
    return money(text),unit

def api_headline_counts(tier):
    """One advertised API tier owns the displayed headline and all three counters."""
    def count(value):
        try:
            number=float(value)
            return int(number) if number>=0 and number.is_integer() else None
        except (ValueError,TypeError,OverflowError): return None
    total=count(tier.get("TotalPrizes")); paid=count(tier.get("PrizesPaid"))
    remaining=count(tier.get("PrizesRemaining"))
    if any(tier.get(key) is not None and value is None for key,value in (
            ("TotalPrizes",total),("PrizesPaid",paid),("PrizesRemaining",remaining))):
        return None,None,None
    if total is not None and remaining is None and paid is not None: remaining=total-paid
    if total is not None and paid is None and remaining is not None: paid=total-remaining
    valid=(total is not None and total>0 and paid is not None and remaining is not None
           and 0<=paid<=total and 0<=remaining<=total and paid+remaining==total)
    return (total,paid,remaining) if valid else (None,None,None)

def game_quality(game,as_of=None):
    """Public quality flags; a delayed winner report does not invalidate fresh API odds."""
    today=iso_date(as_of) or time.strftime("%Y-%m-%d")
    report=iso_date(game.get("last_queried")); launch=iso_date(game.get("launch_date"))
    notes=game.get("data_quality") or ""
    quarantined="Quarantined:" in notes or bool(report and launch and report<launch)
    old=not report or (date.fromisoformat(today)-date.fromisoformat(report)).days>7 or game.get("value_per_dollar_now") is None
    eligible=bool(game.get("on_sale") and game.get("value_per_dollar_now") is not None and not quarantined)
    return {"recommendation_eligible":eligible,
            "source_status":"quarantined" if quarantined else ("limited" if old else "verified"),
            "source_report_date":report}

def normalize_deadlines(games,feeds,as_of=None):
    """Merge explicit closure feeds into one date-based model, retaining legacy keys."""
    today=iso_date(as_of) or time.strftime("%Y-%m-%d")
    by_id={str(g.get("game_no")):g for g in games if g.get("game_no") is not None}
    records={}
    for group in ("ending","expiring"):
        for raw in (feeds or {}).get(group) or []:
            gid=str(raw.get("Id",raw.get("id",raw.get("GameId",""))))
            if not gid: continue
            game=by_id.get(gid,{})
            prior=records.get(gid,{})
            sell=iso_date(raw.get("LastDayToSell") or raw.get("last_sell")) or prior.get("last_sell") or iso_date(game.get("end_date"))
            redeem=iso_date(raw.get("LastDayToRedeem") or raw.get("last_redeem") or raw.get("RedemptionDate")) or prior.get("last_redeem") or iso_date(game.get("redemption_date"))
            records[gid]={"id":gid,"name":clean(raw.get("GameName") or raw.get("name") or game.get("game_name") or f"Game #{gid}"),
                          "price":raw.get("TicketPrice",raw.get("price",game.get("ticket_price"))),
                          "last_sell":sell,"last_redeem":redeem}
    # API EndDate can be a far-future placeholder: only inferred closures already reached
    # today join this list. Future reminders require an explicit ending/expiring feed.
    for gid,game in by_id.items():
        sell=iso_date(game.get("end_date")); redeem=iso_date(game.get("redemption_date"))
        if gid not in records and sell and sell<=today and redeem:
            records[gid]={"id":gid,"name":game.get("game_name") or f"Game #{gid}","price":game.get("ticket_price"),
                          "last_sell":sell,"last_redeem":redeem}
    for record in records.values():
        sell=record["last_sell"]; redeem=record["last_redeem"]
        record["status"]="expired" if redeem and redeem<today else (
            "upcoming" if sell and sell>=today else "redeemable")
    items=sorted(records.values(),key=lambda r:(r["last_redeem"] or "9999",r["last_sell"] or "9999",r["id"]))
    return {"items":items,"ending":[r for r in items if r["status"]=="upcoming"],
            "expiring":[r for r in items if r["status"]=="redeemable"],
            "expired":[r for r in items if r["status"]=="expired"]}

# ---------------- winner-PDF parser (pdfplumber, coordinate columns) ----------------
def parse_pdf(path):
    import pdfplumber
    DATE=re.compile(r"^\d{1,2}/\d{1,2}/\d{4}$")
    MARK=re.compile(r"Total Number of\s+(?:\$([\d,]+(?:\.\d{2})?)\s*/?\s*(WK/LIFE|YR/LIFE)?\s*)?Top-Prize Winning Tickets:\s*([\d,]+)")
    CITY=re.compile(r"^(.*?),\s*([A-Z]{2})\s+(\d{5})?")
    g=os.path.basename(path).split("_")[0]
    res={"game_no":g,"game_name":None,"last_queried":None,"tiers":[],"winners":[]}
    def rows_of(words,tol=3.0):
        ws=sorted(words,key=lambda w:w["top"]); out=[]; cur=[]; last=None
        for w in ws:
            if last is None or w["top"]-last<=tol: cur.append(w)
            else: out.append(cur); cur=[w]
            last=w["top"]
        if cur: out.append(cur)
        return [sorted(r,key=lambda w:w["x0"]) for r in out]
    def headers(rows):
        for ws in rows:
            line=" ".join(w["text"] for w in ws)
            if line.startswith("Claim Date") and "Winner" in line:
                cols={}
                for i,w in enumerate(ws):
                    t=w["text"]
                    if t=="Claim": cols["date"]=w["x0"]
                    elif t=="Winner": cols["winner"]=w["x0"]
                    elif t=="Lottery": cols["retailer"]=w["x0"]
                    elif t=="Advertised": cols["prize"]=w["x0"]
                    elif t=="Top" and "prize" not in cols and (i==0 or ws[i-1]["text"]!="Advertised"): cols["prize"]=w["x0"]
                    elif t=="Payment": cols["payment"]=w["x0"]
                    elif t=="Prize" and i+1<len(ws) and ws[i+1]["text"]=="Payout": cols["payout"]=w["x0"]
                return cols
        return None
    def bounds(cols):
        L={"date":0,"winner":2,"retailer":2,"prize":35,"payment":25,"payout":25}
        return sorted([(x-L.get(k,5),k) for k,x in cols.items()])
    def assign(ws,bs):
        out={k:[] for _,k in bs}
        for w in ws:
            nm=bs[0][1]
            for x,k in bs:
                if w["x0"]>=x: nm=k
            out[nm].append(w["text"])
        return {k:" ".join(v).strip() for k,v in out.items()}
    with pdfplumber.open(path) as pdf:
        cur=None; dcols=None
        for pg in pdf.pages:
            txt=pg.extract_text() or ""
            if res["game_name"] is None:
                m=re.search(r"^(.*)\(GAME #(\d+)\)",txt,re.M)
                if m: res["game_name"]=clean(m.group(1))
            if res["last_queried"] is None:
                m=re.search(r"(\d{1,2}/\d{1,2}/\d{4})\s+as of\s+([\d:]+\s*[AP]M)",txt)
                if m: res["last_queried"]=f"{m.group(1)} {m.group(2)}"
            rows=rows_of(pg.extract_words(x_tolerance=1.5))
            hc=headers(rows);  dcols=hc or dcols
            bs=bounds(dcols or {"date":18,"winner":83,"retailer":300,"prize":600})
            pend=None
            for ws in rows:
                line=" ".join(w["text"] for w in ws)
                mm=MARK.search(line)
                if mm:
                    amt=("$"+mm.group(1)+((" "+mm.group(2)) if mm.group(2) else "")) if mm.group(1) else None
                    cur={"value":amt,"total":int(mm.group(3).replace(",","")),"claimed":0}; res["tiers"].append(cur); continue
                if not ws: continue
                first=ws[0]["text"]
                if DATE.match(first) and "as of" not in line:
                    a=assign(ws,bs); seq=re.search(r"(\d+)\s*$",line); pay=a.get("payout","")
                    w={"claim_date":first,
                       "winner_name":re.sub(r"^\d{1,2}/\d{1,2}/\d{4}\s*","",(a.get("date","")+" "+a.get("winner","")).strip()).strip(),
                       "retailer_name":a.get("retailer",""),"advertised":a.get("prize",""),"payment":a.get("payment",""),
                       "payout":re.sub(r"\s*\d+$","",pay).strip(),"seq":int(seq.group(1)) if seq else None,
                       "city":None,"state":None,"zip":None,"retailer_address":None}
                    if not w["payment"] and not w["payout"]:
                        w["advertised"]=re.sub(r"\s*\d+$","",w["advertised"]).strip()
                    res["winners"].append(w); pend=w
                    if cur: cur["claimed"]+=1
                    continue
                if pend is not None and not DATE.match(first):
                    a=assign(ws,bs); loc=(a.get("date","")+" "+a.get("winner","")).strip(); cm=CITY.match(loc)
                    if cm:
                        pend["city"],pend["state"],pend["zip"]=cm.group(1).strip(),cm.group(2),cm.group(3)
                        pend["retailer_address"]=a.get("retailer","") or None; pend=None
                    elif "Page" in line or "Florida Lottery" in line: pend=None
    return res

# ---------------- fetch ----------------
def fetch_games():
    print("· fetching all games (getscratchinfo)…")
    return getj(f"{GW}/scratchgamesapp/getscratchinfo")

# browser-grade headers: files.floridalottery.com rejects obvious non-browser clients
PDF_HDR={
    "User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Accept":"application/pdf,application/octet-stream,*/*;q=0.8",
    "Accept-Language":"en-US,en;q=0.9",
    "Referer":"https://www.floridalottery.com/",
}
PDFCACHE=os.path.join(ROOT,"pipeline","pdfcache")   # committed fallback: last-known-good PDFs
_PDF_STRATEGY=[None]  # remember the first rung that works and lead with it
PDF_CACHED=[]         # games whose winner PDF fell back to cache this run (for an honest freshness note)

def _pdf_fetch(url):
    """Escalation ladder: the CDN TLS-fingerprints clients (CI gets SSLV3_ALERT_HANDSHAKE_FAILURE),
       so try three different TLS stacks before giving up."""
    def s1():  # stock urllib
        return get(url,headers=PDF_HDR,tries=1,timeout=30)
    def s2():  # TLS1.2 with a browser-ish cipher order
        import ssl
        ctx=ssl.create_default_context()
        ctx.minimum_version=ssl.TLSVersion.TLSv1_2
        ctx.maximum_version=ssl.TLSVersion.TLSv1_2
        ctx.set_ciphers("ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:"
                        "ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:"
                        "ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305")
        req=urllib.request.Request(url,headers=PDF_HDR)
        with urllib.request.urlopen(req,timeout=30,context=ctx) as r: return r.read()
    def s3():  # curl: an entirely different TLS stack/fingerprint
        import subprocess
        r=subprocess.run(["curl","-sS","--fail","-L","--max-time","40",
                          "-A",PDF_HDR["User-Agent"],
                          "-H","Accept: application/pdf",
                          "-H","Referer: https://www.floridalottery.com/",url],
                         capture_output=True,timeout=50)
        if r.returncode==0: return r.stdout
        raise RuntimeError(f"curl rc={r.returncode} {r.stderr[:70].decode(errors='replace')}")
    rungs={"urllib":s1,"tls12":s2,"curl":s3}
    order=([_PDF_STRATEGY[0]] if _PDF_STRATEGY[0] else [])+[k for k in rungs if k!=_PDF_STRATEGY[0]]
    errs=[]
    for k in order:
        try:
            data=rungs[k]()
            if data[:4]==b"%PDF" and data.rstrip().endswith(b"%%EOF"):   # complete PDF: final %%EOF at true EOF
                _PDF_STRATEGY[0]=k
                return data,k
            errs.append(f"{k}: {'truncated '+str(len(data))+'b (no trailing %%EOF)' if data[:4]==b'%PDF' else 'non-PDF '+repr(data[:24])}")
        except Exception as e:
            errs.append(f"{k}: {type(e).__name__} {str(e)[:60]}")
    raise RuntimeError(" | ".join(errs))

def fetch_pdfs(ids):
    import concurrent.futures as cf, shutil
    os.makedirs(os.path.join(CACHE,"pdf"),exist_ok=True)
    os.makedirs(PDFCACHE,exist_ok=True)
    fails=defaultdict(int); cached=[]
    if os.environ.get("FLSS_SIMULATE_PDF_FAIL"):   # test hook: force the cache-fallback path
        globals()["_pdf_fetch"]=lambda url:(_ for _ in ()).throw(RuntimeError("simulated outage"))
    def one(g):
        p=os.path.join(CACHE,"pdf",f"{g}.pdf")
        try:
            data,rung=_pdf_fetch(f"https://files.floridalottery.com/exptkt/{g}_WinningTicketInformation.pdf")
            open(p,"wb").write(data)
            cp=os.path.join(PDFCACHE,f"{g}.pdf")   # refresh committed cache only on real change (no churn)
            try:
                if not(os.path.exists(cp) and open(cp,"rb").read()==data): open(cp,"wb").write(data)
            except Exception: pass
            return g
        except Exception as e:
            fails[str(e)[:120]]+=1
            cp=os.path.join(PDFCACHE,f"{g}.pdf")   # fall back to last-known-good
            if os.path.exists(cp):
                try:
                    shutil.copyfile(cp,p); cached.append(g); return g
                except Exception: pass
            return None
    print(f"· downloading {len(ids)} winner PDFs…",flush=True)
    ok=[]
    with cf.ThreadPoolExecutor(max_workers=8) as ex:
        for r in ex.map(one,ids):
            if r: ok.append(r)
    for sig,n in sorted(fails.items(),key=lambda x:-x[1])[:3]:
        print(f"   PDF failures ×{n}: {sig}",flush=True)
    if cached:
        print(f"! PDF source unreachable for {len(cached)} games — using committed last-known-good PDFs (winners may lag until the next successful full fetch)",flush=True)
    if _PDF_STRATEGY[0] and not cached:
        print(f"   (fetched live via {_PDF_STRATEGY[0]})",flush=True)
    PDF_CACHED[:]=sorted(cached)   # games whose winners came from cache this run (source unreachable)
    return ok

def fetch_deadlines():
    print("· fetching ending/expiring games…")
    out={"ending":[],"expiring":[]}
    try: out["ending"]=getj(f"{GW}/scratchgamesapp/getEndingGames")
    except Exception as e: print("   ending failed:",e)
    try: out["expiring"]=getj(f"{GW}/expringTicketsApp/getExpiringTickets")
    except Exception as e: print("   expiring failed:",e)
    return out

def fetch_retailers():
    print("· fetching retailer census (locator)…")
    centers=[(30.42,-87.22),(30.44,-84.28),(29.65,-82.33),(28.54,-81.38),(27.34,-80.37),
             (26.14,-80.19),(26.64,-81.87),(25.76,-80.19),(24.56,-81.78)]
    seen={}
    for lat,lon in centers:
        try:
            for r in getj(f"{GW}/searchretailersapp/searchRetailers?geoLat={lat}&geoLong={lon}&radius=200"):
                seen[r["LocationId"]]=r
        except Exception as e: print("   center failed:",e)
    return list(seen.values())

def load_geonames():
    p=os.path.join(CACHE,"US.txt")
    if not os.path.exists(p):
        print("· downloading GeoNames ZIP centroids…")
        z=zipfile.ZipFile(io.BytesIO(get("https://download.geonames.org/export/zip/US.zip",headers={"User-Agent":HDR["User-Agent"]})))
        open(p,"wb").write(z.read("US.txt"))
    zipmap={}; cpts=defaultdict(list); z2c={}
    for line in open(p,encoding="utf-8"):
        c=line.rstrip("\n").split("\t")
        if len(c)<11: continue
        try: lat=float(c[9]); lon=float(c[10])
        except: continue
        zipmap[c[1]]=(lat,lon); cpts[(c[2].upper().strip(),c[4])].append((lat,lon))
        if c[4]=="FL": z2c[c[1]]=c[5]
    ccent={k:(statistics.mean(a for a,_ in v),statistics.mean(b for _,b in v)) for k,v in cpts.items()}
    return zipmap,ccent,z2c

# ---------------- chain / category classifiers ----------------
CH=[("Publix","PUBLIX"),("7-Eleven","7[ -]?ELEVEN|SEVEN[ -]?ELEVEN"),("Circle K","CIRCLE K"),("Winn-Dixie","WINN[ -]?DIXIE"),
    ("Walmart","WALMART|WAL-MART"),("RaceTrac","RACETRAC|RACE TRAC"),("Wawa","WAWA"),("Speedway","SPEEDWAY"),("Murphy","MURPHY"),
    ("Chevron","CHEVRON"),("Shell","\\bSHELL\\b"),("Sunoco","SUNOCO"),("Sedano's","SEDANO"),("Gate","\\bGATE\\b")]
GAS=r"CHEVRON|SHELL|EXXON|MOBIL|SUNOCO|MARATHON|\bBP\b|CITGO|VALERO|TEXACO|SPEEDWAY|WAWA|RACETRAC|RACE TRAC|CIRCLE K|MURPHY|7[ -]?ELEVEN|KANGAROO|\bGATE\b|CUMBERLAND|KWIK|PILOT|GAS|FUEL|PETRO|SERVICE STATION|\bMART\b|EXPRESS|CONVENIENC|AMOCO"
GROC=r"PUBLIX|WINN[ -]?DIXIE|WALMART|WAL-MART|SEDANO|SUPERMARKET|SUPER MARKET|GROCERY|SAVE|SAM'S|BRAVO|PRESIDENTE|\bIGA\b|ALDI|FRESCO|WHOLE FOODS|TARGET|FOOD (STORE|MART|MARKET|LION)"
def chainOf(n):
    n=(n or "").upper()
    for lbl,pat in CH:
        if re.search(pat,n): return lbl
    return "Independent/Other"
def catOf(n):
    n=(n or "").upper(); g=bool(re.search(GAS,n)); gr=bool(re.search(GROC,n))
    if gr and not g: return "Grocery/Supermarket"
    if g: return "Gas/Convenience"
    if re.search(r"LIQUOR|WINE|BEVERAGE|PACKAGE",n): return "Liquor/Beverage"
    if re.search(r"PHARMAC|CVS|WALGREEN|DRUG",n): return "Pharmacy"
    return "Other/Independent"

# ---------------- build DB ----------------
def build_db(games_api,parses,census,geo,as_of=None):
    zipmap,ccent,z2c=geo
    db=os.path.join(ROOT,"lottery.db")
    if os.path.exists(db): os.remove(db)
    con=sqlite3.connect(db); con.row_factory=sqlite3.Row; c=con.cursor()
    c.executescript("""
    CREATE TABLE games(game_no TEXT PRIMARY KEY,game_name TEXT,ticket_price REAL,top_prize_display TEXT,top_prize_value_num REAL,
      overall_odds TEXT,overall_odds_1_in REAL,top_prizes_total INTEGER,top_prizes_claimed INTEGER,top_prizes_remaining INTEGER,
      launch_date TEXT,end_date TEXT,redemption_date TEXT,on_sale INTEGER,last_queried TEXT,data_quality TEXT);
    CREATE TABLE prize_tiers(id INTEGER PRIMARY KEY AUTOINCREMENT,game_no TEXT,tier_rank INTEGER,prize_amount_display TEXT,
      prize_amount_value REAL,odds_1_in REAL,remaining INTEGER,original INTEGER,claimed INTEGER);
    CREATE TABLE top_prize_winners(id INTEGER PRIMARY KEY AUTOINCREMENT,game_no TEXT,prize_level_num REAL,is_headline INTEGER,
      seq INTEGER,claim_date TEXT,winner_name TEXT,winner_city TEXT,winner_state TEXT,winner_zip TEXT,
      retailer_name TEXT,retailer_address TEXT,advertised_top_prize TEXT,payment TEXT,prize_payout TEXT,prize_payout_num REAL);
    CREATE TABLE ticket_analysis(game_no TEXT PRIMARY KEY,ticket_price REAL,est_tickets_printed INTEGER,est_tickets_remaining INTEGER,
      pct_tickets_remaining REAL,value_original REAL,value_remaining REAL,pct_value_remaining REAL,ev_per_ticket_now REAL,
      value_per_dollar_original REAL,value_per_dollar_now REAL,tiers_consistent INTEGER);
    CREATE TABLE retailers(location_id INTEGER PRIMARY KEY,name TEXT,chain TEXT,category TEXT,address TEXT,city TEXT,zip TEXT,
      lat REAL,lon REAL,has_vending INTEGER,district TEXT);
    CREATE TABLE data_quality(game_no TEXT,note TEXT);
    """)
    today=iso_date(as_of) or time.strftime("%Y-%m-%d")
    dq=defaultdict(list)
    # games + tiers
    for g in games_api:
        gid=str(g["Id"]); tiers=g.get("OddsTiers") or []
        name=clean(g["GameName"]); price=g.get("TicketPrice")
        end=(g.get("EndDate") or "")[:10]; on=0 if (end and end<today) else 1
        p=parses.get(gid,{})
        # OddsTiers[0] is the advertised headline tier, including life-annuity games.
        # Winner PDFs may omit entirely unclaimed tiers, so their maximum claimed
        # tier must never be promoted to the headline (the #1647 regression).
        headline=tiers[0] if tiers else {}
        top_disp=headline.get("PrizeAmount")
        top_val=money(top_disp)
        tp_total,tp_claim,tp_rem=api_headline_counts(headline)
        if tp_total is None:
            dq[gid].append("Quarantined: the official headline prize counters are missing or inconsistent.")
        report=iso_date(p.get("last_queried")); launch=iso_date(g.get("LaunchDate"))
        if report and launch and report<launch:
            dq[gid].append(f"Quarantined: winner report dated {report} predates this game's {launch} launch.")
        elif report and (date.fromisoformat(today)-date.fromisoformat(report)).days>7:
            dq[gid].append(f"Winner report last updated {report}; winner records may lag the current game odds table.")
        elif not report:
            dq[gid].append("Winner report date unavailable; prize counters come from the current game odds table.")
        matching_pdf=next((t for t in p.get("tiers") or []
                           if prize_identity(t.get("value"))==prize_identity(top_disp)),None)
        if matching_pdf and tp_total is not None and (
                matching_pdf.get("total")!=tp_total or matching_pdf.get("claimed")!=tp_claim):
            dq[gid].append("Winner report and game odds counters differ; headline counts use the official game odds table.")
        c.execute("INSERT INTO games VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (gid,name,price,top_disp,top_val,f"1:{g.get('OverallOdds')}",g.get("OverallOdds"),
             tp_total,tp_claim,tp_rem,(g.get("LaunchDate") or "")[:10],end,(g.get("RedemptionDate") or "")[:10],on,p.get("last_queried"),None))
        for rank,t in enumerate(tiers):
            v=money(t["PrizeAmount"]); tot=t.get("TotalPrizes"); rem=t.get("PrizesRemaining"); paid=t.get("PrizesPaid")
            c.execute("INSERT INTO prize_tiers(game_no,tier_rank,prize_amount_display,prize_amount_value,odds_1_in,remaining,original,claimed) VALUES(?,?,?,?,?,?,?,?)",
                (gid,rank,t["PrizeAmount"],v,odds1in(t["WinningOdds"]),rem,tot,paid))
    # winners
    for gid,p in parses.items():
        advertised=con.execute("SELECT top_prize_display FROM games WHERE game_no=?",(gid,)).fetchone()
        if not advertised: continue
        headline_identity=prize_identity(advertised[0])
        for w in p["winners"]:
            adv=money(w["advertised"]); rc=None
            if w["retailer_address"]:
                parts=[x.strip() for x in w["retailer_address"].split(",")]; rc=parts[-1] if len(parts)>1 else None
            c.execute("""INSERT INTO top_prize_winners(game_no,prize_level_num,is_headline,seq,claim_date,winner_name,winner_city,
              winner_state,winner_zip,retailer_name,retailer_address,advertised_top_prize,payment,prize_payout,prize_payout_num)
              VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
              (gid,adv,1 if adv is not None and prize_identity(w["advertised"])==headline_identity else 0,w["seq"],ndate(w["claim_date"]),w["winner_name"],
               w["city"],w["state"],w["zip"],w["retailer_name"],w["retailer_address"],w["advertised"],
               w["payment"] or None,w["payout"] or None,money(w["payout"])))
    con.commit()
    # annuity reprice
    for gr in con.execute("""SELECT DISTINCT g.game_no FROM games g JOIN prize_tiers t ON t.game_no=g.game_no AND t.tier_rank=0
        WHERE t.prize_amount_display LIKE '%WK/LIFE%' OR t.prize_amount_display LIKE '%YR/LIFE%'
           OR g.game_name LIKE '%A WEEK FOR LIFE%' OR g.game_name LIKE '%A YR FOR LIFE%' OR g.game_name LIKE '%A YEAR FOR LIFE%'""").fetchall():
        gid=gr["game_no"]; cash=con.execute("SELECT AVG(prize_payout_num) FROM top_prize_winners WHERE game_no=? AND is_headline=1 AND prize_payout_num>0",(gid,)).fetchone()[0]
        if cash and cash>0:
            con.execute("UPDATE prize_tiers SET prize_amount_value=? WHERE game_no=? AND tier_rank=0",(cash,gid))
            con.execute("UPDATE games SET top_prize_value_num=? WHERE game_no=?",(cash,gid))
            dq[gid].append(f"Annuity top prize valued at cash-option lump sum (${int(cash):,}).")
    con.commit()
    # ticket_analysis (guarded)
    for gr in con.execute("SELECT game_no,ticket_price,overall_odds_1_in FROM games"):
        gid,price,odv=gr["game_no"],gr["ticket_price"],gr["overall_odds_1_in"]
        if any(note.startswith("Quarantined:") for note in dq[gid]):
            dq[gid].append("Estimated payout withheld until the source discrepancy is resolved."); continue
        valid=[(t["prize_amount_value"],t["original"],t["remaining"],t["odds_1_in"]) for t in con.execute("SELECT * FROM prize_tiers WHERE game_no=? ORDER BY tier_rank",(gid,))
               if t["prize_amount_value"] is not None and t["original"] and t["original"]>0 and t["odds_1_in"] and t["odds_1_in"]>0]
        if not price or len(valid)<3 or not odv:
            dq[gid].append("EV not computed (ended / degenerate odds table)."); continue
        so=sum(o for _,o,_,_ in valid); sr=sum((r or 0) for _,_,r,_ in valid)
        vo=sum(v*o for v,o,_,_ in valid); vr=sum(v*(r or 0) for v,_,r,_ in valid)
        per=[od*o for v,o,_,od in valid]; Nr=statistics.median(per); No=odv*so
        cons=bool(No and Nr and 0.8<=No/Nr<=1.25); N=No if cons else Nr
        vpd=vo/(N*price)
        if vpd>1.03: dq[gid].append("EV not computed (degenerate odds table)."); continue
        frac=sr/so if so else None; est=N*frac if frac is not None else None; ev=vr/est if est else None
        con.execute("INSERT INTO ticket_analysis VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
            (gid,price,int(N),int(est) if est else None,round(100*frac,1) if frac is not None else None,
             round(vo,2),round(vr,2),round(100*vr/vo,1) if vo else None,round(ev,4) if ev else None,
             round(vpd,4),round(ev/price,4) if ev else None,1 if cons else 0))
    # retailers
    for r in census:
        con.execute("INSERT OR REPLACE INTO retailers VALUES(?,?,?,?,?,?,?,?,?,?,?)",
            (r["LocationId"],r["Name"],chainOf(r["Name"]),catOf(r["Name"]),r["Address"],r["City"],r["Zip"],
             float(r["GeoLat"]),float(r["GeoLong"]),1 if r.get("ItvmFlag")=="Y" else 0,r.get("DistrictCode")))
    for gid,notes in dq.items():
        con.execute("UPDATE games SET data_quality=? WHERE game_no=?",(" | ".join(notes),gid))
        for n in notes: con.execute("INSERT INTO data_quality VALUES(?,?)",(gid,n))
    con.commit()
    return con,zipmap,ccent

# ---------------- emit data.js ----------------
POP={"Alachua":290028,"Baker":29737,"Bay":204479,"Bradford":28307,"Brevard":663982,"Broward":2013317,"Calhoun":13289,"Charlotte":217212,"Citrus":171666,"Clay":239593,"Collier":417131,"Columbia":74094,"DeSoto":37078,"Dixie":18038,"Duval":1062963,"Escambia":333834,"Flagler":140360,"Franklin":13029,"Gadsden":44298,"Gilchrist":20488,"Glades":13270,"Gulf":15943,"Hamilton":14180,"Hardee":25932,"Hendry":48276,"Hernando":221701,"Highlands":111122,"Hillsborough":1574115,"Holmes":20119,"Indian River":172799,"Jackson":49629,"Jefferson":16007,"Lafayette":8792,"Lake":456068,"Lee":875607,"Leon":299048,"Levy":48520,"Liberty":8035,"Madison":18759,"Manatee":468200,"Marion":442660,"Martin":166272,"Miami-Dade":2802029,"Monroe":80406,"Nassau":106879,"Okaloosa":221810,"Okeechobee":42608,"Orange":1528002,"Osceola":481718,"Palm Beach":1575726,"Pasco":674516,"Pinellas":948563,"Polk":874790,"Putnam":77734,"St. Johns":346328,"St. Lucie":402449,"Santa Rosa":211115,"Sarasota":479958,"Seminole":491884,"Sumter":157772,"Suwannee":48149,"Taylor":21210,"Union":16250,"Volusia":606573,"Wakulla":38089,"Walton":93288,"Washington":26695}
def tier5(v): return 1 if v is None else 5 if v>=25e6 else 4 if v>=5e6 else 3 if v>=2e6 else 2 if v>=1e6 else 1

# ---------------- per-game OG stub pages + share cards ----------------
SITE="https://flscratchstats.com"
INDEXNOW_KEY="0a780f9282c87ae8f04510e2cbffac77"  # stable key; served at /<key>.txt so Bing/Yandex/Seznam accept the nightly ping (Google does NOT use IndexNow — that still needs Search Console)
def _indexnow(urls):
    """Ping IndexNow so Bing/Yandex/Seznam re-crawl the night's changed URLs. Pipeline-side only —
       the site itself makes zero third-party requests; this runs in CI, not in the browser. Non-fatal."""
    if not os.environ.get("CI") and not os.environ.get("GITHUB_ACTIONS"):
        print("   indexnow: skipped (not CI; key file written, ping fires on the nightly run)"); return
    try:
        import urllib.request,json as _j
        body=_j.dumps({"host":"flscratchstats.com","key":INDEXNOW_KEY,
                       "keyLocation":f"{SITE}/{INDEXNOW_KEY}.txt","urlList":urls[:10000]}).encode()
        req=urllib.request.Request("https://api.indexnow.org/indexnow",data=body,
                                   headers={"Content-Type":"application/json; charset=utf-8"})
        with urllib.request.urlopen(req,timeout=30) as r: print("   indexnow:",r.status,f"({len(urls)} urls)")
    except Exception as e:
        print("   indexnow failed (non-fatal):",e)
def _hesc(s):
    """Escape for HTML text AND double-quoted attributes / SVG text nodes."""
    return (html.escape(str(s if s is not None else ""),quote=True)
            .replace("'","&#39;"))
def _moneyc(v):
    """Compact money like the site's money(): $25M / $250k / $1,234."""
    try: v=float(v)
    except (TypeError,ValueError): return "—"
    a=abs(v)
    if a>=1e6:
        s=v/1e6; return f"${s:.0f}M" if abs(s-round(s))<0.05 else f"${s:.1f}M"
    if a>=1e3:
        s=v/1e3; return f"${s:.0f}k" if abs(s-round(s))<0.05 else f"${s:.1f}k"
    return "${:,.0f}".format(v)
def _clamp(v,a,b): return a if v<a else b if v>b else v
def _value_score(g,tiers):
    """Reproduce app.js Value Score (0-100). tiers = positional rows for this game.
       Returns int score or None (ended / no EV / degenerate)."""
    try:
        vpd_now=g.get("value_per_dollar_now"); on=g.get("on_sale")
        if vpd_now is None or not on or g.get("recommendation_eligible") is False: return None
        price=g.get("ticket_price") or 0
        pProfit=0.0
        for t in (tiers or []):
            odds=t[2] if len(t)>2 else None; val=t[1] if len(t)>1 else None
            if odds and odds>0 and val is not None and val>price:
                pProfit+=1.0/odds
        tp_rem=g.get("top_prizes_remaining"); tp_tot=g.get("top_prizes_total")
        dead=bool(on and tp_tot and tp_tot>0 and tp_rem is not None and tp_rem<=0)
        evN=_clamp((vpd_now-0.55)/(0.95-0.55),0,1)
        prN=_clamp((pProfit-0.03)/(0.15-0.03),0,1)
        frN=_clamp((g.get("pct_value_remaining") or 0)/100.0,0,1)
        if dead: jH=0.0
        elif tp_tot: jH=_clamp((tp_rem or 0)/tp_tot,0,1)*0.5+0.5
        else: jH=0.5
        sc=round(100*(0.45*evN+0.20*prN+0.20*frN+0.15*jH))
        if dead: sc=min(sc,34)
        return int(sc)
    except Exception:
        return None
def _score_band(s):
    if s is None: return ("—","#8FD9D2")
    if s>=70: return ("Excellent","#2FB6A8")
    if s>=55: return ("Good","#8FD9D2")
    if s>=40: return ("Fair","#FF9E4A")
    return ("Avoid","#E24B5B")
def _og_svg(g,tiers):
    """1200x630 flamingo dark-theme stat card as a standalone SVG string."""
    name=_hesc(g.get("game_name") or f"Game #{g.get('game_no','')}")
    no=_hesc(g.get("game_no") or "")
    price=g.get("ticket_price")
    price_s="$"+(f"{price:.0f}" if price is not None and abs(price-round(price))<0.05 else (f"{price}" if price is not None else "?"))
    top_s=_moneyc(g.get("top_prize_value_num"))
    evraw=g.get("value_per_dollar_now")
    ev_s=("$"+f"{evraw:.2f}") if evraw is not None else "—"
    tp_rem=g.get("top_prizes_remaining"); tp_tot=g.get("top_prizes_total")
    rem_s=("{:,}".format(tp_rem) if tp_rem is not None else "—")+((" of {:,}".format(tp_tot)) if tp_tot else "")
    count_s=f"{tp_rem:,}" if tp_rem is not None else "—"
    source_label="Unverified source record — see source notes" if g.get("source_status")=="quarantined" else "Modeled payout, not a prediction"
    # truncate very long names to keep the card readable (~26 chars per line, 2 lines)
    def wrap(t,width=24,maxlines=2):
        words=t.split(" "); lines=[]; cur=""
        for w in words:
            if len(cur)+len(w)+(1 if cur else 0)<=width: cur=(cur+" "+w).strip()
            else:
                lines.append(cur); cur=w
                if len(lines)==maxlines: break
        if cur and len(lines)<maxlines: lines.append(cur)
        if len(lines)==maxlines and (len(words)>sum(len(l.split(' ')) for l in lines)):
            lines[-1]=lines[-1][:width-1].rstrip()+"…"
        return lines[:maxlines]
    title_lines=wrap(g.get("game_name") or f"Game #{g.get('game_no','')}")
    ty=200
    title_svg=""
    for i,ln in enumerate(title_lines):
        title_svg+=f'<text x="80" y="{ty+i*74}" font-family="Georgia,\'Times New Roman\',serif" font-size="64" font-weight="700" fill="#F4E7D3">{_hesc(ln)}</text>'
    def cell(x,label,value,vcolor="#F4E7D3"):
        return (f'<text x="{x}" y="470" font-family="Arial,Helvetica,sans-serif" font-size="26" fill="#9aa4ad" letter-spacing="1">{_hesc(label)}</text>'
                f'<text x="{x}" y="530" font-family="Georgia,\'Times New Roman\',serif" font-size="56" font-weight="700" fill="{vcolor}">{_hesc(value)}</text>')
    cells=(cell(80,"PRICE",price_s)
           +cell(320,"TOP PRIZE",top_s,"#FF9E4A")
           +cell(640,"EST. PAYOUT / $1",ev_s,"#2FB6A8")
           +cell(940,"TOP PRIZES LEFT",count_s,"#8FD9D2"))
    return (
'<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">'
'<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">'
'<stop offset="0" stop-color="#181014"/><stop offset="1" stop-color="#0e0b10"/></linearGradient>'
'<linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">'
'<stop offset="0" stop-color="#FF6F91"/><stop offset="1" stop-color="#FF9E4A"/></linearGradient></defs>'
'<rect width="1200" height="630" fill="url(#bg)"/>'
'<rect x="0" y="0" width="1200" height="14" fill="url(#accent)"/>'
f'<text x="80" y="110" font-family="Arial,Helvetica,sans-serif" font-size="30" fill="#FF6F91" letter-spacing="3" font-weight="700">FLSCRATCHSTATS.COM</text>'
f'<text x="80" y="150" font-family="Arial,Helvetica,sans-serif" font-size="24" fill="#9aa4ad">Florida Scratch-Off &#183; Game #{no}</text>'
f'{title_svg}'
'<line x1="80" y1="410" x2="1120" y2="410" stroke="#2a2230" stroke-width="2"/>'
f'{cells}'
f'<text x="80" y="590" font-family="Arial,Helvetica,sans-serif" font-size="24" fill="#9aa4ad">Top prizes remaining: {_hesc(rem_s)} &#183; {_hesc(source_label)}</text>'
'</svg>')
# ---- shared static-page chrome for stubs + SEO landing pages ----
_PAGE_CSS=("body{margin:0;background:#0f1e1c;color:#ece8dd;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;line-height:1.6}"
 "main{max-width:860px;margin:0 auto;padding:30px 22px 20px}"
 "h1{font-family:Georgia,'Times New Roman',serif;color:#FF6F91;font-size:31px;line-height:1.15;margin:0 0 8px}"
 "h2{font-family:Georgia,serif;font-size:21px;margin:30px 0 10px}"
 "a{color:#2FB6A8;text-decoration:none}a:hover{text-decoration:underline}"
 "table{width:100%;border-collapse:collapse;margin:14px 0;font-size:14px}"
 "th,td{text-align:left;padding:7px 10px;border-bottom:1px solid #2b423c}"
 "th{color:#9db0a7;font-weight:600;font-size:11.5px;text-transform:uppercase;letter-spacing:.04em}"
 "td.r,th.r{text-align:right}"
 ".lead{font-size:17px}.muted{color:#9db0a7;font-size:14px}"
 ".cta{display:inline-block;margin:8px 0;background:#16292d;border:1px solid #2b423c;border-radius:9px;padding:9px 15px;color:#8FD9D2;font-weight:600}"
 ".rel{margin:22px 0 6px}.rel a{display:inline-block;margin:0 14px 8px 0}"
 "nav.pricebar{margin:4px 0 2px;font-size:14px}nav.pricebar a{margin-right:13px;white-space:nowrap}"
 "footer{max-width:860px;margin:0 auto;padding:16px 22px 46px;color:#6a7c74;font-size:12px;line-height:1.6;border-top:1px solid #2b423c}")

_ALL_PRICES=[]
_DUP_KEYS=set()   # (name_lower, price_int) that appear on >1 game -> disambiguate stub titles

def _pricebar(prices):
    if not prices: return ""
    links=" ".join(f'<a href="/florida-{int(p)}-scratch-offs">${int(p)}</a>' for p in prices)
    return f'<nav class="pricebar" aria-label="Browse by price">Browse by price: {links}</nav>'

def _foot():
    return ('<footer>Independent hobby project &#183; not affiliated with, endorsed by, or sponsored by the Florida Lottery or the State of Florida. '
     'Figures derive from public Florida Lottery data and update nightly &#8212; verify with the Florida Lottery before purchasing. '
     'Every scratch-off is negative expected value by design; nothing here improves your odds. Play responsibly &#183; 1-888-ADMIT-IT (18+).'
     ' &#183; <a href="/">Home</a> &#183; <a href="/best-value">Best value</a> &#183; <a href="/new-florida-scratch-offs">New games</a> &#183; <a href="/florida-scratch-offs-most-prizes-left">Most prizes left</a> &#183; <a href="/florida-scratch-offs-ending-soon">Ending soon</a> &#183; <a href="/about.html">About &amp; methodology</a></footer>')

def _siblings(D,g):
    p=g.get("ticket_price"); no=str(g.get("game_no"))
    if p is None: return []
    sibs=[x for x in (D.get("games") or []) if x.get("on_sale") and x.get("ticket_price")==p and str(x.get("game_no"))!=no and x.get("game_name")]
    sibs.sort(key=lambda x:-(x.get("value_per_dollar_now") or 0))
    return [(str(x.get("game_no")),x.get("game_name")) for x in sibs[:4]]

def _stub_html(g,tiers,og_image,related=None,prices=None):
    no=_hesc(g.get("game_no") or "")
    name=g.get("game_name") or f"Game #{g.get('game_no','')}"
    name_e=_hesc(name)
    price=g.get("ticket_price")
    price_s="$"+(f"{price:.0f}" if price is not None and abs(price-round(price))<0.05 else (f"{price}" if price is not None else "?"))
    top_s=_moneyc(g.get("top_prize_value_num"))
    top_disp=_hesc(g.get("top_prize_display") or top_s)
    evraw=g.get("value_per_dollar_now")
    ev_s=("$"+f"{evraw:.2f}"+" per $1") if evraw is not None else "n/a"
    odds=g.get("overall_odds_1_in")
    odds_s=(f"1 in {odds}") if odds is not None else "n/a"
    tp_rem=g.get("top_prizes_remaining"); tp_tot=g.get("top_prizes_total")
    rem_s=("{:,}".format(tp_rem) if tp_rem is not None else "?")+((" of {:,}".format(tp_tot)) if tp_tot else "")
    lq=ndate(g.get("last_queried")) or (g.get("last_queried") or "")[:10].strip()   # ISO, matches landing pages
    launch=(g.get("launch_date") or "")[:10]; redeem=(g.get("redemption_date") or "")[:10]
    _dup=(name.strip().lower(),(int(price) if price is not None else None)) in _DUP_KEYS
    _idn=f" (Game #{no})" if _dup else ""   # distinguish same-name reissues so titles/H1 aren't duplicate
    on_sale=bool(g.get("on_sale"))
    quarantined=g.get("source_status")=="quarantined" or "Quarantined:" in (g.get("data_quality") or "")
    # Price-first short titles: the price is the key differentiator and must survive SERP truncation.
    _ptok=f"{price_s}, #{no}" if _dup else price_s
    if quarantined:
        title=_hesc(f"{name} ({_ptok}) — Unverified Source Record")
    elif not on_sale and redeem:
        title=_hesc(f"{name} ({_ptok}) — Ended · Redeem by {redeem}")
    elif len(name)<=24:
        title=_hesc(f"{name} ({_ptok}) — FL Scratch-Off Odds & Prizes Left")
    else:
        title=_hesc(f"{name} ({_ptok}) — FL Scratch-Off Odds")
    # No literal date in the meta description: Google caches snippets between recrawls, so a baked
    # date reads stale. Live numbers stay (they lift CTR); the visible page carries the real date.
    if quarantined:
        desc=(f"{name}: archived, unverified source record. Inconsistent source data is retained for transparency and excluded from recommendations. Verify with the Florida Lottery.")
    elif on_sale:
        desc=(f"{name}: {price_s} Florida scratch-off — {rem_s} top prizes left"
              +(f", estimated payout {ev_s}" if evraw is not None else "")
              +". Published odds and source prize counts; estimates are not predictions. Independent of the Florida Lottery.")
    else:
        desc=(f"{name}: this {price_s} Florida scratch-off has ended"
              +(f" — winning tickets can still be redeemed through {redeem}" if redeem else "")
              +f". Final odds and prize table. Not affiliated with the Florida Lottery.")
    desc_e=_hesc(desc)
    url=f"{SITE}/g/{no}"
    img=_hesc(og_image)
    trows=""
    for t in (tiers or []):
        disp=t[0] if len(t)>0 else None
        od=t[2] if len(t)>2 else None
        rem=t[3] if len(t)>3 else None
        tot=t[4] if len(t)>4 else None
        if disp is None: continue
        trows+=("<tr><td>"+_hesc(str(disp))+"</td>"
                +'<td class="r">'+(f"1 in {od:,.0f}" if isinstance(od,(int,float)) and od else "&#8212;")+"</td>"
                +'<td class="r">'+(f"{int(tot):,}" if isinstance(tot,(int,float)) else "&#8212;")+"</td>"
                +'<td class="r">'+(f"{int(rem):,}" if isinstance(rem,(int,float)) else "&#8212;")+"</td></tr>")
    tier_table=(f'<h2>Prize tiers &amp; odds</h2><table><thead><tr><th>Prize</th><th class="r">Odds</th><th class="r">Total printed</th><th class="r">Remaining</th></tr></thead><tbody>{trows}</tbody></table>' if trows else "")
    quality_note=""
    if quarantined:
        report_day=iso_date(g.get("last_queried")); launch_day=iso_date(g.get("launch_date"))
        friendly_reason=(f'The winner report is dated {_hesc(report_day)}, before the recorded launch date of {_hesc(launch_day)}. '
                         'Those dates do not describe a verified current game.'
                         if report_day and launch_day and report_day<launch_day else
                         'The official source values conflict or are incomplete, so this game cannot be verified for a current comparison.')
        quality_note=('<aside class="source-warning" role="note"><h2>Archived, unverified source record</h2>'
                      '<p>This record is excluded from recommendations. Do not use its odds, prize counts, or dates as current purchase information.</p>'
                      '<p>'+friendly_reason+'</p></aside>')
        lead=(f'<p class="lead">The {name_e} source record is preserved below for reference and transparency. '
              'Its prize tiers have not been verified as a usable current game record.</p>')
        ended_note=""
    elif on_sale:
        lead=(f'<p class="lead">{name_e} is a {price_s} Florida Lottery scratch-off game with a {top_disp} top prize and published overall odds of {odds_s}. '
              +(f'As of {lq}, {rem_s} top prizes remain' if tp_rem is not None else 'See the live prize table below')
              +(f' and its estimated payout is {ev_s}.' if evraw is not None else '.')+"</p>")
        ended_note=""
    else:
        lead=(f'<p class="lead">{name_e} was a {price_s} Florida Lottery scratch-off game with a {top_disp} top prize and overall odds of {odds_s}. '
              f'Sales have ended; the final prize table below shows what remained as of {lq}.</p>')
        ended_note=('<p style="background:rgba(255,158,74,.12);border:1px solid rgba(255,158,74,.4);border-radius:9px;padding:10px 14px">'
              f'<b>This game has ended</b> — it is no longer sold in stores.'
              +(f' Winning tickets can still be redeemed through <b>{redeem}</b>; after that date prizes are forfeited.' if redeem else ' Check your ticket promptly — redemption windows close after sales end.')
              +' <a href="/florida-scratch-offs-ending-soon">See all ended games and deadlines</a>.</p>')
    meaning=('<p class="muted">Estimated payout is a modeled average per $1 based on unclaimed prizes and an estimated ticket count. '
             'The number of unsold tickets is not published; claim delays and lower cash-option payouts can affect actual returns. '
             'It is not a prediction, a probability of winning, or a profitable strategy. '
             '<a href="/#methodology">Read the model assumptions</a> and verify current details with the Florida Lottery.</p>')
    if evraw is not None and evraw>=1.0 and not quarantined:
        meaning+='<p class="muted">An estimate above $1 can depend on a small number of unclaimed large prizes and change before a ticket is purchased. It does not establish a real buying advantage.</p>'
    life=""
    if launch or redeem:
        life='<p class="muted">'+((f"Source-reported launch date: {launch}. " if launch else "")+(f"Source-reported redemption date: {redeem}." if redeem else "")).strip()+"</p>"
        if quarantined: life+='<p class="muted">These conflicting source dates are retained only as an archival record. Verify the actual game status and deadlines with the Florida Lottery.</p>'
    rel=""
    if related and not quarantined:
        rel='<div class="rel"><b>Other '+price_s+' Florida scratch-offs:</b><br>'+" ".join(f'<a href="/g/{_hesc(rn)}">{_hesc(rnm)}</a>' for rn,rnm in related)+'</div>'
    hub='<div class="rel"><b>Compare all games:</b> <a href="/best-value">Best value now</a> &#183; '
    if price is not None:
        hub+=f'<a href="/florida-{int(price)}-scratch-offs">All ${int(price)} games</a> &#183; '
    hub+='<a href="/florida-scratch-offs-most-prizes-left">Most prizes left</a> &#183; <a href="/florida-scratch-offs-ending-soon">Ending soon</a></div>'
    pb=_pricebar(prices) if prices else ""
    game_cta=(f'<p><a class="cta" href="https://floridalottery.com/games/scratch-offs/view?id={no}">Verify the official game record &#8594;</a></p>'
              if quarantined else f'<p><a class="cta" href="/#game/{no}">Explore this game in the comparison tool &#8594;</a></p>')
    import json as _json
    ld=_json.dumps({"@context":"https://schema.org","@graph":[
        {"@type":"BreadcrumbList","itemListElement":[
            {"@type":"ListItem","position":1,"name":"Home","item":f"{SITE}/"},
            {"@type":"ListItem","position":2,"name":"Best-value scratch-offs","item":f"{SITE}/best-value"},
            {"@type":"ListItem","position":3,"name":name,"item":url}]},
        {"@type":"WebPage","@id":url,"url":url,"name":name,
         "dateModified":time.strftime("%Y-%m-%d"),"isPartOf":{"@id":f"{SITE}/#website"}}]},separators=(",",":"))
    return f"""<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title>
<meta name="description" content="{desc_e}">
<link rel="canonical" href="{_hesc(url)}">
<meta name="robots" content="index,follow">
<link rel="icon" type="image/png" href="/favicon.png">
<meta property="og:type" content="article">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{desc_e}">
<meta property="og:url" content="{_hesc(url)}">
<meta property="og:image" content="{img}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:site_name" content="Florida Scratch-Off Statistician">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{title}">
<meta name="twitter:description" content="{desc_e}">
<meta name="twitter:image" content="{img}">
<style>{_PAGE_CSS}</style>
<script type="application/ld+json">{ld}</script>
</head><body>
<main>
<p class="muted"><a href="/">Florida Scratch-Off Statistician</a> &rsaquo; <a href="/best-value">Best value</a> &rsaquo; {name_e}</p>
<h1>{name_e}{_idn} &#8212; Florida Scratch-Off</h1>
<p class="muted">Winner report dated {lq} &#183; <a href="https://floridalottery.com/games/scratch-offs/view?id={no}" rel="noopener">official Florida Lottery game source</a></p>
{quality_note}
{ended_note}
{lead}
{game_cta}
{tier_table}
{life}
{meaning}
{rel}
{hub}
{pb}
</main>
{_foot()}
</body></html>"""

def _landing_html(title,desc,path,h1,intro_html,table_html,prices,itemlist=None):
    url=f"{SITE}{path}"
    import json as _json
    ld_blocks=[_json.dumps({"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[
        {"@type":"ListItem","position":1,"name":"Home","item":f"{SITE}/"},
        {"@type":"ListItem","position":2,"name":h1,"item":url}]},separators=(",",":"))]
    if itemlist:
        ld_blocks.append(_json.dumps({"@context":"https://schema.org","@type":"ItemList","name":h1,
            "itemListElement":[{"@type":"ListItem","position":i+1,"name":nm,"url":f"{SITE}/g/{gn}"} for i,(gn,nm) in enumerate(itemlist[:25])]},separators=(",",":")))
    lds="".join(f'<script type="application/ld+json">{b}</script>' for b in ld_blocks)
    return f"""<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{_hesc(title)}</title>
<meta name="description" content="{_hesc(desc)}">
<link rel="canonical" href="{_hesc(url)}">
<meta name="robots" content="index,follow">
<link rel="icon" type="image/png" href="/favicon.png">
<meta property="og:type" content="website">
<meta property="og:title" content="{_hesc(title)}">
<meta property="og:description" content="{_hesc(desc)}">
<meta property="og:url" content="{_hesc(url)}">
<meta property="og:image" content="{SITE}/og-home.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:site_name" content="Florida Scratch-Off Statistician">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{_hesc(title)}">
<meta name="twitter:description" content="{_hesc(desc)}">
<meta name="twitter:image" content="{SITE}/og-home.png">
<style>{_PAGE_CSS}</style>
{lds}
</head><body>
<main>
<p class="muted"><a href="/">Florida Scratch-Off Statistician</a> &rsaquo; {_hesc(h1)}</p>
<h1>{_hesc(h1)}</h1>
{intro_html}
{_pricebar(prices)}
{table_html}
<p><a class="cta" href="/">Explore the full interactive site &#8594;</a></p>
</main>
{_foot()}
</body></html>"""

_LTIERS={}
def _game_row(g,cols):
    no=_hesc(g.get("game_no") or ""); nm=_hesc(g.get("game_name") or "")
    price=g.get("ticket_price"); sc=_value_score(g,_LTIERS.get(str(g.get("game_no")),[]))
    ev=g.get("value_per_dollar_now"); tpr=g.get("top_prizes_remaining"); tpt=g.get("top_prizes_total")
    _d=(str(g.get("game_name") or "").strip().lower(),(int(price) if price is not None else None)) in _DUP_KEYS
    cellmap={
        "game":(f'<td><a href="/g/{no}">{nm}{f" (#{no})" if _d else ""}</a></td>'
                if g.get("link_available") is not False else f'<td>{nm}</td>'),
        "price":'<td class="r">$'+(f"{price:.0f}" if price is not None else "?")+"</td>",
        "score":'<td class="r">'+(str(sc) if sc is not None else "&#8212;")+"</td>",
        "ev":'<td class="r">'+(f"${ev:.2f}" if ev is not None else "&#8212;")+"</td>",
        "top":"<td>"+_hesc(g.get("top_prize_display") or _moneyc(g.get("top_prize_value_num")))+"</td>",
        "tpr":'<td class="r">'+((f"{tpr:,}"+(f" of {tpt:,}" if tpt else "")) if tpr is not None else "&#8212;")+"</td>",
        "odds":'<td class="r">'+(f"1 in {g.get('overall_odds_1_in')}" if g.get("overall_odds_1_in") is not None else "&#8212;")+"</td>",
        "pctleft":'<td class="r">'+(f"{g.get('pct_value_remaining'):.0f}%" if g.get("pct_value_remaining") is not None else "&#8212;")+"</td>",
        "redeem":"<td>"+_hesc((g.get("redemption_date") or "")[:10] or "&#8212;")+"</td>",
        "sell":"<td>"+_hesc((g.get("end_date") or "")[:10] or "—")+"</td>",
        "deadline_status":"<td>"+_hesc({"upcoming":"Sales ending","redeemable":"Redeemable"}.get(g.get("deadline_status"),"Expired"))+"</td>",
    }
    return "<tr>"+"".join(cellmap[c] for c in cols)+"</tr>"

def _dnm(g):
    k=((g.get("game_name") or "").strip().lower(),(int(g["ticket_price"]) if g.get("ticket_price") else None))
    return (g.get("game_name") or "")+(f' (#{g.get("game_no")})' if k in _DUP_KEYS else "")

def write_landing_pages(D):
    """Emit static SEO landing pages (best-value, per-price, most-prizes-left, ending-soon)."""
    try:
        global _LTIERS
        _LTIERS=D.get("tiers") or {}
        games=[g for g in (D.get("games") or []) if g.get("game_no")]
        onsale=[g for g in games if g.get("on_sale")]
        recommendable=[g for g in onsale if g.get("recommendation_eligible") is not False
                       and g.get("value_per_dollar_now") is not None]
        prices=sorted({int(g["ticket_price"]) for g in games if g.get("ticket_price")})
        built=(D.get("meta") or {}).get("built","")
        def tbl(rows,cols,head):
            if not rows: return '<p class="muted">No verified games match this list in the latest source snapshot.</p>'
            return "<table><thead><tr>"+head+"</tr></thead><tbody>"+"".join(_game_row(g,cols) for g in rows)+"</tbody></table>"
        def write(path,html):
            with open(os.path.join(PUB,path.lstrip("/")+".html"),"w",encoding="utf-8") as f: f.write(html)

        bv=sorted(recommendable,key=lambda g:(-g["value_per_dollar_now"],str(g["game_no"])))
        head='<th>Game</th><th class="r">Price</th><th class="r">Est. payout per $1</th><th>Top prize</th><th class="r">Top prizes left</th><th class="r">% value left</th>'
        cols=["game","price","ev","top","tpr","pctleft"]
        top10=", ".join(f'<a href="/g/{_hesc(g["game_no"])}">{_hesc(g["game_name"])}</a>' for g in bv[:10])
        intro=(f'<p class="lead">Verified Florida scratch-off games ranked by estimated payout per $1, highest first. Source snapshot {built}.</p>'
               '<p class="muted">Estimated payout is a modeled average based on unclaimed prizes, not a prediction or a chance of winning. The number of unsold tickets is not published; claim delays and cash-option payouts can change actual returns. Each game is designed to lose money over time. Play responsibly.</p>'
               +(f'<p><b>Top 10 right now:</b> {top10}.</p>' if top10 else ""))
        write("/best-value",_landing_html("Best-Value Florida Scratch-Off Tickets to Buy (2026) — Ranked",
            f"Verified Florida scratch-offs ranked by estimated payout per $1, with top prizes remaining. Independent and free. Source snapshot {built}.",
            "/best-value","Best-Value Florida Scratch-Offs Right Now",intro,tbl(bv,cols,head),prices,
            itemlist=[(g["game_no"],_dnm(g)) for g in bv[:25]]))

        for p in prices:
            gp=[g for g in recommendable if g.get("ticket_price") and int(g["ticket_price"])==p]
            gp.sort(key=lambda g:(-g["value_per_dollar_now"],str(g["game_no"])))
            head2='<th>Game</th><th class="r">Published overall odds</th><th>Top prize</th><th class="r">Top prizes left</th><th class="r">Est. payout per $1</th>'
            cols2=["game","odds","top","tpr","ev"]
            intro2=(f'<p class="lead">Verified active ${p} Florida Lottery scratch-offs, ranked by estimated payout per $1. Source snapshot {built}.</p>'
                    '<p class="muted">Published odds describe the original game design. Estimated payout uses unclaimed prizes and an estimated ticket count, so it is not a prediction or the chance of winning. Cash-option payouts may be lower than advertised prizes. Play responsibly.</p>')
            write(f"/florida-{p}-scratch-offs",_landing_html(f"Florida ${p} Scratch-Off Tickets — Odds, Best Value & Prizes Left",
                f"Verified Florida ${p} scratch-offs ranked by estimated payout per $1, with published odds and top prizes remaining. Source snapshot {built}.",
                f"/florida-{p}-scratch-offs",f"Florida ${p} Scratch-Off Tickets",intro2,tbl(gp,cols2,head2),prices,
                itemlist=[(g["game_no"],_dnm(g)) for g in gp[:25]]))

        mp=[g for g in onsale if (g.get("top_prizes_remaining") or 0)>0]; mp.sort(key=lambda g:(-(g.get("top_prizes_remaining") or 0),-(g.get("top_prize_value_num") or 0)))
        head3='<th>Game</th><th class="r">Price</th><th>Top prize</th><th class="r">Top prizes left</th>'
        cols3=["game","price","top","tpr"]
        intro3=(f'<p class="lead">Active Florida scratch-offs with the most top prizes still unclaimed, updated {built}.</p>'
                '<p class="muted">More top prizes remaining does not mean better odds &#8212; a game can have many left simply because few tickets have sold. Compare published odds and estimated payout separately, and play responsibly.</p>')
        write("/florida-scratch-offs-most-prizes-left",_landing_html("Florida Scratch-Offs With the Most Top Prizes Remaining (2026)",
            f"Active Florida scratch-off games ranked by top prizes still unclaimed, updated {built}. Independent live stats — play responsibly.",
            "/florida-scratch-offs-most-prizes-left","Florida Scratch-Offs With the Most Top Prizes Left",intro3,tbl(mp,cols3,head3),prices,
            itemlist=[(g["game_no"],_dnm(g)) for g in mp[:25]]))

        # /new-florida-scratch-offs — recent launches, newest first (real recurring query; no page existed)
        ng=[g for g in recommendable if g.get("launch_date")]; ng.sort(key=lambda g:g["launch_date"],reverse=True)
        headN='<th>Game</th><th class="r">Launched</th><th class="r">Price</th><th>Top prize</th><th class="r">Published overall odds</th>'
        def _rowN(g):
            no=_hesc(g.get("game_no") or "")
            return ("<tr>"+f'<td><a href="/g/{no}">{_hesc(_dnm(g))}</a></td>'
                    +'<td class="r">'+_hesc((g.get("launch_date") or "")[:10])+"</td>"
                    +'<td class="r">$'+(f"{g['ticket_price']:.0f}" if g.get("ticket_price") else "?")+"</td>"
                    +"<td>"+_hesc(g.get("top_prize_display") or _moneyc(g.get("top_prize_value_num")))+"</td>"
                    +'<td class="r">'+(f"1 in {g.get('overall_odds_1_in')}" if g.get("overall_odds_1_in") is not None else "&#8212;")+"</td></tr>")
        tblN=("<table><thead><tr>"+headN+"</tr></thead><tbody>"+"".join(_rowN(g) for g in ng)+"</tbody></table>"
              if ng else '<p class="muted">No verified active games are available in the latest source snapshot.</p>')
        introN=(f'<p class="lead">Verified active Florida Lottery scratch-offs, newest first. The most recent launch was {ng[0]["launch_date"][:10]}. Source snapshot {built}.</p>'
                '<p class="muted">New does not mean better odds. Published odds describe the original game design; remaining prize counts do not reveal an exact count of unsold tickets. Each game is designed to lose money over time. Play responsibly.</p>') if ng else '<p class="lead">No verified active games.</p>'
        write("/new-florida-scratch-offs",_landing_html("New Florida Scratch-Off Games (2026) — Newest Launches & Odds",
            "Verified new Florida scratch-offs, newest first, with launch dates, published odds and top prizes. Source data updates daily.",
            "/new-florida-scratch-offs","New Florida Scratch-Off Games",introN,tblN,prices,
            itemlist=[(g["game_no"],_dnm(g)) for g in ng[:25]]))

        by_id={str(g["game_no"]):g for g in games}
        deadline_model=D.get("deadlines") or {}
        if "items" not in deadline_model:
            deadline_model=normalize_deadlines(games,deadline_model,built)
        es=[]
        for item in deadline_model.get("items") or []:
            if item["status"]=="expired": continue
            gid=item["id"]; game=by_id.get(gid,{})
            es.append({**game,"game_no":gid,"game_name":item["name"],"ticket_price":item["price"],
                       "end_date":item["last_sell"],"redemption_date":item["last_redeem"],"deadline_status":item["status"],
                       "link_available":gid in by_id or os.path.exists(os.path.join(PUB,"g",gid+".html"))})
        head4='<th>Game</th><th class="r">Price</th><th>Status</th><th>Sales end</th><th>Redeem by</th>'
        cols4=["game","price","deadline_status","sell","redeem"]
        intro4=(f'<p class="lead">Upcoming Florida scratch-off sales endings and deadlines for redeeming ended games. Updated {built}.</p>'
                '<p class="muted">Sales end on the date shown; winning tickets remain redeemable through the separate redemption deadline. Verify dates with the Florida Lottery before relying on them.</p>')
        deadline_table=tbl(es,cols4,head4) if es else '<p class="muted">No upcoming sales endings or unexpired redemption deadlines are currently listed by the source.</p>'
        write("/florida-scratch-offs-ending-soon",_landing_html("Florida Scratch-Offs Ending Soon — Redemption Deadlines (2026)",
            f"Florida scratch-off sales end dates and ticket redemption deadlines, updated {built}. Do not let a winning ticket expire.",
            "/florida-scratch-offs-ending-soon","Florida Scratch-Offs Ending Soon",intro4,deadline_table,prices,
            itemlist=[(g["game_no"],_dnm(g)) for g in es[:25] if g["link_available"]]))
        print(f"· wrote {4+len(prices)} SEO landing pages")
    except Exception as e:
        print("   write_landing_pages failed (non-fatal):",e)

def write_stub_pages(D):
    """Emit per-game OG stub pages (public/g/<no>.html) + share cards (public/og/<no>.svg,
       and .png if Pillow available). Pure local writes; never raises."""
    try:
        gdir=os.path.join(PUB,"g"); odir=os.path.join(PUB,"og")
        os.makedirs(gdir,exist_ok=True); os.makedirs(odir,exist_ok=True)
        tiers_all=D.get("tiers") or {}
        # optional rasterizer
        have_pil=False
        try:
            import PIL  # noqa: F401
            have_pil=True
        except Exception:
            have_pil=False
        # Games leaving the active API retain their last canonical page and share card.
        # Discovery decoration marks them archived instead of turning earned links into 404s.
        global _ALL_PRICES,_DUP_KEYS
        _ALL_PRICES=sorted({int(g['ticket_price']) for g in (D.get('games') or []) if g.get('ticket_price')})
        _seen={}
        for _g in (D.get('games') or []):
            _k=((_g.get('game_name') or '').strip().lower(), int(_g['ticket_price']) if _g.get('ticket_price') else None)
            _seen[_k]=_seen.get(_k,0)+1
        _DUP_KEYS={k for k,c in _seen.items() if c>1}
        n=0; npng=0; sitemap=[]
        for g in D.get("games") or []:
            no=g.get("game_no")
            if not no: continue
            no=str(no)
            if not re.fullmatch(r"[A-Za-z0-9_-]+",no):  # path-safety
                continue
            sitemap.append(no)
            tiers=tiers_all.get(no) or []
            try:
                svg=_og_svg(g,tiers)   # deterministic string
                svg_path=os.path.join(odir,f"{no}.svg")
                png_path=os.path.join(odir,f"{no}.png")
                html_path=os.path.join(gdir,f"{no}.html")
                # The SVG and stub-HTML are deterministic (identical bytes on any machine) so writing
                # them every run causes NO git churn. The PNG rasterizer is NOT identical across
                # environments (Mac vs CI Pillow), so ONLY the PNG is content-addressed: regenerate it
                # solely when its embedded SVG fingerprint differs (or it's missing).
                # An SVG-only build cannot accidentally mark an old PNG as current.
                have_png=have_pil and os.path.exists(png_path)
                if have_pil and not _png_matches_svg(png_path,svg):
                    if _svg_to_png(svg,png_path): have_png=True
                with open(svg_path,"w",encoding="utf-8") as f:
                    f.write(svg)
                og_rel=f"{SITE}/og/{no}.png" if have_png else f"{SITE}/og/{no}.svg"
                if have_png: npng+=1
                with open(html_path,"w",encoding="utf-8") as f:
                    f.write(_stub_html(g,tiers,og_rel,related=_siblings(D,g),prices=_ALL_PRICES))
                n+=1
            except Exception as e:
                print("   stub fail",no,e)
        print(f"· wrote/verified {n} OG stub pages"+(f" ({npng} PNG cards)" if npng else " (SVG cards)"))
        # sitemap.xml so the 94 (otherwise orphan) stub pages are discoverable by search crawlers
        today=time.strftime("%Y-%m-%d")
        urls=[f"{SITE}/", f"{SITE}/about", f"{SITE}/best-value", f"{SITE}/new-florida-scratch-offs", f"{SITE}/florida-scratch-offs-most-prizes-left", f"{SITE}/florida-scratch-offs-ending-soon"]+[f"{SITE}/florida-{p}-scratch-offs" for p in _ALL_PRICES]+[f"{SITE}/g/{no}" for no in sitemap]
        sm='<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        sm+="".join(f"<url><loc>{u}</loc><lastmod>{today}</lastmod></url>\n" for u in urls)+"</urlset>\n"
        with open(os.path.join(PUB,"sitemap.xml"),"w",encoding="utf-8") as f: f.write(sm)
        with open(os.path.join(PUB,"robots.txt"),"w",encoding="utf-8") as f:
            f.write(f"User-agent: *\nAllow: /\nSitemap: {SITE}/sitemap.xml\n")
        with open(os.path.join(PUB,f"{INDEXNOW_KEY}.txt"),"w",encoding="utf-8") as f:
            f.write(INDEXNOW_KEY)   # ownership proof IndexNow fetches to verify the key
        write_landing_pages(D)
        _indexnow(urls)
    except Exception as e:
        print("   write_stub_pages failed (non-fatal):",e)
def _png_matches_svg(path,svg):
    """Validate the PNG's actual source, even after an earlier SVG-only build."""
    try:
        from PIL import Image
        with Image.open(path) as image:
            return image.info.get("flss_svg_sha256")==hashlib.sha256(svg.encode("utf-8")).hexdigest()
    except (ImportError,OSError,ValueError): return False

def _svg_to_png(svg,path):
    """Best-effort rasterize the OG SVG to a 1200x630 PNG using Pillow, WITHOUT any
       external SVG renderer: re-draw the card natively with PIL primitives so it works
       even though Pillow cannot parse SVG. Returns True on success."""
    try:
        from PIL import Image,ImageDraw,ImageFont,PngImagePlugin
    except Exception:
        return False
    try:
        import xml.etree.ElementTree as ET
        # Parse just the text nodes we emitted so the PNG mirrors the SVG content.
        root=ET.fromstring(svg)
        ns="{http://www.w3.org/2000/svg}"
        texts=[(t.get("x"),t.get("y"),t.get("fill") or "#F4E7D3",
                int(float(t.get("font-size","24"))),t.text or "") for t in root.iter(ns+"text")]
        img=Image.new("RGB",(1200,630),(24,16,20)); d=ImageDraw.Draw(img)
        d.rectangle([0,0,1200,14],fill=(255,111,145))
        d.line([80,410,1120,410],fill=(42,34,48),width=2)
        def font(sz,bold=False):
            for name in (["Georgia Bold.ttf","Arial Bold.ttf","DejaVuSans-Bold.ttf"] if bold else ["Georgia.ttf","Arial.ttf",
                         "DejaVuSans.ttf"]):
                try: return ImageFont.truetype(name,sz)
                except Exception: continue
            try: return ImageFont.truetype("DejaVuSans.ttf",sz)
            except Exception: return ImageFont.load_default()
        def hexrgb(h):
            h=(h or "#F4E7D3").lstrip("#")
            if len(h)==3: h="".join(c*2 for c in h)
            try: return tuple(int(h[i:i+2],16) for i in (0,2,4))
            except Exception: return (244,231,211)
        for x,y,fill,sz,txt in texts:
            try: xi=int(float(x)); yi=int(float(y))
            except Exception: continue
            txt=html.unescape(txt)
            d.text((xi,yi-sz),txt,fill=hexrgb(fill),font=font(sz,sz>=40))
        provenance=PngImagePlugin.PngInfo()
        provenance.add_text("flss_svg_sha256",hashlib.sha256(svg.encode("utf-8")).hexdigest())
        img.save(path,"PNG",pnginfo=provenance)
        return True
    except Exception:
        return False
def emit(con,zipmap,ccent,z2c,fl_geo,deadlines):
    con.row_factory=sqlite3.Row; D={}
    today=time.strftime("%Y-%m-%d")
    D["games"]=[{k:r[k] for k in r.keys()} for r in con.execute("""SELECT g.*,a.est_tickets_printed,a.est_tickets_remaining,
      a.pct_tickets_remaining,a.value_original,a.value_remaining,a.pct_value_remaining,a.ev_per_ticket_now,
      a.value_per_dollar_original,a.value_per_dollar_now FROM games g LEFT JOIN ticket_analysis a USING(game_no) ORDER BY g.game_no""")]
    tiers=defaultdict(list)
    for r in con.execute("SELECT game_no,prize_amount_display,prize_amount_value,odds_1_in,remaining,original,claimed FROM prize_tiers ORDER BY game_no,tier_rank"):
        tiers[r["game_no"]].append([r["prize_amount_display"],r["prize_amount_value"],r["odds_1_in"],r["remaining"],r["original"],r["claimed"]])
    D["tiers"]=dict(tiers)
    D["winners"]=[[r["game_no"],r["claim_date"],r["winner_name"],r["winner_city"],r["winner_state"],r["advertised_top_prize"],
      r["prize_level_num"],r["payment"],r["prize_payout"],r["is_headline"],r["retailer_name"],r["retailer_address"]]
      for r in con.execute("SELECT * FROM top_prize_winners ORDER BY claim_date")]
    # geocode winners for maps
    def geo_rows():
        home=defaultdict(lambda:{"lo":[],"la":[],"n":0,"t":1,"mx":0}); ret=defaultdict(lambda:{"lo":[],"la":[],"n":0,"t":1,"mx":0})
        for r in con.execute("SELECT winner_city,winner_state,winner_zip,retailer_address,prize_level_num FROM top_prize_winners"):
            lvl=r["prize_level_num"]; t=tier5(lvl)
            pt=None
            if r["winner_zip"] and r["winner_zip"][:5] in zipmap: pt=zipmap[r["winner_zip"][:5]]
            elif r["winner_city"]: pt=ccent.get((r["winner_city"].upper().strip(),r["winner_state"] or "FL"))
            if pt:
                e=home[((r["winner_city"] or "?").upper(),(r["winner_state"] or "FL"))]; e["lo"].append(pt[1]); e["la"].append(pt[0]); e["n"]+=1; e["t"]=max(e["t"],t); e["mx"]=max(e["mx"],lvl or 0)
            if r["retailer_address"]:
                parts=[x.strip() for x in r["retailer_address"].split(",")]; rc=parts[-1] if len(parts)>1 else None
                rp=ccent.get((rc.upper(),"FL")) if rc else None
                if rp: e=ret[rc.upper()]; e["lo"].append(rp[1]); e["la"].append(rp[0]); e["n"]+=1; e["t"]=max(e["t"],t); e["mx"]=max(e["mx"],lvl or 0)
        def pack(d): return [[round(statistics.mean(e["lo"]),3),round(statistics.mean(e["la"]),3),e["n"],e["t"],(city[0] if isinstance(city,tuple) else city),int(e["mx"])] for city,e in d.items()]
        return pack(home),pack(ret)
    D["map_home"],D["map_ret"]=geo_rows()
    # counties
    cw=defaultdict(int)
    for (z,) in con.execute("SELECT winner_zip FROM top_prize_winners WHERE winner_zip IS NOT NULL"):
        cc=z2c.get(z[:5]);
        if cc: cw[cc]+=1
    norm=lambda s:s.upper().replace("SAINT","ST",1).replace(".","").replace(" ","").replace("-","")
    popN={norm(k):(k,v) for k,v in POP.items()}
    TOT=sum(cw.values()); TOTP=sum(POP.values()); counties=[]
    for cc,n in cw.items():
        hit=popN.get(norm(cc))
        if not hit: continue
        nm,pp=hit; exp=TOT*pp/TOTP
        counties.append({"county":nm,"pop":pp,"winners":n,"per100k":round(1e5*n/pp,2),"expected":round(exp,1),"index":round(n/exp,2) if exp else None})
    for nm,pp in POP.items():
        if not any(c["county"]==nm for c in counties):
            counties.append({"county":nm,"pop":pp,"winners":0,"per100k":0,"expected":round(TOT*pp/TOTP,1),"index":0})
    counties.sort(key=lambda c:-c["winners"]); D["counties"]=counties
    # timeline
    tl=defaultdict(lambda:[0,0.0])
    for r in con.execute("SELECT substr(claim_date,1,7) m,COUNT(*) n,SUM(COALESCE(prize_level_num,0)) v FROM top_prize_winners WHERE claim_date IS NOT NULL GROUP BY m"):
        tl[r["m"]]=[r["n"],r["v"]]
    D["timeline"]=[[m,tl[m][0],tl[m][1]] for m in sorted(tl)]
    # retail aggregates
    total=con.execute("SELECT COUNT(*) FROM retailers").fetchone()[0]; itvm=con.execute("SELECT SUM(has_vending) FROM retailers").fetchone()[0]
    wr=[dict(r) for r in con.execute("SELECT retailer_name n,prize_level_num p FROM top_prize_winners WHERE retailer_name IS NOT NULL")]
    sc=defaultdict(int); tc=defaultdict(int)
    for r in con.execute("SELECT chain,category FROM retailers"): sc[r["chain"]]+=1; tc[r["category"]]+=1
    wc=defaultdict(int); wtc=defaultdict(int)
    for r in wr: wc[chainOf(r["n"])]+=1; wtc[catOf(r["n"])]+=1
    base=1000*len(wr)/total if total else 0
    chains=[]
    for name,_ in CH+[("Independent/Other","")]:
        s=sc.get(name,0)
        if s<20: continue
        w=wc.get(name,0); chains.append({"name":name,"stores":s,"winners":w,"per1k":round(1000*w/s,1),"lift":round((1000*w/s)/base,2)})
    chains.sort(key=lambda x:-x["lift"])
    types=[{"name":t,"stores":tc[t],"winners":wtc.get(t,0),"per1k":round(1000*wtc.get(t,0)/tc[t],1),"lift":round((1000*wtc.get(t,0)/tc[t])/base,2)} for t in tc if tc[t]>50]
    types.sort(key=lambda x:-x["lift"])
    D["retail"]={"total":total,"itvm":itvm,"base_per1k":round(base,1),"winners_matched":len(wr),"chains":chains,"types":types}
    D["deadlines"]=normalize_deadlines(D["games"],deadlines,today)
    closure_by_id={item["id"]:item for item in D["deadlines"]["items"]}
    for game in D["games"]:
        closure=closure_by_id.get(game["game_no"])
        if closure:
            if closure["last_sell"]:
                game["end_date"]=closure["last_sell"]
                game["on_sale"]=int(closure["last_sell"]>=today)
            if closure["last_redeem"]: game["redemption_date"]=closure["last_redeem"]
        game.update(game_quality(game,today))
    D["fl"]=fl_geo
    on=[g for g in D["games"] if g["on_sale"]]
    D["meta"]={"built":time.strftime("%Y-%m-%d"),
      "built_at":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),   # real build time (UTC); the UI renders it locally
      "n_games":len(D["games"]),"n_winners":len(D["winners"]),
      "on_sale":len(on),"tp_left":sum(g["top_prizes_remaining"] or 0 for g in on),
      "value_left":sum(g["value_remaining"] or 0 for g in on),
      "winners_stale":len(PDF_CACHED),   # games whose winners came from cache (source unreachable) — honest freshness
      "quarantined":sum(g["source_status"]=="quarantined" for g in D["games"]),
      "recommendation_eligible":sum(g["recommendation_eligible"] for g in D["games"])}
    # append nightly history snapshot (compact; grows ~2KB/day)
    hpath=os.path.join(PUB,"history.json")
    try:
        with open(hpath,encoding="utf-8") as history_file: hist=json.load(history_file)
    except FileNotFoundError: hist={"days":[]}   # corrupt JSON must crash: keeps the committed archive
    today=time.strftime("%Y-%m-%d")
    _nn=lambda x:max(0,x) if isinstance(x,(int,float)) else x   # top-prize counts are never negative
    snap_g={g["game_no"]:[_nn(g["top_prizes_remaining"]),g["pct_value_remaining"],g["value_per_dollar_now"]]
            for g in D["games"] if g["on_sale"]}
    _cur=next((d for d in hist["days"] if d["d"]==today),None)
    if _cur: _cur["g"]=snap_g          # same-day re-run refreshes today's entry (no stale freeze)
    else: hist["days"].append({"d":today,"g":snap_g})
    hist["days"]=hist["days"][-1095:]  # keep 3 years; extras.js fetches the whole file per visit
    _tmp=hpath+".tmp"
    with open(_tmp,"w",encoding="utf-8") as history_file: json.dump(hist,history_file,separators=(",",":"))
    os.replace(_tmp,hpath)
    _dpath=os.path.join(PUB,"data.js"); _dtmp=_dpath+".tmp"
    with open(_dtmp,"w") as f:
        f.write("const DATA="); json.dump(D,f,separators=(",",":")); f.write(";")
    os.replace(_dtmp,_dpath)
    # per-game OG stub pages + social share cards (defensive; never breaks the build)
    write_stub_pages(D)
    # Every refresh rebuilds the HTML-first home and the shared discovery shell.
    from pipeline.build_site import build_site
    build_site(D)
    return D["meta"]

def main():
    fl_geo=json.load(open(os.path.join(ROOT,"pipeline","fl_feature.json")))
    games=fetch_games(); ids=[str(g["Id"]) for g in games]
    ok=fetch_pdfs(ids)
    parses={}
    print(f"· parsing {len(ok)} PDFs…")
    for gid in ok:
        try: parses[gid]=parse_pdf(os.path.join(CACHE,"pdf",f"{gid}.pdf"))
        except Exception as e: print("   parse fail",gid,e)
    deadlines=fetch_deadlines()
    census=fetch_retailers()
    # --- publish guards: a degraded upstream must NOT replace good data (nonzero exit = no CI commit) ---
    if len(games)<50: sys.exit(f"ABORT: getscratchinfo returned only {len(games)} games")
    total_w=sum(len(p.get("winners") or []) for p in parses.values())
    if len(parses)<len(ids)*0.6 or total_w<400: sys.exit(f"ABORT: winner-PDF coverage collapsed ({len(parses)}/{len(ids)} PDFs, {total_w} winners)")
    if len(census)<1000: sys.exit(f"ABORT: retailer census collapsed ({len(census)} stores)")
    zipmap,ccent,z2c=load_geonames()
    con,zipmap,ccent=build_db(games,parses,census,(zipmap,ccent,z2c))
    meta=emit(con,zipmap,ccent,z2c,fl_geo,deadlines)
    print("✓ refresh complete:",json.dumps(meta))

if __name__=="__main__": main()
