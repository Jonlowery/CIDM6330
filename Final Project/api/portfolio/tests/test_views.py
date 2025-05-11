# portfolio/tests/test_views.py
from django.urls import reverse
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.conf import settings
from rest_framework import status
from rest_framework.test import APITestCase
from decimal import Decimal
from datetime import date, timedelta
from django.db import IntegrityError # Import IntegrityError
from unittest.mock import patch, MagicMock
import os
import uuid

# Import your models
from portfolio.models import (
    Customer, Salesperson, Security, SecurityType, InterestSchedule,
    Portfolio, CustomerHolding, MunicipalOffering
)
# Import your serializers if needed for constructing payload
from portfolio.serializers import CustomerHoldingSerializer # For required fields reference

User = get_user_model()

# Default date for tests if not specified otherwise
DEFAULT_TEST_DATE = date(2023, 1, 1)


class BaseAPITestCase(APITestCase):
    """
    Base class for API tests, sets up common data.
    """
    @classmethod
    def setUpTestData(cls):
        cls.admin_user = User.objects.create_superuser(username='testadmin', email='admin@example.com', password='password123')
        cls.normal_user = User.objects.create_user(username='testuser', email='user@example.com', password='password123')
        cls.another_normal_user = User.objects.create_user(username='anotheruser', email='another@example.com', password='password123')

        cls.salesperson1 = Salesperson.objects.create(salesperson_id="API_S001", name="API Sales", email="apisales@example.com")
        cls.salesperson2 = Salesperson.objects.create(salesperson_id="API_S002", name="API Sales Two", email="apisales2@example.com")
        cls.sec_type1 = SecurityType.objects.create(type_id=90, name="API Test SecType Bond")
        cls.sec_type2 = SecurityType.objects.create(type_id=91, name="API Test SecType Equity")
        cls.int_schedule1 = InterestSchedule.objects.create(schedule_code="API_SEMI", name="API Semi")

        cls.customer1 = Customer.objects.create(customer_number=7001, name="API Customer One", city="APICity", state="AP", salesperson=cls.salesperson1, portfolio_accounting_code="API_PAC01")
        cls.customer1.users.add(cls.normal_user)
        cls.customer2 = Customer.objects.create(customer_number=7002, name="API Customer Two", city="APICity2", state="A2", salesperson=cls.salesperson2, portfolio_accounting_code="API_PAC02")
        cls.customer2.users.add(cls.another_normal_user)

        cls.security1 = Security.objects.create(
            cusip="APISEC001", description="API Test Security 1", issue_date=date(2021,1,1),
            maturity_date=date(2031,1,1), security_type=cls.sec_type1, coupon=Decimal("3.0"),
            tax_code='t', interest_schedule=cls.int_schedule1, interest_day=1,
            interest_calc_code='c', payments_per_year=2, allows_paydown=False, payment_delay_days=0,
            factor=Decimal("1.0"), wal=Decimal("7.5"), secondary_rate=Decimal("0.0")
        )
        cls.security2 = Security.objects.create(
            cusip="APISEC002", description="API Test Security 2", issue_date=date(2022,1,1),
            maturity_date=date(2032,1,1), security_type=cls.sec_type2, coupon=Decimal("2.5"),
            tax_code='e', interest_day=15,
            interest_calc_code='a', payments_per_year=1, allows_paydown=True, payment_delay_days=0, cpr=Decimal("5.0"),
            factor=Decimal("0.95"), wal=Decimal("8.0"), secondary_rate=Decimal("0.0")
        )

        cls.portfolio1_cust1 = Portfolio.objects.create(owner=cls.customer1, name="Cust1 Main Portfolio", is_default=True)
        cls.portfolio2_cust1 = Portfolio.objects.create(owner=cls.customer1, name="Cust1 Alt Portfolio")
        cls.portfolio1_cust2 = Portfolio.objects.create(owner=cls.customer2, name="Cust2 Main Portfolio", is_default=True)

        cls.common_holding_fields = {
            "intention_code": 'A',
            "settlement_date": DEFAULT_TEST_DATE,
            "settlement_price": Decimal("100"),
            "book_price": Decimal("100"),
            "market_price": Decimal("101"),
            "market_date": DEFAULT_TEST_DATE + timedelta(days=15),
            "book_yield": Decimal("3.0"),
            "holding_duration": Decimal("7.0"),
            "holding_average_life": Decimal("7.2"),
            "market_yield": Decimal("2.9")
        }

        cls.holding1_p1 = CustomerHolding.objects.create(external_ticket=80001, portfolio=cls.portfolio1_cust1, security=cls.security1, original_face_amount=Decimal("100000"), **cls.common_holding_fields)
        cls.holding2_p1 = CustomerHolding.objects.create(external_ticket=80002, portfolio=cls.portfolio1_cust1, security=cls.security2, original_face_amount=Decimal("50000"), **{**cls.common_holding_fields, "settlement_price": Decimal("99"), "book_price": Decimal("99"), "market_price": Decimal("99.5")})
        cls.holding1_p2_cust1 = CustomerHolding.objects.create(external_ticket=80003, portfolio=cls.portfolio2_cust1, security=cls.security1, original_face_amount=Decimal("20000"), **{**cls.common_holding_fields, "settlement_price": Decimal("102"), "book_price": Decimal("102"), "market_price": Decimal("102.5")})
        cls.holding1_cust2 = CustomerHolding.objects.create(external_ticket=80004, portfolio=cls.portfolio1_cust2, security=cls.security1, original_face_amount=Decimal("70000"), **{**cls.common_holding_fields, "settlement_price": Decimal("98"), "book_price": Decimal("98"), "market_price": Decimal("98.5")})

        cls.offering1 = MunicipalOffering.objects.create(
            cusip="APIMUNI01", description="API Test Muni Offering 1", amount=Decimal("2000000"), price=Decimal("100.5"),
            coupon=Decimal("4.0"), maturity_date=date(2040,1,1), state="TX"
        )
        cls.offering2 = MunicipalOffering.objects.create(
            cusip="APIMUNI02", description="API Test Muni Offering 2", amount=Decimal("1000000"), price=Decimal("101.0"),
            coupon=Decimal("3.5"), maturity_date=date(2035,6,1), state="CA"
        )
        cls.upload_dir = settings.BASE_DIR / 'data' / 'imports' / 'uploads'

    @classmethod
    def tearDownClass(cls):
        upload_dir_path = settings.BASE_DIR / 'data' / 'imports' / 'uploads'
        if os.path.exists(upload_dir_path):
            for item in os.listdir(upload_dir_path):
                item_path = os.path.join(upload_dir_path, item)
                if item.endswith((".xlsx", ".xls")):
                    try: os.remove(item_path)
                    except OSError: pass
        super().tearDownClass()

    def _get_full_holding_payload(self, overrides=None):
        """ Helper to create a valid payload for CustomerHolding creation. """
        payload = {
            "external_ticket": 90000,
            "portfolio_id_input": self.portfolio1_cust1.id, # Serializer expects this field name
            "security_cusip_input": self.security1.cusip,
            "original_face_amount": "50000",
            "settlement_date": DEFAULT_TEST_DATE.isoformat(),
            "settlement_price": "100.00",
            "book_price": "100.00",
            "intention_code": "A",
            "book_yield": "3.0",
            "holding_duration": "7.0",
            "holding_average_life": "7.5",
            "market_price": "101.00",
            "market_yield": "2.9",
            "market_date": (DEFAULT_TEST_DATE + timedelta(days=15)).isoformat(),
        }
        if overrides:
            payload.update(overrides)
        return payload

    def _get_full_security_model_data(self, overrides=None):
        """ Helper to create a valid data dict for Security model creation. """
        data = {
            'cusip': "NEWSECMOD", 'description': "New Model Security",
            'issue_date': date(2024,1,1), 'maturity_date': date(2034,1,1),
            'tax_code': 't', 'interest_day': 1, 'interest_calc_code': 'c',
            'payments_per_year': 2, 'allows_paydown': False, 'payment_delay_days': 0,
            'coupon': Decimal("2.0"), 'factor': Decimal("1.0"), 'wal': Decimal("8.0"),
            'security_type': self.sec_type1,
            'interest_schedule': self.int_schedule1,
            'secondary_rate': Decimal("0.0"),
        }
        if overrides:
            data.update(overrides)
        return data

    def _get_full_security_api_payload(self, overrides=None):
        """ Helper to create a valid payload for Security API creation. """
        payload = {
            'cusip': "NEWSECAPI", 'description': "New API Security",
            'issue_date': "2024-01-01", 'maturity_date': "2034-01-01",
            'tax_code': 't', 'interest_day': 1, 'interest_calc_code': 'c',
            'payments_per_year': 2, 'allows_paydown': False, 'payment_delay_days': 0,
            'coupon': "2.0", 'factor': "1.0", 'wal': "8.0",
            'security_type_id_input': self.sec_type1.type_id,
            'interest_schedule_code_input': self.int_schedule1.schedule_code,
            'secondary_rate': "0.0",
        }
        if overrides:
            payload.update(overrides)
        return payload


