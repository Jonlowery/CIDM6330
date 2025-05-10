# portfolio/tests/test_models.py
from django.test import TestCase
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import IntegrityError
from decimal import Decimal
import uuid
from datetime import date

# Import all your models
from portfolio.models import (
    Salesperson,
    SecurityType,
    InterestSchedule,
    Customer,
    Security,
    Portfolio,
    CustomerHolding,
    MunicipalOffering
)

User = get_user_model()

class SalespersonModelTest(TestCase):
    def test_salesperson_creation(self):
        salesperson = Salesperson.objects.create(
            salesperson_id="S123",
            name="John Doe",
            email="john.doe@example.com",
            is_active=True
        )
        self.assertEqual(salesperson.salesperson_id, "S123")
        self.assertEqual(str(salesperson), "John Doe (S123)")

    def test_salesperson_str_unnamed(self):
        salesperson = Salesperson.objects.create(salesperson_id="S456")
        self.assertEqual(str(salesperson), "Unnamed Salesperson (S456)")

    # Add more tests for unique constraints, email validation (if done at model level), etc.

class SecurityTypeModelTest(TestCase):
    def test_security_type_creation(self):
        sec_type = SecurityType.objects.create(type_id=1, name="Municipal Bond")
        self.assertEqual(sec_type.type_id, 1)
        self.assertEqual(str(sec_type), "Municipal Bond (1)")

    # Add tests for unique type_id, etc.

class InterestScheduleModelTest(TestCase):
    def test_interest_schedule_creation(self):
        schedule = InterestSchedule.objects.create(
            schedule_code="SA",
            name="Semiannual",
            payments_per_year_default=2
        )
        self.assertEqual(schedule.schedule_code, "SA")
        self.assertEqual(str(schedule), "Semiannual (SA)")

    # Add tests for unique schedule_code, etc.


