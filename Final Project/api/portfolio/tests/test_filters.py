# portfolio/tests/test_filters.py
from django.test import TestCase
from django.contrib.auth import get_user_model
from decimal import Decimal
from datetime import date, timedelta

# Import your models
from portfolio.models import (
    Customer, Salesperson, Security, SecurityType, InterestSchedule,
    Portfolio, CustomerHolding, MunicipalOffering
)
# Import your FilterSet classes
from portfolio.filters import CustomerHoldingFilterSet, MuniOfferingFilterSet

User = get_user_model()

class BaseFilterTest(TestCase):
    """
    Base class for filter tests, sets up common data.
    """
    @classmethod
    def setUpTestData(cls):
        # Create users if needed for any context, though filters usually don't need request context directly
        cls.user1 = User.objects.create_user(username='filteruser1', password='password')

        # Create diverse data for filtering
        cls.salesperson_a = Salesperson.objects.create(salesperson_id="F_S01", name="Filter Sales A")
        cls.salesperson_b = Salesperson.objects.create(salesperson_id="F_S02", name="Filter Sales B")

        cls.sec_type_bond = SecurityType.objects.create(type_id=100, name="Corporate Bond")
        cls.sec_type_muni = SecurityType.objects.create(type_id=101, name="Municipal Bond")

        cls.int_sched_semi = InterestSchedule.objects.create(schedule_code="F_SEMI", name="Semi-Annual")

        cls.customer_x = Customer.objects.create(
            customer_number=8001, name="Filter Customer X", city="FilterCityX", state="FX",
            salesperson=cls.salesperson_a, portfolio_accounting_code="FPAC01"
        )
        cls.customer_y = Customer.objects.create(
            customer_number=8002, name="Filter Customer Y", city="FilterCityY", state="FY",
            salesperson=cls.salesperson_b, portfolio_accounting_code="FPAC02"
        )

        cls.security_fnma = Security.objects.create(
            cusip="FILTER001", description="FNMA Test Bond", issue_date=date(2020,1,1),
            maturity_date=date(2030,1,1), security_type=cls.sec_type_bond, coupon=Decimal("2.5"),
            tax_code='t', interest_schedule=cls.int_sched_semi, interest_day=15,
            interest_calc_code='c', payments_per_year=2, allows_paydown=False,
            sector="Agency", state_of_issuer="DC", wal=Decimal("5.5"), cpr=Decimal("6.0")
        )
        cls.security_corp = Security.objects.create(
            cusip="FILTER002", description="Corporate Debenture", issue_date=date(2021,6,1),
            maturity_date=date(2028,6,1), security_type=cls.sec_type_bond, coupon=Decimal("4.0"),
            tax_code='t', interest_day=1, interest_calc_code='a', payments_per_year=1,
            allows_paydown=True, factor=Decimal("0.9"), # Paydown example
            sector="Industrial", state_of_issuer="NY", wal=Decimal("3.2")
        )
        cls.security_muni = Security.objects.create(
            cusip="FILTER003", description="Municipal GO Bond", issue_date=date(2022,3,1),
            maturity_date=date(2035,3,1), security_type=cls.sec_type_muni, coupon=Decimal("3.0"),
            tax_code='e', interest_day=1, interest_calc_code='c', payments_per_year=2,
            allows_paydown=False, sector="General Obligation", state_of_issuer="CA"
        )

        cls.portfolio_x1 = Portfolio.objects.create(owner=cls.customer_x, name="X Primary", is_default=True)
        cls.portfolio_y1 = Portfolio.objects.create(owner=cls.customer_y, name="Y Primary", is_default=True)

        # Holdings with diverse data
        cls.holding1 = CustomerHolding.objects.create(
            external_ticket=90010, portfolio=cls.portfolio_x1, security=cls.security_fnma,
            intention_code='A', original_face_amount=D("100000"), settlement_date=date(2023,1,10),
            settlement_price=D("101"), book_price=D("100.5"), book_yield=D("2.3"),
            market_price=D("101.5"), market_yield=D("2.2"), market_date=date(2023,1,15),
            holding_duration=D("5.1"), holding_average_life=D("5.3")
        )
        # For holding2, ensure intention_code='H' is a valid choice in the CustomerHolding model's
        # 'intention_code' field definition in models.py for test_filter_by_intention_code_H to pass.
        cls.holding2 = CustomerHolding.objects.create(
            external_ticket=90011, portfolio=cls.portfolio_x1, security=cls.security_corp,
            intention_code='H', original_face_amount=D("200000"), settlement_date=date(2023,2,20),
            settlement_price=D("99"), book_price=D("99.5"), book_yield=D("4.1"),
            market_price=D("98.0"), market_yield=D("4.3"), market_date=date(2023,2,25),
            holding_duration=D("3.0"), holding_average_life=D("3.1")
        )
        cls.holding3 = CustomerHolding.objects.create(
            external_ticket=90012, portfolio=cls.portfolio_y1, security=cls.security_muni,
            intention_code='T', original_face_amount=D("50000"), settlement_date=date(2023,3,5),
            settlement_price=D("105"), book_price=D("104.0"), book_yield=D("2.8"),
            market_price=D("105.5"), market_yield=D("2.7"), market_date=date(2023,3,10),
            holding_duration=D("7.5"), holding_average_life=D("8.0")
        )
        cls.holding4_no_market_vals = CustomerHolding.objects.create( # Holding with no market values
            external_ticket=90013, portfolio=cls.portfolio_y1, security=cls.security_fnma,
            intention_code='A', original_face_amount=D("75000"), settlement_date=date(2023,4,1),
            settlement_price=D("100"), book_price=D("100"), book_yield=D("2.5"),
        )

        # Municipal Offerings
        cls.muni_offering1 = MunicipalOffering.objects.create(
            cusip="MUNIFILT1", description="CA Health Revenue", amount=D("5000000"), coupon=D("3.125"),
            maturity_date=date(2040,1,1), yield_rate=D("3.20"), price=D("101.5"), state="CA",
            moody_rating="Aa2", sp_rating="AA", insurance="AGM"
        )
        cls.muni_offering2 = MunicipalOffering.objects.create(
            cusip="MUNIFILT2", description="NY School District GO", amount=D("2000000"), coupon=D("2.75"),
            maturity_date=date(2035,6,1), yield_rate=D("2.85"), price=D("100.25"), state="NY",
            moody_rating="A1", sp_rating="A+", call_date=date(2030,6,1), call_price=D("100")
        )
        cls.muni_offering3 = MunicipalOffering.objects.create(
            cusip="MUNIFILT3", description="TX Utility Revenue", amount=D("10000000"), coupon=D("3.5"),
            maturity_date=date(2045,1,1), yield_rate=D("3.60"), price=D("99.75"), state="TX",
            moody_rating="Aa3", sp_rating="AA-"
        )