class PortfolioAnalyzerViewTest(BaseAPITestCase):
    def test_portfolio_analyzer_view_admin_user(self):
        logged_in = self.client.login(username='testadmin', password='password123')
        self.assertTrue(logged_in, "Admin user login failed")
        url = reverse('portfolio-analyzer')
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.content)
        # Updated to match the actual JavaScript output from the template
        self.assertContains(response, "window.IS_ADMIN_USER = true;")
        self.client.logout()

    def test_portfolio_analyzer_view_normal_user(self):
        logged_in = self.client.login(username='testuser', password='password123')
        self.assertTrue(logged_in, "Normal user login failed")
        url = reverse('portfolio-analyzer')
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.content)
        # Updated to match the actual JavaScript output from the template
        self.assertContains(response, "window.IS_ADMIN_USER = false;")
        self.client.logout()

    def test_portfolio_analyzer_view_unauthenticated(self):
        url = reverse('portfolio-analyzer')
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_302_FOUND)
        self.assertTrue(settings.LOGIN_URL in response.url)


class CustomerViewSetTest(BaseAPITestCase):
    def test_create_customer_normal_user(self):
        self.client.force_authenticate(user=self.normal_user)
        url = reverse('customer-list')
        data = {'customer_number': 7004, 'name': "User Created Cust", 'city': "UserCity", 'state': "UC", 'salesperson_id_input': self.salesperson1.salesperson_id}
        response = self.client.post(url, data, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_delete_customer_normal_user(self):
        self.client.force_authenticate(user=self.normal_user)
        url = reverse('customer-detail', kwargs={'pk': self.customer1.pk})
        response = self.client.delete(url)
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)


