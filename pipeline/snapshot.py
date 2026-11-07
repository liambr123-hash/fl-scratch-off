#!/usr/bin/env python3
"""Repair a saved source snapshot without fetching data or inventing a refresh date.

The scheduled refresh uses the official API directly. This bridge applies the same
prize-identity and quality rules to an already committed DATA object for a UI release.
It never reads or writes history.json, and corrected counters are not claim events.
"""
import argparse
import copy
import json
from pathlib import Path
import re

try:
    from .refresh import api_headline_counts,game_quality,iso_date,normalize_deadlines,prize_identity
except ImportError:  # python3 pipeline/snapshot.py
    from refresh import api_headline_counts,game_quality,iso_date,normalize_deadlines,prize_identity


ANALYSIS_FIELDS=("est_tickets_printed","est_tickets_remaining","pct_tickets_remaining",
                 "value_original","value_remaining","pct_value_remaining","ev_per_ticket_now",
                 "value_per_dollar_original","value_per_dollar_now")


def _note(game,text):
    notes=[n.strip() for n in (game.get("data_quality") or "").split(" | ") if n.strip()]
    if text not in notes: notes.append(text)
    game["data_quality"]=" | ".join(notes)


def repair_snapshot(data,as_of=None):
    """Return a repaired deep copy, preserving the original source build timestamps.

    ``as_of`` controls deadline/quality interpretation, never source freshness metadata.
    It defaults to the snapshot's own source date so repeated UI-only builds are stable.
    The first positional prize tier remains the official advertised headline tier;
    comparing cash-repriced numeric values would misidentify life-annuity games.
    """
    result=copy.deepcopy(data)
    meta=result.setdefault("meta",{})
    source_day=iso_date(as_of) or iso_date(meta.get("built")) or iso_date(meta.get("built_at"))
    if source_day is None:
        raise ValueError("Snapshot requires meta.built/meta.built_at or an explicit as_of date")
    games=result.get("games") or []
    tiers=result.get("tiers") or {}
    identities={}
    for game in games:
        gid=str(game.get("game_no",""))
        pool=tiers.get(gid) or []
        top=pool[0] if pool else []
        before=tuple(game.get(key) for key in ("top_prizes_total","top_prizes_claimed","top_prizes_remaining"))
        if len(top)>=5:
            game["top_prize_display"]=top[0]
            game["top_prize_value_num"]=top[1]
            total,paid,remaining=api_headline_counts({"TotalPrizes":top[4],"PrizesRemaining":top[3],
                                                     "PrizesPaid":top[5] if len(top)>5 else None})
        else:
            total=paid=remaining=None
        game.update(top_prizes_total=total,top_prizes_claimed=paid,top_prizes_remaining=remaining)
        identities[gid]=prize_identity(game.get("top_prize_display"))
        if total is None:
            _note(game,"Quarantined: the official headline prize counters are missing or inconsistent.")
        report=iso_date(game.get("last_queried")); launch=iso_date(game.get("launch_date"))
        if report and launch and report<launch:
            _note(game,f"Quarantined: winner report dated {report} predates this game's {launch} launch.")
        if "Quarantined:" in (game.get("data_quality") or ""):
            for key in ANALYSIS_FIELDS: game[key]=None
            _note(game,"Estimated payout withheld until the source discrepancy is resolved.")
        changed=before!=(total,paid,remaining)
        # A model correction is not evidence of a newly claimed prize. Keep this guard
        # on reruns until a future refresh has accumulated genuinely comparable history.
        game["history_comparable"]=bool(game.get("history_comparable",True) and not changed
                                         and "Quarantined:" not in (game.get("data_quality") or ""))
        if not game["history_comparable"]:
            game["history_note"]="Prior snapshots may use a different prize tier; no claim change is inferred."

    winners=[]
    for winner in result.get("winners") or []:
        row=list(winner)
        if len(row)>9 and str(row[0]) in identities:
            advertised=prize_identity(row[5])
            row[9]=int(advertised[0] is not None and advertised==identities[str(row[0])])
        winners.append(row)
    result["winners"]=winners

    existing=result.get("deadlines") or {}
    feeds={"ending":existing["items"]} if "items" in existing else {
        "ending":existing.get("ending") or [],
        "expiring":(existing.get("expiring") or [])+(existing.get("expired") or [])}
    result["deadlines"]=normalize_deadlines(games,feeds,source_day)
    closures={item["id"]:item for item in result["deadlines"]["items"]}
    for game in games:
        closure=closures.get(str(game.get("game_no")))
        if closure:
            if closure["last_sell"]:
                game["end_date"]=closure["last_sell"]
                game["on_sale"]=int(closure["last_sell"]>=source_day)
            if closure["last_redeem"]: game["redemption_date"]=closure["last_redeem"]
        game.update(game_quality(game,source_day))
    active=[game for game in games if game.get("on_sale")]
    meta.update(n_games=len(games),n_winners=len(winners),on_sale=len(active),
                tp_left=sum(game.get("top_prizes_remaining") or 0 for game in active),
                value_left=sum(game.get("value_remaining") or 0 for game in active),
                quarantined=sum(game["source_status"]=="quarantined" for game in games),
                recommendation_eligible=sum(game["recommendation_eligible"] for game in games),
                history_exclusions=sorted(str(game["game_no"]) for game in games if not game["history_comparable"]))
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input",required=True,type=Path,help="Existing data.js or JSON snapshot")
    parser.add_argument("--output",required=True,type=Path,help="Output .js (const DATA) or .json file")
    parser.add_argument("--as-of",help="Date for deadline interpretation; source timestamps are preserved")
    args=parser.parse_args()
    text=args.input.read_text(encoding="utf-8").strip()
    if text.startswith("const DATA"):
        text=re.sub(r"^const\s+DATA\s*=\s*","",text).removesuffix(";").strip()
    repaired=repair_snapshot(json.loads(text),args.as_of)
    payload=json.dumps(repaired,separators=(",",":"))
    if args.output.suffix==".js": payload="const DATA="+payload+";"
    temporary=args.output.with_name(args.output.name+".tmp")
    temporary.write_text(payload,encoding="utf-8")
    temporary.replace(args.output)
    print(f"Repaired {len(repaired.get('games') or [])} games; source date remains {repaired['meta'].get('built','unknown')}.")


if __name__=="__main__":
    main()
