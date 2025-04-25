import datetime
from django.urls import reverse
from rest_framework.test import APITestCase
from django.contrib.auth import get_user_model

from portfolio.models import Customer, Security, Portfolio, CustomerHolding

class PortfolioVisualizationTest(APITestCase):
    def setUp(self):
        # Create a user and link to a Customer
        User = get_user_model()
        self.user = User.objects.create_user(username='tester', password='secret')
        self.customer = Customer.objects.create(
            customer_number='CUST-100',
            name='Test Customer',
            address='123 Main St',
            city='Testville',
            state='TS',
            zip_code='12345'
        )
        self.customer.users.add(self.user)

        # Create a portfolio for that customer
        self.portfolio = Portfolio.objects.create(owner=self.customer, name='P1')

        # Create two securities
        self.sec_a = Security.objects.create(
            cusip='AAA',
            description='Bond A',
            issue_date=datetime.date(2025, 1, 1),
            maturity_date=datetime.date(2030, 1, 1),
            coupon=0.05,
            wal=5,
            payment_frequency=2,
            day_count='30/360',
            factor=1
        )
        self.sec_b = Security.objects.create(
            cusip='BBB',
            description='Bond B',
            issue_date=datetime.date(2025, 1, 1),
            maturity_date=datetime.date(2031, 1, 1),
            coupon=0.06,
            wal=4,
            payment_frequency=2,
            day_count='30/360',
            factor=1
        )

        # Add two holdings to the portfolio
        CustomerHolding.objects.create(
            portfolio=self.portfolio,
            customer=self.customer,
            security=self.sec_a,
            original_face_amount=100.00
        )
        CustomerHolding.objects.create(
            portfolio=self.portfolio,
            customer=self.customer,
            security=self.sec_b,
            original_face_amount=50.00
        )

    def test_customer_views_portfolio_detail(self):
        """
        Scenario: Customer views portfolio detail
          When I GET /api/portfolios/{id}/
          Then I see name, owner customer_number, and two holdings
        """
        # authenticate (if your API requires it)
        self.client.force_authenticate(user=self.user)

        url = reverse('portfolio-detail', args=[self.portfolio.id])
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)

        data = response.json()
        # Verify top‐level fields
        self.assertEqual(data['name'], 'P1')
        self.assertEqual(data['owner'], 'CUST-100')

        # Verify nested holdings
        holdings = data.get('holdings', [])
        self.assertEqual(len(holdings), 2)

        # Check each entry
        h_aaa = next((h for h in holdings if h['security_cusip'] == 'AAA'), None)
        self.assertIsNotNone(h_aaa)
        self.assertEqual(h_aaa['original_face_amount'], '100.00')

        h_bbb = next((h for h in holdings if h['security_cusip'] == 'BBB'), None)
        self.assertIsNotNone(h_bbb)
        self.assertEqual(h_bbb['original_face_amount'], '50.00')
