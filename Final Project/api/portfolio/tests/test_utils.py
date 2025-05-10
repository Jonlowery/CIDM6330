# portfolio/tests/test_utils.py
from django.test import TestCase
from decimal import Decimal, ROUND_HALF_UP
from datetime import date
import QuantLib as ql # Make sure QuantLib is importable in your test environment

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
    coupon_rate=Decimal("5.0"), payments_per_year=2,
    interest_calc_code='c', # 30/360
    day_count_basis=ql.Thirty360.BondBasis, # Example, align with interest_calc_code
    security_type_name="Generic Bond",
    interest_schedule_code="SEMI",
    interest_day=15,
    allows_paydown=False,
    factor=Decimal("1.0"),
    cpr=None
):
    sec_type, _ = SecurityType.objects.get_or_create(name=security_type_name, defaults={'type_id': hash(security_type_name) % 10000})
    int_sched, _ = InterestSchedule.objects.get_or_create(schedule_code=interest_schedule_code, defaults={'name': interest_schedule_code.capitalize()})

    return Security.objects.create(
        cusip=cusip,
        description=description,
        issue_date=issue_date,
        maturity_date=maturity_date,
        coupon=coupon_rate,
        payments_per_year=payments_per_year,
        interest_calc_code=interest_calc_code,
        security_type=sec_type,
        interest_schedule=int_sched,
        interest_day=interest_day,
        allows_paydown=allows_paydown,
        payment_delay_days=0, # Assuming 0 for simplicity
        factor=factor,
        cpr=cpr,
        tax_code='t' # Default tax_code
    )

# Helper function to create a basic holding for tests
def create_test_holding(
    security_instance,
    portfolio_instance,
    original_face_amount=Decimal("100000.00"),
    settlement_date=date(2023, 1, 1),
    market_price=Decimal("101.00"),
    market_date=date(2023, 1, 15), # Should be >= settlement_date for analytics
    external_ticket_id=None
):
    if external_ticket_id is None:
        external_ticket_id = CustomerHolding.objects.count() + 77000 # Ensure unique

    return CustomerHolding.objects.create(
        external_ticket=external_ticket_id,
        portfolio=portfolio_instance,
        security=security_instance,
        original_face_amount=original_face_amount,
        settlement_date=settlement_date,
        market_price=market_price,
        market_date=market_date,
        # Add other required fields with sensible defaults
        intention_code='H', # Held to Maturity
        settlement_price=Decimal("100.0"), # Example
        book_price=Decimal("100.0") # Example
    )


class QuantLibHelperFunctionTests(TestCase):
    def test_get_quantlib_frequency(self):
        self.assertEqual(get_quantlib_frequency(1), ql.Annual)
        self.assertEqual(get_quantlib_frequency(2), ql.Semiannual)
        self.assertEqual(get_quantlib_frequency(4), ql.Quarterly)
        self.assertEqual(get_quantlib_frequency(12), ql.Monthly)
        self.assertEqual(get_quantlib_frequency(None), ql.Annual) # Test default for None
        self.assertEqual(get_quantlib_frequency(0), ql.Annual)   # Test default for invalid (0)
        self.assertEqual(get_quantlib_frequency(-1), ql.Annual)  # Test default for invalid (negative)
        self.assertEqual(get_quantlib_frequency(3), ql.Annual)   # Test default for unsupported PPY

    def test_get_quantlib_day_counter(self):
        self.assertIsInstance(get_quantlib_day_counter('c'), ql.Thirty360)
        self.assertIsInstance(get_quantlib_day_counter('a'), ql.ActualActual)
        self.assertIsInstance(get_quantlib_day_counter('h'), ql.Actual365Fixed)
        # Test default for unsupported code
        self.assertIsInstance(get_quantlib_day_counter('x'), ql.ActualActual) # Default is ActualActual.ISMA
        self.assertIsInstance(get_quantlib_day_counter(None), ql.ActualActual)