def D(val_str): # Helper for Decimals
    return Decimal(val_str)

class CustomerHoldingFilterSetTest(BaseFilterTest):
    def test_filter_by_portfolio_id(self):
        data = {'portfolio': self.portfolio_x1.id}
        qs = CustomerHolding.objects.all()
        filterset = CustomerHoldingFilterSet(data=data, queryset=qs)
        self.assertTrue(filterset.is_valid(), filterset.errors)
        self.assertEqual(filterset.qs.count(), 2) # holding1 and holding2
        for holding in filterset.qs:
            self.assertEqual(holding.portfolio, self.portfolio_x1)

    def test_filter_by_intention_code(self): # Existing test for 'A'
        data = {'intention_code': 'A'} # Available for Sale
        qs = CustomerHolding.objects.all()
        filterset = CustomerHoldingFilterSet(data=data, queryset=qs)
        self.assertTrue(filterset.is_valid(), filterset.errors)
        self.assertEqual(filterset.qs.count(), 2) # holding1 and holding4
        for holding in filterset.qs:
            self.assertEqual(holding.intention_code, 'A')

    def test_filter_by_intention_code_H(self): # New test for 'H'
        # NOTE: This test will FAIL if 'H' is not included in the 'choices'
        # attribute of the 'intention_code' field in the CustomerHolding model (models.py).
        # The error "Select a valid choice. H is not one of the available choices."
        # indicates this is likely the case. To fix, update models.py.
        data = {'intention_code': 'H'} # Held for Investment
        qs = CustomerHolding.objects.all()
        filterset = CustomerHoldingFilterSet(data=data, queryset=qs)
        self.assertTrue(filterset.is_valid(), filterset.errors) # Added filterset.errors for debugging
        self.assertEqual(filterset.qs.count(), 1) # holding2
        for holding in filterset.qs:
            self.assertEqual(holding.intention_code, 'H')

    def test_filter_by_intention_code_T(self): # New test for 'T'
        data = {'intention_code': 'T'} # Trading
        qs = CustomerHolding.objects.all()
        filterset = CustomerHoldingFilterSet(data=data, queryset=qs)
        self.assertTrue(filterset.is_valid(), filterset.errors)
        self.assertEqual(filterset.qs.count(), 1) # holding3
        for holding in filterset.qs:
            self.assertEqual(holding.intention_code, 'T')

    def test_filter_by_settlement_date_range(self):
        data = {
            'settlement_date_after': date(2023, 2, 1).isoformat(), # From Feb 1, 2023
            'settlement_date_before': date(2023, 3, 31).isoformat() # To Mar 31, 2023
        }
        qs = CustomerHolding.objects.all()
        filterset = CustomerHoldingFilterSet(data=data, queryset=qs)
        self.assertTrue(filterset.is_valid(), filterset.errors)
        self.assertEqual(filterset.qs.count(), 2) # holding2 and holding3
        self.assertIn(self.holding2, filterset.qs)
        self.assertIn(self.holding3, filterset.qs)

    def test_filter_by_settlement_date_only_after(self): # New test
        data = {'settlement_date_after': date(2023, 3, 1).isoformat()} # holding3, holding4
        qs = CustomerHolding.objects.all()
        filterset = CustomerHoldingFilterSet(data=data, queryset=qs)
        self.assertTrue(filterset.is_valid(), filterset.errors)
        self.assertEqual(filterset.qs.count(), 2)
        self.assertIn(self.holding3, filterset.qs)
        self.assertIn(self.holding4_no_market_vals, filterset.qs)

    def test_filter_by_settlement_date_only_before(self): # New test
        data = {'settlement_date_before': date(2023, 1, 31).isoformat()} # holding1
        qs = CustomerHolding.objects.all()
        filterset = CustomerHoldingFilterSet(data=data, queryset=qs)
        self.assertTrue(filterset.is_valid(), filterset.errors)
        self.assertEqual(filterset.qs.count(), 1)
        self.assertIn(self.holding1, filterset.qs)

    def test_filter_by_security_cusip_icontains(self):
        data = {'security_cusip': 'FILTER00'} # Should match all three securities used in holdings
        qs = CustomerHolding.objects.all()
        filterset = CustomerHoldingFilterSet(data=data, queryset=qs)
        self.assertTrue(filterset.is_valid(), filterset.errors)
        # holding1 (FILTER001), holding2 (FILTER002), holding3 (FILTER003), holding4 (FILTER001)
        self.assertEqual(filterset.qs.count(), 4)

    def test_filter_by_security_cusip_exact(self):
        data = {'security_cusip_exact': 'FILTER001'}
        qs = CustomerHolding.objects.all()
        filterset = CustomerHoldingFilterSet(data=data, queryset=qs)
        self.assertTrue(filterset.is_valid(), filterset.errors)
        self.assertEqual(filterset.qs.count(), 2) # holding1 and holding4
        for holding in filterset.qs:
            self.assertEqual(holding.security.cusip, 'FILTER001')

    def test_filter_by_security_description_icontains(self):
        data = {'security_description': 'FNMA'}
        qs = CustomerHolding.objects.all()
        filterset = CustomerHoldingFilterSet(data=data, queryset=qs)
        self.assertTrue(filterset.is_valid(), filterset.errors)
        self.assertEqual(filterset.qs.count(), 2) # holding1 and holding4 (both are FNMA)

    def test_filter_by_security_type_id(self):
        data = {'security_type': self.sec_type_muni.type_id}
        qs = CustomerHolding.objects.all()
        filterset = CustomerHoldingFilterSet(data=data, queryset=qs)
        self.assertTrue(filterset.is_valid(), filterset.errors)
        self.assertEqual(filterset.qs.count(), 1) # holding3
        self.assertEqual(filterset.qs.first().security.security_type, self.sec_type_muni)

    def test_filter_by_security_type_name_icontains(self):
        data = {'security_type_name': 'Corp'} # Matches "Corporate Bond"
        qs = CustomerHolding.objects.all()
        filterset = CustomerHoldingFilterSet(data=data, queryset=qs)
        self.assertTrue(filterset.is_valid(), filterset.errors)
        # holding1 (FNMA is Corp Bond type), holding2, holding4 (FNMA is Corp Bond type)
        self.assertEqual(filterset.qs.count(), 3) # CORRECTED from 2 to 3
        for holding in filterset.qs:
            self.assertIn("Corp", holding.security.security_type.name)


    def test_filter_by_security_tax_code(self): # Existing test for 'e'
        data = {'security_tax_code': 'e'} # Tax-exempt
        qs = CustomerHolding.objects.all()
        filterset = CustomerHoldingFilterSet(data=data, queryset=qs)
        self.assertTrue(filterset.is_valid(), filterset.errors)
        self.assertEqual(filterset.qs.count(), 1) # holding3 (muni)
        self.assertEqual(filterset.qs.first().security.tax_code, 'e')

    def test_filter_by_security_tax_code_t(self): # New test for 't'
        data = {'security_tax_code': 't'} # Taxable
        qs = CustomerHolding.objects.all()
        filterset = CustomerHoldingFilterSet(data=data, queryset=qs)
        self.assertTrue(filterset.is_valid(), filterset.errors)
        self.assertEqual(filterset.qs.count(), 3) # holding1, holding2, holding4
        for holding in filterset.qs:
            self.assertEqual(holding.security.tax_code, 't')

    def test_filter_by_security_allows_paydown_true(self):
        data = {'security_allows_paydown': 'true'} # or True
        qs = CustomerHolding.objects.all()
        filterset = CustomerHoldingFilterSet(data=data, queryset=qs)
        self.assertTrue(filterset.is_valid(), filterset.errors)
        self.assertEqual(filterset.qs.count(), 1) # holding2 (security_corp)
        self.assertTrue(filterset.qs.first().security.allows_paydown)

    def test_filter_by_security_allows_paydown_false(self): # New test
        data = {'security_allows_paydown': 'false'} # or False
        qs = CustomerHolding.objects.all()
        filterset = CustomerHoldingFilterSet(data=data, queryset=qs)
        self.assertTrue(filterset.is_valid(), filterset.errors)
        # security_fnma (False), security_muni (False)
        # holding1 (FNMA), holding3 (Muni), holding4 (FNMA)
        self.assertEqual(filterset.qs.count(), 3)
        for holding in filterset.qs:
            self.assertFalse(holding.security.allows_paydown)

    def test_filter_by_security_maturity_date_range(self):
        data = {'security_maturity_date_after': date(2029,1,1).isoformat()} # Matures in or after 2029
        qs = CustomerHolding.objects.all()
        filterset = CustomerHoldingFilterSet(data=data, queryset=qs)
        self.assertTrue(filterset.is_valid(), filterset.errors)
        # security_fnma (2030), security_muni (2035)
        self.assertEqual(filterset.qs.count(), 3) # holding1, holding3, holding4

    def test_filter_by_security_maturity_date_only_before(self): # New test
        # Assuming DateFromToRangeFilter's '_before' is inclusive (<=),
        # to get strictly before 2030-01-01, we use 2029-12-31.
        data = {'security_maturity_date_before': date(2029,12,31).isoformat()} # Matures on or before 2029-12-31
        qs = CustomerHolding.objects.all()
        filterset = CustomerHoldingFilterSet(data=data, queryset=qs)
        self.assertTrue(filterset.is_valid(), filterset.errors)
        # security_corp (2028-06-01) should match.
        self.assertEqual(filterset.qs.count(), 1) # Should be 1 (holding2)
        self.assertEqual(filterset.qs.first(), self.holding2)

    def test_filter_by_security_sector_icontains(self):
        data = {'security_sector': 'Agency'}
        qs = CustomerHolding.objects.all()
        filterset = CustomerHoldingFilterSet(data=data, queryset=qs)
        self.assertTrue(filterset.is_valid(), filterset.errors)
        self.assertEqual(filterset.qs.count(), 2) # holding1, holding4

    def test_filter_by_security_state_of_issuer_exact(self):
        data = {'security_state_of_issuer': 'NY'}
        qs = CustomerHolding.objects.all()
        filterset = CustomerHoldingFilterSet(data=data, queryset=qs)
        self.assertTrue(filterset.is_valid(), filterset.errors)
        self.assertEqual(filterset.qs.count(), 1) # holding2

    # --- Numeric Field Filters ---
    def test_filter_by_book_price_exact(self):
        data = {'book_price': "100.50"} # This uses NumberFilter, not RangeFilter, so param name is direct
        qs = CustomerHolding.objects.all()
        filterset = CustomerHoldingFilterSet(data=data, queryset=qs)
        self.assertTrue(filterset.is_valid(), filterset.errors)
        self.assertEqual(filterset.qs.count(), 1)
        self.assertEqual(filterset.qs.first(), self.holding1)

    def test_filter_by_book_price_range(self):
        # CORRECTED query param names for RangeFilter
        data = {'book_price_range_min': "99.0", 'book_price_range_max': "100.0"}
        qs = CustomerHolding.objects.all()
        filterset = CustomerHoldingFilterSet(data=data, queryset=qs)
        self.assertTrue(filterset.is_valid(), filterset.errors)
        self.assertEqual(filterset.qs.count(), 2) # holding2 (99.5), holding4 (100.0)
        self.assertIn(self.holding2, filterset.qs)
        self.assertIn(self.holding4_no_market_vals, filterset.qs)

    def test_filter_by_book_price_only_min(self): # New test
        # CORRECTED query param name
        data = {'book_price_range_min': "104.0"} # holding3 (104.0)
        qs = CustomerHolding.objects.all()
        filterset = CustomerHoldingFilterSet(data=data, queryset=qs)
        self.assertTrue(filterset.is_valid(), filterset.errors)
        self.assertEqual(filterset.qs.count(), 1)
        self.assertIn(self.holding3, filterset.qs)

    def test_filter_by_book_price_only_max(self): # New test
        # CORRECTED query param name
        data = {'book_price_range_max': "99.5"} # holding2 (99.5)
        qs = CustomerHolding.objects.all()
        filterset = CustomerHoldingFilterSet(data=data, queryset=qs)
        self.assertTrue(filterset.is_valid(), filterset.errors)
        self.assertEqual(filterset.qs.count(), 1)
        self.assertIn(self.holding2, filterset.qs)

    def test_filter_by_book_yield_range(self):
        # For RangeFilter book_yield, params are book_yield_min, book_yield_max
        data = {'book_yield_min': "2.0", 'book_yield_max': "2.5"}
        qs = CustomerHolding.objects.all()
        filterset = CustomerHoldingFilterSet(data=data, queryset=qs)
        self.assertTrue(filterset.is_valid(), filterset.errors)
        self.assertEqual(filterset.qs.count(), 2) # holding1 (2.3), holding4 (2.5)

    def test_filter_by_book_yield_only_min(self): # New test
        data = {'book_yield_min': "4.0"} # holding2 (4.1)
        qs = CustomerHolding.objects.all()
        filterset = CustomerHoldingFilterSet(data=data, queryset=qs)
        self.assertTrue(filterset.is_valid(), filterset.errors)
        self.assertEqual(filterset.qs.count(), 1)
        self.assertIn(self.holding2, filterset.qs)

    def test_filter_by_market_price_exact(self):
        # This uses NumberFilter, not RangeFilter, so param name is direct
        data = {'market_price': "98.00"}
        qs = CustomerHolding.objects.all() # holding4 has no market price
        filterset = CustomerHoldingFilterSet(data=data, queryset=qs)
        self.assertTrue(filterset.is_valid(), filterset.errors)
        self.assertEqual(filterset.qs.count(), 1)
        self.assertEqual(filterset.qs.first(), self.holding2)

    def test_filter_by_market_price_range_handles_nulls(self):
        # CORRECTED query param names for RangeFilter
        data = {'market_price_range_min': "0", 'market_price_range_max': "200"}
        qs = CustomerHolding.objects.all()
        filterset = CustomerHoldingFilterSet(data=data, queryset=qs)
        self.assertTrue(filterset.is_valid(), filterset.errors)
        self.assertEqual(filterset.qs.count(), 3) # holding1, holding2, holding3 (holding4 is excluded)
        self.assertNotIn(self.holding4_no_market_vals, filterset.qs)

    def test_filter_by_market_price_only_min(self): # New test
        # CORRECTED query param name
        data = {'market_price_range_min': "105.0"} # holding3 (105.5)
        qs = CustomerHolding.objects.all()
        filterset = CustomerHoldingFilterSet(data=data, queryset=qs)
        self.assertTrue(filterset.is_valid(), filterset.errors)
        self.assertEqual(filterset.qs.count(), 1)
        self.assertIn(self.holding3, filterset.qs)

    def test_filter_by_market_yield_range(self):
        # For RangeFilter market_yield, params are market_yield_min, market_yield_max
        data = {'market_yield_min': "4.0"} # holding2 (4.3)
        qs = CustomerHolding.objects.all()
        filterset = CustomerHoldingFilterSet(data=data, queryset=qs)
        self.assertTrue(filterset.is_valid(), filterset.errors)
        self.assertEqual(filterset.qs.count(), 1)
        self.assertEqual(filterset.qs.first(), self.holding2)

    def test_filter_by_market_yield_only_max(self): # New test
        data = {'market_yield_max': "2.5"} # holding1 (2.2)
        qs = CustomerHolding.objects.all()
        filterset = CustomerHoldingFilterSet(data=data, queryset=qs)
        self.assertTrue(filterset.is_valid(), filterset.errors)
        self.assertEqual(filterset.qs.count(), 1)
        self.assertIn(self.holding1, filterset.qs)

    def test_filter_by_holding_average_life_range(self): # 'wal' in frontend maps to this
        # For RangeFilter holding_average_life, params are holding_average_life_min, holding_average_life_max
        data = {'holding_average_life_min': "5.0", 'holding_average_life_max': "6.0"}
        qs = CustomerHolding.objects.all()
        filterset = CustomerHoldingFilterSet(data=data, queryset=qs)
        self.assertTrue(filterset.is_valid(), filterset.errors)
        self.assertEqual(filterset.qs.count(), 1) # holding1 (5.3)

    def test_filter_by_holding_average_life_only_max(self): # New test
        data = {'holding_average_life_max': "3.5"} # holding2 (3.1)
        qs = CustomerHolding.objects.all()
        filterset = CustomerHoldingFilterSet(data=data, queryset=qs)
        self.assertTrue(filterset.is_valid(), filterset.errors)
        self.assertEqual(filterset.qs.count(), 1)
        self.assertIn(self.holding2, filterset.qs)

    def test_filter_by_holding_duration_range(self):
        # For RangeFilter holding_duration, params are holding_duration_min, holding_duration_max
        data = {'holding_duration_min': "7.0"}
        qs = CustomerHolding.objects.all()
        filterset = CustomerHoldingFilterSet(data=data, queryset=qs)
        self.assertTrue(filterset.is_valid(), filterset.errors)
        self.assertEqual(filterset.qs.count(), 1) # holding3 (7.5)

    def test_filter_by_holding_duration_only_min(self): # New test
        data = {'holding_duration_min': "5.0"} # holding1 (5.1), holding3 (7.5)
        qs = CustomerHolding.objects.all()
        filterset = CustomerHoldingFilterSet(data=data, queryset=qs)
        self.assertTrue(filterset.is_valid(), filterset.errors)
        self.assertEqual(filterset.qs.count(), 2)
        self.assertIn(self.holding1, filterset.qs)
        self.assertIn(self.holding3, filterset.qs)

    def test_filter_by_security_wal_range(self):
        # For RangeFilter security_wal, params are security_wal_min, security_wal_max
        data = {'security_wal_min': "5.0"} # security_fnma (5.5)
        qs = CustomerHolding.objects.all()
        filterset = CustomerHoldingFilterSet(data=data, queryset=qs)
        self.assertTrue(filterset.is_valid(), filterset.errors)
        self.assertEqual(filterset.qs.count(), 2) # holding1, holding4

    def test_filter_by_security_wal_only_max(self): # New test
        data = {'security_wal_max': "4.0"} # security_corp (3.2)
        qs = CustomerHolding.objects.all()
        filterset = CustomerHoldingFilterSet(data=data, queryset=qs)
        self.assertTrue(filterset.is_valid(), filterset.errors)
        self.assertEqual(filterset.qs.count(), 1) # holding2
        self.assertIn(self.holding2, filterset.qs)

    def test_filter_by_security_cpr_range(self):
        # For RangeFilter security_cpr, params are security_cpr_min, security_cpr_max
        data = {'security_cpr_min': "5.0", 'security_cpr_max': "7.0"} # security_fnma (6.0)
        qs = CustomerHolding.objects.all()
        filterset = CustomerHoldingFilterSet(data=data, queryset=qs)
        self.assertTrue(filterset.is_valid(), filterset.errors)
        self.assertEqual(filterset.qs.count(), 2) # holding1, holding4

    def test_filter_by_security_cpr_no_match(self): # New test
        data = {'security_cpr_min': "10.0"} # No security has CPR >= 10.0
        qs = CustomerHolding.objects.all()
        filterset = CustomerHoldingFilterSet(data=data, queryset=qs)
        self.assertTrue(filterset.is_valid(), filterset.errors)
        self.assertEqual(filterset.qs.count(), 0)

    def test_filter_combination(self):
        data = {
            'portfolio': self.portfolio_x1.id,
            'security_tax_code': 't',
            'market_price_range_min': "100" # CORRECTED query param name
        } # Portfolio X, Taxable, Market Price >= 100
          # Holding1: portfolio_x1, tax_code='t' (FNMA), market_price=101.5 -> MATCH
          # Holding2: portfolio_x1, tax_code='t' (Corp), market_price=98.0 -> NO MATCH (price too low)
        qs = CustomerHolding.objects.all()
        filterset = CustomerHoldingFilterSet(data=data, queryset=qs)
        self.assertTrue(filterset.is_valid(), filterset.errors)
        self.assertEqual(filterset.qs.count(), 1)
        self.assertEqual(filterset.qs.first(), self.holding1)


