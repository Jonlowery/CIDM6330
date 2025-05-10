# portfolio/tests/test_views.py
from django.urls import reverse
from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase
from rest_framework.authtoken.models import Token # If using TokenAuthentication
from decimal import Decimal
from datetime import date
import json

# Import your models
from portfolio.models import (
    Customer, Salesperson, Security, SecurityType, InterestSchedule,
    Portfolio, CustomerHolding, MunicipalOffering
)
# Import your serializers if needed for constructing payload, though often raw dicts are fine for tests
# from portfolio.serializers import ...

User = get_user_model()

class BaseAPITestCase(APITestCase):
    """
    Base class for API tests, sets up common data.
    """
    @classmethod
    def setUpTestData(cls):
        # Create users
        cls.admin_user = User.objects.create_superuser(
            username='testadmin', email='admin@example.com', password='password123'
        )
        cls.normal_user = User.objects.create_user(
            username='testuser', email='user@example.com', password='password123'
        )

        # Create some initial data that can be used across tests
        cls.salesperson1 = Salesperson.objects.create(salesperson_id="API_S001", name="API Sales", email="apisales@example.com")
        cls.sec_type1 = SecurityType.objects.create(type_id=90, name="API Test SecType")
        cls.int_schedule1 = InterestSchedule.objects.create(schedule_code="API_SEMI", name="API Semi")

        cls.customer1 = Customer.objects.create(
            customer_number=7001, name="API Customer One", city="APICity", state="AP",
            salesperson=cls.salesperson1, portfolio_accounting_code="API_PAC01"
        )
        # Link customer to normal_user for permission tests
        cls.customer1.users.add(cls.normal_user)

        cls.customer2 = Customer.objects.create( # Another customer for permission tests
            customer_number=7002, name="API Customer Two", city="APICity2", state="A2",
            portfolio_accounting_code="API_PAC02"
        )

        cls.security1 = Security.objects.create(
            cusip="APISEC001", description="API Test Security 1", issue_date=date(2021,1,1),
            maturity_date=date(2031,1,1), security_type=cls.sec_type1, coupon=Decimal("3.0"),
            tax_code='t', interest_schedule=cls.int_schedule1, interest_day=1,
            interest_calc_code='c', payments_per_year=2, allows_paydown=False, payment_delay_days=0
        )
        cls.security2 = Security.objects.create(
            cusip="APISEC002", description="API Test Security 2", issue_date=date(2022,1,1),
            maturity_date=date(2032,1,1), tax_code='e', interest_day=15,
            interest_calc_code='a', payments_per_year=1, allows_paydown=True, payment_delay_days=0, cpr=Decimal("5.0")
        )

        cls.portfolio1_cust1 = Portfolio.objects.create(owner=cls.customer1, name="Cust1 Main Portfolio", is_default=True)
        cls.portfolio2_cust1 = Portfolio.objects.create(owner=cls.customer1, name="Cust1 Alt Portfolio")
        cls.portfolio1_cust2 = Portfolio.objects.create(owner=cls.customer2, name="Cust2 Main Portfolio", is_default=True)


        cls.holding1_p1 = CustomerHolding.objects.create(
            external_ticket=80001, portfolio=cls.portfolio1_cust1, security=cls.security1,
            intention_code='A', original_face_amount=Decimal("100000"), settlement_date=date(2023,1,1),
            settlement_price=Decimal("100"), book_price=Decimal("100"), market_price=Decimal("101"), market_date=date(2023,1,15)
        )
        cls.holding2_p1 = CustomerHolding.objects.create(
            external_ticket=80002, portfolio=cls.portfolio1_cust1, security=cls.security2,
            intention_code='H', original_face_amount=Decimal("50000"), settlement_date=date(2023,2,1),
            settlement_price=Decimal("99"), book_price=Decimal("99"), market_price=Decimal("99.5"), market_date=date(2023,2,15)
        )
        cls.holding1_p2_cust1 = CustomerHolding.objects.create( # Holding in another portfolio of cust1
            external_ticket=80003, portfolio=cls.portfolio2_cust1, security=cls.security1,
            intention_code='T', original_face_amount=Decimal("20000"), settlement_date=date(2023,3,1),
            settlement_price=Decimal("102"), book_price=Decimal("102")
        )
        cls.holding1_cust2 = CustomerHolding.objects.create( # Holding for customer2
            external_ticket=80004, portfolio=cls.portfolio1_cust2, security=cls.security1,
            intention_code='A', original_face_amount=Decimal("70000"), settlement_date=date(2023,4,1),
            settlement_price=Decimal("98"), book_price=Decimal("98")
        )

        cls.offering1 = MunicipalOffering.objects.create(
            cusip="APIMUNI01", description="API Test Muni Offering", amount=Decimal("2000000"), price=Decimal("100.5")
        )

        # If using TokenAuthentication, you might want to create tokens
        # cls.admin_token = Token.objects.create(user=cls.admin_user)
        # cls.normal_user_token = Token.objects.create(user=cls.normal_user)

    def get_auth_header(self, user_type="admin"):
        # Helper to get token auth header if using TokenAuthentication
        # if user_type == "admin":
        #     return f'Token {self.admin_token.key}'
        # elif user_type == "normal":
        #     return f'Token {self.normal_user_token.key}'
        return None # For SessionAuthentication, self.client.login() or force_authenticate() is used


