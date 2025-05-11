# portfolio/tests/test_serializers.py
from django.test import TestCase
from django.contrib.auth import get_user_model
from rest_framework.test import APIRequestFactory # For providing request context to serializers
from rest_framework.exceptions import ErrorDetail, ValidationError
from decimal import Decimal, InvalidOperation
from datetime import date

# Import all your models and serializers
from portfolio.models import (
    Salesperson, SecurityType, InterestSchedule, Customer, Security, Portfolio,
    CustomerHolding, MunicipalOffering
)
from portfolio.serializers import (
    SalespersonSerializer, SecurityTypeSerializer, InterestScheduleSerializer,
    CustomerSerializer, SecuritySerializer, PortfolioSerializer,
    CustomerHoldingSerializer, MunicipalOfferingSerializer,
    ExcelUploadSerializer, SelectedBondSerializer, SalespersonInterestSerializer,
    SelectedOfferingSerializer, MuniBuyInterestSerializer,
    HoldingToRemoveSerializer, OfferingToBuySerializer, PortfolioSimulationSerializer
)

User = get_user_model()

class BaseSerializerTest(TestCase):
    """
    Base class for serializer tests, can hold common setup or helper methods.
    We'll use APIRequestFactory to simulate a request object if context is needed.
    """
    @classmethod
    def setUpTestData(cls):
        cls.factory = APIRequestFactory()
        cls.user = User.objects.create_user(username='testuser', password='password123')
        cls.staff_user = User.objects.create_user(username='staffuser', password='password123', is_staff=True)
        cls.admin_user = User.objects.create_user(username='adminuser', password='password123', is_staff=True, is_superuser=True)

        # Create common instances needed by many serializer tests
        cls.salesperson1 = Salesperson.objects.create(salesperson_id="S001", name="Jane Doe", email="jane@example.com", is_active=True)
        cls.salesperson2 = Salesperson.objects.create(salesperson_id="S002", name="John Smith", email="john@example.com", is_active=False)

        cls.sec_type1 = SecurityType.objects.create(type_id=10, name="Government Bond", description="Federal Bonds")
        cls.sec_type2 = SecurityType.objects.create(type_id=20, name="Corporate Bond", description="Corporate Debt")

        cls.int_schedule1 = InterestSchedule.objects.create(schedule_code="MONTHLY", name="Monthly", payments_per_year_default=12)
        cls.int_schedule2 = InterestSchedule.objects.create(schedule_code="ANNUAL", name="Annually", payments_per_year_default=1)

        cls.customer1 = Customer.objects.create(
            customer_number=2001, name="Customer Alpha", city="AlphaCity", state="AS",
            salesperson=cls.salesperson1, portfolio_accounting_code="PAC001",
            cost_of_funds_rate=Decimal("1.5"), federal_tax_bracket_rate=Decimal("0.25")
        )
        cls.customer1.users.add(cls.user) # Associate user with customer

        cls.customer2 = Customer.objects.create(
            customer_number=2002, name="Customer Beta", city="BetaVille", state="BS",
            salesperson=cls.salesperson2, portfolio_accounting_code="PAC002"
        )
        # customer2 has no users initially for some tests

        # Valid choices for Security model based on typical setup
        # Ensure these choices are reflected in your Security model definition
        # Example: TAX_CODE_CHOICES = [('e', 'Exempt'), ('t', 'Taxable'), ...]
        # INTEREST_CALC_CODE_CHOICES = [('a', 'Actual/Actual'), ('c', '30/360'), ...]

        cls.security1 = Security.objects.create(
            cusip="SEC000001", description="Test Security Alpha", issue_date=date(2020,1,1),
            maturity_date=date(2030,1,1), security_type=cls.sec_type1, coupon=Decimal("2.5"),
            tax_code='e', interest_schedule=cls.int_schedule1, interest_day=1,
            interest_calc_code='a', payments_per_year=12, allows_paydown=False, payment_delay_days=0,
            factor=Decimal("1.0"), cpr=Decimal("5.0"), secondary_rate=Decimal("0.1"), wal=Decimal("5.0") # Added missing required based on errors
        )
        cls.security2 = Security.objects.create(
            cusip="SEC000002", description="Test Security Beta", issue_date=date(2021,1,1),
            maturity_date=date(2031,1,1), security_type=cls.sec_type2, coupon=Decimal("3.0"),
            tax_code='t', interest_schedule=cls.int_schedule2, interest_day=15,
            interest_calc_code='c', payments_per_year=1, allows_paydown=True, payment_delay_days=2,
            factor=Decimal("0.95"), secondary_rate=Decimal("0.2"), wal=Decimal("7.0") # Added missing required
        )

        cls.portfolio1 = Portfolio.objects.create(owner=cls.customer1, name="Alpha Portfolio One", is_default=True)
        cls.portfolio2_c1 = Portfolio.objects.create(owner=cls.customer1, name="Alpha Portfolio Two", is_default=False)
        cls.portfolio_c2 = Portfolio.objects.create(owner=cls.customer2, name="Beta Portfolio One", is_default=True)


        cls.holding1 = CustomerHolding.objects.create(
            external_ticket=10001, portfolio=cls.portfolio1, security=cls.security1,
            intention_code='H', original_face_amount=Decimal("50000"), settlement_date=date(2023,1,1),
            settlement_price=Decimal("99.5"), book_price=Decimal("99.0"), market_price=Decimal("100.5"),
            # Provide values for fields that might be required by model (even if serializer says allow_null=True)
            holding_duration=Decimal("5.0"), holding_average_life=Decimal("4.5"), market_yield=Decimal("2.5")
        )
        cls.holding2_for_portfolio1 = CustomerHolding.objects.create(
            external_ticket=10003, portfolio=cls.portfolio1, security=cls.security2,
            intention_code='T', original_face_amount=Decimal("20000"), settlement_date=date(2023,3,1),
            settlement_price=Decimal("101.0"), book_price=Decimal("100.0"),
            holding_duration=Decimal("6.0"), holding_average_life=Decimal("5.5"), market_yield=Decimal("3.0")
        )
        cls.holding_for_portfolio_c2 = CustomerHolding.objects.create(
             external_ticket=10004, portfolio=cls.portfolio_c2, security=cls.security1,
             intention_code='H', original_face_amount=Decimal("70000"), settlement_date=date(2023,4,1),
             settlement_price=Decimal("98.0"), book_price=Decimal("97.5"),
             holding_duration=Decimal("7.0"), holding_average_life=Decimal("6.5"), market_yield=Decimal("2.0")
        )


        cls.offering1 = MunicipalOffering.objects.create(
            cusip="MUNI0000A", description="Alpha Muni Offering", amount=Decimal("1000000"), price=Decimal("101.0"),
            coupon=Decimal("3.0"), maturity_date=date(2035,1,1), yield_rate=Decimal("2.8"), state="CA"
        )
        cls.offering2 = MunicipalOffering.objects.create(
            cusip="MUNI0000B", description="Beta Muni Offering", amount=Decimal("500000"), price=Decimal("100.5"),
            coupon=Decimal("2.5"), maturity_date=date(2040,1,1), yield_rate=Decimal("2.4"), state="TX"
        )

    def get_serializer_context(self, request_user=None):
        """ Helper to get context for serializers that need the request object. """
        user_to_use = request_user if request_user else self.user
        request = self.factory.get('/') # Dummy request
        request.user = user_to_use
        return {'request': request}