class CustomerModelTest(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.salesperson = Salesperson.objects.create(salesperson_id="SP001", name="Test Salesperson")
        cls.customer = Customer.objects.create(
            customer_number=1001,
            name="Test Customer Inc.",
            city="Testville",
            state="TS",
            salesperson=cls.salesperson,
            portfolio_accounting_code="ACC001"
        )

    def test_customer_creation(self):
        self.assertEqual(self.customer.customer_number, 1001)
        self.assertEqual(self.customer.name, "Test Customer Inc.")
        self.assertEqual(str(self.customer), "Test Customer Inc. (1001)")

    def test_customer_salesperson_relationship(self):
        self.assertEqual(self.customer.salesperson, self.salesperson)

    def test_unique_customer_number(self):
        with self.assertRaises(IntegrityError):
            Customer.objects.create(
                customer_number=1001, # Duplicate
                name="Another Customer",
                city="Otherville",
                state="OS",
                salesperson=self.salesperson,
                portfolio_accounting_code="ACC002"
            )
    # Add tests for required fields (name, city, state, portfolio_accounting_code)
    # Add tests for state MinLengthValidator if desired (though often covered by forms/serializers)

class SecurityModelTest(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.sec_type = SecurityType.objects.create(type_id=1, name="Corp Bond")
        cls.int_schedule = InterestSchedule.objects.create(schedule_code="ANN", name="Annual")
        cls.security = Security.objects.create(
            cusip="TESTCUSIP",
            description="Test Corporate Bond",
            issue_date=date(2020, 1, 1),
            maturity_date=date(2030, 1, 1),
            security_type=cls.sec_type,
            coupon=Decimal("5.0"),
            tax_code='t', # Taxable
            interest_schedule=cls.int_schedule,
            interest_day=15,
            interest_calc_code='a', # Actual
            payments_per_year=1,
            allows_paydown=False,
            payment_delay_days=0,
            factor=Decimal("1.0")
        )

    def test_security_creation(self):
        self.assertEqual(self.security.cusip, "TESTCUSIP")
        self.assertEqual(str(self.security), "Test Corporate Bond (TESTCUSIP)")
        self.assertEqual(self.security.cpr, None) # Example: testing default of CPR

    def test_unique_cusip(self):
        with self.assertRaises(IntegrityError):
            Security.objects.create(
                cusip="TESTCUSIP", # Duplicate
                description="Another Bond",
                issue_date=date(2021, 1, 1),
                maturity_date=date(2031, 1, 1),
                tax_code='e', interest_day=1, interest_calc_code='c',
                payments_per_year=2, allows_paydown=False, payment_delay_days=0
            )
    # Add tests for required fields, date validations (maturity > issue), choices, factor logic if any at model level.

class PortfolioModelTest(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.customer = Customer.objects.create(
            customer_number=1002, name="Portfolio Owner", city="City", state="ST",
            portfolio_accounting_code="PAC01"
        )
        cls.portfolio1 = Portfolio.objects.create(owner=cls.customer, name="Retirement Fund", is_default=True)
        cls.portfolio2 = Portfolio.objects.create(owner=cls.customer, name="College Fund")


    def test_portfolio_creation(self):
        self.assertEqual(self.portfolio1.name, "Retirement Fund")
        self.assertEqual(str(self.portfolio1), "Retirement Fund [DEFAULT] (Owner: 1002)")
        self.assertEqual(str(self.portfolio2), "College Fund (Owner: 1002)")


    def test_unique_default_portfolio_per_owner(self):
        # This constraint is unique_default_portfolio_per_owner
        with self.assertRaises(IntegrityError):
            Portfolio.objects.create(owner=self.customer, name="Another Default", is_default=True)

    def test_portfolio_on_delete_customer(self):
        customer_id = self.customer.id
        self.customer.delete()
        self.assertFalse(Portfolio.objects.filter(owner_id=customer_id).exists())


class CustomerHoldingModelTest(TestCase):
    @classmethod
    def setUpTestData(cls):
        customer = Customer.objects.create(customer_number=1003, name="Holding Owner", city="CityX", state="CX", portfolio_accounting_code="PACX")
        portfolio = Portfolio.objects.create(owner=customer, name="Main Holdings")
        security = Security.objects.create(
            cusip="HOLDSEC01", description="Holding Security", issue_date=date(2020,1,1),
            maturity_date=date(2030,1,1), tax_code='t', interest_day=1,
            interest_calc_code='a', payments_per_year=1, allows_paydown=False, payment_delay_days=0
        )
        cls.holding = CustomerHolding.objects.create(
            external_ticket=9001,
            portfolio=portfolio,
            security=security,
            intention_code='A', # Available for Sale
            original_face_amount=Decimal("100000.00"),
            settlement_date=date(2023,1,15),
            settlement_price=Decimal("101.50"),
            book_price=Decimal("101.00")
        )

    def test_customer_holding_creation(self):
        self.assertEqual(self.holding.external_ticket, 9001)
        expected_str = "Holding 9001 — HOLDSEC01 (100,000.00) in Portfolio 'Main Holdings'" # Adjust formatting if needed
        self.assertEqual(str(self.holding), expected_str)

    def test_unique_external_ticket(self):
        with self.assertRaises(IntegrityError):
            CustomerHolding.objects.create(
                external_ticket=9001, # Duplicate
                portfolio=self.holding.portfolio,
                security=self.holding.security,
                intention_code='M', original_face_amount=50000, settlement_date=date(2023,2,1),
                settlement_price=100, book_price=100
            )
    # Test on_delete behaviors for portfolio and security

class MunicipalOfferingModelTest(TestCase):
    def test_municipal_offering_creation(self):
        offering = MunicipalOffering.objects.create(
            cusip="MUNI00001",
            description="Test Muni Offering",
            amount=Decimal("5000000.00"),
            coupon=Decimal("3.5"),
            maturity_date=date(2035, 6, 1),
            price=Decimal("102.75")
        )
        self.assertEqual(offering.cusip, "MUNI00001")
        self.assertEqual(str(offering), "Offering: MUNI00001 - Test Muni Offering")

    def test_unique_cusip_offering(self):
        MunicipalOffering.objects.create(cusip="MUNI00002", description="First Offering")
        with self.assertRaises(IntegrityError):
            MunicipalOffering.objects.create(cusip="MUNI00002", description="Duplicate Offering")

# Add more model tests as needed, especially for any custom logic or complex constraints.
