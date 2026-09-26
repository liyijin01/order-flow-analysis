import io
import unittest

from pipeline.ladder import parse_aggtrades_csv


class LadderTests(unittest.TestCase):
    def test_header_csv_maps_maker_true_to_taker_sell(self):
        csv_text = (
            "agg_trade_id,price,quantity,first_trade_id,last_trade_id,transact_time,is_buyer_maker\n"
            "1,100.25,2.5,10,11,1000,true\n"
            "2,100.75,1.5,12,12,1001,false\n"
        )
        ladder = parse_aggtrades_csv(io.StringIO(csv_text))
        self.assertEqual(ladder[100], [1.5, 2.5])

    def test_headerless_csv_maps_maker_true_to_taker_sell(self):
        csv_text = (
            "1,100.25,2.5,10,11,1000,true\n"
            "2,101.10,1.5,12,12,1001,false\n"
        )
        ladder = parse_aggtrades_csv(io.StringIO(csv_text))
        self.assertEqual(ladder[100], [0.0, 2.5])
        self.assertEqual(ladder[101], [1.5, 0.0])

    def test_existing_one_usdt_floor_binning_is_preserved(self):
        csv_text = (
            "1,100.99,1,10,10,1000,false\n"
            "2,101.00,2,11,11,1001,false\n"
        )
        ladder = parse_aggtrades_csv(io.StringIO(csv_text))
        self.assertEqual(ladder[100], [1.0, 0.0])
        self.assertEqual(ladder[101], [2.0, 0.0])


if __name__ == "__main__":
    unittest.main()