class SalespersonSerializerTest(BaseSerializerTest):
    def test_valid_salesperson_serialization(self):
        serializer = SalespersonSerializer(instance=self.salesperson1)
        data = serializer.data
        self.assertEqual(data['salesperson_id'], self.salesperson1.salesperson_id)
        self.assertEqual(data['name'], self.salesperson1.name)
        self.assertEqual(data['email'], self.salesperson1.email)
        self.assertEqual(data['is_active'], self.salesperson1.is_active)
        self.assertIn('created_at', data)
        self.assertIn('last_modified_at', data)

    def test_valid_salesperson_deserialization_create(self):
        valid_data = {'salesperson_id': "S003", 'name': "Mike Smith", 'email': "mike@example.com", 'is_active': True}
        serializer = SalespersonSerializer(data=valid_data)
        self.assertTrue(serializer.is_valid(), serializer.errors)
        salesperson = serializer.save()
        self.assertEqual(salesperson.name, "Mike Smith")
        self.assertTrue(salesperson.is_active)

    def test_valid_salesperson_deserialization_update(self):
        valid_data = {'name': "Jane Doe Updated", 'is_active': False}
        serializer = SalespersonSerializer(instance=self.salesperson1, data=valid_data, partial=True)
        self.assertTrue(serializer.is_valid(), serializer.errors)
        salesperson = serializer.save()
        self.assertEqual(salesperson.name, "Jane Doe Updated")
        self.assertFalse(salesperson.is_active)

    def test_invalid_salesperson_deserialization_missing_required(self):
        invalid_data = {'name': "Missing ID"} # salesperson_id is required on create
        serializer = SalespersonSerializer(data=invalid_data)
        self.assertFalse(serializer.is_valid())
        self.assertIn('salesperson_id', serializer.errors)

    def test_invalid_salesperson_deserialization_duplicate_id(self):
        invalid_data = {'salesperson_id': self.salesperson1.salesperson_id, 'name': "Duplicate Test"}
        serializer = SalespersonSerializer(data=invalid_data)
        self.assertFalse(serializer.is_valid())
        self.assertIn('salesperson_id', serializer.errors)


class SecurityTypeSerializerTest(BaseSerializerTest):
    def test_valid_security_type_serialization(self):
        serializer = SecurityTypeSerializer(instance=self.sec_type1)
        data = serializer.data
        self.assertEqual(data['type_id'], self.sec_type1.type_id)
        self.assertEqual(data['name'], self.sec_type1.name)
        self.assertEqual(data['description'], self.sec_type1.description)

    def test_valid_security_type_deserialization_create(self):
        valid_data = {'type_id': 30, 'name': "Municipal Bond", 'description': "City/State Bonds"}
        serializer = SecurityTypeSerializer(data=valid_data)
        self.assertTrue(serializer.is_valid(), serializer.errors)
        sec_type = serializer.save()
        self.assertEqual(sec_type.name, "Municipal Bond")

    def test_valid_security_type_deserialization_update(self):
        valid_data = {'name': "Government Bond Updated"}
        serializer = SecurityTypeSerializer(instance=self.sec_type1, data=valid_data, partial=True)
        self.assertTrue(serializer.is_valid(), serializer.errors)
        sec_type = serializer.save()
        self.assertEqual(sec_type.name, "Government Bond Updated")

    def test_invalid_security_type_deserialization_missing_required(self):
        invalid_data = {'name': "Missing Type ID"}
        serializer = SecurityTypeSerializer(data=invalid_data)
        self.assertFalse(serializer.is_valid())
        self.assertIn('type_id', serializer.errors)

    def test_invalid_security_type_deserialization_duplicate_id(self):
        invalid_data = {'type_id': self.sec_type1.type_id, 'name': "Duplicate Type"}
        serializer = SecurityTypeSerializer(data=invalid_data)
        self.assertFalse(serializer.is_valid())
        self.assertIn('type_id', serializer.errors)


class InterestScheduleSerializerTest(BaseSerializerTest):
    def test_valid_interest_schedule_serialization(self):
        serializer = InterestScheduleSerializer(instance=self.int_schedule1)
        data = serializer.data
        self.assertEqual(data['schedule_code'], self.int_schedule1.schedule_code)
        self.assertEqual(data['name'], self.int_schedule1.name)
        self.assertEqual(data['payments_per_year_default'], self.int_schedule1.payments_per_year_default)

    def test_valid_interest_schedule_deserialization_create(self):
        valid_data = {'schedule_code': "QUARTERLY", 'name': "Quarterly", 'payments_per_year_default': 4}
        serializer = InterestScheduleSerializer(data=valid_data)
        self.assertTrue(serializer.is_valid(), serializer.errors)
        schedule = serializer.save()
        self.assertEqual(schedule.name, "Quarterly")

    def test_valid_interest_schedule_deserialization_update(self):
        valid_data = {'name': "Monthly Updated"}
        serializer = InterestScheduleSerializer(instance=self.int_schedule1, data=valid_data, partial=True)
        self.assertTrue(serializer.is_valid(), serializer.errors)
        schedule = serializer.save()
        self.assertEqual(schedule.name, "Monthly Updated")

    def test_invalid_interest_schedule_deserialization_missing_required(self):
        invalid_data = {'name': "Missing Code"}
        serializer = InterestScheduleSerializer(data=invalid_data)
        self.assertFalse(serializer.is_valid())
        self.assertIn('schedule_code', serializer.errors)

    def test_invalid_interest_schedule_deserialization_duplicate_code(self):
        invalid_data = {'schedule_code': self.int_schedule1.schedule_code, 'name': "Duplicate Schedule"}
        serializer = InterestScheduleSerializer(data=invalid_data)
        self.assertFalse(serializer.is_valid())
        self.assertIn('schedule_code', serializer.errors)


