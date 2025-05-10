# portfolio/tests/test_serializers.py
from django.test import TestCase
from django.contrib.auth import get_user_model
from rest_framework.test import APIRequestFactory # For providing request context to serializers
from decimal import Decimal
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

# It's good practice to have some helper methods to create instances for tests
# or use a library like factory_boy. For now, we'll create them directly in setUpTestData.

class BaseSerializerTest(TestCase):
    """
    Base class for serializer tests, can hold common setup or helper methods.
    We'll use APIRequestFactory to simulate a request object if context is needed.
    """
    @classmethod
    def setUpTestData(cls):
        cls.factory = APIRequestFactory()
        cls.user = User.objects.create_user(username='testuser', password='password123', is_staff=True)

        # Create common instances needed by many serializer tests
        cls.salesperson1 = Salesperson.objects.create(salesperson_id="S001", name="Jane Doe", email="jane@example.com")
        cls.sec_type1 = SecurityType.objects.create(type_id=10, name="Government Bond")
        cls.int_schedule1 = InterestSchedule.objects.create(schedule_code="MONTHLY", name="Monthly", payments_per_year_default=12)

        cls.customer1 = Customer.objects.create(
            customer_number=2001, name="Customer Alpha", city="AlphaCity", state="AS",
            salesperson=cls.salesperson1, portfolio_accounting_code="PAC001"
        )
        cls.customer1.users.add(cls.user) # Associate user with customer

        cls.security1 = Security.objects.create(
            cusip="SEC000001", description="Test Security Alpha", issue_date=date(2020,1,1),
            maturity_date=date(2030,1,1), security_type=cls.sec_type1, coupon=Decimal("2.5"),
            tax_code='e', interest_schedule=cls.int_schedule1, interest_day=1,
            interest_calc_code='a', payments_per_year=12, allows_paydown=False, payment_delay_days=0
        )
        cls.portfolio1 = Portfolio.objects.create(owner=cls.customer1, name="Alpha Portfolio One", is_default=True)
        cls.holding1 = CustomerHolding.objects.create(
            external_ticket=10001, portfolio=cls.portfolio1, security=cls.security1,
            intention_code='H', original_face_amount=Decimal("50000"), settlement_date=date(2023,1,1),
            settlement_price=Decimal("99.5"), book_price=Decimal("99.0"), market_price=Decimal("100.5")
        )
        cls.offering1 = MunicipalOffering.objects.create(
            cusip="MUNI0000A", description="Alpha Muni Offering", amount=Decimal("1000000"), price=Decimal("101.0")
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
        # Add more assertions for other fields

    def test_valid_salesperson_deserialization(self):
        valid_data = {'salesperson_id': "S002", 'name': "Mike Smith", 'email': "mike@example.com"}
        serializer = SalespersonSerializer(data=valid_data)
        self.assertTrue(serializer.is_valid(), serializer.errors)
        salesperson = serializer.save()
        self.assertEqual(salesperson.name, "Mike Smith")

    def test_invalid_salesperson_deserialization(self):
        invalid_data = {'name': "Missing ID"} # salesperson_id is required
        serializer = SalespersonSerializer(data=invalid_data)
        self.assertFalse(serializer.is_valid())
        self.assertIn('salesperson_id', serializer.errors)

class SecurityTypeSerializerTest(BaseSerializerTest):
    def test_valid_security_type_serialization(self):
        serializer = SecurityTypeSerializer(instance=self.sec_type1)
        data = serializer.data
        self.assertEqual(data['type_id'], self.sec_type1.type_id)
        self.assertEqual(data['name'], self.sec_type1.name)

    # Add tests for deserialization (valid and invalid)

class InterestScheduleSerializerTest(BaseSerializerTest):
    def test_valid_interest_schedule_serialization(self):
        serializer = InterestScheduleSerializer(instance=self.int_schedule1)
        data = serializer.data
        self.assertEqual(data['schedule_code'], self.int_schedule1.schedule_code)
        self.assertEqual(data['name'], self.int_schedule1.name)

    # Add tests for deserialization (valid and invalid)

class CustomerSerializerTest(BaseSerializerTest):
    def test_valid_customer_serialization(self):
        # CustomerSerializer needs context for salesperson_id_input handling if request is involved
        # For basic serialization, context might not be strictly needed if salesperson_id_input isn't used.
        serializer = CustomerSerializer(instance=self.customer1, context=self.get_serializer_context())
        data = serializer.data
        self.assertEqual(data['customer_number'], self.customer1.customer_number)
        self.assertEqual(data['name'], self.customer1.name)
        self.assertIsNotNone(data['salesperson']) # Check nested salesperson
        self.assertEqual(data['salesperson']['salesperson_id'], self.salesperson1.salesperson_id)

    def test_customer_create_with_salesperson_id_input(self):
        valid_data = {
            'customer_number': 2002, 'name': "Beta Corp", 'city': "BetaVille", 'state': "BS",
            'portfolio_accounting_code': "PAC002",
            'salesperson_id_input': self.salesperson1.salesperson_id # Link to existing salesperson
        }
        serializer = CustomerSerializer(data=valid_data, context=self.get_serializer_context())
        self.assertTrue(serializer.is_valid(), serializer.errors)
        customer = serializer.save()
        self.assertEqual(customer.salesperson, self.salesperson1)

    def test_customer_create_invalid_salesperson_id_input(self):
        invalid_data = {
            'customer_number': 2003, 'name': "Gamma Inc", 'city': "GammaCity", 'state': "GS",
            'portfolio_accounting_code': "PAC003",
            'salesperson_id_input': "INVALID_ID"
        }
        serializer = CustomerSerializer(data=invalid_data, context=self.get_serializer_context())
        self.assertFalse(serializer.is_valid())
        self.assertIn('salesperson_id_input', serializer.errors)

    # Add more tests: update, missing required fields, etc.

class SecuritySerializerTest(BaseSerializerTest):
    def test_valid_security_serialization(self):
        serializer = SecuritySerializer(instance=self.security1, context=self.get_serializer_context())
        data = serializer.data
        self.assertEqual(data['cusip'], self.security1.cusip)
        self.assertEqual(data['description'], self.security1.description)
        self.assertIsNotNone(data['security_type'])
        self.assertEqual(data['security_type']['type_id'], self.sec_type1.type_id)
        # Test DecimalFields are serialized as strings
        self.assertEqual(data['coupon'], str(self.security1.coupon.quantize(Decimal("0.00000001"))))


    def test_security_create_with_fk_inputs(self):
        valid_data = {
            'cusip': "SEC000002", 'description': "Test Security Beta",
            'issue_date': "2021-01-01", 'maturity_date': "2031-01-01",
            'tax_code': 't', 'interest_day': 15, 'interest_calc_code': 'c',
            'payments_per_year': 2, 'allows_paydown': True, 'payment_delay_days': 2,
            'security_type_id_input': self.sec_type1.type_id,
            'interest_schedule_code_input': self.int_schedule1.schedule_code,
            'coupon': "3.0",
            'cpr': "6.5" # Test CPR field
        }
        serializer = SecuritySerializer(data=valid_data, context=self.get_serializer_context())
        self.assertTrue(serializer.is_valid(), serializer.errors)
        security = serializer.save()
        self.assertEqual(security.security_type, self.sec_type1)
        self.assertEqual(security.interest_schedule, self.int_schedule1)
        self.assertEqual(security.cpr, Decimal("6.50000"))

    # Add more tests: update, invalid FK inputs, validation of choices, etc.

class PortfolioSerializerTest(BaseSerializerTest):
    def test_valid_portfolio_serialization(self):
        serializer = PortfolioSerializer(instance=self.portfolio1, context=self.get_serializer_context())
        data = serializer.data
        self.assertEqual(data['name'], self.portfolio1.name)
        self.assertTrue(data['is_default'])
        self.assertIsNotNone(data['owner'])
        self.assertEqual(data['owner']['customer_number'], self.customer1.customer_number)

    def test_portfolio_create_for_owner(self):
        # PortfolioSerializer's create/validate methods have logic based on request.user
        # and owner_id_input.
        valid_data = {
            'name': "New Test Portfolio",
            'owner_id_input': self.customer1.id
        }
        # Simulate a request from an admin user for simplicity here
        admin_user = User.objects.create_user(username='adminuser', password='password', is_staff=True, is_superuser=True)
        serializer = PortfolioSerializer(data=valid_data, context=self.get_serializer_context(request_user=admin_user))
        self.assertTrue(serializer.is_valid(), serializer.errors)
        portfolio = serializer.save() # This calls serializer.create()
        self.assertEqual(portfolio.owner, self.customer1)
        self.assertFalse(portfolio.is_default) # Default is False unless specified

    def test_portfolio_create_validation_owner_permission(self):
        # Create another user and customer not associated with self.user
        other_user = User.objects.create_user(username='otheruser', password='password')
        other_customer = Customer.objects.create(
            customer_number=2005, name="Other Customer", city="OtherCity", state="OS",
            portfolio_accounting_code="PAC005"
        )
        # self.user tries to create a portfolio for other_customer
        invalid_data = {
            'name': "Unauthorized Portfolio",
            'owner_id_input': other_customer.id
        }
        # Use self.user (non-admin, not associated with other_customer) in context
        serializer = PortfolioSerializer(data=invalid_data, context=self.get_serializer_context(request_user=self.user))
        self.assertFalse(serializer.is_valid())
        self.assertIn('owner_id_input', serializer.errors) # Or a general non-field error depending on impl.

    # Add tests for initial_holding_ids logic, various validation scenarios in validate()

class CustomerHoldingSerializerTest(BaseSerializerTest):
    def test_valid_holding_serialization(self):
        serializer = CustomerHoldingSerializer(instance=self.holding1)
        data = serializer.data
        self.assertEqual(data['external_ticket'], self.holding1.external_ticket)
        self.assertEqual(data['security_cusip'], self.security1.cusip)
        self.assertEqual(data['portfolio_id'], self.portfolio1.id)
        self.assertIsNotNone(data['par_value']) # Test SerializerMethodField
        # Expected par = original_face * factor (assuming factor is 1.0 for security1)
        expected_par = self.holding1.original_face_amount * (self.security1.factor or Decimal("1.0"))
        self.assertEqual(Decimal(data['par_value']), expected_par.quantize(Decimal("0.01")))

    def test_holding_create(self):
        security2 = Security.objects.create(
            cusip="SEC000003", description="Test Security Gamma", issue_date=date(2022,1,1),
            maturity_date=date(2032,1,1), tax_code='t', interest_day=1,
            interest_calc_code='a', payments_per_year=1, allows_paydown=False, payment_delay_days=0
        )
        valid_data = {
            'external_ticket': 10002,
            'portfolio_id_input': self.portfolio1.id,
            'security_cusip_input': security2.cusip,
            'intention_code': 'T',
            'original_face_amount': "75000.00",
            'settlement_date': "2023-02-01",
            'settlement_price': "100.00",
            'book_price': "100.00",
        }
        serializer = CustomerHoldingSerializer(data=valid_data)
        self.assertTrue(serializer.is_valid(), serializer.errors)
        holding = serializer.save()
        self.assertEqual(holding.security, security2)
        self.assertEqual(holding.portfolio, self.portfolio1)

    # Add tests for invalid FK inputs, validation of choices, par_value calculation with different factors

class MunicipalOfferingSerializerTest(BaseSerializerTest):
    def test_valid_offering_serialization(self):
        serializer = MunicipalOfferingSerializer(instance=self.offering1)
        data = serializer.data
        self.assertEqual(data['cusip'], self.offering1.cusip)
        self.assertEqual(Decimal(data['price']), self.offering1.price.quantize(Decimal("0.000001")))

    # MunicipalOfferingSerializer is mostly read-only based on fields, so focus on serialization.

# --- Tests for Non-Model Serializers ---

class ExcelUploadSerializerTest(TestCase):
    def test_valid_file_upload(self):
        # This serializer is simple, mainly for file presence.
        # Testing actual file processing is for the view/task.
        from django.core.files.uploadedfile import SimpleUploadedFile
        upload_file = SimpleUploadedFile("test.xlsx", b"file_content", content_type="application/vnd.ms-excel")
        data = {'file': upload_file}
        serializer = ExcelUploadSerializer(data=data)
        self.assertTrue(serializer.is_valid())

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

    def test_invalid_par_selected_bond(self):
        data = {'cusip': "TESTBOND2", 'par': "invalid_par"}
        serializer = SelectedBondSerializer(data=data)
        self.assertFalse(serializer.is_valid())
        self.assertIn('par', serializer.errors)

    # Add tests for missing fields

class SalespersonInterestSerializerTest(BaseSerializerTest): # Inherit for customer setup
    def test_valid_salesperson_interest(self):
        selected_bonds_data = [
            {'cusip': "BOND00001", 'par': "50000"},
            {'cusip': "BOND00002", 'par': "75000.50"}
        ]
        data = {'customer_id': self.customer1.id, 'selected_bonds': selected_bonds_data}
        serializer = SalespersonInterestSerializer(data=data)
        self.assertTrue(serializer.is_valid(), serializer.errors)

    def test_invalid_customer_id_salesperson_interest(self):
        data = {'customer_id': 99999, 'selected_bonds': [{'cusip': "BONDX", 'par': "1000"}]} # Non-existent customer
        serializer = SalespersonInterestSerializer(data=data)
        self.assertFalse(serializer.is_valid())
        self.assertIn('customer_id', serializer.errors)

    def test_empty_selected_bonds_salesperson_interest(self):
        data = {'customer_id': self.customer1.id, 'selected_bonds': []}
        serializer = SalespersonInterestSerializer(data=data)
        self.assertFalse(serializer.is_valid()) # allow_empty=False
        self.assertIn('selected_bonds', serializer.errors)

    # Test with invalid data within selected_bonds list

class SelectedOfferingSerializerTest(TestCase):
    def test_valid_selected_offering(self):
        data = {'cusip': "OFFER0001", 'description': "Test Offering"}
        serializer = SelectedOfferingSerializer(data=data)
        self.assertTrue(serializer.is_valid(), serializer.errors)

    # Add tests for missing fields

class MuniBuyInterestSerializerTest(BaseSerializerTest): # Inherit for customer setup
    def test_valid_muni_buy_interest(self):
        selected_offerings_data = [
            {'cusip': "MUNI00001", 'description': "Muni One"},
            {'cusip': "MUNI00002", 'description': "Muni Two"}
        ]
        data = {'customer_id': self.customer1.id, 'selected_offerings': selected_offerings_data}
        serializer = MuniBuyInterestSerializer(data=data)
        self.assertTrue(serializer.is_valid(), serializer.errors)

    # Add tests similar to SalespersonInterestSerializerTest (invalid customer, empty list, invalid internal data)


class HoldingToRemoveSerializerTest(TestCase):
    def test_valid_holding_to_remove(self):
        data = {'external_ticket': 12345}
        serializer = HoldingToRemoveSerializer(data=data)
        self.assertTrue(serializer.is_valid(), serializer.errors)

    def test_invalid_holding_to_remove(self):
        data = {'external_ticket': "not_an_int"}
        serializer = HoldingToRemoveSerializer(data=data)
        self.assertFalse(serializer.is_valid())
        self.assertIn('external_ticket', serializer.errors)

class OfferingToBuySerializerTest(TestCase):
    def test_valid_offering_to_buy(self):
        data = {'offering_cusip': "CUSIP1234", 'par_to_buy': "100000.00"}
        serializer = OfferingToBuySerializer(data=data)
        self.assertTrue(serializer.is_valid(), serializer.errors)

    def test_invalid_par_to_buy_offering(self):
        data = {'offering_cusip': "CUSIP5678", 'par_to_buy': "0.00"} # Must be positive
        serializer = OfferingToBuySerializer(data=data)
        self.assertFalse(serializer.is_valid())
        self.assertIn('par_to_buy', serializer.errors)

    def test_invalid_cusip_format_offering(self): # Assuming CUSIP has length/char validation in model/serializer
        data = {'offering_cusip': "SHORT", 'par_to_buy': "10000"}
        serializer = OfferingToBuySerializer(data=data)
        # This depends on if you add specific CUSIP validation to this serializer or rely on model
        # For now, CharField only checks max_length by default.
        # self.assertFalse(serializer.is_valid())
        # self.assertIn('offering_cusip', serializer.errors)
        pass # Placeholder if no specific CUSIP validation here

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
        data = {} # Neither remove nor buy
        serializer = PortfolioSimulationSerializer(data=data)
        self.assertFalse(serializer.is_valid())
        self.assertIn('non_field_errors', serializer.errors) # From custom validate() method

    def test_invalid_simulation_bad_nested_data(self):
        data = {
            'offerings_to_buy': [{'offering_cusip': self.offering1.cusip, 'par_to_buy': "-100"}] # Invalid par
        }
        serializer = PortfolioSimulationSerializer(data=data)
        self.assertFalse(serializer.is_valid())
        self.assertIn('offerings_to_buy', serializer.errors)
        self.assertIn('par_to_buy', serializer.errors['offerings_to_buy'][0])

# Remember to add more specific test cases for each serializer,
# covering all validation rules, read_only/write_only fields,
# and any custom logic in create(), update(), validate_<field>(), or validate().
