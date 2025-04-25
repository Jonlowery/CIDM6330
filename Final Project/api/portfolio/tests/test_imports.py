# api/portfolio/tests/test_imports.py

import os
from django.test import TestCase
from django.conf import settings
from portfolio.tasks import (
    import_securities_from_excel,
    import_customers_from_excel,
    import_holdings_from_excel,
)
from portfolio.models import Security, Customer, Portfolio, CustomerHolding

class ImportTasksTest(TestCase):
    def setUp(self):
        base = settings.BASE_DIR / 'data' / 'imports'
        self.sec_file = str(base / 'sample_securities.xlsx')
        self.cust_file = str(base / 'customers.xlsx')
        self.hold_file = str(base / 'holdings.xlsx')

    def test_import_securities_creates_securities(self):
        # precondition
        self.assertEqual(Security.objects.count(), 0)
        # run task
        import_securities_from_excel(self.sec_file)
        # postcondition: sheet has 5 rows → 5 Securities
        self.assertEqual(Security.objects.count(), 5)

    def test_import_customers_creates_customers_and_default_portfolio(self):
        self.assertEqual(Customer.objects.count(), 0)
        self.assertEqual(Portfolio.objects.count(), 0)
        import_customers_from_excel(self.cust_file)
        # e.g. 3 rows in Excel
        self.assertEqual(Customer.objects.count(), 3)
        # each customer should have exactly 1 default Portfolio
        for cust in Customer.objects.all():
            self.assertEqual(cust.portfolios.count(), 1)

    def test_import_holdings_creates_holdings_linked(self):
        # seed securities & customers
        import_securities_from_excel(self.sec_file)
        import_customers_from_excel(self.cust_file)
        # now holdings
        import_holdings_from_excel(self.hold_file)
        # Excel has 3 rows → 3 holdings
        self.assertEqual(CustomerHolding.objects.count(), 3)
        # each holding references a Customer and a Security
        for h in CustomerHolding.objects.all():
            self.assertIsNotNone(h.customer)
            self.assertIsNotNone(h.security)
