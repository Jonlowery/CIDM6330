# portfolio/tests/test_tasks.py
import os
from unittest.mock import patch, MagicMock
from django.test import TestCase
from django.conf import settings
from django.core.files.uploadedfile import SimpleUploadedFile
from decimal import Decimal, InvalidOperation
from datetime import date, datetime

from portfolio.tasks import (
    # Data cleaning helpers
    clean_decimal,
    clean_date,
    clean_boolean_from_char,
    # Import tasks
    import_salespersons_from_excel,
    import_security_types_from_excel,
    import_interest_schedules_from_excel,
    import_securities_from_excel,
    import_customers_from_excel,
    import_holdings_from_excel,
    import_muni_offerings_from_excel,
    import_all_from_excel, # Orchestration task
    # Email tasks
    send_salesperson_interest_email,
    send_salesperson_muni_buy_interest_email
)
from portfolio.models import (
    Salesperson, SecurityType, InterestSchedule, Security, Customer, Portfolio,
    CustomerHolding, MunicipalOffering
)

# It's good practice to create sample Excel files for testing imports,
# or mock openpyxl.load_workbook to return controlled data.
# For this skeleton, we'll mostly outline tests and assume mocking for file operations.

class DataCleaningHelpersTest(TestCase):
    def test_clean_decimal(self):
        self.assertEqual(clean_decimal("123.45"), Decimal("123.45"))
        self.assertEqual(clean_decimal("1,234.56"), Decimal("1234.56"))
        self.assertEqual(clean_decimal("5%"), Decimal("5"))
        self.assertEqual(clean_decimal("(100.00)"), Decimal("-100.00"))
        self.assertIsNone(clean_decimal("invalid"))
        self.assertEqual(clean_decimal("invalid", default=Decimal("0.0")), Decimal("0.0"))
        self.assertEqual(clean_decimal("  78.9  "), Decimal("78.9"))
        self.assertEqual(clean_decimal(None), None)
        self.assertEqual(clean_decimal(""), None)
        # Test with precision and non-negative constraints if needed
        self.assertEqual(clean_decimal("123.4567", decimal_places=2), Decimal("123.4567")) # Note: clean_decimal doesn't quantize yet
        self.assertEqual(clean_decimal("-10", non_negative=True, default=Decimal("0.0")), Decimal("0.0"))
        self.assertEqual(clean_decimal("10", non_negative=True), Decimal("10"))


    def test_clean_date(self):
        self.assertEqual(clean_date("12/31/2023"), date(2023, 12, 31))
        self.assertEqual(clean_date("2023-12-31"), date(2023, 12, 31))
        self.assertEqual(clean_date("12-31-2023"), date(2023, 12, 31))
        self.assertEqual(clean_date("20231231"), date(2023, 12, 31))
        self.assertEqual(clean_date(datetime(2023, 12, 31, 10, 0, 0)), date(2023, 12, 31))
        self.assertIsNone(clean_date("invalid_date"))
        self.assertEqual(clean_date("invalid", default=date(2000,1,1)), date(2000,1,1))
        self.assertIsNone(clean_date("01/  /2023")) # Test for invalid patterns
        self.assertIsNone(clean_date(None))
        self.assertIsNone(clean_date(""))
        # Test Excel serial date (requires openpyxl, might need mocking or a small helper)
        # Example: self.assertEqual(clean_date(45290), date(2023, 12, 31)) # 45290 is Excel serial for 2023-12-31

    def test_clean_boolean_from_char(self):
        self.assertTrue(clean_boolean_from_char('y'))
        self.assertTrue(clean_boolean_from_char('Y'))
        self.assertTrue(clean_boolean_from_char('yes'))
        self.assertTrue(clean_boolean_from_char('True'))
        self.assertTrue(clean_boolean_from_char('1'))
        self.assertTrue(clean_boolean_from_char('t'))
        self.assertFalse(clean_boolean_from_char('n'))
        self.assertFalse(clean_boolean_from_char('N'))
        self.assertFalse(clean_boolean_from_char('no'))
        self.assertFalse(clean_boolean_from_char('False'))
        self.assertFalse(clean_boolean_from_char('0'))
        self.assertFalse(clean_boolean_from_char('f'))
        self.assertFalse(clean_boolean_from_char('other'))
        self.assertIsNone(clean_boolean_from_char(None))


