# portfolio/tests/test_simulation.py

from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase
from portfolio.models import Customer, Security, Portfolio, CustomerHolding

class PortfolioSwapSimulationTest(APITestCase):
    def setUp(self):
        # create customer + default portfolio
        self.customer = Customer.objects.create(
            customer_number='CUST-100',
            name='Test Customer',
            address='123 Main',
            city='Town',
            state='ST',
            zip_code='00000'
        )
        self.portfolio = Portfolio.objects.create(
            owner=self.customer,
            name='Test Portfolio'
        )
        # two securities
        self.secA = Security.objects.create(
            cusip='AAA', description='Bond A',
            issue_date='2020-01-01', maturity_date='2030-01-01',
            coupon=0.05, wal=5,
            payment_frequency=2, day_count='30/360', factor=1.0
        )
        self.secB = Security.objects.create(
            cusip='BBB', description='Bond B',
            issue_date='2021-01-01', maturity_date='2031-01-01',
            coupon=0.04, wal=6,
            payment_frequency=2, day_count='30/360', factor=1.0
        )
        # initial holdings A=100, B=50
        CustomerHolding.objects.create(
            customer=self.customer,
            portfolio=self.portfolio,
            security=self.secA,
            original_face_amount=100,
            settlement_date='2025-01-01',
            settlement_price=100, book_price=100, book_yield=0.05
        )
        CustomerHolding.objects.create(
            customer=self.customer,
            portfolio=self.portfolio,
            security=self.secB,
            original_face_amount=50,
            settlement_date='2025-01-01',
            settlement_price=100, book_price=100, book_yield=0.04
        )

    def test_swap_simulation(self):
        url = reverse('portfolio-simulate-swap', args=[self.portfolio.id])
        payload = {
            "add": [
                {"security_id": self.secA.id, "face_amount": 80, "price": 101.5}
            ],
            "remove": [
                {"holding_id": CustomerHolding.objects.get(security=self.secB).id}
            ]
        }
        response = self.client.post(url, payload, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        data = response.json()
        # unchanged total face = 150
        self.assertEqual(data['before_total_face'], 150)
        self.assertEqual(data['after_total_face'], 150)

        # deltas present
        self.assertIn('delta_wal', data)
        self.assertIn('delta_net_benefit', data)

        # original holdings untouched
        holdings = CustomerHolding.objects.filter(portfolio=self.portfolio)
        self.assertEqual(holdings.count(), 2)

