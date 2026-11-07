import copy
import unittest

from pipeline.snapshot import repair_snapshot


def snapshot_fixture():
    return {
        "meta":{"built":"2026-11-06","built_at":"2026-11-06T21:07:54Z","winners_stale":0},
        "games":[
            {"game_no":"1647","game_name":"$15,000,000 PLATINUM PAYOUT","ticket_price":30,
             "top_prize_display":"$15,000,000.00","top_prize_value_num":15000000,
             "top_prizes_total":4,"top_prizes_claimed":1,"top_prizes_remaining":3,
             "launch_date":"2026-09-21","end_date":"2036-05-24","redemption_date":"2036-07-23",
             "on_sale":1,"last_queried":"11/06/2026 5:51:18 AM","value_per_dollar_now":0.81,
             "value_remaining":331706630,"data_quality":None},
            {"game_no":"1384","game_name":"Unverified source","ticket_price":5,
             "top_prize_display":"$500,000.00","top_prize_value_num":500000,
             "top_prizes_total":None,"top_prizes_claimed":None,"top_prizes_remaining":None,
             "launch_date":"2025-06-03","on_sale":1,"last_queried":"12/04/2020 2:02:02 AM",
             "value_per_dollar_now":None,"value_remaining":None,"data_quality":"EV not computed (degenerate odds table)."},
            {"game_no":"1599","game_name":"$1,000 A WEEK FOR LIFE","ticket_price":2,
             "top_prize_display":"$1,000 WK/LIFE","top_prize_value_num":952800,
             "top_prizes_total":4,"top_prizes_claimed":3,"top_prizes_remaining":1,
             "launch_date":"2025-07-01","on_sale":1,"last_queried":"11/06/2026 5:00:00 AM",
             "value_per_dollar_now":0.77,"value_remaining":1000000,"data_quality":None}],
        "tiers":{
            "1647":[["$15,000,000.00",15000000,7953060,2,2,0],
                    ["$1,000,000.00",1000000,3976530,3,4,1]],
            "1384":[["$500,000.00",500000,None,0,0,0]],
            # The cash-repriced top annuity is smaller numerically than the cash
            # second tier; official tier order and advertised units must win.
            "1599":[["$1,000 WK/LIFE",952800,5591775,1,4,3],
                    ["$2,000,000.00",2000000,10000000,1,2,1]]},
        "winners":[["1647","2026-10-19","Fixture winner","ORLANDO","FL","$1,000,000.00",1000000,"CASH OPTION","$640,000",1,"Store","Address"],
                   ["1599","2025-07-14","Fixture winner","ORLANDO","FL","$1,000.00 WK/LIFE",1000,"CASH OPTION","$779,200",1,"Store","Address"]],
        "deadlines":{"ending":[{"id":"1647","name":"$15,000,000 PLATINUM PAYOUT","price":30,
                                  "last_sell":"2026-12-18","last_redeem":"2027-02-16"}],"expiring":[]},
        "history":{"days":[{"d":"2026-11-05","g":{"1647":[3,87,0.81]}}]}}


class SnapshotTests(unittest.TestCase):
    def test_repairs_identity_without_inventing_a_source_refresh_or_mutating_input(self):
        data=snapshot_fixture(); before=copy.deepcopy(data)
        result=repair_snapshot(data)
        self.assertEqual(data,before)
        self.assertEqual(result["meta"]["built"],"2026-11-06")
        self.assertEqual(result["meta"]["built_at"],"2026-11-06T21:07:54Z")
        game=result["games"][0]
        self.assertEqual((game["top_prizes_total"],game["top_prizes_claimed"],game["top_prizes_remaining"]),(2,0,2))
        self.assertEqual(result["winners"][0][9],0)
        self.assertEqual(result["winners"][1][9],1)

    def test_repair_is_idempotent_and_preserves_claim_history(self):
        data=snapshot_fixture()
        result=repair_snapshot(data)
        self.assertEqual(repair_snapshot(result),result)
        self.assertEqual(result["history"],data["history"])
        self.assertFalse(result["games"][0]["history_comparable"])
        self.assertIn("1647",result["meta"]["history_exclusions"])
        self.assertTrue(result["games"][2]["history_comparable"])

    def test_quarantine_and_deadlines_are_applied_from_saved_evidence(self):
        result=repair_snapshot(snapshot_fixture(),as_of="2026-11-07")
        self.assertEqual(result["games"][1]["source_status"],"quarantined")
        self.assertFalse(result["games"][1]["recommendation_eligible"])
        self.assertEqual(result["meta"]["quarantined"],1)
        self.assertEqual(result["games"][0]["end_date"],"2026-12-18")
        self.assertEqual(result["deadlines"]["items"][0]["status"],"upcoming")
        later=repair_snapshot(result,as_of="2027-02-17")
        self.assertEqual(later["deadlines"]["items"][0]["status"],"expired")
        self.assertEqual(repair_snapshot(later,as_of="2027-02-17"),later)
        self.assertEqual(later["meta"]["built"],"2026-11-06")

    def test_cash_repriced_annuity_is_not_replaced_by_larger_cash_second_tier(self):
        game=repair_snapshot(snapshot_fixture())["games"][2]
        self.assertEqual(game["top_prize_display"],"$1,000 WK/LIFE")
        self.assertEqual(game["top_prize_value_num"],952800)
        self.assertEqual((game["top_prizes_total"],game["top_prizes_remaining"]),(4,1))

    def test_unknown_source_date_requires_explicit_interpretation_date(self):
        with self.assertRaises(ValueError): repair_snapshot({"games":[],"tiers":{}})
        result=repair_snapshot({"games":[],"tiers":{}},as_of="2026-11-07")
        self.assertNotIn("built",result["meta"])
        self.assertNotIn("built_at",result["meta"])


if __name__=="__main__":
    unittest.main()
