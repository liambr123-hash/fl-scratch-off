"""Offline regressions for advertised prize identity, quarantine, and closure dates."""
import copy
import importlib.util
import json
import re
import sys
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import Mock,patch


SPEC=importlib.util.spec_from_file_location("refresh",Path(__file__).resolve().parents[1]/"pipeline"/"refresh.py")
refresh=importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(refresh)


def game_fixture(game_no="1647"):
    # A complete, internally consistent small prize pool, with no jackpot claims.
    return {"Id":game_no,"GameName":"Fixture game","TicketPrice":10,"OverallOdds":9.009,
            "LaunchDate":"2026-09-01","EndDate":"2036-01-01","RedemptionDate":"2036-03-01",
            "OddsTiers":[
                {"PrizeAmount":"$1,000.00","TotalPrizes":2,"PrizesPaid":0,"PrizesRemaining":2,"WinningOdds":"1-in-1000"},
                {"PrizeAmount":"$100.00","TotalPrizes":20,"PrizesPaid":10,"PrizesRemaining":10,"WinningOdds":"1-in-100"},
                {"PrizeAmount":"$10.00","TotalPrizes":200,"PrizesPaid":100,"PrizesRemaining":100,"WinningOdds":"1-in-10"}]}


def winner(advertised):
    return {"advertised":advertised,"claim_date":"10/19/2026","seq":1,"winner_name":"Fixture winner",
            "city":"ORLANDO","state":"FL","zip":"32801","retailer_name":"Fixture store",
            "retailer_address":"1 Main St, ORLANDO","payment":"CASH OPTION","payout":"$100.00"}


class DataQualityTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name)
        self.root_patch=patch.object(refresh,"ROOT",str(self.root))
        self.root_patch.start(); self.addCleanup(self.root_patch.stop)
        self.pub_patch=patch.object(refresh,"PUB",str(self.root))
        self.pub_patch.start(); self.addCleanup(self.pub_patch.stop)

    def build(self,game,report):
        con,_,_=refresh.build_db([game],{str(game["Id"]):report},[],({},{},{}),as_of="2026-11-07")
        self.addCleanup(con.close)
        row=dict(con.execute("SELECT g.*,a.value_per_dollar_now FROM games g LEFT JOIN ticket_analysis a USING(game_no)").fetchone())
        return con,row

    def test_lower_pdf_tier_never_becomes_headline(self):
        report={"last_queried":"11/06/2026 5:51:18 AM",
                "tiers":[{"value":"$100.00","total":20,"claimed":10}],"winners":[winner("$100.00")]}
        con,row=self.build(game_fixture(),report)
        self.assertEqual((row["top_prize_display"],row["top_prizes_total"],row["top_prizes_remaining"]),("$1,000.00",2,2))
        self.assertEqual(con.execute("SELECT is_headline FROM top_prize_winners").fetchone()[0],0)
        self.assertTrue(refresh.game_quality(row,"2026-11-07")["recommendation_eligible"])

    def test_1647_advertised_top_prize_uses_api_two_of_two(self):
        game=game_fixture(); game["OddsTiers"][0].update(PrizeAmount="$15,000,000.00")
        game["OddsTiers"][1].update(PrizeAmount="$1,000,000.00",TotalPrizes=4,PrizesPaid=1,PrizesRemaining=3)
        report={"last_queried":"11/06/2026 5:51:18 AM",
                "tiers":[{"value":"$1,000,000.00","total":4,"claimed":1}],"winners":[winner("$1,000,000.00")]}
        con,row=self.build(game,report)
        self.assertEqual((row["top_prizes_total"],row["top_prizes_claimed"],row["top_prizes_remaining"]),(2,0,2))
        self.assertEqual(con.execute("SELECT is_headline FROM top_prize_winners").fetchone()[0],0)

    def test_same_amount_cash_and_life_annuity_are_different_prizes(self):
        game=game_fixture("1599")
        game["OddsTiers"][0]["PrizeAmount"]="$1,000 WK/LIFE"
        report={"last_queried":"11/06/2026","tiers":[],
                "winners":[winner("$1,000.00"),winner("$1,000.00/WK/LIFE")]}
        con,_=self.build(game,report)
        self.assertEqual([r[0] for r in con.execute("SELECT is_headline FROM top_prize_winners ORDER BY id")],[0,1])

    def test_api_counts_remain_canonical_when_matching_pdf_is_stale(self):
        report={"last_queried":"11/06/2026","tiers":[{"value":"$1,000.00","total":2,"claimed":1}],"winners":[]}
        _,row=self.build(game_fixture(),report)
        self.assertEqual(row["top_prizes_remaining"],2)
        self.assertIn("counters differ",row["data_quality"])

    def test_prelaunch_report_is_quarantined_and_has_no_estimated_payout(self):
        game=game_fixture("1384"); game["LaunchDate"]="2025-06-03"
        _,row=self.build(game,{"last_queried":"12/04/2020 2:02:02 AM","tiers":[],"winners":[]})
        self.assertIn("predates",row["data_quality"])
        self.assertIsNone(row["value_per_dollar_now"])
        self.assertEqual(refresh.game_quality(row,"2026-11-07"),{
            "recommendation_eligible":False,"source_status":"quarantined","source_report_date":"2020-12-04"})

    def test_invalid_api_counters_do_not_create_negative_or_false_depleted_jackpot(self):
        game=game_fixture(); game["OddsTiers"][0]["PrizesRemaining"]=-1
        _,row=self.build(game,{"last_queried":"11/06/2026","tiers":[],"winners":[]})
        self.assertIsNone(row["top_prizes_remaining"])
        self.assertIsNone(row["value_per_dollar_now"])
        self.assertEqual(refresh.game_quality(row,"2026-11-07")["source_status"],"quarantined")

    def test_delayed_report_marks_winners_limited_without_disabling_api_ranking(self):
        _,row=self.build(game_fixture(),{"last_queried":"10/20/2026","tiers":[],"winners":[]})
        quality=refresh.game_quality(row,"2026-11-07")
        self.assertEqual(quality["source_status"],"limited")
        self.assertTrue(quality["recommendation_eligible"])

    def test_missing_report_date_is_not_invented(self):
        _,row=self.build(game_fixture(),{"tiers":[],"winners":[]})
        quality=refresh.game_quality(row,"2026-11-07")
        self.assertIsNone(quality["source_report_date"])
        self.assertEqual(quality["source_status"],"limited")

    def test_deadline_model_uses_explicit_feed_and_inclusive_final_dates(self):
        games=[{"game_no":"5048","game_name":"Florida 300X","ticket_price":30,
                "end_date":"2036-01-01","redemption_date":"2036-03-01"}]
        feeds={"ending":[{"Id":5048,"GameName":"Florida 300X","TicketPrice":30,
                           "LastDayToSell":"2026-12-18","LastDayToRedeem":"2027-02-16"}],
               "expiring":[{"Id":7,"GameName":"Ended game","LastDayToSell":"2026-09-01","LastDayToRedeem":"2026-11-07"},
                           {"Id":8,"GameName":"Expired game","LastDayToSell":"2026-09-01","LastDayToRedeem":"2026-11-06"}]}
        model=refresh.normalize_deadlines(games,feeds,"2026-11-07")
        by_id={r["id"]:r for r in model["items"]}
        self.assertEqual(by_id["5048"]["last_sell"],"2026-12-18")
        self.assertEqual(by_id["5048"]["status"],"upcoming")
        self.assertEqual(by_id["7"]["status"],"redeemable")
        self.assertEqual(by_id["8"]["status"],"expired")
        self.assertEqual(refresh.normalize_deadlines(games,feeds,"2026-12-18")["ending"][0]["id"],"5048")
        self.assertEqual(refresh.normalize_deadlines(games,feeds,"2026-12-19")["expiring"][0]["id"],"5048")

    def test_far_future_api_placeholder_is_not_an_upcoming_reminder(self):
        model=refresh.normalize_deadlines([{"game_no":"1","end_date":"2036-01-01","redemption_date":"2036-03-01"}],{},"2026-11-07")
        self.assertEqual(model["items"],[])

    def test_emitted_game_flags_and_dates_use_the_same_deadline_model(self):
        con,_=self.build(game_fixture(),{"last_queried":"11/06/2026","tiers":[],"winners":[]})
        feeds={"ending":[{"Id":1647,"LastDayToSell":"2026-11-06","LastDayToRedeem":"2027-01-05"}]}
        def clock(fmt,*args):
            return "2026-11-07T12:00:00Z" if "T" in fmt else "2026-11-07"
        home_builder=Mock()
        home_module=types.ModuleType("pipeline.build_site")
        home_module.build_site=home_builder
        with patch.object(refresh.time,"strftime",side_effect=clock),patch.object(refresh,"write_stub_pages"), \
                patch.dict(sys.modules,{"pipeline.build_site":home_module}):
            meta=refresh.emit(con,{},{},{},{},feeds)
        data=json.loads((self.root/"data.js").read_text().removeprefix("const DATA=").rstrip(";"))
        game=data["games"][0]
        self.assertEqual(game["end_date"],"2026-11-06")
        self.assertEqual(game["redemption_date"],"2027-01-05")
        self.assertEqual(game["on_sale"],0)
        self.assertFalse(game["recommendation_eligible"])
        self.assertEqual(data["deadlines"]["items"][0]["status"],"redeemable")
        self.assertEqual(meta["on_sale"],0)
        self.assertEqual(meta["recommendation_eligible"],0)
        home_builder.assert_called_once()
        self.assertEqual(home_builder.call_args.args[0],data)

    def test_deadline_landing_lists_future_endings_and_has_real_empty_state(self):
        game={"game_no":"5048","game_name":"Florida 300X","ticket_price":30,"on_sale":1}
        model=refresh.normalize_deadlines([game],{"ending":[{"Id":5048,"LastDayToSell":"2026-12-18","LastDayToRedeem":"2027-02-16"}]},"2026-11-07")
        data={"games":[game],"tiers":{},"deadlines":model,"meta":{"built":"2026-11-07"}}
        refresh.write_landing_pages(data)
        page=(self.root/"florida-scratch-offs-ending-soon.html").read_text()
        self.assertIn("2026-12-18",page)
        self.assertIn("Sales ending",page)
        self.assertNotIn("games that have ended sales",page)
        data=copy.deepcopy(data);data["deadlines"]={"items":[]}
        refresh.write_landing_pages(data)
        page=(self.root/"florida-scratch-offs-ending-soon.html").read_text()
        self.assertIn("No upcoming sales endings",page)
        self.assertNotIn("<tbody></tbody>",page)

    def test_category_rankings_use_estimated_payout_and_exclude_unverified_records(self):
        common={"ticket_price":5,"on_sale":1,"top_prize_display":"$1,000,000",
                "top_prize_value_num":1000000,"top_prizes_total":4,"overall_odds_1_in":4}
        high={**common,"game_no":"1001","game_name":"Higher payout","launch_date":"2026-08-01",
              "value_per_dollar_now":0.90,"pct_value_remaining":1,"top_prizes_remaining":0,"recommendation_eligible":True}
        fresh={**common,"game_no":"1002","game_name":"Fresher pool","launch_date":"2026-09-01",
               "value_per_dollar_now":0.80,"pct_value_remaining":100,"top_prizes_remaining":4,"recommendation_eligible":True}
        invalid={**common,"game_no":"1384","game_name":"Unverified recent record","launch_date":"2026-11-01",
                 "value_per_dollar_now":1.10,"top_prizes_remaining":4,"recommendation_eligible":False}
        refresh.write_landing_pages({"games":[fresh,invalid,high],"tiers":{},"deadlines":{"items":[]},
                                     "meta":{"built":"2026-11-06"}})
        price=(self.root/"florida-5-scratch-offs.html").read_text()
        body=re.search(r"<tbody>(.*?)</tbody>",price,re.S).group(1)
        self.assertLess(body.index("Higher payout"),body.index("Fresher pool"))
        self.assertNotIn("Unverified recent record",price)
        self.assertNotIn("Value Score",price)
        self.assertIn("Est. payout per $1",price)
        self.assertIn("Published overall odds",price)
        newest=(self.root/"new-florida-scratch-offs.html").read_text()
        self.assertNotIn("Unverified recent record",newest)
        self.assertNotIn("live odds match",newest)
        self.assertNotIn("Value Score",newest)
        best=(self.root/"best-value.html").read_text()
        self.assertNotIn("Unverified recent record",best)
        self.assertIn("Estimated payout is a modeled average",best)

    def test_game_pages_label_estimates_and_quarantined_records_have_no_game_comparison_cta(self):
        base={"game_no":"1647","game_name":"Verified fixture","ticket_price":30,"on_sale":1,
              "top_prize_display":"$15,000,000.00","top_prize_value_num":15000000,
              "top_prizes_total":2,"top_prizes_remaining":2,"overall_odds_1_in":2.85,
              "last_queried":"11/06/2026","launch_date":"2026-09-21",
              "value_per_dollar_now":0.81,"recommendation_eligible":True,"source_status":"verified"}
        tiers=[["$15,000,000.00",15000000,7953060,2,2,0]]
        page=refresh._stub_html(base,tiers,"https://flscratchstats.com/og/1647.png")
        self.assertIn("estimated payout is $0.81 per $1",page)
        self.assertIn('href="/#methodology"',page)
        self.assertNotIn("Value Score",page)
        invalid={**base,"game_no":"1384","game_name":"Unverified fixture","source_status":"quarantined",
                 "last_queried":"12/04/2020","launch_date":"2025-06-03","value_per_dollar_now":None,
                 "recommendation_eligible":False,"data_quality":"Quarantined: winner report predates launch."}
        page=refresh._stub_html(invalid,tiers,"https://flscratchstats.com/og/1384.png")
        self.assertIn("Archived, unverified source record",page)
        self.assertIn("Do not use its odds, prize counts, or dates as current purchase information",page)
        self.assertIn("Prize tiers &amp; odds",page)
        self.assertNotIn('/#game/1384',page)
        self.assertNotIn("Explore this game",page)
        self.assertIn("Verify the official game record",page)
        self.assertIn("before the recorded launch date",page)
        self.assertNotIn("degenerate",page)
        self.assertNotIn("Value Score",page)
        card=refresh._og_svg(base,tiers)
        self.assertNotIn("VALUE SCORE",card)
        self.assertIn("EST. PAYOUT / $1",card)

    def test_png_cache_validates_its_rendered_svg_source(self):
        try:
            import PIL  # noqa: F401
        except ImportError:
            self.skipTest("Pillow is an optional local OG renderer")
        card='<svg xmlns="http://www.w3.org/2000/svg"><text x="80" y="110" font-size="30">2 top prizes left</text></svg>'
        path=self.root/"card.png"
        self.assertFalse(refresh._png_matches_svg(path,card))
        self.assertTrue(refresh._svg_to_png(card,path))
        self.assertTrue(refresh._png_matches_svg(path,card))
        self.assertFalse(refresh._png_matches_svg(path,card.replace("2 top","3 top")))


if __name__=="__main__":
    unittest.main()
