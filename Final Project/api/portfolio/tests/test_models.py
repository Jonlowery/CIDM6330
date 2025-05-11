# portfolio/tests/test_models.py
from django.test import TestCase
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from decimal import Decimal
import uuid
from datetime import date, timedelta
import time # For the auto_now test

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
        self.assertEqual(salesperson.name, "John Doe")
        self.assertEqual(salesperson.email, "john.doe@example.com")
        self.assertTrue(salesperson.is_active)
        self.assertEqual(str(salesperson), "John Doe (S123)")

    def test_salesperson_str_unnamed(self):
        salesperson = Salesperson.objects.create(salesperson_id="S456")
        self.assertEqual(str(salesperson), "Unnamed Salesperson (S456)")

    def test_salesperson_id_unique(self):
        Salesperson.objects.create(salesperson_id="S789", name="Jane Doe")
        with self.assertRaises(IntegrityError):
            Salesperson.objects.create(salesperson_id="S789", name="Another Jane")

    def test_salesperson_email_can_be_duplicate(self):
        # Based on models.py: "# *** REMOVED: Allow duplicate emails ***"
        Salesperson.objects.create(salesperson_id="S001", name="First Seller", email="duplicate@example.com")
        try:
            Salesperson.objects.create(salesperson_id="S002", name="Second Seller", email="duplicate@example.com")
        except IntegrityError:
            self.fail("Salesperson email should allow duplicates, but IntegrityError was raised.")
        # Assert that two salespersons with the same email exist
        self.assertEqual(Salesperson.objects.filter(email="duplicate@example.com").count(), 2)


    def test_salesperson_is_active_default(self):
        salesperson = Salesperson.objects.create(salesperson_id="S003")
        self.assertTrue(salesperson.is_active, "is_active should default to True")

    def test_salesperson_nullable_blankable_fields(self):
        # Test creation with name and email as None (blank=True, null=True)
        salesperson_none = Salesperson.objects.create(salesperson_id="S004", name=None, email=None)
        self.assertIsNone(salesperson_none.name)
        self.assertIsNone(salesperson_none.email)

        # Test creation with name as empty string (blank=True)
        salesperson_blank_name = Salesperson.objects.create(salesperson_id="S005", name="", email="valid@example.com")
        self.assertEqual(salesperson_blank_name.name, "")
        # EmailField with blank=True, null=True: empty string is not a valid email, so it should be None or a valid email.
        # If you try to save email="", it would raise ValidationError on full_clean().
        # Salesperson.objects.create(salesperson_id="S006", email="") would likely fail or save None depending on DB.
        # For this test, we've established name="" is okay.


class SecurityTypeModelTest(TestCase):
    def test_security_type_creation(self):
        sec_type = SecurityType.objects.create(type_id=1, name="Municipal Bond", description="General Obligation")
        self.assertEqual(sec_type.type_id, 1)
        self.assertEqual(sec_type.name, "Municipal Bond")
        self.assertEqual(sec_type.description, "General Obligation")
        self.assertEqual(str(sec_type), "Municipal Bond (1)")

    def test_security_type_id_unique(self):
        SecurityType.objects.create(type_id=2, name="Corporate Bond")
        with self.assertRaises(IntegrityError):
            SecurityType.objects.create(type_id=2, name="Another Corp Bond")

    def test_security_type_name_can_be_duplicate(self):
        # Based on models.py: "# *** REMOVED unique=True from name field ***"
        SecurityType.objects.create(type_id=3, name="Duplicate Name")
        try:
            SecurityType.objects.create(type_id=4, name="Duplicate Name")
        except IntegrityError:
            self.fail("SecurityType name should allow duplicates, but IntegrityError was raised.")
        self.assertEqual(SecurityType.objects.filter(name="Duplicate Name").count(), 2)

    def test_security_type_description_optional(self):
        # description is (blank=True, null=True)
        sec_type_no_desc = SecurityType.objects.create(type_id=5, name="No Description Type", description=None)
        self.assertIsNone(sec_type_no_desc.description)
        self.assertEqual(str(sec_type_no_desc), "No Description Type (5)")

        sec_type_with_empty_desc = SecurityType.objects.create(type_id=6, name="With Empty Description Type", description="")
        self.assertEqual(sec_type_with_empty_desc.description, "")