class ImportTasksTest(TestCase):
    """
    Tests for the main Excel import tasks.
    These tests will likely require mocking openpyxl.load_workbook
    to provide controlled worksheet data, or using actual small sample Excel files.
    """
    @classmethod
    def setUpTestData(cls):
        # It's good to have some dependent objects if your import logic relies on them
        # For example, if customer import links to salespersons, create some salespersons.
        Salesperson.objects.create(salesperson_id="S001", name="Test Salesperson")
        SecurityType.objects.create(type_id=1, name="Gov Bond")
        InterestSchedule.objects.create(schedule_code="SEMI", name="Semiannual")

    def setUp(self):
        # You might set up paths to dummy Excel files here if not fully mocking openpyxl
        # For this skeleton, we assume mocking.
        pass

    @patch('portfolio.tasks.openpyxl.load_workbook')
    def test_import_salespersons_from_excel_success(self, mock_load_workbook):
        # Mock the return value of openpyxl.load_workbook().active
        mock_ws = MagicMock()
        mock_ws.iter_rows.return_value = [
            ('slsm_id', 'name', 'email'), # Header row
            ('SP001', 'Alice Wonderland', 'alice@example.com'),
            ('SP002', 'Bob The Builder', 'bob@example.com'),
        ]
        # Configure the mock worksheet to be returned by mock_load_workbook().active
        mock_workbook = MagicMock()
        mock_workbook.active = mock_ws
        mock_load_workbook.return_value = mock_workbook

        import_salespersons_from_excel("dummy_path.xlsx")
        self.assertEqual(Salesperson.objects.count(), 2 + 1) # +1 from setUpTestData
        self.assertTrue(Salesperson.objects.filter(salesperson_id="SP001", name="Alice Wonderland").exists())
        # Add more assertions: updates existing, handles bad rows, logs skips

    @patch('portfolio.tasks.openpyxl.load_workbook')
    def test_import_security_types_from_excel_success(self, mock_load_workbook):
        mock_ws = MagicMock()
        mock_ws.iter_rows.return_value = [
            ('sec_type', 'meaning', 'description'),
            (10, 'Corporate Bond', 'A bond issued by a corporation'),
            (20, 'Municipal Bond', 'A bond issued by a state or local government'),
        ]
        mock_workbook = MagicMock()
        mock_workbook.active = mock_ws
        mock_load_workbook.return_value = mock_workbook

        import_security_types_from_excel("dummy_path.xlsx")
        self.assertEqual(SecurityType.objects.count(), 2 + 1) # +1 from setUpTestData
        self.assertTrue(SecurityType.objects.filter(type_id=10, name="Corporate Bond").exists())
        # Add more assertions

    @patch('portfolio.tasks.openpyxl.load_workbook')
    def test_import_interest_schedules_from_excel_success(self, mock_load_workbook):
        mock_ws = MagicMock()
        mock_ws.iter_rows.return_value = [
            ('int_sched', 'meaning', 'ppy_default'),
            ('ANNUAL', 'Annual Payment', 1),
            ('QUARTERLY', 'Quarterly Payment', 4),
        ]
        mock_workbook = MagicMock()
        mock_workbook.active = mock_ws
        mock_load_workbook.return_value = mock_workbook

        import_interest_schedules_from_excel("dummy_path.xlsx")
        self.assertEqual(InterestSchedule.objects.count(), 2 + 1) # +1 from setUpTestData
        self.assertTrue(InterestSchedule.objects.filter(schedule_code="ANNUAL", payments_per_year_default=1).exists())
        # Add more assertions

    @patch('portfolio.tasks.openpyxl.load_workbook')
    def test_import_securities_from_excel_success(self, mock_load_workbook):
        # This will be more complex due to more fields and FKs
        mock_ws = MagicMock()
        # Define headers carefully matching your task's header_map
        headers = [
            'sec_id', 'sec_desc_1', 'issue_dt', 'mat_dt', 'sec_type', 'rate',
            'tax_cd', 'int_sched', 'int_day', 'int_calc_cd', 'ppy',
            'prin_paydown', 'pmt_delay', 'factor', 'cpr'
        ]
        mock_ws.iter_rows.return_value = [
            headers,
            ('SECIMPORT1', 'Imported Sec 1', '01/01/2020', '01/01/2030', 1, 5.0,
             't', 'SEMI', 15, 'a', 2, 'n', 0, 1.0, 6.0)
        ]
        mock_workbook = MagicMock()
        mock_workbook.active = mock_ws
        mock_load_workbook.return_value = mock_workbook

        import_securities_from_excel("dummy_path.xlsx")
        self.assertEqual(Security.objects.count(), 1)
        imported_sec = Security.objects.get(cusip="SECIMPORT1")
        self.assertEqual(imported_sec.description, "Imported Sec 1")
        self.assertEqual(imported_sec.cpr, Decimal("6.00000"))
        self.assertEqual(imported_sec.security_type, SecurityType.objects.get(type_id=1))
        # Add many more assertions for all fields, FK lookups, factor logic, CPR logic

    @patch('portfolio.tasks.openpyxl.load_workbook')
    def test_import_customers_from_excel_success(self, mock_load_workbook):
        mock_ws = MagicMock()
        headers = ['cust_num', 'cust_na1', 'city', 'state', 'slsm_id', 'ip_bnk']
        mock_ws.iter_rows.return_value = [
            headers,
            (3001, 'Imported Customer X', 'ImpCity', 'IX', 'S001', 'IBX01')
        ]
        mock_workbook = MagicMock()
        mock_workbook.active = mock_ws
        mock_load_workbook.return_value = mock_workbook

        import_customers_from_excel("dummy_path.xlsx")
        self.assertEqual(Customer.objects.count(), 1)
        imported_cust = Customer.objects.get(customer_number=3001)
        self.assertEqual(imported_cust.name, "Imported Customer X")
        self.assertEqual(imported_cust.salesperson, Salesperson.objects.get(salesperson_id="S001"))
        self.assertTrue(Portfolio.objects.filter(owner=imported_cust, is_default=True).exists())
        # Add more assertions

    @patch('portfolio.tasks.openpyxl.load_workbook')
    def test_import_holdings_from_excel_success(self, mock_load_workbook):
        # Requires existing customers and securities
        customer = Customer.objects.create(customer_number=3002, name="Cust For Holding", city="HC", state="HS", portfolio_accounting_code="PHC", salesperson=Salesperson.objects.first())
        Portfolio.objects.create(owner=customer, name=f"{customer.name} - Primary Holdings", is_default=True) # Ensure default portfolio
        security = Security.objects.create(
            cusip="HOLDINGSEC", description="Sec For Holding", issue_date=date(2020,1,1), maturity_date=date(2030,1,1),
            tax_code='t', interest_day=1, interest_calc_code='a', payments_per_year=1, allows_paydown=False, payment_delay_days=0
        )

        mock_ws = MagicMock()
        headers = ['ticket', 'cust_num', 'sec_id', 'lc_xf1_cd', 'orig_face', 'settle_dt', 'set_price', 'book_price']
        mock_ws.iter_rows.return_value = [
            headers,
            (20001, 3002, 'HOLDINGSEC', 'A', 100000, '01/15/2023', 101.0, 100.5)
        ]
        mock_workbook = MagicMock()
        mock_workbook.active = mock_ws
        mock_load_workbook.return_value = mock_workbook

        import_holdings_from_excel("dummy_path.xlsx")
        self.assertEqual(CustomerHolding.objects.count(), 1)
        imported_holding = CustomerHolding.objects.get(external_ticket=20001)
        self.assertEqual(imported_holding.original_face_amount, Decimal("100000.00"))
        self.assertEqual(imported_holding.security, security)
        self.assertEqual(imported_holding.portfolio.owner, customer)
        # Test deletion of obsolete holdings if applicable

    @patch('portfolio.tasks.openpyxl.load_workbook')
    def test_import_muni_offerings_from_excel_success(self, mock_load_workbook):
        mock_ws = MagicMock()
        headers = ['cusip', 'description', 'amount', 'price']
        mock_ws.iter_rows.return_value = [
            headers,
            ('MUNIMPORT1', 'Imported Muni 1', 5000000, 102.5)
        ]
        mock_workbook = MagicMock()
        mock_workbook.active = mock_ws
        mock_load_workbook.return_value = mock_workbook

        # Test pre-import deletion
        MunicipalOffering.objects.create(cusip="OLDMUNI", description="Old Offering")
        self.assertEqual(MunicipalOffering.objects.count(), 1)

        import_muni_offerings_from_excel("dummy_path.xlsx")
        self.assertEqual(MunicipalOffering.objects.count(), 1) # Old one deleted, new one added
        self.assertTrue(MunicipalOffering.objects.filter(cusip="MUNIMPORT1").exists())
        self.assertFalse(MunicipalOffering.objects.filter(cusip="OLDMUNI").exists())
        # Add more assertions

    # Add tests for error handling in each import task (bad file, bad headers, bad data rows)