class CustomerSerializerTest(BaseSerializerTest):
    def test_valid_customer_serialization(self):
        serializer = CustomerSerializer(instance=self.customer1, context=self.get_serializer_context())
        data = serializer.data
        self.assertEqual(data['customer_number'], self.customer1.customer_number)
        self.assertEqual(data['name'], self.customer1.name)
        self.assertIsNotNone(data['salesperson'])
        self.assertEqual(data['salesperson']['salesperson_id'], self.salesperson1.salesperson_id)
        self.assertEqual(str(Decimal(data['cost_of_funds_rate']).quantize(Decimal("0.0001"))), str(self.customer1.cost_of_funds_rate.quantize(Decimal("0.0001"))))
        self.assertEqual(str(Decimal(data['federal_tax_bracket_rate']).quantize(Decimal("0.0001"))), str(self.customer1.federal_tax_bracket_rate.quantize(Decimal("0.0001"))))

    def test_customer_create_with_salesperson_id_input(self):
        valid_data = {
            'customer_number': 2003, 'name': "Gamma Corp", 'city': "GammaVille", 'state': "GS",
            'portfolio_accounting_code': "PAC003",
            'salesperson_id_input': self.salesperson1.salesperson_id
        }
        serializer = CustomerSerializer(data=valid_data, context=self.get_serializer_context())
        self.assertTrue(serializer.is_valid(), serializer.errors)
        customer = serializer.save()
        self.assertEqual(customer.salesperson, self.salesperson1)

    def test_customer_create_with_null_salesperson_id_input(self):
        valid_data = {
            'customer_number': 2004, 'name': "Delta LLC", 'city': "DeltaCity", 'state': "DS",
            'portfolio_accounting_code': "PAC004",
            'salesperson_id_input': None
        }
        serializer = CustomerSerializer(data=valid_data, context=self.get_serializer_context())
        self.assertTrue(serializer.is_valid(), serializer.errors)
        customer = serializer.save()
        self.assertIsNone(customer.salesperson)

    def test_customer_create_with_empty_salesperson_id_input(self):
        valid_data = {
            'customer_number': 2005, 'name': "Epsilon Co", 'city': "EpsilonTown", 'state': "ES",
            'portfolio_accounting_code': "PAC005",
            'salesperson_id_input': ""
        }
        serializer = CustomerSerializer(data=valid_data, context=self.get_serializer_context())
        self.assertTrue(serializer.is_valid(), serializer.errors)
        customer = serializer.save()
        self.assertIsNone(customer.salesperson)

    def test_customer_update_salesperson(self):
        update_data = {'salesperson_id_input': self.salesperson2.salesperson_id}
        serializer = CustomerSerializer(instance=self.customer1, data=update_data, partial=True, context=self.get_serializer_context())
        self.assertTrue(serializer.is_valid(), serializer.errors)
        customer = serializer.save()
        self.assertEqual(customer.salesperson, self.salesperson2)

    def test_customer_update_unassign_salesperson(self):
        update_data = {'salesperson_id_input': None} # or ""
        serializer = CustomerSerializer(instance=self.customer1, data=update_data, partial=True, context=self.get_serializer_context())
        self.assertTrue(serializer.is_valid(), serializer.errors)
        customer = serializer.save()
        self.assertIsNone(customer.salesperson)

    def test_customer_invalid_salesperson_id_input(self):
        invalid_data = {
            'customer_number': 2006, 'name': "Zeta Inc", 'city': "ZetaCity", 'state': "ZS",
            'portfolio_accounting_code': "PAC006",
            'salesperson_id_input': "INVALID_ID"
        }
        serializer = CustomerSerializer(data=invalid_data, context=self.get_serializer_context())
        self.assertFalse(serializer.is_valid())
        self.assertIn('salesperson_id_input', serializer.errors)
        self.assertEqual(str(serializer.errors['salesperson_id_input'][0]), "Salesperson with ID 'INVALID_ID' not found.")

    def test_customer_missing_required_fields(self):
        invalid_data = {'customer_number': 2007}
        serializer = CustomerSerializer(data=invalid_data, context=self.get_serializer_context())
        self.assertFalse(serializer.is_valid())
        self.assertIn('name', serializer.errors)
        self.assertIn('city', serializer.errors)
        self.assertIn('state', serializer.errors)
        self.assertIn('portfolio_accounting_code', serializer.errors)