class InterestScheduleModelTest(TestCase):
    def test_interest_schedule_creation(self):
        schedule = InterestSchedule.objects.create(
            schedule_code="SA",
            name="Semiannual",
            payments_per_year_default=2,
            description="Pays twice a year"
        )
        self.assertEqual(schedule.schedule_code, "SA")
        self.assertEqual(schedule.name, "Semiannual")
        self.assertEqual(schedule.payments_per_year_default, 2)
        self.assertEqual(schedule.description, "Pays twice a year")
        self.assertEqual(str(schedule), "Semiannual (SA)")

    def test_interest_schedule_code_unique(self):
        InterestSchedule.objects.create(schedule_code="ANN", name="Annual")
        with self.assertRaises(IntegrityError):
            InterestSchedule.objects.create(schedule_code="ANN", name="Another Annual")

    def test_interest_schedule_name_can_be_duplicate(self):
        # Based on models.py: "# *** REMOVED unique=True from name field ***"
        InterestSchedule.objects.create(schedule_code="MTH", name="Duplicate Schedule Name", payments_per_year_default=12)
        try:
            InterestSchedule.objects.create(schedule_code="BIM", name="Duplicate Schedule Name", payments_per_year_default=6)
        except IntegrityError:
            self.fail("InterestSchedule name should allow duplicates, but IntegrityError was raised.")
        self.assertEqual(InterestSchedule.objects.filter(name="Duplicate Schedule Name").count(), 2)


    def test_interest_schedule_description_optional(self):
        # description is (blank=True, null=True)
        schedule_no_desc = InterestSchedule.objects.create(schedule_code="QTR", name="Quarterly", description=None)
        self.assertIsNone(schedule_no_desc.description)
        self.assertEqual(str(schedule_no_desc), "Quarterly (QTR)")

        schedule_empty_desc = InterestSchedule.objects.create(schedule_code="YRL", name="Yearly", description="")
        self.assertEqual(schedule_empty_desc.description, "")


    def test_interest_schedule_payments_per_year_default_nullable(self):
        schedule = InterestSchedule.objects.create(schedule_code="VAR", name="Variable", payments_per_year_default=None)
        self.assertIsNone(schedule.payments_per_year_default)


