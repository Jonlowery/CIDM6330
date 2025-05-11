# portfolio/tests/test_tasks.py
import os
from unittest.mock import patch, MagicMock
from django.test import TestCase
from django.conf import settings
from django.core.files.uploadedfile import SimpleUploadedFile # Not used directly, but good for future tests with actual files
from decimal import Decimal, InvalidOperation
from datetime import date, datetime
from pathlib import Path # Still needed for type hints or direct Path usage in tests if any

# Assuming your tasks and models are in the 'portfolio' app
# Adjust the import path if your app structure is different
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
from celery.exceptions import Ignore as CeleryIgnore, Retry as CeleryRetry # For testing retry logic

# --- Constants for Dummy File Paths ---
DUMMY_EXCEL_PATH = "dummy_path.xlsx" # A generic path for mocked calls

class DataCleaningHelpersTest(TestCase):
    """
    Tests for the data cleaning helper functions.
    """
    def test_clean_decimal(self):
        # Test successful conversions
        self.assertEqual(clean_decimal("123.45"), Decimal("123.45"))
        self.assertEqual(clean_decimal("1,234.56"), Decimal("1234.56")) # With comma
        self.assertEqual(clean_decimal("5%"), Decimal("5")) # With percentage sign
        self.assertEqual(clean_decimal("(100.00)"), Decimal("-100.00")) # Accounting negative
        self.assertEqual(clean_decimal("  78.9  "), Decimal("78.9")) # With whitespace

        # Test invalid inputs returning None or default
        self.assertIsNone(clean_decimal("invalid_string"))
        self.assertEqual(clean_decimal("invalid_string", default=Decimal("0.0")), Decimal("0.0"))
        self.assertIsNone(clean_decimal(None))
        self.assertEqual(clean_decimal(None, default=Decimal("1.0")), Decimal("1.0"))
        self.assertIsNone(clean_decimal(""))
        self.assertEqual(clean_decimal("", default=Decimal("2.0")), Decimal("2.0"))

        # Test non-negative constraint
        self.assertEqual(clean_decimal("10", non_negative=True), Decimal("10"))
        self.assertEqual(clean_decimal("-10", non_negative=True, default=Decimal("0.0")), Decimal("0.0"))
        self.assertIsNone(clean_decimal("-5.5", non_negative=True)) # Should return None if no default

        # Test decimal_places (note: current clean_decimal logs a warning but doesn't quantize)
        self.assertEqual(clean_decimal("123.4567", decimal_places=2), Decimal("123.4567"))

    def test_clean_date(self):
        # Test successful conversions with various formats
        self.assertEqual(clean_date("12/31/2023"), date(2023, 12, 31))
        self.assertEqual(clean_date("2023-12-31"), date(2023, 12, 31))
        self.assertEqual(clean_date("12-31-2023"), date(2023, 12, 31))
        self.assertEqual(clean_date("20231231"), date(2023, 12, 31))

        self.assertEqual(clean_date(datetime(2023, 12, 31, 10, 0, 0)), date(2023, 12, 31))
        self.assertEqual(clean_date(date(2024, 1, 15)), date(2024, 1, 15))

        self.assertIsNone(clean_date("invalid_date_string"))
        self.assertEqual(clean_date("invalid", default=date(2000,1,1)), date(2000,1,1))
        self.assertIsNone(clean_date("01/  /2023"))
        self.assertIsNone(clean_date("31/13/2023"))

        self.assertIsNone(clean_date(None))
        self.assertEqual(clean_date(None, default=date(1999,1,1)), date(1999,1,1))
        self.assertIsNone(clean_date(""))
        self.assertEqual(clean_date("", default=date(1998,1,1)), date(1998,1,1))

        # Patching from_excel where it's used (assuming it's imported in tasks.py from openpyxl.utils.datetime)
        with patch('openpyxl.utils.datetime.from_excel', return_value=datetime(2023, 12, 31)) as mock_from_excel:
             self.assertEqual(clean_date(45290), date(2023, 12, 31))
             mock_from_excel.assert_called_with(45290)

        with patch('openpyxl.utils.datetime.from_excel', side_effect=ValueError("Test Excel date conversion error")):
             self.assertIsNone(clean_date(45291))

        with patch('openpyxl.utils.datetime.from_excel') as mock_from_excel_large_num:
            self.assertIsNone(clean_date(3000000)) # Test heuristic for large numbers
            mock_from_excel_large_num.assert_not_called()

    def test_clean_boolean_from_char(self):
        for val in ['y', 'Y', 'yes', 'YES', 'True', 'TRUE', '1', 't', 'T']:
            self.assertTrue(clean_boolean_from_char(val), f"Failed for true value: {val}")
        for val in ['n', 'N', 'no', 'NO', 'False', 'FALSE', '0', 'f', 'F', 'other', 'random']:
            self.assertFalse(clean_boolean_from_char(val), f"Failed for false value: {val}")
        self.assertIsNone(clean_boolean_from_char(None))


