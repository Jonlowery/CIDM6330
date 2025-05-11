# portfolio/tests/test_utils.py
from django.test import TestCase
from decimal import Decimal, ROUND_HALF_UP, InvalidOperation
from datetime import date, timedelta
import QuantLib as ql
from unittest.mock import patch, MagicMock
import logging # Added for assertLogs logger specification

from portfolio.models import Customer, Security, Portfolio, CustomerHolding, SecurityType, InterestSchedule
from portfolio.utils import (
    get_quantlib_frequency,
    get_quantlib_day_counter,
    generate_quantlib_cashflows,
    calculate_bond_analytics
)

# Helper function to create a basic security for tests
def create_test_security(
    cusip="TESTSEC01", description="Test Security",
    issue_date=date(2020, 1, 1), maturity_date=date(2030, 1, 1),
    coupon_rate=Decimal("5.0"), payments_per_year=2, # Default PPY to a valid number
    interest_calc_code='c', # 30/360
    security_type_name="Generic Bond",
    interest_schedule_code="SEMI",
    interest_day=15,
    allows_paydown=False,
    factor=Decimal("1.0"), # Default factor to a valid number
    cpr=None,
    payment_delay_days=0,
    tax_code='t'
):
    sec_type, _ = SecurityType.objects.get_or_create(name=security_type_name, defaults={'type_id': hash(security_type_name) % 10000})
    int_sched, _ = InterestSchedule.objects.get_or_create(schedule_code=interest_schedule_code, defaults={'name': interest_schedule_code.capitalize()})

    # Ensure issue_date and maturity_date are not None before creating
    # These checks are more for awareness; DB constraints will ultimately apply.
    if issue_date is None or maturity_date is None:
        pass # DB will likely raise error if these are None and not nullable
    # Provide defaults if None is passed for fields that are likely NOT NULL in DB,
    # to allow object creation for tests that might modify to None later for logic testing.
    db_payments_per_year = payments_per_year if payments_per_year is not None else 2
    db_factor = factor if factor is not None else Decimal("1.0")


    return Security.objects.create(
        cusip=cusip,
        description=description,
        issue_date=issue_date,
        maturity_date=maturity_date,
        coupon=coupon_rate,
        payments_per_year=db_payments_per_year, # Use potentially defaulted value
        interest_calc_code=interest_calc_code,
        security_type=sec_type,
        interest_schedule=int_sched,
        interest_day=interest_day,
        allows_paydown=allows_paydown,
        payment_delay_days=payment_delay_days,
        factor=db_factor, # Use potentially defaulted value
        cpr=cpr,
        tax_code=tax_code
    )

# Helper function to create a basic holding for tests
def create_test_holding(
    security_instance, # Can be None for specific tests, but DB might not allow saving
    portfolio_instance,
    original_face_amount=Decimal("100000.00"),
    settlement_date=date(2023, 1, 1),
    market_price=Decimal("101.00"),
    market_date=date(2023, 1, 15),
    external_ticket_id=None,
    save=True # Add a save flag
):
    if external_ticket_id is None:
        # Generate a unique numeric ticket ID if not provided
        external_ticket_id = CustomerHolding.objects.count() + 77000

    holding = CustomerHolding(
        external_ticket=external_ticket_id,
        portfolio=portfolio_instance,
        security=security_instance,
        original_face_amount=original_face_amount, # This might be None if save=False
        settlement_date=settlement_date,
        market_price=market_price,
        market_date=market_date,
        intention_code='H',
        settlement_price=Decimal("100.0"),
        book_price=Decimal("100.0")
    )
    if save:
        # Ensure security_instance is not None if saving, as DB requires it
        if security_instance is None:
            # This will likely raise an IntegrityError if security_instance is None and model requires it.
            # Test logic should handle this by passing save=False for such cases.
            pass
        if original_face_amount is None:
            # This will likely raise an IntegrityError if original_face_amount is None and model requires it.
            # Test logic should handle this by passing save=False for such cases.
            pass
        holding.save()
    return holding