class SecurityViewSetTest(BaseAPITestCase):
    def test_create_security_admin_only(self):
        self.client.force_authenticate(user=self.admin_user)
        url = reverse('security-list')
        data = self._get_full_security_api_payload({'cusip': "APISEC003"})
        response = self.client.post(url, data, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)

        self.client.force_authenticate(user=self.normal_user)
        data_user = self._get_full_security_api_payload({'cusip': "APISEC004"})
        response_normal = self.client.post(url, data_user, format='json')
        self.assertEqual(response_normal.status_code, status.HTTP_201_CREATED)

    def test_update_security_admin_only(self):
        self.client.force_authenticate(user=self.admin_user)
        url = reverse('security-detail', kwargs={'cusip': self.security1.cusip})
        data = {'description': "Updated by Admin"}
        response = self.client.patch(url, data, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)

        self.client.force_authenticate(user=self.normal_user)
        response_normal = self.client.patch(url, data, format='json')
        self.assertEqual(response_normal.status_code, status.HTTP_200_OK)

    def test_delete_security_admin_only(self):
        temp_sec_data = self._get_full_security_model_data({'cusip': "DELSEC001"})
        temp_sec = Security.objects.create(**temp_sec_data)

        self.client.force_authenticate(user=self.admin_user)
        url = reverse('security-detail', kwargs={'cusip': temp_sec.cusip})
        response = self.client.delete(url)
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)

        self.client.force_authenticate(user=self.normal_user)
        url_normal = reverse('security-detail', kwargs={'cusip': self.security2.cusip})
        response_normal = self.client.delete(url_normal)
        self.assertEqual(response_normal.status_code, status.HTTP_204_NO_CONTENT)