class CustomerViewSetTest(BaseAPITestCase):
    def test_list_customers_unauthenticated(self):
        url = reverse('customer-list')
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED) # Or 403 if sessions are on but no login

    def test_list_customers_admin(self):
        self.client.force_authenticate(user=self.admin_user)
        # self.client.credentials(HTTP_AUTHORIZATION=self.get_auth_header("admin"))
        url = reverse('customer-list')
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data['results']), 2) # customer1 and customer2

    def test_list_customers_normal_user(self):
        self.client.force_authenticate(user=self.normal_user)
        url = reverse('customer-list')
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data['results']), 1) # Only customer1 (linked to normal_user)
        self.assertEqual(response.data['results'][0]['customer_number'], self.customer1.customer_number)

    def test_retrieve_customer_normal_user_success(self):
        self.client.force_authenticate(user=self.normal_user)
        url = reverse('customer-detail', kwargs={'pk': self.customer1.pk})
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['name'], self.customer1.name)

    def test_retrieve_customer_normal_user_permission_denied(self):
        self.client.force_authenticate(user=self.normal_user)
        url = reverse('customer-detail', kwargs={'pk': self.customer2.pk}) # customer2 not linked to normal_user
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND) # Or 403 if queryset filtering leads to this

    def test_create_customer_admin(self):
        self.client.force_authenticate(user=self.admin_user)
        url = reverse('customer-list')
        data = {
            'customer_number': 7003, 'name': "Newly Created Cust", 'city': "NewCity", 'state': "NC",
            'portfolio_accounting_code': "NEWPAC", 'salesperson_id_input': self.salesperson1.salesperson_id
        }
        response = self.client.post(url, data, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(Customer.objects.filter(customer_number=7003).exists())

    # Add tests for: create_invalid_data, update_success, update_permission_denied, delete_success, etc.

class SecurityViewSetTest(BaseAPITestCase):
    def test_list_securities_authenticated(self):
        self.client.force_authenticate(user=self.normal_user) # Any authenticated user can list securities
        url = reverse('security-list')
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(len(response.data['results']) >= 2)

    def test_retrieve_security_success(self):
        self.client.force_authenticate(user=self.normal_user)
        url = reverse('security-detail', kwargs={'cusip': self.security1.cusip})
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['description'], self.security1.description)

    def test_create_security_admin_only(self): # Assuming only admins can create securities
        self.client.force_authenticate(user=self.admin_user)
        url = reverse('security-list')
        data = {
            'cusip': "APISEC003", 'description': "Admin Created Sec", 'issue_date': "2023-01-01",
            'maturity_date': "2033-01-01", 'tax_code': 't', 'interest_day': 1,
            'interest_calc_code': 'a', 'payments_per_year': 1, 'allows_paydown': False,
            'payment_delay_days': 0, 'coupon': "1.5"
            # 'security_type_id_input': self.sec_type1.type_id # Optional
        }
        response = self.client.post(url, data, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertTrue(Security.objects.filter(cusip="APISEC003").exists())

        # Test with normal user (should be forbidden)
        self.client.force_authenticate(user=self.normal_user)
        response_normal = self.client.post(url, data, format='json')
        # The actual status code might depend on your default permission for create.
        # If IsAdminUser is applied directly to create or ModelViewSet's default permissions.
        self.assertIn(response_normal.status_code, [status.HTTP_403_FORBIDDEN, status.HTTP_405_METHOD_NOT_ALLOWED])


    # Add tests for: create_invalid_data, update (admin only?), delete (admin only?)

class PortfolioViewSetTest(BaseAPITestCase):
    def test_list_portfolios_normal_user(self):
        self.client.force_authenticate(user=self.normal_user)
        url = reverse('portfolio-list')
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        # normal_user is linked to customer1, which has portfolio1_cust1 and portfolio2_cust1
        self.assertEqual(len(response.data['results']), 2)

    def test_retrieve_portfolio_permission_denied(self):
        self.client.force_authenticate(user=self.normal_user)
        url = reverse('portfolio-detail', kwargs={'pk': self.portfolio1_cust2.pk}) # Belongs to customer2
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND) # or 403

    def test_create_portfolio_for_own_customer(self):
        self.client.force_authenticate(user=self.normal_user)
        url = reverse('portfolio-list')
        data = {'name': "My New Portfolio", 'owner_id_input': self.customer1.id} # User creating for their own customer
        response = self.client.post(url, data, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertTrue(Portfolio.objects.filter(name="My New Portfolio", owner=self.customer1).exists())

    def test_create_portfolio_for_other_customer_denied(self):
        self.client.force_authenticate(user=self.normal_user)
        url = reverse('portfolio-list')
        data = {'name': "Sneaky Portfolio", 'owner_id_input': self.customer2.id} # User trying for other customer
        response = self.client.post(url, data, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST) # Validation error from serializer
        self.assertIn('owner_id_input', response.data)


    # Test custom actions: simulate_swap, aggregated_cash_flows
    # These will require more complex payloads and mocking of underlying utils
    def test_simulate_swap_action(self):
        self.client.force_authenticate(user=self.normal_user) # or admin
        url = reverse('portfolio-simulate-swap', kwargs={'pk': self.portfolio1_cust1.pk})
        payload = {
            "holdings_to_remove": [{"external_ticket": self.holding1_p1.external_ticket}],
            "offerings_to_buy": [{"offering_cusip": self.offering1.cusip, "par_to_buy": "50000.00"}]
        }
        response = self.client.post(url, payload, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertIn('current_portfolio_metrics', response.data)
        self.assertIn('simulated_portfolio_metrics', response.data)
        self.assertIn('delta_metrics', response.data)

    def test_aggregated_cash_flows_action(self):
        self.client.force_authenticate(user=self.normal_user) # or admin
        url = reverse('portfolio-aggregated-cash-flows', kwargs={'pk': self.portfolio1_cust1.pk})
        # Test with and without filter params like ?security_cusip=...
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIsInstance(response.data, list)
        # Further assertions on the structure of flow data if flows are expected


class CustomerHoldingViewSetTest(BaseAPITestCase):
    def test_list_holdings_for_portfolio_normal_user(self):
        self.client.force_authenticate(user=self.normal_user)
        # normal_user is associated with customer1, which owns portfolio1_cust1
        url = reverse('customerholding-list') + f'?portfolio={self.portfolio1_cust1.id}'
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data['results']), 2) # holding1_p1 and holding2_p1

    def test_list_holdings_permission_denied_for_other_customer_portfolio(self):
        self.client.force_authenticate(user=self.normal_user)
        url = reverse('customerholding-list') + f'?portfolio={self.portfolio1_cust2.id}' # Belongs to customer2
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK) # ViewSet filters by user's customers
        self.assertEqual(len(response.data['results']), 0)


    # Test custom actions: cash_flows, financial_analysis
    # These will require mocking of underlying utils
    @patch('portfolio.views.generate_quantlib_cashflows') # Patch where it's used
    def test_holding_cash_flows_action(self, mock_generate_cf):
        self.client.force_authenticate(user=self.normal_user)
        # Mock the return of generate_quantlib_cashflows
        mock_detailed_flows = [
            (MagicMock(date=MagicMock(return_value=ql.Date(1,1,2024)), amount=MagicMock(return_value=1000.0)), 'Interest'),
            (MagicMock(date=MagicMock(return_value=ql.Date(1,1,2024)), amount=MagicMock(return_value=50000.0)), 'Principal')
        ]
        mock_generate_cf.return_value = ([], mock_detailed_flows, None, None)

        url = reverse('customerholding-cash-flows', kwargs={'external_ticket': self.holding1_p1.external_ticket})
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(len(response.data), 2)
        self.assertEqual(response.data[0]['type'], 'Interest')
        mock_generate_cf.assert_called_once()

    @patch('portfolio.views.calculate_bond_analytics') # Patch where it's used
    def test_holding_financial_analysis_action(self, mock_calculate_analytics):
        self.client.force_authenticate(user=self.normal_user)
        mock_calculate_analytics.return_value = {
            'ytm': "3.5000", 'duration_modified': "5.2", 'convexity': "0.25", 'cash_flows': [], 'error': None
        }
        url = reverse('customerholding-financial-analysis', kwargs={'external_ticket': self.holding1_p1.external_ticket})
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data['ytm'], "3.5000")
        mock_calculate_analytics.assert_called_once()