class MuniOfferingFilterSetTest(BaseFilterTest):
    def test_filter_muni_by_cusip_icontains(self):
        data = {'cusip': 'FILT1'} # MUNIFILT1
        qs = MunicipalOffering.objects.all()
        filterset = MuniOfferingFilterSet(data=data, queryset=qs)
        self.assertTrue(filterset.is_valid(), filterset.errors)
        self.assertEqual(filterset.qs.count(), 1)
        self.assertEqual(filterset.qs.first(), self.muni_offering1)

    def test_filter_muni_by_description_icontains(self):
        data = {'description': 'Revenue'} # MUNIFILT1 (CA Health Revenue), MUNIFILT3 (TX Utility Revenue)
        qs = MunicipalOffering.objects.all()
        filterset = MuniOfferingFilterSet(data=data, queryset=qs)
        self.assertTrue(filterset.is_valid(), filterset.errors)
        self.assertEqual(filterset.qs.count(), 2)
        self.assertIn(self.muni_offering1, filterset.qs)
        self.assertIn(self.muni_offering3, filterset.qs)

    def test_filter_muni_by_state_exact(self):
        data = {'state': 'NY'}
        qs = MunicipalOffering.objects.all()
        filterset = MuniOfferingFilterSet(data=data, queryset=qs)
        self.assertTrue(filterset.is_valid(), filterset.errors)
        self.assertEqual(filterset.qs.count(), 1)
        self.assertEqual(filterset.qs.first(), self.muni_offering2)

    def test_filter_muni_by_moody_rating_exact(self):
        data = {'moody_rating': 'Aa2'}
        qs = MunicipalOffering.objects.all()
        filterset = MuniOfferingFilterSet(data=data, queryset=qs)
        self.assertTrue(filterset.is_valid(), filterset.errors)
        self.assertEqual(filterset.qs.count(), 1)
        self.assertEqual(filterset.qs.first(), self.muni_offering1)

    def test_filter_muni_by_sp_rating_exact(self):
        data = {'sp_rating': 'A+'}
        qs = MunicipalOffering.objects.all()
        filterset = MuniOfferingFilterSet(data=data, queryset=qs)
        self.assertTrue(filterset.is_valid(), filterset.errors)
        self.assertEqual(filterset.qs.count(), 1)
        self.assertEqual(filterset.qs.first(), self.muni_offering2)

    def test_filter_muni_by_insurance_icontains(self):
        data = {'insurance': 'AGM'}
        qs = MunicipalOffering.objects.all()
        filterset = MuniOfferingFilterSet(data=data, queryset=qs)
        self.assertTrue(filterset.is_valid(), filterset.errors)
        self.assertEqual(filterset.qs.count(), 1)
        self.assertEqual(filterset.qs.first(), self.muni_offering1)

    def test_filter_muni_by_insurance_no_match(self): # New test
        data = {'insurance': 'NonExistentInsurer'}
        qs = MunicipalOffering.objects.all()
        filterset = MuniOfferingFilterSet(data=data, queryset=qs)
        self.assertTrue(filterset.is_valid(), filterset.errors)
        self.assertEqual(filterset.qs.count(), 0)

    # --- Range and DateRange filters for MuniOffering ---
    # For MuniOfferingFilterSet, the fields are directly named in Meta,
    # so RangeFilter params are <field_name>_min and <field_name>_max
    def test_filter_muni_by_amount_range(self):
        data = {'amount_min': "1000000", 'amount_max': "3000000"} # muni_offering2 (2M)
        qs = MunicipalOffering.objects.all()
        filterset = MuniOfferingFilterSet(data=data, queryset=qs)
        self.assertTrue(filterset.is_valid(), filterset.errors)
        self.assertEqual(filterset.qs.count(), 1)
        self.assertEqual(filterset.qs.first(), self.muni_offering2)

    def test_filter_muni_by_amount_only_min(self): # New test
        data = {'amount_min': "6000000"} # muni_offering3 (10M)
        qs = MunicipalOffering.objects.all()
        filterset = MuniOfferingFilterSet(data=data, queryset=qs)
        self.assertTrue(filterset.is_valid(), filterset.errors)
        self.assertEqual(filterset.qs.count(), 1)
        self.assertEqual(filterset.qs.first(), self.muni_offering3)

    def test_filter_muni_by_coupon_range(self):
        data = {'coupon_min': "3.0", 'coupon_max': "3.2"} # muni_offering1 (3.125)
        qs = MunicipalOffering.objects.all()
        filterset = MuniOfferingFilterSet(data=data, queryset=qs)
        self.assertTrue(filterset.is_valid(), filterset.errors)
        self.assertEqual(filterset.qs.count(), 1)
        self.assertEqual(filterset.qs.first(), self.muni_offering1)

    def test_filter_muni_by_coupon_only_max(self): # New test
        data = {'coupon_max': "3.0"} # muni_offering2 (2.75)
        qs = MunicipalOffering.objects.all()
        filterset = MuniOfferingFilterSet(data=data, queryset=qs)
        self.assertTrue(filterset.is_valid(), filterset.errors)
        self.assertEqual(filterset.qs.count(), 1)
        self.assertEqual(filterset.qs.first(), self.muni_offering2)

    def test_filter_muni_by_maturity_date_range(self):
        # DateFromToRangeFilter uses <field_name>_after, <field_name>_before
        data = {'maturity_date_after': date(2039,1,1).isoformat(), 'maturity_date_before': date(2045,1,1).isoformat()}
        qs = MunicipalOffering.objects.all()
        filterset = MuniOfferingFilterSet(data=data, queryset=qs)
        self.assertTrue(filterset.is_valid(), filterset.errors)
        self.assertEqual(filterset.qs.count(), 2) # muni_offering1 (2040), muni_offering3 (2045-01-01)
        self.assertIn(self.muni_offering1, filterset.qs)
        self.assertIn(self.muni_offering3, filterset.qs)


    def test_filter_muni_by_maturity_date_only_after(self): # New test
        data = {'maturity_date_after': date(2042,1,1).isoformat()} # muni_offering3 (2045)
        qs = MunicipalOffering.objects.all()
        filterset = MuniOfferingFilterSet(data=data, queryset=qs)
        self.assertTrue(filterset.is_valid(), filterset.errors)
        self.assertEqual(filterset.qs.count(), 1)
        self.assertEqual(filterset.qs.first(), self.muni_offering3)

    def test_filter_muni_by_maturity_date_only_before(self): # New test
        data = {'maturity_date_before': date(2036,1,1).isoformat()} # muni_offering2 (2035)
        qs = MunicipalOffering.objects.all()
        filterset = MuniOfferingFilterSet(data=data, queryset=qs)
        self.assertTrue(filterset.is_valid(), filterset.errors)
        self.assertEqual(filterset.qs.count(), 1)
        self.assertEqual(filterset.qs.first(), self.muni_offering2)

    def test_filter_muni_by_yield_rate_range(self): # 'yield' in frontend
        data = {'yield_rate_min': "3.5"} # muni_offering3 (3.60)
        qs = MunicipalOffering.objects.all()
        filterset = MuniOfferingFilterSet(data=data, queryset=qs)
        self.assertTrue(filterset.is_valid(), filterset.errors)
        self.assertEqual(filterset.qs.count(), 1)
        self.assertEqual(filterset.qs.first(), self.muni_offering3)

    def test_filter_muni_by_yield_rate_only_max(self): # New test
        data = {'yield_rate_max': "3.0"} # muni_offering2 (2.85)
        qs = MunicipalOffering.objects.all()
        filterset = MuniOfferingFilterSet(data=data, queryset=qs)
        self.assertTrue(filterset.is_valid(), filterset.errors)
        self.assertEqual(filterset.qs.count(), 1)
        self.assertEqual(filterset.qs.first(), self.muni_offering2)

    def test_filter_muni_by_price_range(self):
        data = {'price_min': D("99.0"), 'price_max': "100.00"} # muni_offering3 (99.75)
        qs = MunicipalOffering.objects.all()
        filterset = MuniOfferingFilterSet(data=data, queryset=qs)
        self.assertTrue(filterset.is_valid(), filterset.errors)
        self.assertEqual(filterset.qs.count(), 1)
        self.assertEqual(filterset.qs.first(), self.muni_offering3)

    def test_filter_muni_by_price_only_min(self): # New test
        data = {'price_min': "101.00"} # muni_offering1 (101.5)
        qs = MunicipalOffering.objects.all()
        filterset = MuniOfferingFilterSet(data=data, queryset=qs)
        self.assertTrue(filterset.is_valid(), filterset.errors)
        self.assertEqual(filterset.qs.count(), 1)
        self.assertEqual(filterset.qs.first(), self.muni_offering1)

    def test_filter_muni_by_call_date_range(self):
        # Only muni_offering2 has a call_date (2030-06-01)
        data = {'call_date_after': date(2030,1,1).isoformat(), 'call_date_before': date(2030,12,31).isoformat()}
        qs = MunicipalOffering.objects.all()
        filterset = MuniOfferingFilterSet(data=data, queryset=qs)
        self.assertTrue(filterset.is_valid(), filterset.errors)
        self.assertEqual(filterset.qs.count(), 1)
        self.assertEqual(filterset.qs.first(), self.muni_offering2)

    def test_filter_muni_by_call_date_only_after(self): # New test
        # Only muni_offering2 has a call_date (2030-06-01)
        data = {'call_date_after': date(2030,6,1).isoformat()}
        qs = MunicipalOffering.objects.all()
        filterset = MuniOfferingFilterSet(data=data, queryset=qs)
        self.assertTrue(filterset.is_valid(), filterset.errors)
        self.assertEqual(filterset.qs.count(), 1)
        self.assertEqual(filterset.qs.first(), self.muni_offering2)

    def test_filter_muni_by_call_date_only_before(self): # New test
        # Only muni_offering2 has a call_date (2030-06-01)
        data = {'call_date_before': date(2030,6,1).isoformat()}
        qs = MunicipalOffering.objects.all()
        filterset = MuniOfferingFilterSet(data=data, queryset=qs)
        self.assertTrue(filterset.is_valid(), filterset.errors)
        self.assertEqual(filterset.qs.count(), 1)
        self.assertEqual(filterset.qs.first(), self.muni_offering2)

    def test_filter_muni_by_call_date_no_call_date_excluded(self): # New test
        # This test ensures that items with NULL call_date are not matched by a range filter.
        # muni_offering1 and muni_offering3 have no call_date.
        data = {'call_date_after': date(2000,1,1).isoformat()} # A very early date
        qs = MunicipalOffering.objects.all()
        filterset = MuniOfferingFilterSet(data=data, queryset=qs)
        self.assertTrue(filterset.is_valid(), filterset.errors)
        self.assertEqual(filterset.qs.count(), 1) # Only muni_offering2 which has a call_date
        self.assertIn(self.muni_offering2, filterset.qs)
        self.assertNotIn(self.muni_offering1, filterset.qs)
        self.assertNotIn(self.muni_offering3, filterset.qs)


    def test_filter_muni_by_call_price_range(self):
        # Only muni_offering2 has a call_price (100)
        data = {'call_price_min': "99.0", 'call_price_max': "101.0"}
        qs = MunicipalOffering.objects.all()
        filterset = MuniOfferingFilterSet(data=data, queryset=qs)
        self.assertTrue(filterset.is_valid(), filterset.errors)
        self.assertEqual(filterset.qs.count(), 1)
        self.assertEqual(filterset.qs.first(), self.muni_offering2)

    def test_filter_muni_by_call_price_only_min(self): # New test
        # Only muni_offering2 has a call_price (100)
        data = {'call_price_min': "100.0"}
        qs = MunicipalOffering.objects.all()
        filterset = MuniOfferingFilterSet(data=data, queryset=qs)
        self.assertTrue(filterset.is_valid(), filterset.errors)
        self.assertEqual(filterset.qs.count(), 1)
        self.assertEqual(filterset.qs.first(), self.muni_offering2)

    # Add more tests for combinations and edge cases.