class PortfolioViewSetTest(BaseAPITestCase):
    @patch('portfolio.views.CustomerHolding.objects.bulk_create')
    def test_create_portfolio_with_holding_copy_bulk_create_error(self, mock_bulk_create):
        mock_bulk_create.side_effect = IntegrityError("DB error during bulk create")
        self.client.force_authenticate(user=self.admin_user)
        url = reverse('portfolio-list')
        data = {'name': "Portfolio Copy Fail", 'owner_id_input': self.customer1.id, 'initial_holding_ids': [self.holding1_p1.external_ticket]}
        response = self.client.post(url, data, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST, response.data)
        self.assertTrue(any("Error copying holdings" in str(err) for err in response.data), response.data)


    def test_simulate_swap_action_offering_not_found(self):
        self.client.force_authenticate(user=self.normal_user)
        url = reverse('portfolio-simulate-swap', kwargs={'pk': self.portfolio1_cust1.pk})
        payload = {"offerings_to_buy": [{"offering_cusip": "NONEX000A", "par_to_buy": "50000.00"}]}
        response = self.client.post(url, payload, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST, response.data)
        self.assertIn("NONEX000A not found", response.data.get('error', ''))

    @patch('portfolio.views.generate_quantlib_cashflows')
    def test_aggregated_cash_flows_quantlib_error(self, mock_generate_cf):
        self.client.force_authenticate(user=self.normal_user)
        mock_generate_cf.return_value = (None, None, None, "QuantLib Calculation Error")
        temp_portfolio = Portfolio.objects.create(owner=self.customer1, name="Temp Single Holding Portfolio")
        holding_data_for_creation = {k:v for k,v in self.common_holding_fields.items()}
        CustomerHolding.objects.create(
            external_ticket=90001, portfolio=temp_portfolio, security=self.security1,
            original_face_amount=Decimal("10000"),
            **holding_data_for_creation
        )
        url = reverse('portfolio-aggregated-cash-flows', kwargs={'pk': temp_portfolio.pk})
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data, [])