class MunicipalOfferingViewSetTest(BaseAPITestCase):
    def test_list_muni_offerings_authenticated(self):
        self.client.force_authenticate(user=self.normal_user)
        url = reverse('munioffering-list')
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(len(response.data['results']) >= 1)

    # Add tests for filtering if MuniOfferingFilterSet is complex

# --- Tests for Standalone APIViews ---

class ImportExcelViewTest(BaseAPITestCase):
    @patch('portfolio.views.import_securities_from_excel.si') # Patch the .si attribute of the task
    def test_import_excel_securities_admin_success(self, mock_task_si):
        self.client.force_authenticate(user=self.admin_user)
        # Create a dummy task result mock
        mock_task_result = MagicMock()
        mock_task_result.id = "test_task_id_123"
        mock_task_si.return_value.delay.return_value = mock_task_result # mock .si().delay()

        from django.core.files.uploadedfile import SimpleUploadedFile
        upload_file = SimpleUploadedFile("Security.xlsx", b"file_content_sec", content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        url = reverse('import-excel')
        response = self.client.post(url, {'file': upload_file}, format='multipart')

        self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED, response.data)
        self.assertIn("task_id", response.data)
        mock_task_si.assert_called_once() # Check that the task's .si() was called
        mock_task_si.return_value.delay.assert_called_once() # Check that .delay() was called on the signature

    def test_import_excel_non_admin_forbidden(self):
        self.client.force_authenticate(user=self.normal_user)
        upload_file = SimpleUploadedFile("Security.xlsx", b"file_content_sec", content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        url = reverse('import-excel')
        response = self.client.post(url, {'file': upload_file}, format='multipart')
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    # Add tests for other file types (Customers.xlsx, etc.)
    # Add tests for invalid file name, no file submitted

class EmailSalespersonInterestViewTest(BaseAPITestCase):
    @patch('portfolio.views.send_salesperson_interest_email.s') # Patch the .s attribute of the task
    def test_email_sell_interest_success(self, mock_task_s):
        self.client.force_authenticate(user=self.normal_user) # normal_user is linked to customer1
        mock_task_result = MagicMock()
        mock_task_result.id = "email_task_id_456"
        mock_task_s.return_value.delay.return_value = mock_task_result

        url = reverse('email-salesperson-interest')
        payload = {
            "customer_id": self.customer1.id,
            "selected_bonds": [{"cusip": "BOND01", "par": "10000"}]
        }
        response = self.client.post(url, payload, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertIn("Email task queued successfully", response.data['message'])
        mock_task_s.assert_called_once_with(
            salesperson_email=self.salesperson1.email,
            salesperson_name=self.salesperson1.name,
            customer_name=self.customer1.name,
            customer_number=self.customer1.customer_number,
            selected_bonds=payload['selected_bonds']
        )
        mock_task_s.return_value.delay.assert_called_once()


    def test_email_sell_interest_unauthorized_customer(self):
        self.client.force_authenticate(user=self.normal_user)
        url = reverse('email-salesperson-interest')
        payload = {
            "customer_id": self.customer2.id, # normal_user not linked to customer2
            "selected_bonds": [{"cusip": "BOND01", "par": "10000"}]
        }
        response = self.client.post(url, payload, format='json')
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    # Add tests for invalid payload, customer not found, salesperson not configured

class EmailSalespersonMuniBuyInterestViewTest(BaseAPITestCase):
    @patch('portfolio.views.send_salesperson_muni_buy_interest_email.s')
    def test_email_buy_interest_success(self, mock_task_s):
        self.client.force_authenticate(user=self.normal_user)
        mock_task_result = MagicMock()
        mock_task_result.id = "email_buy_task_789"
        mock_task_s.return_value.delay.return_value = mock_task_result

        url = reverse('email-buy-muni-interest')
        payload = {
            "customer_id": self.customer1.id,
            "selected_offerings": [{"cusip": "MUNI01", "description": "Test Muni"}]
        }
        response = self.client.post(url, payload, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertIn("Email task queued successfully", response.data['message'])
        mock_task_s.assert_called_once() # Add detailed argument checking like above

    # Add similar tests as for EmailSalespersonInterestViewTest

# Remember to add more specific tests for each endpoint, covering:
# - Different user roles and permissions
# - Valid and invalid input data for create/update operations
# - Edge cases for filters and custom actions
# - Correct handling of related objects