class OrchestrationTasksTest(TestCase):
    @patch('portfolio.tasks.import_salespersons_from_excel.si')
    @patch('portfolio.tasks.import_security_types_from_excel.si')
    @patch('portfolio.tasks.import_interest_schedules_from_excel.si')
    @patch('portfolio.tasks.import_securities_from_excel.si')
    @patch('portfolio.tasks.import_customers_from_excel.si')
    @patch('portfolio.tasks.import_holdings_from_excel.si')
    @patch('portfolio.tasks.import_muni_offerings_from_excel.si')
    @patch('portfolio.tasks.chain') # Mock the chain object itself
    @patch('pathlib.Path.exists') # Mock Path.exists
    def test_import_all_from_excel(self, mock_path_exists, mock_chain,
                                   mock_muni_task, mock_hold_task, mock_cust_task,
                                   mock_sec_task, mock_int_sch_task, mock_sec_type_task,
                                   mock_sales_task):
        mock_path_exists.return_value = True # Assume all files exist
        # Make .si() return a mock task signature that can be chained
        mock_sales_task.return_value = MagicMock()
        mock_sec_type_task.return_value = MagicMock()
        mock_int_sch_task.return_value = MagicMock()
        mock_sec_task.return_value = MagicMock()
        mock_cust_task.return_value = MagicMock()
        mock_hold_task.return_value = MagicMock()
        mock_muni_task.return_value = MagicMock()

        # Mock the chain object's apply_async method
        mock_chain_instance = MagicMock()
        mock_chain.return_value = mock_chain_instance

        import_all_from_excel()

        # Check that chain was called with the correct number of tasks
        self.assertEqual(mock_chain.call_count, 1)
        self.assertEqual(len(mock_chain.call_args[0][0]), 7) # 7 import tasks in the chain

        # Check that apply_async was called on the chain instance
        mock_chain_instance.apply_async.assert_called_once()

        # Check that individual task .si() methods were called
        mock_sales_task.assert_called_once()
        # ... add assertions for all other import tasks ...
        mock_muni_task.assert_called_once()

    @patch('portfolio.tasks.chain')
    @patch('pathlib.Path.exists')
    def test_import_all_from_excel_missing_mandatory_file(self, mock_path_exists, mock_chain):
        # Simulate a mandatory file (e.g., Security.xlsx) missing
        def side_effect(path_obj):
            if 'Security.xlsx' in str(path_obj):
                return False
            return True
        mock_path_exists.side_effect = side_effect

        import_all_from_excel()
        # Chain should still be called, but with fewer tasks, or log an error
        # The exact assertion depends on how you want to handle this (e.g., log error, don't run chain)
        # For now, just check chain was called (it might be with an incomplete list)
        mock_chain.assert_called_once()
        self.assertNotEqual(len(mock_chain.call_args[0][0]), 7)