class ImportTasksTest(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.salesperson1 = Salesperson.objects.create(salesperson_id="S001", name="Test Salesperson One", email="s001@example.com")
        cls.salesperson2 = Salesperson.objects.create(salesperson_id="S002", name="Test Salesperson Two", email="s002@example.com")
        cls.sec_type_bond = SecurityType.objects.create(type_id=1, name="Government Bond", description="Bond issued by government")
        cls.sec_type_stock = SecurityType.objects.create(type_id=2, name="Common Stock", description="Equity share") # Original description
        cls.int_sched_semi = InterestSchedule.objects.create(schedule_code="SEMI", name="Semiannual", payments_per_year_default=2, description="Pays twice a year") # Original description
        cls.int_sched_annual = InterestSchedule.objects.create(schedule_code="ANNUAL", name="Annual", payments_per_year_default=1, description="Pays once a year")
        cls.security1 = Security.objects.create(
            cusip="SECURI001", description="Test Security One", issue_date=date(2020,1,1),
            maturity_date=date(2030,1,1), security_type=cls.sec_type_bond, coupon=Decimal("2.5"),
            tax_code='t', interest_schedule=cls.int_sched_semi, interest_day=15, interest_calc_code='a',
            payments_per_year=2, allows_paydown=False, payment_delay_days=0, factor=Decimal("1.0")
        )
        cls.security2 = Security.objects.create(
            cusip="SECURI002", description="Test Security Two", issue_date=date(2021,1,1),
            maturity_date=date(2031,1,1), security_type=cls.sec_type_stock,
            tax_code='e', interest_day=1, interest_calc_code='a',
            payments_per_year=0, allows_paydown=False, payment_delay_days=0, factor=Decimal("1.0")
        )
        cls.customer1 = Customer.objects.create(
            customer_number=8001, name="Existing Customer One", city="Testville", state="TX",
            salesperson=cls.salesperson1, portfolio_accounting_code="CUST01ACC"
        )
        cls.portfolio1 = Portfolio.objects.create(owner=cls.customer1, name="Customer One Default", is_default=True)
        cls.customer2 = Customer.objects.create(
            customer_number=8002, name="Existing Customer Two", city="Sampletown", state="CA",
            salesperson=cls.salesperson2, portfolio_accounting_code="CUST02ACC"
        )
        cls.portfolio2 = Portfolio.objects.create(owner=cls.customer2, name="Customer Two Default", is_default=True)

    def _setup_mock_workbook_data(self, header_row, data_rows_values_only):
        """ Helper to set up mock worksheet and workbook, returns the mock_workbook. """
        mock_ws = MagicMock()
        mock_header_cells = [MagicMock(value=val) for val in header_row]
        mock_ws.__getitem__.return_value = mock_header_cells
        mock_ws.iter_rows.return_value = data_rows_values_only
        mock_workbook = MagicMock()
        mock_workbook.active = mock_ws
        return mock_workbook

    @patch('portfolio.tasks.openpyxl.load_workbook')
    def test_import_salespersons_from_excel_success(self, mock_openpyxl_load_workbook):
        headers = ['slsm_id', 'name', 'email']
        data = [
            ('SPNEW01', 'Alice Wonderland', 'alice@example.com'),
            ('SPNEW02', 'Bob The Builder', 'bob@example.com'),
            ('S001', 'Test Salesperson One UPD', 's001.updated@example.com'),
        ]
        mock_openpyxl_load_workbook.return_value = self._setup_mock_workbook_data(headers, data)
        result = import_salespersons_from_excel(DUMMY_EXCEL_PATH)
        self.assertEqual(Salesperson.objects.count(), 4) # 2 existing + 2 new
        self.assertTrue(Salesperson.objects.filter(salesperson_id="SPNEW01").exists())
        updated_s001 = Salesperson.objects.get(salesperson_id="S001")
        self.assertEqual(updated_s001.name, "Test Salesperson One UPD")
        self.assertEqual(result, DUMMY_EXCEL_PATH)

    @patch('portfolio.tasks.openpyxl.load_workbook')
    def test_import_salespersons_from_excel_error_handling(self, mock_openpyxl_load_workbook):
        mock_openpyxl_load_workbook.side_effect = FileNotFoundError
        with self.assertRaises(FileNotFoundError):
            import_salespersons_from_excel("non_existent_path.xlsx")
        mock_openpyxl_load_workbook.side_effect = None # Reset

        headers_bad = ['WRONG_id_header', 'name', 'email']
        mock_openpyxl_load_workbook.return_value = self._setup_mock_workbook_data(headers_bad, [])
        with self.assertRaises(ValueError) as cm:
            import_salespersons_from_excel(DUMMY_EXCEL_PATH)
        self.assertIn("Mandatory salesperson headers missing: ['salesperson_id']", str(cm.exception))

        headers_good = ['slsm_id', 'name', 'email']
        data_missing_id = [(None, 'No ID Person', 'noid@example.com')]
        mock_openpyxl_load_workbook.return_value = self._setup_mock_workbook_data(headers_good, data_missing_id)
        initial_count = Salesperson.objects.count()
        with self.assertLogs('portfolio.tasks', level='WARNING') as log_capture:
            import_salespersons_from_excel(DUMMY_EXCEL_PATH)
            self.assertTrue(any("Skip missing slsm_id" in msg for msg in log_capture.output))
        self.assertEqual(Salesperson.objects.count(), initial_count)

        data_bad_email = [('SP_BADEMAIL', 'Bad Email Person', 'notanemail@')]
        mock_openpyxl_load_workbook.return_value = self._setup_mock_workbook_data(headers_good, data_bad_email)
        with self.assertLogs('portfolio.tasks', level='WARNING') as log_capture:
            import_salespersons_from_excel(DUMMY_EXCEL_PATH)
            self.assertTrue(any("Invalid email format 'notanemail@'. Storing as NULL." in msg for msg in log_capture.output))
        self.assertTrue(Salesperson.objects.filter(salesperson_id="SP_BADEMAIL").exists())
        self.assertIsNone(Salesperson.objects.get(salesperson_id="SP_BADEMAIL").email)

        data_dup_email_different_id = [('SP_DUPEMAIL', 'Duplicate Email Person', self.salesperson1.email)]
        mock_openpyxl_load_workbook.return_value = self._setup_mock_workbook_data(headers_good, data_dup_email_different_id)
        
        initial_salesperson_count = Salesperson.objects.count()
        import_salespersons_from_excel(DUMMY_EXCEL_PATH)
        
        self.assertEqual(Salesperson.objects.count(), initial_salesperson_count + 1)
        self.assertTrue(Salesperson.objects.filter(salesperson_id="SP_DUPEMAIL", email=self.salesperson1.email).exists())


    @patch('portfolio.tasks.openpyxl.load_workbook')
    def test_import_security_types_from_excel_success(self, mock_openpyxl_load_workbook):
        headers = ['sec_type', 'meaning', 'description']
        data = [
            (10, 'Corporate Bond New', 'A bond by a corporation'),
            (2, 'Common Stock UPDATED', 'Updated Equity Share Desc'), 
        ]
        mock_openpyxl_load_workbook.return_value = self._setup_mock_workbook_data(headers, data)
        import_security_types_from_excel(DUMMY_EXCEL_PATH)
        self.assertEqual(SecurityType.objects.count(), 3) 
        self.assertTrue(SecurityType.objects.filter(type_id=10, name="Corporate Bond New").exists())
        updated_st = SecurityType.objects.get(type_id=2)
        self.assertEqual(updated_st.name, "Common Stock UPDATED")
        self.assertEqual(updated_st.description, "Equity share", "SecurityType description updated unexpectedly. If intentional, update test. If not, check tasks.py header_map for import_security_types_from_excel.")


    @patch('portfolio.tasks.openpyxl.load_workbook')
    def test_import_interest_schedules_from_excel_success(self, mock_openpyxl_load_workbook):
        headers = ['int_sched', 'meaning', 'ppy_default', 'description']
        data = [
            ('MONTHLY', 'Monthly Payment', 12, 'Pays every month'),      
            ('SEMI', 'Semiannual UPDATED', 2, 'Updated Semi Desc'), 
        ]
        mock_openpyxl_load_workbook.return_value = self._setup_mock_workbook_data(headers, data)
        import_interest_schedules_from_excel(DUMMY_EXCEL_PATH)
        self.assertEqual(InterestSchedule.objects.count(), 3) 

        monthly_schedule = InterestSchedule.objects.get(schedule_code="MONTHLY")
        self.assertEqual(monthly_schedule.name, "Monthly Payment")
        self.assertIsNone(monthly_schedule.payments_per_year_default, "Task processed 'ppy_default' for new record; if intentional, update test. Else, check tasks.py header_map.")
        self.assertIsNone(monthly_schedule.description, "Task processed 'description' for new record; if intentional, update test. Else, check tasks.py header_map.")

        updated_is = InterestSchedule.objects.get(schedule_code="SEMI")
        self.assertEqual(updated_is.name, "Semiannual UPDATED")
        self.assertEqual(updated_is.payments_per_year_default, 2, "Existing ppy_default changed unexpectedly; if intentional, update test. Else, check tasks.py header_map.")
        self.assertEqual(updated_is.description, "Pays twice a year", "Existing description changed unexpectedly; if intentional, update test. Else, check tasks.py header_map.")


    @patch('portfolio.tasks.openpyxl.load_workbook')
    def test_import_securities_from_excel_success(self, mock_openpyxl_load_workbook):
        headers = ['sec_id', 'sec_desc_1', 'issue_dt', 'mat_dt', 'sec_type', 'rate', 'tax_cd', 'int_sched', 'int_day', 'int_calc_cd', 'ppy', 'prin_paydown', 'pmt_delay', 'factor', 'cpr', 'issuer_name', 'secrate_rate', 'rate_dt', 'callable_flag_excel', 'call_date']
        data = [
            ('NEWSEC001', 'New Security One', '01/01/2024', '01/01/2034', self.sec_type_bond.type_id, 3.0, 't', self.int_sched_semi.schedule_code, 1, 'a', 2, 'n', 0, 1.0, 5.0, 'New Issuer Inc.', None, None, 'N', None),
            ('SECURI001', 'Test Security One UPD', '02/01/2020', '02/01/2030', self.sec_type_bond.type_id, 2.75, 'e', self.int_sched_annual.schedule_code, 20, 'c', 1, 'y', 2, 0.95, 6.5, 'Test Issuer One UPD', 2.80, '01/15/2023', 'Y', '07/01/2025')
        ]
        mock_openpyxl_load_workbook.return_value = self._setup_mock_workbook_data(headers, data)
        initial_sec_count = Security.objects.count()
        import_securities_from_excel(DUMMY_EXCEL_PATH)
        self.assertEqual(Security.objects.count(), initial_sec_count + 1)
        new_sec = Security.objects.get(cusip="NEWSEC001")
        self.assertEqual(new_sec.description, "New Security One")
        updated_sec = Security.objects.get(cusip="SECURI001")
        self.assertEqual(updated_sec.coupon, Decimal("2.80")) 
        self.assertEqual(updated_sec.rate_effective_date, date(2023, 1, 15))
        self.assertTrue(updated_sec.callable_flag)
        self.assertEqual(updated_sec.call_date, date(2025, 7, 1))


    @patch('portfolio.tasks.openpyxl.load_workbook')
    def test_import_customers_from_excel_success(self, mock_openpyxl_load_workbook):
        headers = ['cust_num', 'cust_na1', 'city', 'state', 'slsm_id', 'ip_bnk', 'address', 'cost_funds', 'fed_tax_bkt']
        data = [
            (9001, 'New Customer Ltd.', 'NewCity', 'NY', self.salesperson2.salesperson_id, 'NEWCUSTACC', '789 Pine Ln', '1.2%', '15%'),
            (self.customer1.customer_number, 'Existing Customer One UPDATED', 'UpdatedCity', 'TX', self.salesperson1.salesperson_id, 'CUST01ACC_UPD', '123 Oak Ave UPD', '2.1%', '28%')
        ]
        mock_openpyxl_load_workbook.return_value = self._setup_mock_workbook_data(headers, data)
        initial_cust_count = Customer.objects.count()
        import_customers_from_excel(DUMMY_EXCEL_PATH)
        self.assertEqual(Customer.objects.count(), initial_cust_count + 1)
        new_cust = Customer.objects.get(customer_number=9001)
        self.assertEqual(new_cust.name, "New Customer Ltd.")
        self.assertTrue(Portfolio.objects.filter(owner=new_cust, is_default=True, name="New Customer Ltd. - Primary Holdings").exists())
        updated_cust = Customer.objects.get(customer_number=self.customer1.customer_number)
        self.assertEqual(updated_cust.name, "Existing Customer One UPDATED")
        self.assertTrue(Portfolio.objects.filter(owner=updated_cust, is_default=True, name="Existing Customer One UPDATED - Primary Holdings").exists())

    @patch('portfolio.tasks.openpyxl.load_workbook')
    def test_import_holdings_from_excel_success_and_deletion(self, mock_openpyxl_load_workbook):
        CustomerHolding.objects.create(external_ticket=10001, portfolio=self.portfolio1, security=self.security1, original_face_amount=Decimal("50000"), settlement_date=date(2022,1,1), settlement_price=Decimal("100"), book_price=Decimal("99"), intention_code='A')
        CustomerHolding.objects.create(external_ticket=99999, portfolio=self.portfolio1, security=self.security2, original_face_amount=Decimal("20000"), settlement_date=date(2022,2,1), settlement_price=Decimal("101"), book_price=Decimal("100"), intention_code='M') 
        CustomerHolding.objects.create(external_ticket=77777, portfolio=self.portfolio2, security=self.security1, original_face_amount=Decimal("10000"), settlement_date=date(2022,1,1), settlement_price=Decimal("100"), book_price=Decimal("99"), intention_code='A') 

        headers = ['ticket', 'cust_num', 'sec_id', 'lc_xf1_cd', 'orig_face', 'settle_dt', 'set_price', 'book_price', 'book_yield']
        data = [
            (20001, self.customer1.customer_number, self.security2.cusip, 'T', 75000, '03/15/2023', 100.5, 100.2, 4.2), 
            (10001, self.customer1.customer_number, self.security1.cusip, 'M', 60000,  '01/02/2022', 102.0, 99.5, 4.8), 
            (20002, self.customer2.customer_number, self.security2.cusip, 'A', 80000, '04/01/2023', 101.5, 101.0, 4.3)  
        ]
        mock_openpyxl_load_workbook.return_value = self._setup_mock_workbook_data(headers, data)
        import_holdings_from_excel(DUMMY_EXCEL_PATH)
        self.assertEqual(CustomerHolding.objects.count(), 3)
        self.assertTrue(CustomerHolding.objects.filter(external_ticket=20001).exists())
        self.assertTrue(CustomerHolding.objects.filter(external_ticket=10001).exists())
        self.assertTrue(CustomerHolding.objects.filter(external_ticket=20002).exists())
        self.assertFalse(CustomerHolding.objects.filter(external_ticket=99999).exists())
        self.assertFalse(CustomerHolding.objects.filter(external_ticket=77777).exists())

    @patch('portfolio.tasks.openpyxl.load_workbook')
    def test_import_muni_offerings_from_excel_success_and_deletion(self, mock_openpyxl_load_workbook):
        headers = ['cusip', 'description', 'amount', 'price', 'maturity', 'yield', 'state', 'call_date', 'call_price']
        data = [
            ('MUNIIMP01', 'Imported Muni One', 5000000, 102.5, '12/31/2030', 3.5, 'CA', '06/30/2028', 101.0),
            ('MUNIIMP02', 'Imported Muni Two', 2000000, 101.0, '06/30/2028', 3.2, 'NY', None, None)
        ]
        mock_openpyxl_load_workbook.return_value = self._setup_mock_workbook_data(headers, data)
        MunicipalOffering.objects.create(cusip="OLDMUNI01", description="Old Offering 1", amount=1000, price=100)
        self.assertEqual(MunicipalOffering.objects.count(), 1) 
        import_muni_offerings_from_excel(DUMMY_EXCEL_PATH)
        self.assertEqual(MunicipalOffering.objects.count(), 2) 
        self.assertTrue(MunicipalOffering.objects.filter(cusip="MUNIIMP01").exists())
        self.assertFalse(MunicipalOffering.objects.filter(cusip="OLDMUNI01").exists())


class OrchestrationTasksTest(TestCase):
    # When patching, patch where the object is looked up.
    # In tasks.py, Path objects are created (e.g., settings.BASE_DIR / 'data' / 'imports'),
    # and then .exists() is called on these instances.
    # So, we patch 'pathlib.Path.exists'. autospec=True helps ensure the mock
    # has the same signature as the original, which is good for instance methods.

    @patch('portfolio.tasks.import_salespersons_from_excel.si')
    @patch('portfolio.tasks.import_security_types_from_excel.si')
    @patch('portfolio.tasks.import_interest_schedules_from_excel.si')
    @patch('portfolio.tasks.import_securities_from_excel.si')
    @patch('portfolio.tasks.import_customers_from_excel.si')
    @patch('portfolio.tasks.import_holdings_from_excel.si')
    @patch('portfolio.tasks.import_muni_offerings_from_excel.si')
    @patch('portfolio.tasks.chain') 
    @patch('pathlib.Path.exists', autospec=True) # REVERTED to pathlib.Path.exists and added autospec
    def test_import_all_from_excel_all_files_exist(self, mock_path_exists_method, mock_celery_chain,
                                                   mock_muni_task_si, mock_hold_task_si, mock_cust_task_si,
                                                   mock_sec_task_si, mock_int_sch_task_si, mock_sec_type_task_si,
                                                   mock_sales_task_si): 
        mock_path_exists_method.return_value = True
        task_signature_mocks = { mock_sales_task_si: MagicMock(), mock_sec_type_task_si: MagicMock(), mock_int_sch_task_si: MagicMock(), mock_sec_task_si: MagicMock(), mock_cust_task_si: MagicMock(), mock_hold_task_si: MagicMock(), mock_muni_task_si: MagicMock()}
        for task_mock, sig_mock in task_signature_mocks.items(): task_mock.return_value = sig_mock
        mock_chain_instance = MagicMock()
        mock_celery_chain.return_value = mock_chain_instance
        result_message = import_all_from_excel()
        self.assertEqual(mock_celery_chain.call_count, 1)
        actual_chain_args = mock_celery_chain.call_args[0][0]
        self.assertEqual(len(actual_chain_args), 7, "Should schedule 7 tasks when all files exist.")
        mock_chain_instance.apply_async.assert_called_once()
        base_path = settings.BASE_DIR / 'data' / 'imports'
        mock_sales_task_si.assert_called_once_with(str(base_path / 'Salesperson.xlsx'))
        mock_muni_task_si.assert_called_once_with(str(base_path / 'muni_offerings.xlsx'))
        self.assertIn("Scheduled chained import tasks (7 tasks from 7 files). Mandatory File Status OK: True", result_message)

    @patch('pathlib.Path.exists', autospec=True) # REVERTED to pathlib.Path.exists and added autospec
    @patch('portfolio.tasks.chain')
    @patch('portfolio.tasks.import_muni_offerings_from_excel.si') 
    @patch('portfolio.tasks.import_holdings_from_excel.si')
    @patch('portfolio.tasks.import_interest_schedules_from_excel.si')
    @patch('portfolio.tasks.import_security_types_from_excel.si')
    @patch('portfolio.tasks.import_salespersons_from_excel.si')
    def test_import_all_from_excel_missing_mandatory_file(self, mock_sales_si, mock_sec_type_si,
                                                           mock_int_sched_si, mock_hold_si, mock_muni_si,
                                                           mock_celery_chain, mock_path_exists_method): 
        # The side_effect function for Path.exists should accept the Path instance (self)
        # as its first argument because .exists() is an instance method.
        def side_effect_for_path_exists(path_instance_self_arg):
            path_str = str(path_instance_self_arg).lower()
            if 'security.xlsx' in path_str or 'customer.xlsx' in path_str:
                return False # Simulate these mandatory files as missing
            return True # Other files exist
        mock_path_exists_method.side_effect = side_effect_for_path_exists

        mock_chain_instance = MagicMock()
        mock_celery_chain.return_value = mock_chain_instance
        
        result_message = import_all_from_excel() 
        
        mock_celery_chain.assert_called_once()
        self.assertEqual(len(mock_celery_chain.call_args[0][0]), 5, "Should schedule 5 tasks if Security and Customer files are missing.")
        mock_chain_instance.apply_async.assert_called_once()
        self.assertIn("Mandatory File Status OK: False", result_message)
        self.assertIn("Scheduled chained import tasks (5 tasks from 5 files).", result_message) 
        mock_sales_si.assert_called_once()
        mock_sec_type_si.assert_called_once()
        mock_int_sched_si.assert_called_once()
        mock_hold_si.assert_called_once()
        mock_muni_si.assert_called_once() 

    @patch('pathlib.Path.exists', autospec=True) # REVERTED to pathlib.Path.exists and added autospec
    @patch('portfolio.tasks.chain')
    @patch('portfolio.tasks.import_holdings_from_excel.si')
    @patch('portfolio.tasks.import_customers_from_excel.si')
    @patch('portfolio.tasks.import_securities_from_excel.si')
    @patch('portfolio.tasks.import_interest_schedules_from_excel.si')
    @patch('portfolio.tasks.import_security_types_from_excel.si')
    @patch('portfolio.tasks.import_salespersons_from_excel.si')
    def test_import_all_from_excel_missing_optional_file(self, mock_sales_si, mock_sec_type_si, mock_int_sched_si,
                                                          mock_sec_si, mock_cust_si, mock_hold_si,
                                                          mock_celery_chain, mock_path_exists_method): 
        def side_effect_for_path_exists(path_instance_self_arg):
            if 'muni_offerings.xlsx' in str(path_instance_self_arg).lower():
                return False # Simulate optional muni file as missing
            return True # All mandatory files exist
        mock_path_exists_method.side_effect = side_effect_for_path_exists

        mock_chain_instance = MagicMock()
        mock_celery_chain.return_value = mock_chain_instance
        
        result_message = import_all_from_excel() 

        mock_celery_chain.assert_called_once()
        self.assertEqual(len(mock_celery_chain.call_args[0][0]), 6, "Should schedule 6 tasks if optional muni file is missing.")
        mock_chain_instance.apply_async.assert_called_once()
        self.assertIn("Mandatory File Status OK: True", result_message) 
        self.assertIn("Scheduled chained import tasks (6 tasks from 6 files).", result_message)
        for mock_si_call in [mock_sales_si, mock_sec_type_si, mock_int_sched_si, mock_sec_si, mock_cust_si, mock_hold_si]:
            mock_si_call.assert_called_once()

    @patch('pathlib.Path.exists', autospec=True) # REVERTED to pathlib.Path.exists and added autospec
    @patch('portfolio.tasks.chain')
    def test_import_all_from_excel_no_files_found(self, mock_celery_chain, mock_path_exists_method): 
        mock_path_exists_method.return_value = False # All files missing
        result_message = import_all_from_excel()
        mock_celery_chain.assert_not_called() 
        self.assertEqual(result_message, "Chained Import Error: No import tasks could be added (no files found or critical files missing).")


class EmailTasksTest(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.salesperson = Salesperson.objects.create(salesperson_id="EMAILSP", name="Email Sales Person", email="sales@example.com")
        cls.customer = Customer.objects.create(customer_number=4001, name="Email Customer", city="MailVille", state="EM", salesperson=cls.salesperson, portfolio_accounting_code="EMC01")

    @patch('portfolio.tasks.send_mail')
    def test_send_salesperson_interest_email_success(self, mock_django_send_mail):
        selected_bonds_data = [{'cusip': "BOND00001", 'par': "50000"}, {'cusip': "BOND00003", 'par': "invalid_par_value"}]
        task_result = send_salesperson_interest_email(self.salesperson.email, self.salesperson.name, self.customer.name, self.customer.customer_number, selected_bonds_data)
        mock_django_send_mail.assert_called_once()
        args, _ = mock_django_send_mail.call_args
        subject, body, _, _ = args
        self.assertIn(f"Interest in Selling Bonds - Customer {self.customer.name}", subject)
        self.assertIn("CUSIP: BOND00001, Par: 50,000.00", body)
        self.assertIn("CUSIP: BOND00003, Par: invalid_par_value", body)
        self.assertEqual(task_result, f"Email sent successfully to {self.salesperson.email}")

    @patch('portfolio.tasks.send_mail')
    def test_send_salesperson_interest_email_no_salesperson_name(self, mock_django_send_mail):
        send_salesperson_interest_email(self.salesperson.email, None, self.customer.name, self.customer.customer_number, [{'cusip': "BOND00003", 'par': "10000"}])
        _, body, _, _ = mock_django_send_mail.call_args[0]
        self.assertIn("Dear Salesperson,", body)

    @patch('portfolio.tasks.send_mail')
    @patch.object(send_salesperson_interest_email, 'retry', side_effect=CeleryRetry)
    def test_send_salesperson_interest_email_retry_logic(self, mock_task_retry_method, mock_django_send_mail):
        original_exception = Exception("SMTP connection failed")
        mock_django_send_mail.side_effect = original_exception
        with self.assertRaises(CeleryRetry): 
            send_salesperson_interest_email(
                self.salesperson.email, self.salesperson.name, self.customer.name,
                self.customer.customer_number, [{'cusip': "BONDFAIL", 'par': "1"}]
            )
        mock_django_send_mail.assert_called_once()
        mock_task_retry_method.assert_called_once_with(exc=original_exception)


    @patch('portfolio.tasks.send_mail')
    def test_send_salesperson_muni_buy_interest_email_success(self, mock_django_send_mail):
        selected_offerings_data = [{'cusip': "MUNI00001", 'description': "Muni One To Buy"}, {'cusip': "MUNI00002"}]
        task_result = send_salesperson_muni_buy_interest_email(self.salesperson.email, self.salesperson.name, self.customer.name, self.customer.customer_number, selected_offerings_data)
        mock_django_send_mail.assert_called_once()
        args, _ = mock_django_send_mail.call_args
        subject, body, _, _ = args
        self.assertIn(f"Interest in Buying Municipal Offerings - Customer {self.customer.name}", subject)
        self.assertIn("CUSIP: MUNI00001 (Muni One To Buy)", body)
        self.assertIn("CUSIP: MUNI00002 (N/A)", body)
        self.assertEqual(task_result, f"Email sent successfully to {self.salesperson.email}")

    @patch('portfolio.tasks.send_mail')
    @patch.object(send_salesperson_muni_buy_interest_email, 'retry', side_effect=CeleryRetry)
    def test_send_salesperson_muni_buy_interest_email_retry_logic(self, mock_task_retry_method, mock_django_send_mail):
        original_exception = Exception("SMTP connection failed for muni")
        mock_django_send_mail.side_effect = original_exception
        with self.assertRaises(CeleryRetry):
            send_salesperson_muni_buy_interest_email(
                self.salesperson.email, self.salesperson.name, self.customer.name,
                self.customer.customer_number, [{'cusip': "MUNIBAD", 'description': "Bad Send"}]
            )
        mock_django_send_mail.assert_called_once()
        mock_task_retry_method.assert_called_once_with(exc=original_exception)