class QuantLibHelperFunctionTests(TestCase):
    def test_get_quantlib_frequency(self):
        self.assertEqual(get_quantlib_frequency(1), ql.Annual)
        self.assertEqual(get_quantlib_frequency(2), ql.Semiannual)
        self.assertEqual(get_quantlib_frequency(4), ql.Quarterly)
        self.assertEqual(get_quantlib_frequency(12), ql.Monthly)
        self.assertEqual(get_quantlib_frequency(None), ql.Annual)
        self.assertEqual(get_quantlib_frequency(0), ql.Annual)
        self.assertEqual(get_quantlib_frequency(-1), ql.Annual)
        self.assertEqual(get_quantlib_frequency(3), ql.Annual)
        self.assertEqual(get_quantlib_frequency("abc"), ql.Annual)
        self.assertEqual(get_quantlib_frequency(2.5), ql.Annual)

    def test_get_quantlib_day_counter(self):
        self.assertIsInstance(get_quantlib_day_counter('c'), ql.Thirty360)
        self.assertIsInstance(get_quantlib_day_counter('a'), ql.ActualActual)
        self.assertIsInstance(get_quantlib_day_counter('h'), ql.Actual365Fixed)
        self.assertIsInstance(get_quantlib_day_counter('x'), ql.ActualActual)
        self.assertIsInstance(get_quantlib_day_counter(None), ql.ActualActual)


