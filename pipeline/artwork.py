#!/usr/bin/env python3
"""Cache unchanged official ticket teasers; fetch only missing or unusable entries."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import re
import urllib.error
import urllib.parse
import urllib.request


SITE="https://floridalottery.com"
CMS_LIST=SITE+"/content/flalottery-web/us/en/games/scratch-offs/view.scratch-offs.json"
ART_PREFIX="/content/dam/flalottery-web/images/games/scratch-offs/"
MAX_BYTES=2*1024*1024
TIMEOUT=20


def _game_id(value):
    value=str(value or "")
    return value if re.fullmatch(r"[0-9]{1,8}",value) else None


def _trusted_image_url(value):
    if not isinstance(value,str): return False
    try:
        parsed=urllib.parse.urlsplit(value)
        decoded=parsed.path
        for _ in range(5):
            next_path=urllib.parse.unquote(decoded)
            if next_path==decoded: break
            decoded=next_path
        return (parsed.scheme=="https" and parsed.netloc=="floridalottery.com"
                and not parsed.query and not parsed.fragment
                and parsed.path.startswith(ART_PREFIX) and decoded.startswith(ART_PREFIX)
                and ".." not in decoded.split("/") and "\\" not in decoded
                and not re.search(r"%(?:2e|2f|5c)",decoded,re.I)
                and not any(ord(char)<32 or ord(char)==127 for char in value+decoded))
    except ValueError: return False


class _OfficialRedirects(urllib.request.HTTPRedirectHandler):
    def __init__(self,allowed): self.allowed=allowed

    def redirect_request(self,request,fp,code,msg,headers,newurl):
        if not self.allowed(newurl):
            raise urllib.error.HTTPError(newurl,code,"Artwork redirect left the official source",headers,fp)
        return super().redirect_request(request,fp,code,msg,headers,newurl)


def _fetch(url,image=False):
    allowed=_trusted_image_url if image else lambda candidate:candidate==CMS_LIST
    if not allowed(url): raise ValueError("Artwork URL is outside the official source")
    opener=urllib.request.build_opener(_OfficialRedirects(allowed))
    request=urllib.request.Request(url,headers={"User-Agent":"Mozilla/5.0 (FL Scratch Stats artwork cache)",
                                                "Accept":"image/jpeg" if image else "application/json"})
    with opener.open(request,timeout=TIMEOUT) as response:
        if not allowed(response.geturl()): raise ValueError("Artwork response left the official source")
        length=response.headers.get("Content-Length")
        if length and int(length)>MAX_BYTES: raise ValueError("Artwork response exceeds 2 MiB")
        body=response.read(MAX_BYTES+1)
        if len(body)>MAX_BYTES: raise ValueError("Artwork response exceeds 2 MiB")
        if image and response.headers.get_content_type() not in ("image/jpeg","image/jpg"):
            raise ValueError("Official artwork response is not a JPEG")
        return body


def _jpeg(body):
    """Check container boundaries without decoding or changing the official image."""
    return 128<=len(body)<=MAX_BYTES and body.startswith(b"\xff\xd8") and body.endswith(b"\xff\xd9")


def _cached(public_dir,gid,entry):
    if not isinstance(entry,dict) or entry.get("thumb")!=f"/assets/tickets/{gid}.jpg": return False
    if not _trusted_image_url(entry.get("source")): return False
    if entry.get("page")!=f"{SITE}/games/scratch-offs/view?id={gid}": return False
    path=public_dir/"assets"/"tickets"/(gid+".jpg")
    try:
        if path.is_symlink() or path.stat().st_size>MAX_BYTES: return False
        return _jpeg(path.read_bytes())
    except OSError: return False


def _write_json(path,data):
    encoded=json.dumps(data,indent=2,sort_keys=True)+"\n"
    if path.exists() and path.read_text(encoding="utf-8")==encoded: return
    temporary=path.with_name(path.name+".tmp")
    temporary.write_text(encoded,encoding="utf-8")
    temporary.replace(path)


def ensure_artwork(public_dir,games):
    """Return trusted cached artwork, preserving previous files on any fetch failure.

    The CMS supplies every exact image URL. No image filename is guessed from a game
    number. A complete cache performs no network requests and no file writes.
    """
    public_dir=Path(public_dir)
    manifest=public_dir/"artwork.json"
    try:
        previous=json.loads(manifest.read_text(encoding="utf-8")) if manifest.exists() else {}
        if not isinstance(previous,dict): raise ValueError("Artwork manifest must be an object")
    except (OSError,ValueError) as error:
        print(f"Artwork: keeping existing manifest after read failure ({type(error).__name__}).")
        return {}
    mapping={gid:entry for raw_id,entry in previous.items()
             if (gid:=_game_id(raw_id)) and _cached(public_dir,gid,entry)}
    requested={gid for game in games if (gid:=_game_id(game.get("game_no")))}
    missing=sorted(requested-set(mapping))
    if not missing: return mapping
    try:
        payload=json.loads(_fetch(CMS_LIST))
        if not isinstance(payload,dict): raise ValueError("Official CMS response is not an object")
        records=payload.get("data")
        if not isinstance(records,list): raise ValueError("Official CMS response has no game list")
        sources={}
        for record in records:
            if not isinstance(record,dict): continue
            gid=_game_id(record.get("id"))
            value=record.get("teaserImage")
            if gid not in requested or not isinstance(value,str): continue
            source=urllib.parse.urljoin(SITE,value)
            if _trusted_image_url(source): sources[gid]=source
    except (OSError,ValueError,TypeError) as error:
        print(f"Artwork: source unavailable; keeping cached images ({type(error).__name__}).")
        return mapping
    tickets=public_dir/"assets"/"tickets"
    tickets.mkdir(parents=True,exist_ok=True)

    def download(gid):
        source=sources.get(gid)
        if not source: return gid,None
        try:
            body=_fetch(source,image=True)
            if not _jpeg(body): raise ValueError("Official JPEG is incomplete or invalid")
            path=tickets/(gid+".jpg")
            temporary=path.with_name(path.name+".tmp")
            temporary.write_bytes(body)
            temporary.replace(path)
            return gid,{"thumb":f"/assets/tickets/{gid}.jpg","source":source,
                        "page":f"{SITE}/games/scratch-offs/view?id={gid}"}
        except (OSError,ValueError) as error:
            print(f"Artwork: keeping prior image for game {gid} ({type(error).__name__}).")
            return gid,None

    with ThreadPoolExecutor(max_workers=4) as pool:
        for gid,entry in pool.map(download,missing):
            if entry is not None: mapping[gid]=entry
    # Do not replace a previous manifest merely because an image/source was unavailable.
    updated=dict(previous)
    updated.update(mapping)
    if updated!=previous or not manifest.exists(): _write_json(manifest,updated)
    unavailable=sorted(requested-set(mapping))
    print(f"Artwork: {len(requested)-len(unavailable)}/{len(requested)} games cached"
          +(f"; unavailable: {', '.join(unavailable)}" if unavailable else ""))
    return mapping


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--public-dir",type=Path,default=Path(__file__).resolve().parents[1]/"public")
    args=parser.parse_args()
    data=json.loads((args.public_dir/"data.json").read_text(encoding="utf-8"))
    ensure_artwork(args.public_dir,data["games"])


if __name__=="__main__":
    main()
