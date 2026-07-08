#!/usr/bin/env python3
"""End-to-end refresh: pull live Florida Lottery data -> build lottery.db -> emit public/data.js.
Runs standalone (CI or local). No pre-existing database required.
  python3 pipeline/refresh.py
Sources: official getscratchinfo API, winner-report PDFs, retailer locator API, GeoNames ZIP centroids.
"""
import json, os, re, sys, sqlite3, statistics, io, zipfile, urllib.request, urllib.parse, time, html
from collections import defaultdict

ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
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

# ---------------- winner-PDF parser (pdfplumber, coordinate columns) ----------------
def parse_pdf(path):
    import pdfplumber
    DATE=re.compile(r"^\d{1,2}/\d{1,2}/\d{4}$")
    MARK=re.compile(r"Total Number of\s+(?:\$([\d,]+(?:\.\d{2})?)\s*/?\s*(WK/LIFE)?\s+)?Top-Prize Winning Tickets:\s*([\d,]+)")
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
                    amt=("$"+mm.group(1)+(" WK/LIFE" if mm.group(2) else "")) if mm.group(1) else None
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

def fetch_pdfs(ids):
    import concurrent.futures as cf
    os.makedirs(os.path.join(CACHE,"pdf"),exist_ok=True)
    def one(g):
        p=os.path.join(CACHE,"pdf",f"{g}.pdf")
        try:
            data=get(f"https://files.floridalottery.com/exptkt/{g}_WinningTicketInformation.pdf",headers={"User-Agent":HDR["User-Agent"]})
            if data[:4]==b"%PDF": open(p,"wb").write(data); return g
        except Exception: return None
    print(f"· downloading {len(ids)} winner PDFs…")
    ok=[]
    with cf.ThreadPoolExecutor(max_workers=8) as ex:
        for r in ex.map(one,ids):
            if r: ok.append(r)
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
def build_db(games_api,parses,census,geo):
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
    today=time.strftime("%Y-%m-%d")
    dq=defaultdict(list)
    # games + tiers
    for g in games_api:
        gid=str(g["Id"]); tiers=g.get("OddsTiers") or []
        name=clean(g["GameName"]); price=g.get("TicketPrice")
        end=(g.get("EndDate") or "")[:10]; on=0 if (end and end<=today) else 1
        p=parses.get(gid,{})
        # headline top-prize counts from winner PDF (authoritative for claims), fallback to API tier0
        hv=[money(t["value"]) for t in (p.get("tiers") or []) if t.get("value")]
        headpdf=max(((t for t in p.get("tiers") or [] if t.get("value")),),default=None)
        pdf_head=None
        if hv:
            mx=max(hv); pdf_head=next((t for t in p["tiers"] if money(t.get("value"))==mx),None)
        tp_total=pdf_head["total"] if pdf_head else (tiers[0]["TotalPrizes"] if tiers else None)
        tp_claim=pdf_head["claimed"] if pdf_head else (tiers[0].get("PrizesPaid") if tiers else None)
        tp_rem=(tp_total-tp_claim) if (tp_total is not None and tp_claim is not None) else (tiers[0].get("PrizesRemaining") if tiers else None)
        top_disp=tiers[0]["PrizeAmount"] if tiers else None
        top_val=money(top_disp)
        c.execute("INSERT INTO games VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (gid,name,price,top_disp,top_val,f"1:{g.get('OverallOdds')}",g.get("OverallOdds"),
             tp_total,tp_claim,tp_rem,(g.get("LaunchDate") or "")[:10],end,(g.get("RedemptionDate") or "")[:10],on,p.get("last_queried"),None))
        for rank,t in enumerate(tiers):
            v=money(t["PrizeAmount"]); tot=t.get("TotalPrizes"); rem=t.get("PrizesRemaining"); paid=t.get("PrizesPaid")
            c.execute("INSERT INTO prize_tiers(game_no,tier_rank,prize_amount_display,prize_amount_value,odds_1_in,remaining,original,claimed) VALUES(?,?,?,?,?,?,?,?)",
                (gid,rank,t["PrizeAmount"],v,odds1in(t["WinningOdds"]),rem,tot,paid))
    # winners
    for gid,p in parses.items():
        if not con.execute("SELECT 1 FROM games WHERE game_no=?",(gid,)).fetchone(): continue
        hv=[money(t["value"]) for t in p["tiers"] if t.get("value")]; headv=max(hv) if hv else None
        for w in p["winners"]:
            adv=money(w["advertised"]); rc=None
            if w["retailer_address"]:
                parts=[x.strip() for x in w["retailer_address"].split(",")]; rc=parts[-1] if len(parts)>1 else None
            c.execute("""INSERT INTO top_prize_winners(game_no,prize_level_num,is_headline,seq,claim_date,winner_name,winner_city,
              winner_state,winner_zip,retailer_name,retailer_address,advertised_top_prize,payment,prize_payout,prize_payout_num)
              VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
              (gid,adv,1 if (adv and headv and abs(adv-headv)<1) else 0,w["seq"],ndate(w["claim_date"]),w["winner_name"],
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
    # blowout canonical remaining from odds tier0
    for gid in ("1607","1626"):
        t0=con.execute("SELECT remaining,original FROM prize_tiers WHERE game_no=? AND tier_rank=0",(gid,)).fetchone()
        if t0: con.execute("UPDATE games SET top_prizes_remaining=?,top_prizes_total=?,top_prizes_claimed=? WHERE game_no=?",(t0[0],t0[1],t0[1]-t0[0],gid))
    con.commit()
    # ticket_analysis (guarded)
    for gr in con.execute("SELECT game_no,ticket_price,overall_odds_1_in FROM games"):
        gid,price,odv=gr["game_no"],gr["ticket_price"],gr["overall_odds_1_in"]
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
def emit(con,zipmap,ccent,z2c,fl_geo,deadlines):
    con.row_factory=sqlite3.Row; D={}
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
                e=home[(r["winner_city"] or "?").upper()]; e["lo"].append(pt[1]); e["la"].append(pt[0]); e["n"]+=1; e["t"]=max(e["t"],t); e["mx"]=max(e["mx"],lvl or 0)
            if r["retailer_address"]:
                parts=[x.strip() for x in r["retailer_address"].split(",")]; rc=parts[-1] if len(parts)>1 else None
                rp=ccent.get((rc.upper(),"FL")) if rc else None
                if rp: e=ret[rc.upper()]; e["lo"].append(rp[1]); e["la"].append(rp[0]); e["n"]+=1; e["t"]=max(e["t"],t); e["mx"]=max(e["mx"],lvl or 0)
        def pack(d): return [[round(statistics.mean(e["lo"]),3),round(statistics.mean(e["la"]),3),e["n"],e["t"],city,int(e["mx"])] for city,e in d.items()]
        return pack(home),pack(ret)
    D["map_home"],D["map_ret"]=geo_rows()
    # counties
    cw=defaultdict(int)
    for (z,) in con.execute("SELECT winner_zip FROM top_prize_winners WHERE winner_zip IS NOT NULL"):
        cc=z2c.get(z[:5]);
        if cc: cw[cc]+=1
    norm=lambda s:s.upper().replace(".","").replace(" ","").replace("-","")
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
    D["deadlines"]={"ending":[{"id":str(e.get("Id")),"name":e.get("GameName"),"price":e.get("TicketPrice"),
        "last_sell":(e.get("LastDayToSell") or "")[:10],"last_redeem":(e.get("LastDayToRedeem") or "")[:10]}
        for e in (deadlines.get("ending") or [])],
      "expiring":deadlines.get("expiring") or []}
    D["fl"]=fl_geo
    on=[g for g in D["games"] if g["on_sale"]]
    D["meta"]={"built":time.strftime("%Y-%m-%d"),"n_games":len(D["games"]),"n_winners":len(D["winners"]),
      "on_sale":len(on),"tp_left":sum(g["top_prizes_remaining"] or 0 for g in on),
      "value_left":sum(g["value_remaining"] or 0 for g in on)}
    # append nightly history snapshot (compact; grows ~2KB/day)
    hpath=os.path.join(PUB,"history.json")
    try: hist=json.load(open(hpath))
    except Exception: hist={"days":[]}
    today=time.strftime("%Y-%m-%d")
    if not any(d["d"]==today for d in hist["days"]):
        snap={"d":today,"g":{}}
        for g in D["games"]:
            if g["on_sale"]:
                snap["g"][g["game_no"]]=[g["top_prizes_remaining"],g["pct_value_remaining"],g["value_per_dollar_now"]]
        hist["days"].append(snap)
        json.dump(hist,open(hpath,"w"),separators=(",",":"))
    with open(os.path.join(PUB,"data.js"),"w") as f:
        f.write("const DATA="); json.dump(D,f,separators=(",",":")); f.write(";")
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
    zipmap,ccent,z2c=load_geonames()
    con,zipmap,ccent=build_db(games,parses,census,(zipmap,ccent,z2c))
    meta=emit(con,zipmap,ccent,z2c,fl_geo,deadlines)
    print("✓ refresh complete:",json.dumps(meta))

if __name__=="__main__": main()