class SecuritySerializerTest(BaseSerializerTest):
    def test_valid_security_serialization(self):
        serializer = SecuritySerializer(instance=self.security1, context=self.get_serializer_context())
        data = serializer.data
        self.assertEqual(data['cusip'], self.security1.cusip)
        self.assertEqual(data['description'], self.security1.description)
        self.assertIsNotNone(data['security_type'])
        self.assertEqual(data['security_type']['type_id'], self.sec_type1.type_id)
        self.assertIsNotNone(data['interest_schedule'])
        self.assertEqual(data['interest_schedule']['schedule_code'], self.int_schedule1.schedule_code)
        self.assertEqual(data['coupon'], str(self.security1.coupon.quantize(Decimal("0.00000001"))))
        self.assertEqual(data['cpr'], str(self.security1.cpr.quantize(Decimal("0.00001"))))
        self.assertEqual(data['factor'], str(self.security1.factor.quantize(Decimal("0.0000000001"))))

    def test_security_create_with_fk_inputs(self):
        valid_data = {
            'cusip': "SEC000003", 'description': "Test Security Gamma",
            'issue_date': "2022-01-01", 'maturity_date': "2032-01-01",
            'tax_code': 'e', 'interest_day': 10, 'interest_calc_code': 'a', # Validated choices
            'payments_per_year': 4, 'allows_paydown': False, 'payment_delay_days': 1,
            'security_type_id_input': self.sec_type2.type_id,
            'interest_schedule_code_input': self.int_schedule2.schedule_code,
            'coupon': "3.5", 'cpr': "7.0",
            'factor': "0.9900000000", # Provide all required fields
            'secondary_rate': "0.3",
            'wal': "6.0"
        }
        serializer = SecuritySerializer(data=valid_data, context=self.get_serializer_context())
        self.assertTrue(serializer.is_valid(), serializer.errors)
        security = serializer.save()
        self.assertEqual(security.security_type, self.sec_type2)
        self.assertEqual(security.interest_schedule, self.int_schedule2)
        self.assertEqual(security.coupon, Decimal("3.5"))
        self.assertEqual(security.cpr, Decimal("7.0"))
        self.assertEqual(security.factor, Decimal("0.99"))

    def test_security_create_with_null_fk_inputs(self):
        valid_data = {
            'cusip': "SEC000004", 'description': "Test Security Delta",
            'issue_date': "2022-02-01", 'maturity_date': "2032-02-01",
            'tax_code': 't', 'interest_day': 20, 'interest_calc_code': 'c', # Validated choices
            'payments_per_year': 2, 'allows_paydown': True, 'payment_delay_days': 3,
            'security_type_id_input': None,
            'interest_schedule_code_input': None,
            'coupon': "4.0",
            'factor': "1.0000000000", # Provide factor as it's NOT NULL in DB
            'secondary_rate': "0.4", # Provide if required by model or make optional in serializer
            'wal': "8.0"             # Provide if required by model or make optional in serializer
            # cpr is optional in serializer
        }
        serializer = SecuritySerializer(data=valid_data, context=self.get_serializer_context())
        self.assertTrue(serializer.is_valid(), serializer.errors)
        security = serializer.save()
        self.assertIsNone(security.security_type)
        self.assertIsNone(security.interest_schedule)

    def test_security_update_fks(self):
        update_data = {
            'security_type_id_input': self.sec_type2.type_id,
            'interest_schedule_code_input': self.int_schedule2.schedule_code,
            'cpr': "8.0"
        }
        serializer = SecuritySerializer(instance=self.security1, data=update_data, partial=True, context=self.get_serializer_context())
        self.assertTrue(serializer.is_valid(), serializer.errors)
        security = serializer.save()
        self.assertEqual(security.security_type, self.sec_type2)
        self.assertEqual(security.interest_schedule, self.int_schedule2)
        self.assertEqual(security.cpr, Decimal("8.0"))

    def test_security_invalid_fk_inputs(self):
        invalid_data_sec_type = {'security_type_id_input': 99999}
        invalid_data_int_sched = {'interest_schedule_code_input': "INVALID"}

        serializer_sec_type = SecuritySerializer(instance=self.security1, data=invalid_data_sec_type, partial=True)
        self.assertFalse(serializer_sec_type.is_valid())
        self.assertIn('security_type_id_input', serializer_sec_type.errors)

        serializer_int_sched = SecuritySerializer(instance=self.security1, data=invalid_data_int_sched, partial=True)
        self.assertFalse(serializer_int_sched.is_valid())
        self.assertIn('interest_schedule_code_input', serializer_int_sched.errors)

    def test_security_missing_required_fields(self):
        invalid_data = {'cusip': "SEC000005"} # Missing many fields
        serializer = SecuritySerializer(data=invalid_data)
        self.assertFalse(serializer.is_valid())
        self.assertIn('description', serializer.errors)
        self.assertIn('issue_date', serializer.errors)
        self.assertIn('maturity_date', serializer.errors)
        self.assertIn('tax_code', serializer.errors)
        self.assertIn('factor', serializer.errors) # Assuming factor is required
        self.assertIn('secondary_rate', serializer.errors) # Assuming secondary_rate is required
        self.assertIn('wal', serializer.errors) # Assuming wal is required

    def test_security_optional_fields_not_provided(self):
        # Test create without CPR (optional), but with factor, secondary_rate, wal (assuming required or made optional in serializer)
        valid_data = {
            'cusip': "SEC000006", 'description': "Test Security Epsilon",
            'issue_date': "2023-01-01", 'maturity_date': "2033-01-01",
            'tax_code': 'e', 'interest_day': 1, 'interest_calc_code': 'a',
            'payments_per_year': 12, 'allows_paydown': False, 'payment_delay_days': 0,
            'coupon': "2.0",
            'factor': "1.0000000000",      # Provide factor
            'secondary_rate': "0.15", # Provide secondary_rate
            'wal': "7.5"              # Provide wal
            # cpr is not provided (optional in serializer)
            # security_type_id_input and interest_schedule_code_input are not required by serializer
        }
        serializer = SecuritySerializer(data=valid_data, context=self.get_serializer_context())
        self.assertTrue(serializer.is_valid(), serializer.errors)
        security = serializer.save()
        self.assertIsNone(security.cpr) # CPR can be null if not provided and optional
        self.assertEqual(security.factor, Decimal("1.0"))
        self.assertIsNone(security.security_type)
        self.assertIsNone(security.interest_schedule)


class CustomerHoldingSerializerTest(BaseSerializerTest):
    def test_valid_holding_serialization(self):
        serializer = CustomerHoldingSerializer(instance=self.holding1)
        data = serializer.data
        self.assertEqual(data['external_ticket'], self.holding1.external_ticket)
        self.assertEqual(data['security_cusip'], self.security1.cusip)
        self.assertEqual(data['portfolio_id'], self.portfolio1.id)
        self.assertEqual(data['customer_number'], self.customer1.customer_number)
        self.assertEqual(data['portfolio_name'], self.portfolio1.name)
        self.assertEqual(data['security_description'], self.security1.description)
        expected_par = (self.holding1.original_face_amount * (self.holding1.security.factor or Decimal("1.0"))).quantize(Decimal("0.01"))
        self.assertEqual(Decimal(data['par_value']), expected_par)

    def test_holding_serialization_par_value_different_factor(self):
        original_factor = self.security1.factor
        self.security1.factor = Decimal("0.5")
        self.security1.save()
        # Re-fetch holding1 or its security to ensure the change is reflected if serializer accesses DB
        holding_to_test = CustomerHolding.objects.get(pk=self.holding1.pk)
        serializer = CustomerHoldingSerializer(instance=holding_to_test)
        data = serializer.data
        expected_par = (holding_to_test.original_face_amount * Decimal("0.5")).quantize(Decimal("0.01"))
        self.assertEqual(Decimal(data['par_value']), expected_par)
        self.security1.factor = original_factor # Reset factor
        self.security1.save()

    def test_holding_create(self):
        # Assumes holding_duration, holding_average_life, market_yield are made optional in serializer
        # or provided here.
        valid_data = {
            'external_ticket': 10002,
            'portfolio_id_input': self.portfolio1.id,
            'security_cusip_input': self.security2.cusip,
            'intention_code': 'T',
            'original_face_amount': "75000.00",
            'settlement_date': "2023-02-01",
            'settlement_price': "100.00",
            'book_price': "100.00",
            'book_yield': "2.5",        # Optional field
            'market_price': "101.0",     # Optional field
            # Provide other potentially required fields if not made optional in serializer
            'holding_duration': "5.0",
            'holding_average_life': "4.5",
            'market_yield': "2.8"
        }
        serializer = CustomerHoldingSerializer(data=valid_data)
        self.assertTrue(serializer.is_valid(), serializer.errors)
        holding = serializer.save()
        self.assertEqual(holding.security, self.security2)
        self.assertEqual(holding.portfolio, self.portfolio1)
        self.assertEqual(holding.book_yield, Decimal("2.5"))

    def test_holding_update(self):
        update_data = {
            'original_face_amount': "60000.00",
            'market_price': "102.50",
        }
        serializer = CustomerHoldingSerializer(instance=self.holding1, data=update_data, partial=True)
        self.assertTrue(serializer.is_valid(), serializer.errors)
        holding = serializer.save()
        self.assertEqual(holding.original_face_amount, Decimal("60000.00"))
        self.assertEqual(holding.market_price, Decimal("102.50"))

    def test_holding_invalid_fk_inputs(self):
        invalid_portfolio = {'portfolio_id_input': 99999}
        invalid_security = {'security_cusip_input': "INVALIDCUS"}
        base_data = {
            'external_ticket': 10005, 'intention_code': 'H', 'original_face_amount': "1000",
            'settlement_date': "2023-01-01", 'settlement_price': "100", 'book_price': "100",
            'holding_duration': "1.0", 'holding_average_life': "1.0", 'market_yield': "1.0" # Add required
        }
        serializer_portfolio = CustomerHoldingSerializer(data={**base_data, **invalid_portfolio, 'security_cusip_input': self.security1.cusip})
        self.assertFalse(serializer_portfolio.is_valid())
        self.assertIn('portfolio_id_input', serializer_portfolio.errors)

        serializer_security = CustomerHoldingSerializer(data={**base_data, **invalid_security, 'portfolio_id_input': self.portfolio1.id})
        self.assertFalse(serializer_security.is_valid())
        self.assertIn('security_cusip_input', serializer_security.errors)

    def test_holding_missing_required_fields(self):
        invalid_data = {'external_ticket': 10006}
        serializer = CustomerHoldingSerializer(data=invalid_data)
        self.assertFalse(serializer.is_valid())
        self.assertIn('portfolio_id_input', serializer.errors)
        self.assertIn('security_cusip_input', serializer.errors)
        self.assertIn('intention_code', serializer.errors)
        # Add checks for other fields made required implicitly by model (holding_duration, etc.)
        # if they are not made `required=False` in serializer
        # Assuming they are made optional in serializer for this test to pass as is:
        # If CustomerHoldingSerializer makes holding_duration etc. `required=False`, then this test is fine.
        # Otherwise, they would also appear in serializer.errors here.