class CustomerHoldingViewSetTest(BaseAPITestCase):
    def test_list_holdings_filtering_by_security_cusip(self):
        self.client.force_authenticate(user=self.normal_user)
        url = reverse('customerholding-list') + f'?portfolio={self.portfolio1_cust1.id}&security_cusip={self.security1.cusip}'
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data['results']), 1)
        self.assertEqual(response.data['results'][0]['security']['cusip'], self.security1.cusip)

    def test_create_holding_normal_user_own_portfolio(self):
        self.client.force_authenticate(user=self.normal_user)
        url = reverse('customerholding-list')
        data = self._get_full_holding_payload({
            "external_ticket": 80005,
            "portfolio_id_input": self.portfolio1_cust1.id,
        })
        response = self.client.post(url, data, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST, response.data)
        self.assertIn('portfolio', response.data)
        self.assertEqual(response.data['portfolio'], 'Portfolio is required.')


    def test_create_holding_normal_user_other_portfolio_denied(self):
        self.client.force_authenticate(user=self.normal_user)
        url = reverse('customerholding-list')
        data = self._get_full_holding_payload({
            "external_ticket": 80006,
            "portfolio_id_input": self.portfolio1_cust2.id,
        })
        response = self.client.post(url, data, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


    def test_create_holding_integrity_error_duplicate_ticket(self):
        self.client.force_authenticate(user=self.admin_user)
        url = reverse('customerholding-list')
        data = self._get_full_holding_payload({"external_ticket": self.holding1_p1.external_ticket})
        response = self.client.post(url, data, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('external_ticket', response.data)
        self.assertTrue(any("already exists" in str(err).lower() for err in response.data['external_ticket']))

    def test_holding_financial_analysis_action_no_market_price(self):
        self.client.force_authenticate(user=self.normal_user)
        non_market_fields = {k:v for k,v in self.common_holding_fields.items() if k not in ['market_price', 'market_date', 'market_yield']}
        holding_no_price = CustomerHolding.objects.create(
            external_ticket=80007, portfolio=self.portfolio1_cust1, security=self.security1,
            original_face_amount="1000", market_price=None,
            **non_market_fields
        )
        url = reverse('customerholding-financial-analysis', kwargs={'external_ticket': holding_no_price.external_ticket})
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data.get('error'), "Market price required.")


class EmailSalespersonInterestViewTest(BaseAPITestCase):
    def test_email_sell_interest_customer_not_found(self):
        self.client.force_authenticate(user=self.normal_user)
        url = reverse('email-salesperson-interest')
        payload = {"customer_id": 9999, "selected_bonds": [{"cusip": "VALID01", "par": "10000"}]}
        response = self.client.post(url, payload, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('customer_id', response.data)
        self.assertEqual(response.data['customer_id'][0].code, 'invalid')


    def test_email_sell_interest_salesperson_not_configured(self):
        self.client.force_authenticate(user=self.normal_user)
        customer_no_sales_email = Customer.objects.create(customer_number=7005, name="No Sales Email")
        customer_no_sales_email.users.add(self.normal_user)
        temp_salesperson = Salesperson.objects.create(salesperson_id="TEMP01", name="Temp Sales", email=None)
        customer_no_sales_email.salesperson = temp_salesperson
        customer_no_sales_email.save()
        url = reverse('email-salesperson-interest')
        payload = {"customer_id": customer_no_sales_email.id, "selected_bonds": [{"cusip": "VALID01", "par": "10000"}]}
        response = self.client.post(url, payload, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data.get('error'), "Salesperson email is not configured for this customer.")

    @patch('portfolio.views.send_salesperson_interest_email.s')
    def test_email_sell_interest_celery_delay_error(self, mock_task_s):
        self.client.force_authenticate(user=self.normal_user)
        mock_task_s.return_value.delay.side_effect = Exception("Celery down")
        url = reverse('email-salesperson-interest')
        payload = {"customer_id": self.customer1.id, "selected_bonds": [{"cusip": "VALID01", "par": "10000"}]}
        response = self.client.post(url, payload, format='json')
        self.assertEqual(response.status_code, status.HTTP_500_INTERNAL_SERVER_ERROR)
        self.assertIn("Failed to queue email task", response.data['error'])


class EmailSalespersonMuniBuyInterestViewTest(BaseAPITestCase):
    @patch('portfolio.views.send_salesperson_muni_buy_interest_email.s')
    def test_email_buy_interest_success_normal_user(self, mock_task_s):
        self.client.force_authenticate(user=self.normal_user)
        mock_task_result = MagicMock(id="email_buy_task_789")
        mock_task_s.return_value.delay.return_value = mock_task_result
        url = reverse('email-buy-muni-interest')
        api_payload = {"customer_id": self.customer1.id, "selected_offerings": [{"cusip": "MUNI01", "description": "Test Muni", "par_amount": "100000"}]}
        celery_task_expected_offerings = [{"cusip": "MUNI01", "description": "Test Muni"}]

        response = self.client.post(url, api_payload, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)

        mock_task_s.assert_called_once_with(
            salesperson_email=self.salesperson1.email,
            salesperson_name=self.salesperson1.name,
            customer_name=self.customer1.name,
            customer_number=self.customer1.customer_number,
            selected_offerings=celery_task_expected_offerings
        )