class GenerateCashflowsTest(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.customer = Customer.objects.create(customer_number=5001, name="CF Test Cust", city="CF City", state="CF", portfolio_accounting_code="PACCFT")
        cls.portfolio = Portfolio.objects.create(owner=cls.customer, name="Cashflow Test Portfolio")

        cls.sec1 = create_test_security(
            cusip="CFSEC001", issue_date=date(2022, 1, 1), maturity_date=date(2025, 1, 1),
            coupon_rate=Decimal("4.0"), payments_per_year=2
        )
        cls.holding1 = create_test_holding(cls.sec1, cls.portfolio, settlement_date=date(2022,1,1), market_date=date(2023,6,30))

        cls.sec_zero_coupon = create_test_security(
            cusip="CFSEC002", issue_date=date(2023, 1, 1), maturity_date=date(2026, 1, 1),
            coupon_rate=Decimal("0.0"), payments_per_year=0, interest_calc_code='a'
        )
        cls.holding_zero_coupon = create_test_holding(cls.sec_zero_coupon, cls.portfolio, settlement_date=date(2023,1,1), market_date=date(2023,6,30))

        cls.sec_paydown_cpr = create_test_security(
            cusip="CFSEC003", issue_date=date(2022, 7, 1), maturity_date=date(2025, 7, 1),
            coupon_rate=Decimal("3.0"), payments_per_year=4, allows_paydown=True, cpr=Decimal("10.0"), factor=Decimal("0.9")
        )
        cls.holding_paydown_cpr = create_test_holding(cls.sec_paydown_cpr, cls.portfolio, original_face_amount=Decimal("200000"), settlement_date=date(2023,1,1), market_date=date(2023,9,30))

        cls.sec_matured = create_test_security(
            cusip="CFSEC004", issue_date=date(2020, 1, 1), maturity_date=date(2022, 1, 1),
            coupon_rate=Decimal("2.0"), payments_per_year=1
        )
        cls.holding_matured = create_test_holding(cls.sec_matured, cls.portfolio, market_date=date(2023,1,1))

    def test_generate_cashflows_simple_bond(self):
        eval_date = date(2023, 6, 30)
        combined_flows, detailed_flows, _, error = generate_quantlib_cashflows(self.holding1, eval_date)
        self.assertIsNone(error, f"Cashflow generation error: {error}")
        self.assertTrue(len(combined_flows) > 0)
        self.assertTrue(len(detailed_flows) > 0)
        # Expected payments after 2023/6/30: 2023/7/1, 2024/1/1, 2024/7/1, 2025/1/1
        self.assertEqual(len(combined_flows), 4)

        first_interest_flow_obj = next((f[0] for f in detailed_flows if f[1] == 'Interest' and f[0].date() == ql.Date(1, 7, 2023)), None)
        self.assertIsNotNone(first_interest_flow_obj, "Did not find expected interest flow for 2023-07-01")
        if first_interest_flow_obj:
             self.assertAlmostEqual(first_interest_flow_obj.amount(), 2000.00, places=2)

        principal_at_maturity = next((f[0] for f in detailed_flows if f[1] == 'Principal' and f[0].date() == ql.Date(1,1,2025)), None)
        self.assertIsNotNone(principal_at_maturity)
        if principal_at_maturity: self.assertAlmostEqual(principal_at_maturity.amount(), float(self.holding1.original_face_amount * self.sec1.factor), places=2)

    def test_generate_cashflows_zero_coupon(self):
        eval_date = date(2024, 1, 1)
        combined_flows, detailed_flows, _, error = generate_quantlib_cashflows(self.holding_zero_coupon, eval_date)
        self.assertIsNone(error)
        self.assertEqual(len(combined_flows), 1)
        self.assertEqual(len(detailed_flows), 1)
        if detailed_flows:
            self.assertEqual(detailed_flows[0][1], 'Principal')
            self.assertEqual(detailed_flows[0][0].date(), ql.Date(1,1,2026))
            self.assertAlmostEqual(detailed_flows[0][0].amount(), float(self.holding_zero_coupon.original_face_amount), places=2)

    def test_generate_cashflows_paydown_with_cpr(self):
        eval_date = date(2023, 9, 30)
        _, detailed_flows, _, error = generate_quantlib_cashflows(self.holding_paydown_cpr, eval_date)
        self.assertIsNone(error)
        self.assertTrue(len(detailed_flows) > 0)
        total_principal_paid = sum(f[0].amount() for f in detailed_flows if f[1] == 'Principal')
        expected_initial_principal = float(self.holding_paydown_cpr.original_face_amount * self.sec_paydown_cpr.factor)
        self.assertAlmostEqual(total_principal_paid, expected_initial_principal, places=2)

    def test_generate_cashflows_matured_bond(self):
        eval_date = date(2023, 1, 1)
        combined_flows, _, _, error = generate_quantlib_cashflows(self.holding_matured, eval_date)
        self.assertIsNone(error)
        self.assertEqual(len(combined_flows), 0)

    def test_generate_cashflows_eval_date_before_issue(self):
        eval_date = date(2019, 6, 30)
        _, detailed_flows, ql_settlement_date, error = generate_quantlib_cashflows(self.holding1, eval_date)
        self.assertIsNone(error)
        self.assertTrue(len(detailed_flows) > 0)
        self.assertEqual(ql_settlement_date, ql.Date.from_date(self.sec1.issue_date))

    def test_generate_cashflows_missing_or_invalid_data(self):
        _, _, _, error = generate_quantlib_cashflows(None, date.today())
        self.assertIsNotNone(error)
        self.assertIn("Missing holding or security data", error)

        bad_holding_no_sec_inst = CustomerHolding(portfolio=self.portfolio, original_face_amount=Decimal(1000))
        bad_holding_no_sec_inst.security = None 
        _, _, _, error_no_sec = generate_quantlib_cashflows(bad_holding_no_sec_inst, date.today())
        self.assertIsNotNone(error_no_sec, "Error should be returned for holding with no security.")
        self.assertIn("Missing holding or security data", error_no_sec if error_no_sec else "", "Incorrect error for missing security.")

        # Test with original_face_amount = None (unsaved instance)
        holding_no_face = create_test_holding(self.sec1, self.portfolio, original_face_amount=None, save=False)
        _, _, _, error_no_face_val = generate_quantlib_cashflows(holding_no_face, date.today())
        self.assertIsNotNone(error_no_face_val)
        self.assertIn("Invalid original_face_amount", error_no_face_val)

        # Test with original_face_amount = 0 (saved instance, as 0 is a valid Decimal but invalid logic for func)
        holding_zero_face = create_test_holding(self.sec1, self.portfolio, original_face_amount=Decimal("0.0"))
        _, _, _, error_zero_face_val = generate_quantlib_cashflows(holding_zero_face, date.today())
        self.assertIsNotNone(error_zero_face_val)
        self.assertIn("Invalid original_face_amount", error_zero_face_val)

        sec_invalid_dates1 = create_test_security(cusip="INVDATE1", issue_date=date(2023,1,1), maturity_date=date(2022,1,1))
        holding_inv_dates1 = create_test_holding(sec_invalid_dates1, self.portfolio)
        _, _, _, error = generate_quantlib_cashflows(holding_inv_dates1, date.today())
        self.assertIsNotNone(error)
        self.assertIn("Invalid dates for CUSIP INVDATE1", error)

        sec_temp_valid_dates = create_test_security(cusip="INVDATE2_TEMP")
        holding_inv_dates2 = create_test_holding(sec_temp_valid_dates, self.portfolio, save=False)
        holding_inv_dates2.security.issue_date = None
        _, _, _, error = generate_quantlib_cashflows(holding_inv_dates2, date.today())
        self.assertIsNotNone(error)
        self.assertIn("Invalid dates for CUSIP INVDATE2_TEMP", error)

        sec_temp_valid_dates_3 = create_test_security(cusip="INVDATE3_TEMP")
        holding_inv_dates3 = create_test_holding(sec_temp_valid_dates_3, self.portfolio, save=False)
        holding_inv_dates3.security.maturity_date = None
        _, _, _, error = generate_quantlib_cashflows(holding_inv_dates3, date.today())
        self.assertIsNotNone(error)
        self.assertIn("Invalid dates for CUSIP INVDATE3_TEMP", error)

        sec_no_ppy_obj = create_test_security(cusip="NOPPYSEC_TEMP", payments_per_year=2)
        holding_no_ppy = create_test_holding(sec_no_ppy_obj, self.portfolio, save=False)
        holding_no_ppy.security.payments_per_year = None
        _, _, _, error = generate_quantlib_cashflows(holding_no_ppy, date.today())
        self.assertIsNotNone(error)
        self.assertIn("Missing payments_per_year for CUSIP NOPPYSEC_TEMP", error)

        holding_no_settle = create_test_holding(self.sec1, self.portfolio, settlement_date=None, save=False) # save=False if DB disallows None
        _, _, _, error = generate_quantlib_cashflows(holding_no_settle, date.today())
        self.assertIsNotNone(error)
        self.assertIn(f"Missing settlement_date for holding {holding_no_settle.external_ticket}", error)

        sec_inv_ppy_coupon = create_test_security(cusip="INVPPYC", coupon_rate=Decimal("5.0"), payments_per_year=0)
        holding_inv_ppy_coupon = create_test_holding(sec_inv_ppy_coupon, self.portfolio)
        _, _, _, error = generate_quantlib_cashflows(holding_inv_ppy_coupon, date.today())
        self.assertIsNotNone(error)
        self.assertIn(f"Invalid payments_per_year (0) for coupon bond {sec_inv_ppy_coupon.cusip}", error)


    def test_generate_cashflows_factor_variations(self):
        sec_factor_temp = create_test_security(cusip="FACTORNONE_TEMP", factor=Decimal("1.0"))
        holding_factor_none = create_test_holding(sec_factor_temp, self.portfolio, save=False)
        holding_factor_none.security.factor = None

        _, detailed_flows, _, error = generate_quantlib_cashflows(holding_factor_none, date(2023,1,1))
        self.assertIsNone(error)
        principal_at_maturity = next((f[0] for f in detailed_flows if f[1] == 'Principal' and f[0].date() == ql.Date.from_date(holding_factor_none.security.maturity_date)), None)
        self.assertAlmostEqual(principal_at_maturity.amount(), float(holding_factor_none.original_face_amount * Decimal("1.0")), places=2)

        sec_factor_str_obj = create_test_security(cusip="FACTORSTR_TEMP", factor=Decimal("1.0"))
        holding_factor_str = create_test_holding(sec_factor_str_obj, self.portfolio, save=False)
        holding_factor_str.security.factor = "0.8" 
        
        _, detailed_flows_str, _, error_str = generate_quantlib_cashflows(holding_factor_str, date(2023,1,1))
        self.assertIsNone(error_str)
        principal_at_maturity_str = next((f[0] for f in detailed_flows_str if f[1] == 'Principal' and f[0].date() == ql.Date.from_date(holding_factor_str.security.maturity_date)), None)
        self.assertAlmostEqual(principal_at_maturity_str.amount(), float(holding_factor_str.original_face_amount * Decimal("0.8")), places=2)

        with self.assertLogs('portfolio.utils', level='WARNING') as log_capture:
            sec_factor_bad_str_obj = create_test_security(cusip="FACTORBADSTR_TEMP", factor=Decimal("1.0"))
            holding_factor_bad_str = create_test_holding(sec_factor_bad_str_obj, self.portfolio, save=False)
            holding_factor_bad_str.security.factor = "abc"

            _, detailed_flows_bad_str, _, error_bad_str = generate_quantlib_cashflows(holding_factor_bad_str, date(2023,1,1))
            self.assertIsNone(error_bad_str)
            principal_at_maturity_bad_str = next((f[0] for f in detailed_flows_bad_str if f[1] == 'Principal' and f[0].date() == ql.Date.from_date(holding_factor_bad_str.security.maturity_date)), None)
            self.assertAlmostEqual(principal_at_maturity_bad_str.amount(), float(holding_factor_bad_str.original_face_amount * Decimal("1.0")), places=2)
            self.assertTrue(any("Could not convert factor 'abc' to Decimal" in msg for msg in log_capture.output))

    def test_generate_cashflows_cpr_with_invalid_ppy(self):
        sec_cpr_no_ppy_obj = create_test_security(cusip="CPRNO_PPY_TEMP", allows_paydown=True, cpr=Decimal("10.0"), payments_per_year=2)
        holding_cpr_no_ppy = create_test_holding(sec_cpr_no_ppy_obj, self.portfolio, save=False)
        holding_cpr_no_ppy.security.payments_per_year = None

        _, _, _, error = generate_quantlib_cashflows(holding_cpr_no_ppy, date(2023,1,1))
        self.assertIsNotNone(error)
        self.assertIn("Missing payments_per_year", error)


        sec_cpr_zero_ppy = create_test_security(cusip="CPRZEROPPY", allows_paydown=True, cpr=Decimal("10.0"), payments_per_year=0, coupon_rate=Decimal("0.0"))
        holding_cpr_zero_ppy = create_test_holding(sec_cpr_zero_ppy, self.portfolio)
        with self.assertLogs('portfolio.utils', level='WARNING') as log_capture:
            _, detailed_flows, _, error_zero_ppy = generate_quantlib_cashflows(holding_cpr_zero_ppy, date(2023,1,1))
            self.assertIsNone(error_zero_ppy)
            self.assertTrue(any("Invalid payments_per_year (0) for CPR calculation" in msg for msg in log_capture.output))
            self.assertEqual(len(detailed_flows), 1)
            self.assertEqual(detailed_flows[0][1], 'Principal')


    @patch('portfolio.utils.ql.DayCounter.yearFraction')
    def test_generate_cashflows_interest_calc_exception(self, mock_year_fraction):
        mock_year_fraction.side_effect = Exception("Simulated yearFraction error")
        sec_normal_interest = create_test_security(cusip="INTEXCEPT", coupon_rate=Decimal("5.0"), payments_per_year=2)
        holding_normal_interest = create_test_holding(sec_normal_interest, self.portfolio)

        with self.assertLogs('portfolio.utils', level='ERROR') as log_capture:
            _, detailed_flows, _, error = generate_quantlib_cashflows(holding_normal_interest, date(2023,1,1))
            self.assertIsNone(error)
            self.assertTrue(any("Error calculating year fraction or interest" in msg for msg in log_capture.output))
            interest_flows = [f for f in detailed_flows if f[1] == 'Interest']
            self.assertTrue(all(abs(f[0].amount()) < 1e-6 for f in interest_flows) or not interest_flows)


class CalculateBondAnalyticsTest(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.customer = Customer.objects.create(customer_number=5002, name="Analytics Test Cust")
        cls.portfolio = Portfolio.objects.create(owner=cls.customer, name="Analytics Test Portfolio")

        cls.fixed_coupon_security = create_test_security(
            cusip="ANALYTICS1", issue_date=date(2020, 1, 1), maturity_date=date(2025, 1, 1),
            coupon_rate=Decimal("3.0"), payments_per_year=2
        )
        cls.holding_fixed = create_test_holding(
            cls.fixed_coupon_security, cls.portfolio,
            market_price=Decimal("98.5"), market_date=date(2023, 7, 1),
            settlement_date=date(2023,7,1)
        )
        
        cls.matured_sec = create_test_security(
            cusip="MATUREDSEC", issue_date=date(2020,1,1), maturity_date=date(2022,1,1), coupon_rate=Decimal("5.0"), payments_per_year=2
        )
        cls.holding_matured_for_analytics = create_test_holding(
            cls.matured_sec, cls.portfolio, market_date=date(2023,1,1)
        )

    @patch('portfolio.utils.generate_quantlib_cashflows')
    def test_calculate_analytics_success(self, mock_generate_cashflows):
        mock_eval_date_ql = ql.Date.from_date(self.holding_fixed.market_date)
        pmt_date1 = ql.Date(1, 1, 2024); pmt_date2 = ql.Date(1, 7, 2024); pmt_date3 = ql.Date(1, 1, 2025)
        actual_coupon_pmt = 1500.0; actual_principal_pmt = 100000.0
        mock_detailed_flows = [
            (ql.SimpleCashFlow(actual_coupon_pmt, pmt_date1), 'Interest'),
            (ql.SimpleCashFlow(actual_coupon_pmt, pmt_date2), 'Interest'),
            (ql.SimpleCashFlow(actual_coupon_pmt, pmt_date3), 'Interest'),
            (ql.SimpleCashFlow(actual_principal_pmt, pmt_date3), 'Principal'),
        ]
        mock_combined_flows = [
            ql.SimpleCashFlow(actual_coupon_pmt, pmt_date1),
            ql.SimpleCashFlow(actual_coupon_pmt, pmt_date2),
            ql.SimpleCashFlow(actual_coupon_pmt + actual_principal_pmt, pmt_date3),
        ]
        mock_generate_cashflows.return_value = (mock_combined_flows, mock_detailed_flows, mock_eval_date_ql, None)
        results = calculate_bond_analytics(self.holding_fixed)
        self.assertIsNone(results.get('error'), f"Analytics error: {results.get('error')}")
        self.assertIsNotNone(results.get('ytm'))
        mock_generate_cashflows.assert_called_once_with(self.holding_fixed, self.holding_fixed.market_date)


    def test_calculate_analytics_missing_invalid_inputs(self):
        holding_no_sec_inst = create_test_holding(None, self.portfolio, save=False) 
        results_no_sec = calculate_bond_analytics(holding_no_sec_inst)
        self.assertIsNotNone(results_no_sec.get('error'), "Error should be returned for holding with no security.")
        self.assertIn("Missing security data", results_no_sec.get('error', ""), "Incorrect error for missing security.")

        holding_zero_price = create_test_holding(self.fixed_coupon_security, self.portfolio, market_price=Decimal("0.0"))
        results = calculate_bond_analytics(holding_zero_price)
        self.assertIsNotNone(results.get('error'))
        self.assertIn("Missing or invalid market price", results['error'])
        
        # Test with original_face_amount = None (unsaved instance)
        holding_no_face = create_test_holding(self.fixed_coupon_security, self.portfolio, original_face_amount=None, save=False)
        results_no_face_val = calculate_bond_analytics(holding_no_face)
        self.assertIsNotNone(results_no_face_val.get('error'))
        self.assertIn("Missing or invalid original_face_amount", results_no_face_val.get('error', ""))
        
        holding_no_mkt_date = create_test_holding(self.fixed_coupon_security, self.portfolio, market_date=None)
        with patch('portfolio.utils.generate_quantlib_cashflows') as mock_gen_cf:
            mock_eval_ql_date = ql.Date.from_date(date.today())
            mock_gen_cf.return_value = ([ql.SimpleCashFlow(100000.0, ql.Date.from_date(date(2026,1,1)))], # Unscaled
                                        [(ql.SimpleCashFlow(100000.0, ql.Date.from_date(date(2026,1,1))),'Principal')], 
                                        mock_eval_ql_date, None)
            holding_no_mkt_date.market_price = Decimal("98.0") 
            results = calculate_bond_analytics(holding_no_mkt_date)
            self.assertIsNone(results.get('error')) 
            mock_gen_cf.assert_called_once_with(holding_no_mkt_date, date.today())


    @patch('portfolio.utils.generate_quantlib_cashflows')
    def test_calculate_analytics_no_cash_flows_generated(self, mock_generate_cashflows):
        mock_eval_date_ql = ql.Date.from_date(self.holding_matured_for_analytics.market_date)
        mock_generate_cashflows.return_value = ([], [], mock_eval_date_ql, None)
        results = calculate_bond_analytics(self.holding_matured_for_analytics)
        self.assertIsNotNone(results.get('error'))
        self.assertIn("No future cash flows generated for analytics", results['error'])

    @patch('portfolio.utils.generate_quantlib_cashflows')
    def test_calculate_analytics_cashflow_formatting_error(self, mock_generate_cashflows):
        mock_eval_date_ql = ql.Date.from_date(self.holding_fixed.market_date)
        
        mock_flow_obj = MagicMock(spec=ql.SimpleCashFlow)
        mock_flow_obj.amount.return_value = "NOT_A_NUMBER" 
        mock_flow_obj.date.return_value = ql.Date.from_date(date(2024,1,1))

        mock_detailed_flows = [(mock_flow_obj, 'Principal')]
        mock_combined_flows_for_test = [mock_flow_obj] 
        mock_generate_cashflows.return_value = (mock_combined_flows_for_test, mock_detailed_flows, mock_eval_date_ql, None)
        
        with self.assertLogs('portfolio.utils', level='ERROR') as log_capture:
            results = calculate_bond_analytics(self.holding_fixed)
            
            found_log = False
            for record in log_capture.records:
                if "Error formatting cash flows" in record.getMessage():
                    if record.exc_info and isinstance(record.exc_info[1], InvalidOperation):
                        found_log = True
                        break
            self.assertTrue(found_log, "Expected 'InvalidOperation' due to Decimal conversion failure in formatting error log.")
            self.assertEqual(results.get('cash_flows', None), [])

    @patch('portfolio.utils.generate_quantlib_cashflows')
    def test_calculate_analytics_cashflow_scaling_error(self, mock_generate_cashflows):
        holding_tiny_face = create_test_holding(self.fixed_coupon_security, self.portfolio, original_face_amount=Decimal("0.00000001"))
        mock_eval_date_ql = ql.Date.from_date(holding_tiny_face.market_date)
        mock_flows = [ql.SimpleCashFlow(1.0, ql.Date(1,1,2025))]
        mock_generate_cashflows.return_value = (mock_flows, [(mock_flows[0], 'Principal')], mock_eval_date_ql, None)
        results = calculate_bond_analytics(holding_tiny_face)
        self.assertIsNotNone(results.get('error'))
        self.assertIn("Error scaling cash flows", results['error'])

    def test_calculate_analytics_invalid_ppy_for_frequency(self):
        sec_no_ppy_analytics_obj = create_test_security(cusip="NOPPYANL_TEMP", payments_per_year=2) 
        
        holding_no_ppy_analytics = create_test_holding(
            sec_no_ppy_analytics_obj, 
            self.portfolio, 
            original_face_amount=Decimal("100.00"), 
            market_price=Decimal("98.00"),         
            save=True 
        )
        holding_no_ppy_analytics.security.payments_per_year = None

        with patch('portfolio.utils.generate_quantlib_cashflows') as mock_gen_cf, \
             self.assertLogs('portfolio.utils', level='WARNING') as log_capture:
            
            market_date_for_test = holding_no_ppy_analytics.market_date if holding_no_ppy_analytics.market_date else date.today()
            ql_market_date = ql.Date.from_date(market_date_for_test)
            
            maturity_dt = market_date_for_test + timedelta(days=365)
            ql_maturity_dt = ql.Date.from_date(maturity_dt)

            coupon_decimal = sec_no_ppy_analytics_obj.coupon if sec_no_ppy_analytics_obj.coupon is not None else Decimal("0.0")
            face_val_decimal = Decimal("100.00")
            
            interest_for_year = face_val_decimal * (coupon_decimal / Decimal("100.0"))
            mock_actual_flow_amount_decimal = face_val_decimal + interest_for_year
            
            mock_gen_cf.return_value = (
                [ql.SimpleCashFlow(float(mock_actual_flow_amount_decimal), ql_maturity_dt)], 
                [(ql.SimpleCashFlow(float(mock_actual_flow_amount_decimal), ql_maturity_dt), 'Combined')], 
                ql_market_date, 
                None
            )
            
            results = calculate_bond_analytics(holding_no_ppy_analytics)
            
            self.assertTrue(any("Invalid payments_per_year (None) for YTM frequency" in msg for msg in log_capture.output), "Warning for None PPY not logged.")
            self.assertIsNone(results.get('error'), f"Expected no error, but got: {results.get('error')}")
            self.assertIsNotNone(results.get('ytm'), "YTM should be calculated.")


    @patch('portfolio.utils.generate_quantlib_cashflows')
    @patch('QuantLib.CashFlows.yieldRate')
    def test_calculate_analytics_ytm_non_finite_unreasonable(self, mock_ql_yieldrate, mock_generate_cashflows):
        mock_eval_date_ql = ql.Date.from_date(self.holding_fixed.market_date)
        mock_generate_cashflows.return_value = ([ql.SimpleCashFlow(100.0, ql.Date(1,1,2025))], 
                                                [], mock_eval_date_ql, None)

        mock_ql_yieldrate.return_value = float('nan')
        results_nan = calculate_bond_analytics(self.holding_fixed)
        self.assertIsNotNone(results_nan.get('error'))
        self.assertIn("YTM calculation failed (resulted in invalid or unreasonable value", results_nan['error'])

        mock_ql_yieldrate.return_value = float('inf')
        results_inf = calculate_bond_analytics(self.holding_fixed)
        self.assertIsNotNone(results_inf.get('error'))
        self.assertIn("YTM calculation failed", results_inf['error'])
        
        mock_ql_yieldrate.return_value = 3.0 
        results_large = calculate_bond_analytics(self.holding_fixed)
        self.assertIsNotNone(results_large.get('error'))
        self.assertIn("YTM calculation failed", results_large['error'])

    @patch('portfolio.utils.generate_quantlib_cashflows')
    @patch('QuantLib.CashFlows.yieldRate')
    def test_calculate_analytics_ytm_convergence_error(self, mock_ql_yieldrate, mock_generate_cashflows):
        mock_eval_date_ql = ql.Date.from_date(self.holding_fixed.market_date)
        mock_combined_flows = [ql.SimpleCashFlow(101.5, ql.Date(1,1,2025))] 
        mock_detailed_flows = [(ql.SimpleCashFlow(101500, ql.Date(1,1,2025)), "Combined")] 
        mock_generate_cashflows.return_value = (mock_combined_flows, mock_detailed_flows, mock_eval_date_ql, None)
        mock_ql_yieldrate.side_effect = RuntimeError("convergence not reached after 100 iterations")
        results = calculate_bond_analytics(self.holding_fixed)
        self.assertIsNotNone(results.get('error'))
        self.assertIn("Yield solver did not converge", results['error'])

    @patch('portfolio.utils.generate_quantlib_cashflows')
    def test_calculate_analytics_cashflow_generation_error(self, mock_generate_cashflows):
        mock_generate_cashflows.return_value = ([], [], None, "Simulated CF Error")
        results = calculate_bond_analytics(self.holding_fixed)
        self.assertIsNotNone(results.get('error'))
        self.assertIn("Simulated CF Error", results['error'])

    @patch('portfolio.utils.generate_quantlib_cashflows')
    @patch('QuantLib.CashFlows.yieldRate') 
    def test_calculate_analytics_quantlib_runtime_error_root_not_bracketed(self, mock_ql_yieldrate, mock_generate_cashflows):
        mock_eval_date_ql = ql.Date.from_date(self.holding_fixed.market_date)
        mock_combined_flows = [ql.SimpleCashFlow(100.0, ql.Date(1,1,2025))] 
        mock_detailed_flows = [(ql.SimpleCashFlow(100000.0, ql.Date(1,1,2025)), "Principal")] 
        mock_generate_cashflows.return_value = (mock_combined_flows, mock_detailed_flows, mock_eval_date_ql, None)
        mock_ql_yieldrate.side_effect = RuntimeError("root not bracketed")
        results = calculate_bond_analytics(self.holding_fixed)
        self.assertIsNotNone(results.get('error'))
        self.assertIn("Yield solver could not bracket the root", results['error'])