class CustomerModelTest(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.salesperson = Salesperson.objects.create(salesperson_id="SP001", name="Test Salesperson")
        cls.user1 = User.objects.create_user(username="user1", password="password123")
        cls.user2 = User.objects.create_user(username="user2", password="password123")
        cls.customer_base_data = {
            "customer_number": 1001, # This will be incremented in tests needing unique
            "name": "Test Customer Inc.",
            "city": "Testville",
            "state": "TS",
            "salesperson": cls.salesperson,
            "portfolio_accounting_code": "ACC001",
        }
        cls.customer_full_data = {
            **cls.customer_base_data,
            "address": "123 Main St",
            "cost_of_funds_rate": Decimal("0.0123"),
            "federal_tax_bracket_rate": Decimal("0.35")
        }
        cls.customer = Customer.objects.create(**cls.customer_full_data)
        cls.customer.users.add(cls.user1)

    def test_customer_creation(self):
        self.assertEqual(self.customer.customer_number, 1001)
        self.assertEqual(self.customer.name, "Test Customer Inc.")
        self.assertEqual(self.customer.city, "Testville")
        self.assertEqual(self.customer.state, "TS")
        self.assertEqual(self.customer.salesperson, self.salesperson)
        self.assertEqual(self.customer.portfolio_accounting_code, "ACC001")
        self.assertEqual(self.customer.address, "123 Main St")
        self.assertEqual(self.customer.cost_of_funds_rate, Decimal("0.0123"))
        self.assertEqual(self.customer.federal_tax_bracket_rate, Decimal("0.35"))
        self.assertEqual(str(self.customer), "Test Customer Inc. (1001)")
        self.assertIsNotNone(self.customer.unique_id)

    def test_customer_salesperson_relationship(self):
        self.assertEqual(self.customer.salesperson, self.salesperson)

    def test_unique_customer_number(self):
        with self.assertRaises(IntegrityError):
            Customer.objects.create(**{**self.customer_base_data, "customer_number": 1001}) # Duplicate

    def test_customer_required_char_fields_blank(self):
        # Test blank=False for CharFields (name, city, state, portfolio_accounting_code)
        # These should raise ValidationError on full_clean() if empty string.
        # Customer.name: blank=False, null=False
        # Customer.city: blank=False, null=False
        # Customer.state: blank=False, null=False (also has MinLengthValidator)
        # Customer.portfolio_accounting_code: blank=False, null=False
        required_char_fields = ["name", "city", "portfolio_accounting_code"] # state is tested separately with its validator
        for field_name in required_char_fields:
            data = {**self.customer_base_data, "customer_number": 1002 + required_char_fields.index(field_name)}
            data[field_name] = "" # Set to empty string
            customer_instance = Customer(**data)
            with self.assertRaises(ValidationError, msg=f"Field '{field_name}' with empty string should raise ValidationError on full_clean()"):
                customer_instance.full_clean()

    def test_customer_required_fields_null(self):
        # Test null=False for all required fields
        # These should raise IntegrityError on create() if None.
        required_fields = ["name", "city", "state", "portfolio_accounting_code"]
        for i, field_name in enumerate(required_fields):
            data = {**self.customer_base_data, "customer_number": 1010 + i}
            data[field_name] = None # Set to None
            # Each failing create should be in its own transaction context for testing if TransactionManagementError occurs
            with transaction.atomic():
                with self.assertRaises(IntegrityError, msg=f"Field '{field_name}' as None should raise IntegrityError on create()"):
                    Customer.objects.create(**data)


    def test_customer_state_validator(self):
        # Test state MinLengthValidator and null=False/blank=False
        # Test blank=False for state
        customer_empty_state = Customer(**{**self.customer_base_data, "customer_number": 1003, "state": ""})
        with self.assertRaises(ValidationError, msg="State as empty string should fail full_clean() due to blank=False and MinLengthValidator"):
            customer_empty_state.full_clean()

        # Test MinLengthValidator for state
        customer_short_state = Customer(**{**self.customer_base_data, "customer_number": 1004, "state": "T"})
        with self.assertRaises(ValidationError, msg="State with one char should fail MinLengthValidator"):
            customer_short_state.full_clean()

        customer_valid_state = Customer(**{**self.customer_base_data, "customer_number": 1005, "state": "TX"})
        try:
            customer_valid_state.full_clean() # Should pass
            customer_valid_state.save()
        except ValidationError:
            self.fail("Customer with valid state 'TX' should not raise ValidationError")


    def test_customer_users_m2m(self):
        self.assertIn(self.user1, self.customer.users.all())
        self.customer.users.add(self.user2)
        self.assertIn(self.user2, self.customer.users.all())
        self.assertEqual(self.customer.users.count(), 2)
        self.customer.users.remove(self.user1)
        self.assertNotIn(self.user1, self.customer.users.all())
        self.assertEqual(self.customer.users.count(), 1)

    def test_customer_salesperson_on_delete_set_null(self):
        customer_with_sp = Customer.objects.create(
            **{**self.customer_base_data, "customer_number": 1020, "salesperson": self.salesperson}
        )
        salesperson_pk = self.salesperson.pk # Use pk for safety
        Salesperson.objects.filter(pk=salesperson_pk).delete()
        customer_with_sp.refresh_from_db()
        self.assertIsNone(customer_with_sp.salesperson)

    def test_customer_optional_fields(self):
        # address (CharField, blank=True, null=True)
        # cost_of_funds_rate (DecimalField, null=True, blank=True)
        # federal_tax_bracket_rate (DecimalField, null=True, blank=True)
        customer_minimal = Customer.objects.create(
            **{**self.customer_base_data, "customer_number": 1021,
               "address": None, "cost_of_funds_rate": None, "federal_tax_bracket_rate": None}
        )
        self.assertIsNone(customer_minimal.address)
        self.assertIsNone(customer_minimal.cost_of_funds_rate)
        self.assertIsNone(customer_minimal.federal_tax_bracket_rate)

        customer_blank_addr = Customer.objects.create(
             **{**self.customer_base_data, "customer_number": 1022, "address": ""}
        )
        self.assertEqual(customer_blank_addr.address, "")


class SecurityModelTest(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.sec_type = SecurityType.objects.create(type_id=1, name="Corp Bond")
        cls.int_schedule = InterestSchedule.objects.create(schedule_code="ANN", name="Annual", payments_per_year_default=1)
        cls.today = date.today()
        # Base data includes all fields that are null=False, blank=False (or have defaults)
        # to ensure a valid starting point before modifying for specific null tests.
        cls.security_base_data = {
            "cusip": "BASECUSIP", # Will be changed in tests needing unique
            "description": "Test Corporate Bond",
            "issue_date": cls.today - timedelta(days=365),
            "maturity_date": cls.today + timedelta(days=3650),
            "tax_code": 't', # Valid choice, null=False, blank=False
            "interest_day": 15, # null=False
            "interest_calc_code": 'a', # Valid choice, null=False, blank=False
            "payments_per_year": 1, # null=False
            "allows_paydown": False, # BooleanField, null=False (defaults to False)
            "payment_delay_days": 0, # null=False
            "factor": Decimal("1.0") # Has default
        }
        cls.security_full_data = { # Extends base_data with optional/nullable fields
            **cls.security_base_data,
            "cusip": "TESTCUSIP", # Override for this specific instance
            "security_type": cls.sec_type,
            "coupon": Decimal("5.0"),
            "secondary_rate": Decimal("5.1"),
            "rate_effective_date": cls.today - timedelta(days=30),
            "interest_schedule": cls.int_schedule,
            "call_date": cls.today + timedelta(days=180),
            "wal": Decimal("7.5"),
            "cpr": Decimal("6.0"),
            "issuer_name": "Test Issuer Inc.",
            "currency": "USD",
            "callable_flag": True, 
            "moody_rating": "Aaa",
            "sp_rating": "AAA",
            "fitch_rating": "AAA",
            "sector": "Corporate",
            "state_of_issuer": "NY"
        }
        cls.security = Security.objects.create(**cls.security_full_data)

    def test_security_creation(self):
        self.assertEqual(self.security.cusip, "TESTCUSIP")
        self.assertEqual(str(self.security), "Test Corporate Bond (TESTCUSIP)")
        self.assertEqual(self.security.cpr, Decimal("6.0"))
        self.assertEqual(self.security.secondary_rate, Decimal("5.1"))
        self.assertEqual(self.security.rate_effective_date, self.today - timedelta(days=30))
        self.assertEqual(self.security.issuer_name, "Test Issuer Inc.")
        self.assertEqual(self.security.currency, "USD")
        self.assertTrue(self.security.callable_flag)
        self.assertEqual(self.security.moody_rating, "Aaa")
        self.assertEqual(self.security.sp_rating, "AAA")
        self.assertEqual(self.security.fitch_rating, "AAA")
        self.assertEqual(self.security.sector, "Corporate")
        self.assertEqual(self.security.state_of_issuer, "NY")
        self.assertEqual(self.security.call_date, self.today + timedelta(days=180))
        self.assertEqual(self.security.wal, Decimal("7.5"))


    def test_unique_cusip(self):
        with self.assertRaises(IntegrityError):
            # Create a security with all required fields from base_data, but with a duplicate CUSIP
            Security.objects.create(**{**self.security_base_data, "cusip": "TESTCUSIP"}) 

    def test_security_required_char_fields_blank(self):
        # Security.description: blank=False, null=False
        # For CharFields that are blank=False, an empty string should raise ValidationError on full_clean()
        data = {**self.security_base_data, "cusip": "NEWCUSIP1_BLANK_DESC", "description": ""}
        sec_instance = Security(**data)
        with self.assertRaises(ValidationError, msg="Field 'description' with empty string should raise ValidationError on full_clean()"):
            sec_instance.full_clean()
        
        # Test for tax_code and interest_calc_code (blank=False and choices)
        # "" is not a valid choice, so full_clean() should fail.
        choice_fields_blank = {"tax_code": "t", "interest_calc_code": "a"} # Need valid values for other fields
        for i, field_name in enumerate(choice_fields_blank.keys()):
            data = {**self.security_base_data, "cusip": f"NEWCUSIP1_BLANK_CHOICE{i}_{field_name}"}
            data[field_name] = "" # Set to empty string
            sec_instance = Security(**data)
            with self.assertRaises(ValidationError, msg=f"Field '{field_name}' with empty string should raise ValidationError on full_clean() due to invalid choice"):
                sec_instance.full_clean()


    def test_security_required_fields_null(self):
        # This test checks if explicitly passing None to a null=False field raises IntegrityError upon create()

        # Test null=False for CharField 'description'
        with transaction.atomic():
            with self.assertRaises(IntegrityError, msg="Field 'description' as None should raise IntegrityError on create()"):
                Security.objects.create(**{**self.security_base_data, "cusip": "SEC_DESC_NULL", "description": None})

        # Test null=False for DateFields
        date_fields = ["issue_date", "maturity_date"]
        for idx, field_name in enumerate(date_fields):
            data = {**self.security_base_data, "cusip": f"SEC_DATE_NULL_{idx}_{field_name}"}
            data[field_name] = None 
            with transaction.atomic():
                with self.assertRaises(IntegrityError, msg=f"Field '{field_name}' as None should raise IntegrityError on create()"):
                    Security.objects.create(**data)
        
        # Test null=False for CharFields with choices
        choice_char_fields = ["tax_code", "interest_calc_code"]
        for idx, field_name in enumerate(choice_char_fields):
            data = {**self.security_base_data, "cusip": f"SEC_CHOICE_NULL_{idx}_{field_name}"}
            data[field_name] = None 
            with transaction.atomic():
                with self.assertRaises(IntegrityError, msg=f"Field '{field_name}' as None should raise IntegrityError on create()"):
                    Security.objects.create(**data)

        # Test null=False for PositiveSmallIntegerFields
        # allows_paydown (BooleanField) is null=False by default and defaults to False if not provided, so not tested for None here.
        # factor (DecimalField) has a default, so not tested for None here.
        positive_small_int_fields = ["interest_day", "payments_per_year", "payment_delay_days"]
        for idx, field_name in enumerate(positive_small_int_fields):
            data = {**self.security_base_data, "cusip": f"SEC_PSINT_NULL_{idx}_{field_name}"}
            data[field_name] = None 
            with transaction.atomic():
                with self.assertRaises(IntegrityError, msg=f"Field '{field_name}' as None should raise IntegrityError on create()"):
                    Security.objects.create(**data)


    def test_security_cusip_validator(self):
        with self.assertRaises(ValidationError):
            sec = Security(**{**self.security_full_data, "cusip": "SHORT"})
            sec.full_clean()
        with self.assertRaises(ValidationError):
            sec = Security(**{**self.security_full_data, "cusip": "TOOLONG123"})
            sec.full_clean()

    def test_security_interest_day_validator(self):
        with self.assertRaises(ValidationError): # MinValueValidator
            sec = Security(**{**self.security_full_data, "cusip": "DAYVAL0", "interest_day": 0})
            sec.full_clean()
        with self.assertRaises(ValidationError): # MaxValueValidator
            sec = Security(**{**self.security_full_data, "cusip": "DAYVAL32", "interest_day": 32})
            sec.full_clean()

    def test_security_state_of_issuer_validator(self):
        # state_of_issuer allows null=True, blank=True, but has MinLengthValidator(2) if a value is provided
        with self.assertRaises(ValidationError):
            sec = Security(**{**self.security_full_data, "cusip": "STATEVAL1", "state_of_issuer": "N"})
            sec.full_clean()
        sec_valid = Security(**{**self.security_full_data, "cusip": "STATEVAL2", "state_of_issuer": "CA"})
        try:
            sec_valid.full_clean()
        except ValidationError:
            self.fail("Valid state_of_issuer failed validation.")
        # Test blank is okay
        sec_blank_state = Security(**{**self.security_full_data, "cusip": "STATEVAL3", "state_of_issuer": ""})
        try:
            sec_blank_state.full_clean() # Should pass as blank=True
        except ValidationError:
            self.fail("Blank state_of_issuer should be valid.")


    def test_security_tax_code_choices(self):
        with self.assertRaises(ValidationError):
            sec = Security(**{**self.security_full_data, "cusip": "TAXCODEINV", "tax_code": "x"}) # "x" is invalid
            sec.full_clean()

    def test_security_interest_calc_code_choices(self):
        with self.assertRaises(ValidationError):
            sec = Security(**{**self.security_full_data, "cusip": "CALCODEINV", "interest_calc_code": "x"}) # "x" is invalid
            sec.full_clean()

    def test_security_type_on_delete_set_null(self):
        sec_type_temp = SecurityType.objects.create(type_id=99, name="Temp Type")
        sec = Security.objects.create(**{**self.security_full_data, "cusip": "SECTYPDEL", "security_type": sec_type_temp})
        sec_type_temp_pk = sec_type_temp.pk
        SecurityType.objects.filter(pk=sec_type_temp_pk).delete()
        sec.refresh_from_db()
        self.assertIsNone(sec.security_type)

    def test_interest_schedule_on_delete_set_null(self):
        int_sch_temp = InterestSchedule.objects.create(schedule_code="TMP", name="Temp Schedule")
        sec = Security.objects.create(**{**self.security_full_data, "cusip": "INTSCHDEL", "interest_schedule": int_sch_temp})
        int_sch_temp_pk = int_sch_temp.pk
        InterestSchedule.objects.filter(pk=int_sch_temp_pk).delete()
        sec.refresh_from_db()
        self.assertIsNone(sec.interest_schedule)

    def test_security_nullable_fields(self):
        # Test fields that can be null/blank
        # Create a security with only the absolute minimal required fields, setting others to None or ""
        minimal_required_data_for_nullable_test = {
            "cusip": "NULLSEC01", 
            "description": "Nullable Sec Description", 
            "issue_date": self.today,
            "maturity_date": self.today + timedelta(days=10), 
            "tax_code": 't', 
            "interest_day": 1,
            "interest_calc_code": 'a', 
            "payments_per_year": 1, 
            "allows_paydown": False, 
            "payment_delay_days": 0,
            # Now set nullable fields to None
            "coupon": None, "secondary_rate": None, "rate_effective_date": None, "security_type": None,
            "interest_schedule": None, "call_date": None, "wal": None, "cpr": None, "issuer_name": None,
            "currency": None, "moody_rating": None, "sp_rating": None, "fitch_rating": None,
            "sector": None, "state_of_issuer": None # state_of_issuer is (null=True, blank=True)
        }
        sec = Security.objects.create(**minimal_required_data_for_nullable_test)
        
        nullable_field_names = ["coupon", "secondary_rate", "rate_effective_date", "security_type",
                                "interest_schedule", "call_date", "wal", "cpr", "issuer_name",
                                "currency", "moody_rating", "sp_rating", "fitch_rating", "sector", "state_of_issuer"]
        for field in nullable_field_names:
            self.assertIsNone(getattr(sec, field), f"Field {field} should be None")

        # Test blank values for CharFields that allow it (issuer_name, currency, ratings, sector, state_of_issuer)
        # These fields are also null=True, so setting to "" is also a valid test for blank=True
        blankable_char_fields_data = {
            **self.security_base_data, "cusip": "BLANKSEC01", # Use base_data which has all required non-nullable fields
            "issuer_name": "", "currency": "", "moody_rating": "", "sp_rating": "", "fitch_rating": "",
            "sector": "", "state_of_issuer": "" 
        }
        sec_blank = Security.objects.create(**blankable_char_fields_data)
        blankable_char_field_names = ["issuer_name", "currency", "moody_rating", "sp_rating", "fitch_rating", "sector", "state_of_issuer"]
        for field in blankable_char_field_names:
             self.assertEqual(getattr(sec_blank, field), "", f"Field {field} should be blank")


class PortfolioModelTest(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.owner_customer = Customer.objects.create(
            customer_number=1002, name="Portfolio Owner", city="City", state="ST",
            portfolio_accounting_code="PAC01"
        )
        cls.portfolio1 = Portfolio.objects.create(owner=cls.owner_customer, name="Retirement Fund", is_default=True)

    def test_portfolio_creation(self):
        self.assertEqual(self.portfolio1.name, "Retirement Fund")
        self.assertTrue(self.portfolio1.is_default)
        self.assertEqual(self.portfolio1.owner, self.owner_customer)
        self.assertEqual(str(self.portfolio1), "Retirement Fund [DEFAULT] (Owner: 1002)")

        portfolio2 = Portfolio.objects.create(owner=self.owner_customer, name="College Fund", is_default=False)
        # Adjusted to expect two spaces due to model's __str__ formatting for non-default.
        self.assertEqual(str(portfolio2), f"College Fund  (Owner: {self.owner_customer.customer_number})", 
                         "Confirm __str__ formatting for non-default portfolio. Expecting two spaces after name.")

    def test_unique_default_portfolio_per_owner(self):
        # self.portfolio1 is already a default for self.owner_customer
        with self.assertRaises(IntegrityError):
            Portfolio.objects.create(owner=self.owner_customer, name="Another Default", is_default=True)

    def test_can_have_multiple_non_default_portfolios(self):
        # self.portfolio1 is default. We create two new non-default portfolios.
        Portfolio.objects.create(owner=self.owner_customer, name="Savings Fund", is_default=False)
        Portfolio.objects.create(owner=self.owner_customer, name="Vacation Fund", is_default=False)
        # So, there should be 2 non-default portfolios for this owner.
        self.assertEqual(self.owner_customer.portfolios.filter(is_default=False).count(), 2)


    def test_portfolio_on_delete_customer_cascades(self):
        customer_temp = Customer.objects.create(
            customer_number=1099, name="Temp Owner", city="Tmp", state="TM", portfolio_accounting_code="TMP01"
        )
        Portfolio.objects.create(owner=customer_temp, name="Temp Portfolio", is_default=True)
        self.assertTrue(Portfolio.objects.filter(owner=customer_temp).exists())
        
        customer_temp_pk = customer_temp.pk
        customer_temp.delete() # Cascade delete should occur
        
        self.assertFalse(Portfolio.objects.filter(owner_id=customer_temp_pk).exists())

    def test_portfolio_name_is_none(self):
        # Test null=False for name
        with self.assertRaises(IntegrityError, msg="Portfolio name=None should raise IntegrityError on create()"):
            Portfolio.objects.create(owner=self.owner_customer, name=None, is_default=False)

    def test_portfolio_name_is_blank(self):
        # Test blank=False for name
        portfolio_no_name = Portfolio(owner=self.owner_customer, name="", is_default=False)
        with self.assertRaises(ValidationError, msg="Portfolio name='' should raise ValidationError on full_clean()"):
            portfolio_no_name.full_clean()


    def test_change_default_portfolio(self):
        # self.portfolio1 is initially default
        owner_customer = self.portfolio1.owner
        portfolio_new_default = Portfolio.objects.create(owner=owner_customer, name="New Main Fund", is_default=False)

        # Make old default non-default
        self.portfolio1.is_default = False
        self.portfolio1.save()

        # Make new portfolio default
        portfolio_new_default.is_default = True
        portfolio_new_default.save() # This should now succeed

        self.portfolio1.refresh_from_db()
        portfolio_new_default.refresh_from_db()

        self.assertTrue(portfolio_new_default.is_default)
        self.assertFalse(self.portfolio1.is_default, "Old default portfolio should now be non-default.")


class CustomerHoldingModelTest(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.customer = Customer.objects.create(customer_number=1003, name="Holding Owner", city="CityX", state="CX", portfolio_accounting_code="PACX")
        cls.portfolio = Portfolio.objects.create(owner=cls.customer, name="Main Holdings", is_default=True)
        cls.security_details_for_holding = {
            "cusip":"HOLDSEC01", "description":"Holding Security", "issue_date":date(2020,1,1),
            "maturity_date":date(2030,1,1), "tax_code":'t', "interest_day":1,
            "interest_calc_code":'a', "payments_per_year":1, "allows_paydown":False, "payment_delay_days":0
        }
        cls.security = Security.objects.create(**cls.security_details_for_holding)
        
        cls.holding_base_data = {
            "external_ticket": 9001, # Will be incremented
            "portfolio": cls.portfolio,
            "security": cls.security,
            "intention_code": 'A',
            "original_face_amount": Decimal("100000.00"),
            "settlement_date": date(2023,1,15),
            "settlement_price": Decimal("101.50"),
            "book_price": Decimal("101.00"),
        }
        cls.holding_full_data = {
            **cls.holding_base_data,
            "book_yield": Decimal("0.045"),
            "holding_duration": Decimal("5.25"),
            "holding_average_life": Decimal("6.75"),
            "holding_average_life_date": date(2023,1,1),
            "market_date": date(2023,2,1),
            "market_price": Decimal("102.00"),
            "market_yield": Decimal("0.043")
        }
        cls.holding = CustomerHolding.objects.create(**cls.holding_full_data)

    def test_customer_holding_creation(self):
        self.assertEqual(self.holding.external_ticket, 9001)
        self.assertEqual(self.holding.intention_code, 'A')
        expected_str = "Holding 9001 — HOLDSEC01 (100,000.00) in Portfolio 'Main Holdings'"
        self.assertEqual(str(self.holding), expected_str)
        self.assertIsNotNone(self.holding.ticket_id)


    def test_unique_external_ticket(self):
        with self.assertRaises(IntegrityError):
            CustomerHolding.objects.create(**{**self.holding_base_data, "external_ticket": 9001}) # Duplicate


    def test_customer_holding_required_char_fields_blank(self):
        # intention_code: choices, blank=False, null=False
        data = {**self.holding_base_data, "external_ticket": 9002, "intention_code": ""}
        holding_instance = CustomerHolding(**data)
        with self.assertRaises(ValidationError, msg="Field 'intention_code' with empty string should raise ValidationError on full_clean()"):
            holding_instance.full_clean()


    def test_customer_holding_required_fields_null(self):
        # Test null=False for various required fields
        # intention_code (CharField)
        with transaction.atomic():
            with self.assertRaises(IntegrityError, msg="Field 'intention_code' as None should raise IntegrityError on create()"):
                CustomerHolding.objects.create(**{**self.holding_base_data, "external_ticket": 9003, "intention_code": None})

        # DecimalFields (original_face_amount, settlement_price, book_price)
        decimal_fields = ["original_face_amount", "settlement_price", "book_price"]
        for idx, field_name in enumerate(decimal_fields):
            data = {**self.holding_base_data, "external_ticket": 9004 + idx}
            data[field_name] = None
            with transaction.atomic():
                with self.assertRaises(IntegrityError, msg=f"Field '{field_name}' as None should raise IntegrityError on create()"):
                    CustomerHolding.objects.create(**data)
        
        # DateField (settlement_date)
        with transaction.atomic():
            with self.assertRaises(IntegrityError, msg="Field 'settlement_date' as None should raise IntegrityError on create()"):
                CustomerHolding.objects.create(**{**self.holding_base_data, "external_ticket": 9008, "settlement_date": None})


    def test_customer_holding_intention_code_choices(self):
        data = {**self.holding_base_data, "external_ticket": 9009, "intention_code": "X"} # Invalid choice
        holding_invalid = CustomerHolding(**data)
        with self.assertRaises(ValidationError):
            holding_invalid.full_clean()

    def test_customer_holding_portfolio_on_delete_cascade(self):
        temp_portfolio = Portfolio.objects.create(owner=self.customer, name="Temp Portfolio for Deletion")
        CustomerHolding.objects.create(**{**self.holding_base_data, "external_ticket": 9010, "portfolio": temp_portfolio})
        self.assertTrue(CustomerHolding.objects.filter(portfolio=temp_portfolio).exists())
        
        temp_portfolio_pk = temp_portfolio.pk
        temp_portfolio.delete() # Cascade delete
        
        self.assertFalse(CustomerHolding.objects.filter(portfolio_id=temp_portfolio_pk).exists())

    def test_customer_holding_security_on_delete_cascade(self):
        temp_security = Security.objects.create(
            **{**self.security_details_for_holding, "cusip":"DELSEC01"}
        )
        CustomerHolding.objects.create(**{**self.holding_base_data, "external_ticket": 9011, "security": temp_security})
        self.assertTrue(CustomerHolding.objects.filter(security=temp_security).exists())

        temp_security_pk = temp_security.pk
        temp_security.delete() # Cascade delete

        self.assertFalse(CustomerHolding.objects.filter(security_id=temp_security_pk).exists())

    def test_customer_holding_nullable_fields(self):
        nullable_data = {
            **self.holding_base_data, "external_ticket": 9012,
            "book_yield": None, "holding_duration": None, "holding_average_life": None,
            "holding_average_life_date": None, "market_date": None, "market_price": None, "market_yield": None
        }
        holding_nulls = CustomerHolding.objects.create(**nullable_data)
        for field in ["book_yield", "holding_duration", "holding_average_life",
                           "holding_average_life_date", "market_date", "market_price", "market_yield"]:
            self.assertIsNone(getattr(holding_nulls, field), f"Field {field} should be None")

    def test_multiple_holdings_of_same_security_in_portfolio_allowed(self):
        # Based on models.py: "# *** REMOVED the conflicting unique constraint ***"
        try:
            CustomerHolding.objects.create(
                **{**self.holding_base_data, "external_ticket": 9013, "intention_code": 'T', "original_face_amount": Decimal("25000.00")}
            )
        except IntegrityError:
            self.fail("Should be able to create multiple holdings of the same security in one portfolio.")
        self.assertEqual(CustomerHolding.objects.filter(portfolio=self.portfolio, security=self.security).count(), 2)


class MunicipalOfferingModelTest(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.offering_data = {
            "cusip": "MUNI00001",
            "description": "Test Muni Offering", 
            "amount": Decimal("5000000.00"), 
            "coupon": Decimal("3.5"), 
            "maturity_date": date(2035, 6, 1), 
            "price": Decimal("102.75"), 
            "yield_rate": Decimal("3.25"), 
            "moody_rating": "Aa1", 
            "sp_rating": "AA+", 
            "call_date": date(2030, 6, 1), 
            "call_price": Decimal("101.00"), 
            "state": "CA", 
            "insurance": "BAM" 
        }
        cls.offering = MunicipalOffering.objects.create(**cls.offering_data)

    def test_municipal_offering_creation(self):
        self.assertEqual(self.offering.cusip, "MUNI00001")
        self.assertEqual(self.offering.description, "Test Muni Offering")
        self.assertEqual(self.offering.amount, Decimal("5000000.00"))
        self.assertEqual(str(self.offering), "Offering: MUNI00001 - Test Muni Offering")

    def test_unique_cusip_offering(self):
        with self.assertRaises(IntegrityError):
            MunicipalOffering.objects.create(cusip="MUNI00001", description="Duplicate Offering")

    def test_municipal_offering_nullable_fields(self):
        minimal_data = {"cusip": "MUNI00003"}
        offering_minimal = MunicipalOffering.objects.create(**minimal_data)
        self.assertEqual(offering_minimal.cusip, "MUNI00003")
        
        nullable_fields = [
            "amount", "coupon", "maturity_date", "price", "yield_rate",
            "moody_rating", "sp_rating", "call_date", "call_price", "state", "insurance"
        ]
        for field_name in nullable_fields:
            self.assertIsNone(getattr(offering_minimal, field_name), f"Field '{field_name}' should default to None.")

        self.assertEqual(offering_minimal.description, "", "Field 'description' (blank=True, null=False) should default to empty string.")

        offering_blank_desc = MunicipalOffering.objects.create(cusip="MUNI00004", description="")
        self.assertEqual(offering_blank_desc.description, "")
        
        # Test creating with description as None (should raise IntegrityError as null=False for CharField)
        with self.assertRaises(IntegrityError, msg="description=None should raise IntegrityError for CharField(null=False)"):
            MunicipalOffering.objects.create(cusip="MUNI00006", description=None)


    def test_municipal_offering_last_updated_auto_now(self):
        offering = MunicipalOffering.objects.create(cusip="MUNI00005")
        initial_time = offering.last_updated
        time.sleep(0.01) # Ensure time difference for auto_now
        offering.description = "Updated Description"
        offering.save()
        offering.refresh_from_db()
        self.assertGreater(offering.last_updated, initial_time)