class PortfolioSerializerTest(BaseSerializerTest):
    def test_valid_portfolio_serialization(self):
        serializer = PortfolioSerializer(instance=self.portfolio1, context=self.get_serializer_context())
        data = serializer.data
        self.assertEqual(data['name'], self.portfolio1.name)
        self.assertTrue(data['is_default'])
        self.assertIsNotNone(data['owner'])
        self.assertEqual(data['owner']['customer_number'], self.customer1.customer_number)

    def test_portfolio_create_by_admin_for_customer(self):
        valid_data = {'name': "Admin Created Portfolio", 'owner_id_input': self.customer1.id}
        serializer = PortfolioSerializer(data=valid_data, context=self.get_serializer_context(request_user=self.admin_user))
        self.assertTrue(serializer.is_valid(), serializer.errors)
        portfolio = serializer.save()
        self.assertEqual(portfolio.owner, self.customer1)
        self.assertFalse(portfolio.is_default)

    def test_portfolio_create_by_user_for_own_customer_single(self):
        valid_data = {'name': "User Created Portfolio"}
        serializer = PortfolioSerializer(data=valid_data, context=self.get_serializer_context(request_user=self.user))
        self.assertTrue(serializer.is_valid(), serializer.errors)
        portfolio = serializer.save()
        self.assertEqual(portfolio.owner, self.customer1)

    def test_portfolio_create_by_user_for_own_customer_multiple_specify_owner(self):
        self.customer2.users.add(self.user)
        valid_data = {'name': "User Created Portfolio C2", 'owner_id_input': self.customer2.id}
        serializer = PortfolioSerializer(data=valid_data, context=self.get_serializer_context(request_user=self.user))
        self.assertTrue(serializer.is_valid(), serializer.errors)
        portfolio = serializer.save()
        self.assertEqual(portfolio.owner, self.customer2)
        self.customer2.users.remove(self.user)

    def test_portfolio_create_by_user_for_own_customer_multiple_omit_owner_fails(self):
        self.customer2.users.add(self.user)
        invalid_data = {'name': "User Created Portfolio Fail"}
        serializer = PortfolioSerializer(data=invalid_data, context=self.get_serializer_context(request_user=self.user))
        self.assertFalse(serializer.is_valid())
        self.assertIn('owner_id_input', serializer.errors)
        self.assertEqual(str(serializer.errors['owner_id_input'][0]), "Must specify a valid owner customer ID when associated with multiple customers.")
        self.customer2.users.remove(self.user)

    def test_portfolio_create_by_user_no_associated_customer_fails(self):
        unassociated_user = User.objects.create_user(username='nouser', password='password')
        invalid_data = {'name': "No Customer Portfolio"}
        serializer = PortfolioSerializer(data=invalid_data, context=self.get_serializer_context(request_user=unassociated_user))
        self.assertFalse(serializer.is_valid())
        self.assertTrue('owner_id_input' in serializer.errors or 'non_field_errors' in serializer.errors)
        if 'non_field_errors' in serializer.errors: # Based on current serializer logic
             self.assertEqual(str(serializer.errors['non_field_errors'][0]), "User is not associated with any customers.")
        elif 'owner_id_input' in serializer.errors: # If logic changes to make it owner_id_input error
             self.assertIn("User is not associated with any customers.", str(serializer.errors['owner_id_input'][0]))


    def test_portfolio_create_by_non_admin_for_other_customer_fails(self):
        invalid_data = {'name': "Unauthorized Portfolio", 'owner_id_input': self.customer2.id}
        serializer = PortfolioSerializer(data=invalid_data, context=self.get_serializer_context(request_user=self.user))
        self.assertFalse(serializer.is_valid())
        self.assertIn('owner_id_input', serializer.errors)
        self.assertEqual(str(serializer.errors['owner_id_input'][0]), f"You do not have permission to assign portfolios to customer ID {self.customer2.id}.")

    def test_portfolio_create_admin_missing_owner_id_fails(self):
        invalid_data = {'name': "Admin Missing Owner"}
        serializer = PortfolioSerializer(data=invalid_data, context=self.get_serializer_context(request_user=self.admin_user))
        self.assertFalse(serializer.is_valid())
        self.assertIn('owner_id_input', serializer.errors)
        self.assertEqual(str(serializer.errors['owner_id_input'][0]), "Admin must provide the owner customer ID.")

    def test_portfolio_create_missing_name_fails(self):
        invalid_data = {'owner_id_input': self.customer1.id}
        serializer = PortfolioSerializer(data=invalid_data, context=self.get_serializer_context(request_user=self.admin_user))
        self.assertFalse(serializer.is_valid())
        self.assertIn('name', serializer.errors)

    def test_portfolio_update_name(self):
        update_data = {'name': "Updated Portfolio Name"}
        serializer = PortfolioSerializer(instance=self.portfolio1, data=update_data, partial=True, context=self.get_serializer_context(request_user=self.admin_user))
        self.assertTrue(serializer.is_valid(), serializer.errors)
        portfolio = serializer.save()
        self.assertEqual(portfolio.name, "Updated Portfolio Name")

    def test_portfolio_update_empty_name_fails(self):
        update_data = {'name': ""}
        serializer = PortfolioSerializer(instance=self.portfolio1, data=update_data, partial=True, context=self.get_serializer_context(request_user=self.admin_user))
        self.assertFalse(serializer.is_valid())
        self.assertIn('name', serializer.errors)

    def test_portfolio_update_change_owner_fails(self):
        update_data = {'owner_id_input': self.customer2.id}
        # Assuming PortfolioSerializer.validate uses self.initial_data to check owner_id_input
        serializer = PortfolioSerializer(instance=self.portfolio1, data=update_data, partial=True, context=self.get_serializer_context(request_user=self.admin_user))
        self.assertFalse(serializer.is_valid())
        # The error is "Cannot change portfolio owner during update."
        # This should be a non_field_error if raised as serializers.ValidationError("message")
        # or a field error if raised as serializers.ValidationError({'owner_id_input': "message"})
        # The current serializer raises it as a non-field error.
        self.assertIn('non_field_errors', serializer.errors)
        self.assertEqual(str(serializer.errors['non_field_errors'][0]), "Cannot change portfolio owner during update.")


    def test_portfolio_update_attempt_to_change_is_default_ignored(self): # Renamed
        # self.portfolio1 is initially is_default=True
        self.assertTrue(self.portfolio1.is_default, "Pre-condition: portfolio1 should be default.")

        update_data = {'is_default': False} # Attempt to change a read-only field

        serializer = PortfolioSerializer(
            instance=self.portfolio1,
            data=update_data,
            partial=True, # Crucial for allowing other fields to be absent
            context=self.get_serializer_context(request_user=self.admin_user)
        )

        # Because 'is_default' is in read_only_fields, DRF should ignore this field in the input.
        # The serializer should still be valid if no other validation errors occur,
        # as the current PortfolioSerializer.validate method does not raise an error for 'is_default'
        # when it's a read_only_field (it won't be in `attrs`/`data` argument of `validate`).
        self.assertTrue(serializer.is_valid(), serializer.errors)

        # Save the serializer. The 'is_default' field on the instance should not change.
        portfolio = serializer.save()

        # Refresh from DB to be certain
        self.portfolio1.refresh_from_db()

        # Check that 'is_default' has NOT changed on the instance
        self.assertTrue(self.portfolio1.is_default, "is_default should not have changed after update attempt.")
        self.assertTrue(portfolio.is_default, "is_default on returned instance should not have changed.")


    def test_portfolio_create_with_initial_holdings(self):
        valid_data = {
            'name': "Portfolio With Copied Holdings",
            'owner_id_input': self.customer1.id,
            'initial_holding_ids': [self.holding1.external_ticket, self.holding2_for_portfolio1.external_ticket]
        }
        serializer = PortfolioSerializer(data=valid_data, context=self.get_serializer_context(request_user=self.admin_user))
        self.assertTrue(serializer.is_valid(), serializer.errors)
        self.assertIn('_holdings_to_copy_qs', serializer.validated_data)
        self.assertEqual(serializer.validated_data['_holdings_to_copy_qs'].count(), 2)

    def test_portfolio_create_with_initial_holdings_invalid_ticket_type(self):
        invalid_data = {
            'name': "Portfolio Invalid Ticket Type",
            'owner_id_input': self.customer1.id,
            'initial_holding_ids': [self.holding1.external_ticket, "not-an-int"]
        }
        serializer = PortfolioSerializer(data=invalid_data, context=self.get_serializer_context(request_user=self.admin_user))
        self.assertFalse(serializer.is_valid())
        self.assertIn('initial_holding_ids', serializer.errors)
        # Error comes from ListField's child IntegerField validation
        self.assertIn(1, serializer.errors['initial_holding_ids']) # Check error is for index 1
        self.assertEqual(str(serializer.errors['initial_holding_ids'][1][0]), "A valid integer is required.")


    def test_portfolio_create_with_initial_holdings_non_existent_ticket(self):
        invalid_data = {
            'name': "Portfolio Non Existent Ticket",
            'owner_id_input': self.customer1.id,
            'initial_holding_ids': [self.holding1.external_ticket, 999999]
        }
        serializer = PortfolioSerializer(data=invalid_data, context=self.get_serializer_context(request_user=self.admin_user))
        self.assertFalse(serializer.is_valid())
        self.assertIn('initial_holding_ids', serializer.errors)
        self.assertTrue("Invalid or inaccessible holding external ticket numbers" in str(serializer.errors['initial_holding_ids'][0]))

    def test_portfolio_create_with_initial_holdings_ticket_from_other_owner(self):
        invalid_data = {
            'name': "Portfolio Other Owner Ticket",
            'owner_id_input': self.customer1.id,
            'initial_holding_ids': [self.holding_for_portfolio_c2.external_ticket]
        }
        serializer = PortfolioSerializer(data=invalid_data, context=self.get_serializer_context(request_user=self.admin_user))
        self.assertFalse(serializer.is_valid())
        self.assertIn('initial_holding_ids', serializer.errors)
        self.assertTrue("Invalid or inaccessible holding external ticket numbers" in str(serializer.errors['initial_holding_ids'][0]))