class EmailTasksTest(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.salesperson = Salesperson.objects.create(
            salesperson_id="EMAILSP", name="Email Sales Person", email="sales@example.com"
        )
        cls.customer = Customer.objects.create(
            customer_number=4001, name="Email Customer", city="MailVille", state="EM",
            salesperson=cls.salesperson, portfolio_accounting_code="EMC01"
        )

    @patch('portfolio.tasks.send_mail')
    def test_send_salesperson_interest_email(self, mock_send_mail):
        selected_bonds_data = [
            {'cusip': "BOND00001", 'par': "50000"},
            {'cusip': "BOND00002", 'par': "75000.50"}
        ]
        send_salesperson_interest_email(
            salesperson_email=self.salesperson.email,
            salesperson_name=self.salesperson.name,
            customer_name=self.customer.name,
            customer_number=self.customer.customer_number,
            selected_bonds=selected_bonds_data
        )
        mock_send_mail.assert_called_once()
        args, kwargs = mock_send_mail.call_args
        self.assertIn(f"Interest in Selling Bonds - Customer {self.customer.name}", args[0]) # Subject
        self.assertIn("BOND00001", args[1]) # Body
        self.assertIn("BOND00002", args[1]) # Body
        self.assertEqual(args[2], settings.DEFAULT_FROM_EMAIL) # From email
        self.assertEqual(args[3], [self.salesperson.email]) # Recipient list

    @patch('portfolio.tasks.send_mail')
    def test_send_salesperson_muni_buy_interest_email(self, mock_send_mail):
        selected_offerings_data = [
            {'cusip': "MUNI00001", 'description': "Muni One To Buy"},
            {'cusip': "MUNI00002", 'description': "Muni Two To Buy"}
        ]
        send_salesperson_muni_buy_interest_email(
            salesperson_email=self.salesperson.email,
            salesperson_name=self.salesperson.name,
            customer_name=self.customer.name,
            customer_number=self.customer.customer_number,
            selected_offerings=selected_offerings_data
        )
        mock_send_mail.assert_called_once()
        args, kwargs = mock_send_mail.call_args
        self.assertIn(f"Interest in Buying Municipal Offerings - Customer {self.customer.name}", args[0])
        self.assertIn("Muni One To Buy", args[1])
        self.assertEqual(args[3], [self.salesperson.email])

    # Add tests for retry logic if tasks have autoretry_for configured and you want to test it explicitly.
    # This often involves mocking the task's `self.retry()` method.