class GenerateCashflowsTest(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.customer = Customer.objects.create(customer_number=5001, name="CF Test Cust", city="CF City", state="CF", portfolio_accounting_code="PACCFT")
        cls.portfolio = Portfolio.objects.create(owner=cls.customer, name="Cashflow Test Portfolio")

        # Security 1: Simple semi-annual bond
        cls.sec1 = create_test_security(
            cusip="CFSEC001", description="Semi-Annual Fixed Coupon Bond",
            issue_date=date(2022, 1, 1), maturity_date=date(2025, 1, 1), # 3 years
            coupon_rate=Decimal("4.0"), payments_per_year=2, interest_calc_code='c'
        )
        cls.holding1 = create_test_holding(cls.sec1, cls.portfolio, settlement_date=date(2022,1,1), market_date=date(2023,6,30))

        # Security 2: Zero coupon bond (set coupon=0, ppy=0 or 1 depending on your model/utils logic)
        cls.sec2 = create_test_security(
            cusip="CFSEC002", description="Zero Coupon Bond",
            issue_date=date(2023, 1, 1), maturity_date=date(2026, 1, 1),
            coupon_rate=Decimal("0.0"), payments_per_year=0, # Or 1 if ppy=0 is problematic
            interest_calc_code='a'
        )
        cls.holding2 = create_test_holding(cls.sec2, cls.portfolio, settlement_date=date(2023,1,1), market_date=date(2023,6,30))

        # Security 3: Paydown security with CPR
        cls.sec3 = create_test_security(
            cusip="CFSEC003", description="Paydown Bond with CPR",
            issue_date=date(2022, 7, 1), maturity_date=date(2025, 7, 1),
            coupon_rate=Decimal("3.0"), payments_per_year=4, # Quarterly
            allows_paydown=True, cpr=Decimal("10.0"), factor=Decimal("0.9") # 10% CPR, already paid down a bit
        )
        cls.holding3 = create_test_holding(cls.sec3, cls.portfolio, original_face_amount=Decimal("200000"), settlement_date=date(2023,1,1), market_date=date(2023,9,30))

        # Security 4: Bond that has already matured from evaluation date
        cls.sec4 = create_test_security(
            cusip="CFSEC004", description="Matured Bond",
            issue_date=date(2020, 1, 1), maturity_date=date(2022, 1, 1),
            coupon_rate=Decimal("2.0"), payments_per_year=1
        )
        cls.holding4 = create_test_holding(cls.sec4, cls.portfolio, market_date=date(2023,1,1))


    def test_generate_cashflows_simple_bond(self):
        eval_date = date(2023, 6, 30) # Mid-way through holding1's life
        combined_flows, detailed_flows, ql_settlement_date, error = generate_quantlib_cashflows(self.holding1, eval_date)

        self.assertIsNone(error, f"Cashflow generation error: {error}")
        self.assertTrue(len(combined_flows) > 0, "Expected some combined cash flows")
        self.assertTrue(len(detailed_flows) > 0, "Expected some detailed cash flows")

        # Example assertions (these will need to be precise based on expected calculations)
        # First payment after eval_date for sec1 (matures 2025/1/1, pays Jan 1, Jul 1)
        # Expected payments: 2024/1/1, 2024/7/1, 2025/1/1
        self.assertEqual(len(combined_flows), 3) # 3 remaining payment dates

        # Check first interest payment amount (approximate)
        # Interest = 100000 * (4.0/100) / 2 = 2000
        first_interest_flow = next((f[0] for f in detailed_flows if f[1] == 'Interest' and f[0].date() == ql.Date(1, 1, 2024)), None) # QuantLib date
        self.assertIsNotNone(first_interest_flow, "Did not find expected interest flow for 2024-01-01")
        if first_interest_flow:
             self.assertAlmostEqual(first_interest_flow.amount(), 2000.00, places=2)

        # Check principal payment at maturity
        principal_at_maturity = next((f[0] for f in detailed_flows if f[1] == 'Principal' and f[0].date() == ql.Date(1,1,2025)), None)
        self.assertIsNotNone(principal_at_maturity)
        if principal_at_maturity:
            self.assertAlmostEqual(principal_at_maturity.amount(), float(self.holding1.original_face_amount * self.sec1.factor), places=2)
        # Add more specific assertions about dates and amounts of flows

    def test_generate_cashflows_zero_coupon(self):
        eval_date = date(2024, 1, 1)
        combined_flows, detailed_flows, _, error = generate_quantlib_cashflows(self.holding2, eval_date)
        self.assertIsNone(error)
        self.assertEqual(len(combined_flows), 1) # Only principal at maturity
        self.assertEqual(len(detailed_flows), 1)
        if detailed_flows:
            self.assertEqual(detailed_flows[0][1], 'Principal')
            self.assertEqual(detailed_flows[0][0].date(), ql.Date(1,1,2026)) # Maturity date of sec2
            self.assertAlmostEqual(detailed_flows[0][0].amount(), float(self.holding2.original_face_amount), places=2)

    def test_generate_cashflows_paydown_with_cpr(self):
        eval_date = date(2023, 9, 30) # Holding3 settlement is 2023/1/1
        combined_flows, detailed_flows, _, error = generate_quantlib_cashflows(self.holding3, eval_date)
        self.assertIsNone(error)
        self.assertTrue(len(detailed_flows) > 0)
        # Assertions for paydown are more complex:
        # - Principal payments should occur before maturity.
        # - Interest should be calculated on decreasing principal.
        # - Total principal paid should eventually equal original_face * initial_factor.
        # This requires careful step-by-step calculation or comparison with a trusted source.
        # For now, check that some principal flows occur before maturity.
        principal_flows_before_maturity = [
            f for f in detailed_flows
            if f[1] == 'Principal' and f[0].date() < ql.Date.from_date(self.sec3.maturity_date)
        ]
        # Given CPR, we expect some principal paydown before final maturity if eval date is early enough
        # self.assertTrue(len(principal_flows_before_maturity) > 0, "Expected principal paydowns before maturity due to CPR")
        # For a more robust test, you'd sum all principal payments and check against initial principal.
        total_principal_paid = sum(f[0].amount() for f in detailed_flows if f[1] == 'Principal')
        expected_initial_principal = float(self.holding3.original_face_amount * self.sec3.factor)
        self.assertAlmostEqual(total_principal_paid, expected_initial_principal, places=2,
                               msg=f"Total principal paid {total_principal_paid} does not match expected {expected_initial_principal}")


    def test_generate_cashflows_matured_bond(self):
        eval_date = date(2023, 1, 1) # sec4 matured 2022/1/1
        combined_flows, detailed_flows, _, error = generate_quantlib_cashflows(self.holding4, eval_date)
        self.assertIsNone(error)
        self.assertEqual(len(combined_flows), 0, "Expected no cash flows for a matured bond")
        self.assertEqual(len(detailed_flows), 0)

    def test_generate_cashflows_eval_date_before_issue(self):
        holding = create_test_holding(self.sec1, self.portfolio, market_date=date(2019,1,1)) # Eval date before sec1 issue
        eval_date = date(2019, 6, 30)
        _, detailed_flows, ql_settlement_date, error = generate_quantlib_cashflows(holding, eval_date)
        self.assertIsNone(error)
        self.assertTrue(len(detailed_flows) > 0) # Should still generate all flows from issue date
        self.assertEqual(ql_settlement_date, ql.Date.from_date(self.sec1.issue_date)) # Projection starts from issue date

    def test_generate_cashflows_missing_data(self):
        bad_holding_no_sec = CustomerHolding(portfolio=self.portfolio, original_face_amount=1000)
        _, _, _, error = generate_quantlib_cashflows(bad_holding_no_sec, date.today())
        self.assertIsNotNone(error)
        self.assertIn("Missing holding or security data", error)

        bad_holding_no_face = create_test_holding(self.sec1, self.portfolio, original_face_amount=None)
        _, _, _, error = generate_quantlib_cashflows(bad_holding_no_face, date.today())
        self.assertIsNotNone(error)
        self.assertIn("Invalid original_face_amount", error)

        # Add more tests for other missing/invalid data points in holding or security


class CalculateBondAnalyticsTest(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.customer = Customer.objects.create(customer_number=5002, name="Analytics Test Cust", city="AY City", state="AY", portfolio_accounting_code="PACAYT")
        cls.portfolio = Portfolio.objects.create(owner=cls.customer, name="Analytics Test Portfolio")

        cls.fixed_coupon_security = create_test_security(
            cusip="ANALYTICS1", description="Fixed Coupon for Analytics",
            issue_date=date(2020, 1, 1), maturity_date=date(2025, 1, 1),
            coupon_rate=Decimal("3.0"), payments_per_year=2, interest_calc_code='c'
        )
        cls.holding_fixed = create_test_holding(
            cls.fixed_coupon_security, cls.portfolio,
            market_price=Decimal("98.5"), market_date=date(2023, 7, 1), # Ensure market_date is set
            settlement_date=date(2023,7,1)
        )

    # Patch generate_quantlib_cashflows to control its output for analytics tests
    @patch('portfolio.utils.generate_quantlib_cashflows')
    def test_calculate_analytics_success(self, mock_generate_cashflows):
        # Define what mock_generate_cashflows should return
        # This needs to be realistic QuantLib cash flow objects or a simplified mock
        # For simplicity, let's assume it returns some basic structure.
        # In a real scenario, you might need to construct actual ql.SimpleCashFlow objects.
        mock_eval_date = ql.Date.from_date(self.holding_fixed.market_date)
        mock_ql_settlement_date = mock_eval_date # Assuming analytics settlement date is market_date
        
        # Example: 2 remaining semi-annual payments for a 100 face bond
        # Dates need to be ql.Date objects
        pmt_date1 = ql.Date(1, 1, 2024)
        pmt_date2 = ql.Date(1, 7, 2024)
        pmt_date3 = ql.Date(1, 1, 2025) # Maturity

        # Scaled flows (per 100 face for analytics calculation)
        # Coupon = 3.0 / 2 = 1.5 per period
        # Principal at maturity = 100
        # Note: The actual generate_quantlib_cashflows scales by original_face_amount / 100
        # So if original_face is 100000, scale factor is 1000.
        # The ql.CashFlows.yieldRate expects price per 100 face, and flows scaled accordingly.
        # The example below assumes flows are already scaled as if original face was 100 for simplicity of the mock.
        # If testing the scaling within calculate_bond_analytics, the mock needs to return unscaled flows.

        # Let's mock the *detailed* flows as calculate_bond_analytics uses them for results['cash_flows']
        # And *combined* flows for the actual QL calculations.
        # The scaling factor for analytics is original_face / 100.
        # So, if original_face = 100000, factor = 1000.
        # If coupon is 1.5 on 100 face, actual coupon is 1500.
        # generate_quantlib_cashflows returns ACTUAL flows.
        # calculate_bond_analytics then scales them DOWN for QL funcs.

        actual_coupon_pmt = float(self.holding_fixed.original_face_amount * (self.fixed_coupon_security.coupon / 100) / self.fixed_coupon_security.payments_per_year)
        actual_principal_pmt = float(self.holding_fixed.original_face_amount)


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

        mock_generate_cashflows.return_value = (mock_combined_flows, mock_detailed_flows, mock_ql_settlement_date, None)

        results = calculate_bond_analytics(self.holding_fixed)

        self.assertIsNone(results.get('error'), f"Analytics error: {results.get('error')}")
        self.assertIsNotNone(results.get('ytm'))
        self.assertIsNotNone(results.get('duration_modified'))
        self.assertIsNotNone(results.get('convexity'))
        self.assertTrue(len(results.get('cash_flows', [])) > 0)

        # More specific assertions would require knowing the expected YTM/Duration for the mock flows
        # For example, if YTM is expected to be around 3-4% for a price of 98.5
        # self.assertTrue(Decimal("3.0") < Decimal(results['ytm']) < Decimal("4.5")) # Example range

        # Verify that generate_quantlib_cashflows was called correctly
        mock_generate_cashflows.assert_called_once_with(self.holding_fixed, self.holding_fixed.market_date)


    @patch('portfolio.utils.generate_quantlib_cashflows')
    def test_calculate_analytics_no_market_price(self, mock_generate_cashflows):
        holding_no_price = create_test_holding(self.fixed_coupon_security, self.portfolio, market_price=None, market_date=date(2023,7,1))
        results = calculate_bond_analytics(holding_no_price)
        self.assertIsNotNone(results.get('error'))
        self.assertIn("Missing or invalid market price", results['error'])
        mock_generate_cashflows.assert_not_called() # Should not proceed to CF generation

    @patch('portfolio.utils.generate_quantlib_cashflows')
    def test_calculate_analytics_cashflow_generation_error(self, mock_generate_cashflows):
        mock_generate_cashflows.return_value = ([], [], None, "Simulated CF Error")
        results = calculate_bond_analytics(self.holding_fixed)
        self.assertIsNotNone(results.get('error'))
        self.assertIn("Simulated CF Error", results['error'])

    @patch('portfolio.utils.generate_quantlib_cashflows')
    @patch('QuantLib.CashFlows.yieldRate') # Mock the specific QL function that might fail
    def test_calculate_analytics_quantlib_runtime_error(self, mock_ql_yieldrate, mock_generate_cashflows):
        # Setup mock cashflows as in the success test
        mock_eval_date = ql.Date.from_date(self.holding_fixed.market_date)
        mock_ql_settlement_date = mock_eval_date
        pmt_date1 = ql.Date(1, 1, 2024); pmt_date3 = ql.Date(1, 1, 2025)
        actual_coupon_pmt = float(self.holding_fixed.original_face_amount * (self.fixed_coupon_security.coupon / 100) / self.fixed_coupon_security.payments_per_year)
        actual_principal_pmt = float(self.holding_fixed.original_face_amount)
        mock_combined_flows = [ql.SimpleCashFlow(actual_coupon_pmt + actual_principal_pmt, pmt_date3)] # Simplified
        mock_detailed_flows = [(ql.SimpleCashFlow(actual_coupon_pmt + actual_principal_pmt, pmt_date3), 'Combined')]

        mock_generate_cashflows.return_value = (mock_combined_flows, mock_detailed_flows, mock_ql_settlement_date, None)

        # Make the QuantLib function raise a RuntimeError
        mock_ql_yieldrate.side_effect = RuntimeError("root not bracketed")

        results = calculate_bond_analytics(self.holding_fixed)
        self.assertIsNotNone(results.get('error'))
        self.assertIn("root not bracketed", results['error'])

    # Add more tests for different bond types (zero coupon, paydown) if analytics differ.
    # Test edge cases for market dates (e.g., on coupon payment date, ex-dividend).
    # Test the critical warning logic if possible (though this is more about logging).