class MunicipalOfferingSerializerTest(BaseSerializerTest):
    def test_valid_offering_serialization(self):
        serializer = MunicipalOfferingSerializer(instance=self.offering1)
        data = serializer.data
        self.assertEqual(data['cusip'], self.offering1.cusip)
        self.assertEqual(data['description'], self.offering1.description)
        self.assertEqual(Decimal(data['amount']), self.offering1.amount.quantize(Decimal("0.01")))
        self.assertEqual(Decimal(data['price']), self.offering1.price.quantize(Decimal("0.000001")))
        self.assertEqual(Decimal(data['coupon']), self.offering1.coupon.quantize(Decimal("0.00001")))
        self.assertEqual(str(data['maturity_date']), str(self.offering1.maturity_date))
        self.assertEqual(Decimal(data['yield_rate']), self.offering1.yield_rate.quantize(Decimal("0.00001")))
        self.assertEqual(data['state'], self.offering1.state)

class ExcelUploadSerializerTest(TestCase):
    def test_valid_file_upload(self):
        from django.core.files.uploadedfile import SimpleUploadedFile
        upload_file = SimpleUploadedFile("test.xlsx", b"file_content", content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        data = {'file': upload_file}
        serializer = ExcelUploadSerializer(data=data)
        self.assertTrue(serializer.is_valid(), serializer.errors)

    def test_missing_file(self):
        data = {}
        serializer = ExcelUploadSerializer(data=data)
        self.assertFalse(serializer.is_valid())
        self.assertIn('file', serializer.errors)

class SelectedBondSerializerTest(TestCase):
    def test_valid_selected_bond(self):
        data = {'cusip': "TESTBOND1", 'par': "100000.00"}
        serializer = SelectedBondSerializer(data=data)
        self.assertTrue(serializer.is_valid(), serializer.errors)
        self.assertEqual(serializer.validated_data['par'], "100000.00")

    def test_valid_selected_bond_decimal_par(self):
        data = {'cusip': "TESTBONDX", 'par': "50000.75"}
        serializer = SelectedBondSerializer(data=data)
        self.assertTrue(serializer.is_valid(), serializer.errors)
        self.assertEqual(serializer.validated_data['par'], "50000.75")

    def test_invalid_par_selected_bond(self):
        data = {'cusip': "TESTBOND2", 'par': "invalid_par"}
        serializer = SelectedBondSerializer(data=data)
        self.assertFalse(serializer.is_valid())
        self.assertIn('par', serializer.errors)
        self.assertEqual(str(serializer.errors['par'][0]), "Invalid par amount format.")

    def test_missing_cusip_selected_bond(self):
        data = {'par': "100000.00"}
        serializer = SelectedBondSerializer(data=data)
        self.assertFalse(serializer.is_valid())
        self.assertIn('cusip', serializer.errors)

    def test_missing_par_selected_bond(self):
        data = {'cusip': "TESTBOND3"}
        serializer = SelectedBondSerializer(data=data)
        self.assertFalse(serializer.is_valid())
        self.assertIn('par', serializer.errors)

    def test_blank_cusip_selected_bond(self):
        data = {'cusip': "", 'par': "10000"}
        serializer = SelectedBondSerializer(data=data)
        self.assertFalse(serializer.is_valid())
        self.assertIn('cusip', serializer.errors)

    def test_blank_par_selected_bond(self):
        data = {'cusip': "TESTBND4", 'par': ""}
        serializer = SelectedBondSerializer(data=data)
        self.assertFalse(serializer.is_valid())
        self.assertIn('par', serializer.errors)


class SalespersonInterestSerializerTest(BaseSerializerTest):
    def test_valid_salesperson_interest(self):
        selected_bonds_data = [
            {'cusip': "BOND00001", 'par': "50000"},
            {'cusip': "BOND00002", 'par': "75000.50"}
        ]
        data = {'customer_id': self.customer1.id, 'selected_bonds': selected_bonds_data}
        serializer = SalespersonInterestSerializer(data=data)
        self.assertTrue(serializer.is_valid(), serializer.errors)

    def test_invalid_customer_id_salesperson_interest(self):
        data = {'customer_id': 99999, 'selected_bonds': [{'cusip': "BONDX", 'par': "1000"}]}
        serializer = SalespersonInterestSerializer(data=data)
        self.assertFalse(serializer.is_valid())
        self.assertIn('customer_id', serializer.errors)
        self.assertEqual(str(serializer.errors['customer_id'][0]), "Customer with ID 99999 not found.")

    def test_empty_selected_bonds_salesperson_interest(self):
        data = {'customer_id': self.customer1.id, 'selected_bonds': []}
        serializer = SalespersonInterestSerializer(data=data)
        self.assertFalse(serializer.is_valid())
        self.assertIn('selected_bonds', serializer.errors)

    def test_invalid_data_in_selected_bonds(self):
        invalid_bonds_data = [
            {'cusip': "BOND00001", 'par': "50000"},
            {'cusip': "BOND00003", 'par': "invalid_par_here"}
        ]
        data = {'customer_id': self.customer1.id, 'selected_bonds': invalid_bonds_data}
        serializer = SalespersonInterestSerializer(data=data)
        self.assertFalse(serializer.is_valid())
        self.assertIn('selected_bonds', serializer.errors)
        self.assertIn('par', serializer.errors['selected_bonds'][1])

    def test_missing_customer_id_salesperson_interest(self):
        data = {'selected_bonds': [{'cusip': "BONDX", 'par': "1000"}]}
        serializer = SalespersonInterestSerializer(data=data)
        self.assertFalse(serializer.is_valid())
        self.assertIn('customer_id', serializer.errors)

    def test_missing_selected_bonds_salesperson_interest(self):
        data = {'customer_id': self.customer1.id}
        serializer = SalespersonInterestSerializer(data=data)
        self.assertFalse(serializer.is_valid())
        self.assertIn('selected_bonds', serializer.errors)


class SelectedOfferingSerializerTest(TestCase):
    def test_valid_selected_offering(self):
        data = {'cusip': "OFFER0001", 'description': "Test Offering"}
        serializer = SelectedOfferingSerializer(data=data)
        self.assertTrue(serializer.is_valid(), serializer.errors)

    def test_missing_cusip_selected_offering(self):
        data = {'description': "Test Offering"}
        serializer = SelectedOfferingSerializer(data=data)
        self.assertFalse(serializer.is_valid())
        self.assertIn('cusip', serializer.errors)

    def test_missing_description_selected_offering(self):
        data = {'cusip': "OFFER0002"}
        serializer = SelectedOfferingSerializer(data=data)
        self.assertFalse(serializer.is_valid())
        self.assertIn('description', serializer.errors)

    def test_blank_cusip_selected_offering(self):
        data = {'cusip': "", 'description': "Test Offering"}
        serializer = SelectedOfferingSerializer(data=data)
        self.assertFalse(serializer.is_valid())
        self.assertIn('cusip', serializer.errors)

    def test_blank_description_selected_offering(self):
        data = {'cusip': "OFFER0003", 'description': ""}
        serializer = SelectedOfferingSerializer(data=data)
        self.assertFalse(serializer.is_valid())
        self.assertIn('description', serializer.errors)


class MuniBuyInterestSerializerTest(BaseSerializerTest):
    def test_valid_muni_buy_interest(self):
        selected_offerings_data = [
            {'cusip': "MUNI00001", 'description': "Muni One"},
            {'cusip': "MUNI00002", 'description': "Muni Two"}
        ]
        data = {'customer_id': self.customer1.id, 'selected_offerings': selected_offerings_data}
        serializer = MuniBuyInterestSerializer(data=data)
        self.assertTrue(serializer.is_valid(), serializer.errors)

    def test_invalid_customer_id_muni_buy_interest(self):
        data = {'customer_id': 88888, 'selected_offerings': [{'cusip': "MUNI001", 'description': "Muni X"}]}
        serializer = MuniBuyInterestSerializer(data=data)
        self.assertFalse(serializer.is_valid())
        self.assertIn('customer_id', serializer.errors)
        self.assertEqual(str(serializer.errors['customer_id'][0]), "Customer with ID 88888 not found.")

    def test_empty_selected_offerings_muni_buy_interest(self):
        data = {'customer_id': self.customer1.id, 'selected_offerings': []}
        serializer = MuniBuyInterestSerializer(data=data)
        self.assertFalse(serializer.is_valid())
        self.assertIn('selected_offerings', serializer.errors)

    def test_invalid_data_in_selected_offerings(self):
        invalid_offerings_data = [
            {'cusip': "MUNI00001", 'description': "Muni One"},
            {'cusip': "MUNI00003"}
        ]
        data = {'customer_id': self.customer1.id, 'selected_offerings': invalid_offerings_data}
        serializer = MuniBuyInterestSerializer(data=data)
        self.assertFalse(serializer.is_valid())
        self.assertIn('selected_offerings', serializer.errors)
        self.assertIn('description', serializer.errors['selected_offerings'][1])

    def test_missing_customer_id_muni_buy_interest(self):
        data = {'selected_offerings': [{'cusip': "MUNI001", 'description': "Muni X"}]}
        serializer = MuniBuyInterestSerializer(data=data)
        self.assertFalse(serializer.is_valid())
        self.assertIn('customer_id', serializer.errors)

    def test_missing_selected_offerings_muni_buy_interest(self):
        data = {'customer_id': self.customer1.id}
        serializer = MuniBuyInterestSerializer(data=data)
        self.assertFalse(serializer.is_valid())
        self.assertIn('selected_offerings', serializer.errors)


class HoldingToRemoveSerializerTest(TestCase):
    def test_valid_holding_to_remove(self):
        data = {'external_ticket': 12345}
        serializer = HoldingToRemoveSerializer(data=data)
        self.assertTrue(serializer.is_valid(), serializer.errors)

    def test_invalid_holding_to_remove_type(self):
        data = {'external_ticket': "not_an_int"}
        serializer = HoldingToRemoveSerializer(data=data)
        self.assertFalse(serializer.is_valid())
        self.assertIn('external_ticket', serializer.errors)
        self.assertEqual(str(serializer.errors['external_ticket'][0]), 'A valid integer is required.')

    def test_missing_external_ticket(self):
        data = {}
        serializer = HoldingToRemoveSerializer(data=data)
        self.assertFalse(serializer.is_valid())
        self.assertIn('external_ticket', serializer.errors)


class OfferingToBuySerializerTest(TestCase):
    def test_valid_offering_to_buy(self):
        data = {'offering_cusip': "CUSIP1234", 'par_to_buy': "100000.00"}
        serializer = OfferingToBuySerializer(data=data)
        self.assertTrue(serializer.is_valid(), serializer.errors)
        self.assertEqual(serializer.validated_data['par_to_buy'], Decimal("100000.00"))

    def test_invalid_par_to_buy_offering_negative(self):
        data = {'offering_cusip': "CUSIP5678", 'par_to_buy': "-100.00"}
        serializer = OfferingToBuySerializer(data=data)
        self.assertFalse(serializer.is_valid())
        self.assertIn('par_to_buy', serializer.errors)
        self.assertEqual(str(serializer.errors['par_to_buy'][0]), "Par amount to buy must be positive.")

    def test_invalid_par_to_buy_offering_zero(self):
        data = {'offering_cusip': "CUSIP5679", 'par_to_buy': "0.00"}
        serializer = OfferingToBuySerializer(data=data)
        self.assertFalse(serializer.is_valid())
        self.assertIn('par_to_buy', serializer.errors)
        self.assertEqual(str(serializer.errors['par_to_buy'][0]), "Par amount to buy must be positive.")

    def test_invalid_par_to_buy_offering_format(self):
        data = {'offering_cusip': "CUSIP5680", 'par_to_buy': "not_a_decimal"}
        serializer = OfferingToBuySerializer(data=data)
        self.assertFalse(serializer.is_valid())
        self.assertIn('par_to_buy', serializer.errors)
        self.assertTrue("A valid number is required." in str(serializer.errors['par_to_buy'][0]) or \
                        "Must be a valid decimal." in str(serializer.errors['par_to_buy'][0]))

    def test_missing_offering_cusip(self):
        data = {'par_to_buy': "10000"}
        serializer = OfferingToBuySerializer(data=data)
        self.assertFalse(serializer.is_valid())
        self.assertIn('offering_cusip', serializer.errors)

    def test_missing_par_to_buy(self):
        data = {'offering_cusip': "CUSIP123"}
        serializer = OfferingToBuySerializer(data=data)
        self.assertFalse(serializer.is_valid())
        self.assertIn('par_to_buy', serializer.errors)


class PortfolioSimulationSerializerTest(BaseSerializerTest):
    def test_valid_simulation_sell_only(self):
        data = {
            'holdings_to_remove': [{'external_ticket': self.holding1.external_ticket}]
        }
        serializer = PortfolioSimulationSerializer(data=data)
        self.assertTrue(serializer.is_valid(), serializer.errors)

    def test_valid_simulation_buy_only(self):
        data = {
            'offerings_to_buy': [{'offering_cusip': self.offering1.cusip, 'par_to_buy': "50000"}]
        }
        serializer = PortfolioSimulationSerializer(data=data)
        self.assertTrue(serializer.is_valid(), serializer.errors)

    def test_valid_simulation_buy_and_sell(self):
        data = {
            'holdings_to_remove': [{'external_ticket': self.holding1.external_ticket}],
            'offerings_to_buy': [{'offering_cusip': self.offering1.cusip, 'par_to_buy': "25000"}]
        }
        serializer = PortfolioSimulationSerializer(data=data)
        self.assertTrue(serializer.is_valid(), serializer.errors)

    def test_invalid_simulation_empty_input(self):
        data = {}
        serializer = PortfolioSimulationSerializer(data=data)
        self.assertFalse(serializer.is_valid())
        self.assertIn('non_field_errors', serializer.errors)
        self.assertEqual(str(serializer.errors['non_field_errors'][0]), "Must specify at least one holding to 'sell' or offering to 'buy'.")

    def test_invalid_simulation_empty_lists_input(self):
        data = {'holdings_to_remove': [], 'offerings_to_buy': []}
        serializer = PortfolioSimulationSerializer(data=data)
        self.assertFalse(serializer.is_valid())
        self.assertIn('non_field_errors', serializer.errors)
        self.assertEqual(str(serializer.errors['non_field_errors'][0]), "Must specify at least one holding to 'sell' or offering to 'buy'.")

    def test_invalid_simulation_bad_nested_data_offerings(self):
        data = {
            'offerings_to_buy': [{'offering_cusip': self.offering1.cusip, 'par_to_buy': "-100"}]
        }
        serializer = PortfolioSimulationSerializer(data=data)
        self.assertFalse(serializer.is_valid())
        self.assertIn('offerings_to_buy', serializer.errors)
        self.assertIn('par_to_buy', serializer.errors['offerings_to_buy'][0])

    def test_invalid_simulation_bad_nested_data_holdings(self):
        data = {
            'holdings_to_remove': [{'external_ticket': "not-an-int"}]
        }
        serializer = PortfolioSimulationSerializer(data=data)
        self.assertFalse(serializer.is_valid())
        self.assertIn('holdings_to_remove', serializer.errors)
        self.assertIn('external_ticket', serializer.errors['holdings_to_remove'][0])
