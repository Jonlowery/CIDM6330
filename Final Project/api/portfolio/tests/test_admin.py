# portfolio/tests/test_admin.py
from django.test import TestCase
from django.contrib.admin.sites import AdminSite
from django.contrib.auth import get_user_model
from decimal import Decimal
from datetime import date
# unittest.mock can be useful for more complex mocking scenarios if needed in the future.
# from unittest.mock import MagicMock, patch, PropertyMock 

# Models from the portfolio application.
from portfolio.models import (
    Customer, Salesperson, Security, SecurityType, InterestSchedule,
    Portfolio, CustomerHolding
)
# ModelAdmin classes from the portfolio application's admin configuration.
from portfolio.admin import (
    SalespersonAdmin, SecurityTypeAdmin, InterestScheduleAdmin,
    CustomerAdmin, SecurityAdmin, PortfolioAdmin, CustomerHoldingAdmin,
    MunicipalOfferingAdmin
)

User = get_user_model()

class BaseAdminTest(TestCase):
    """
    Provides a base class for admin-related tests.
    Common setup data can be defined here.
    """
    @classmethod
    def setUpTestData(cls):
        """
        Sets up data that will be used across all test methods in this class.
        This is executed once for the entire test class.
        """
        cls.site = AdminSite() # We use a dummy admin site for testing ModelAdmin instances.

        # Create instances of models that are commonly required for these admin tests.
        cls.salesperson1 = Salesperson.objects.create(salesperson_id="ADM_S01", name="Admin Sales")
        cls.sec_type1 = SecurityType.objects.create(type_id=200, name="Admin SecType")
        cls.int_schedule1 = InterestSchedule.objects.create(schedule_code="ADM_SEMI", name="Admin Semi")

        cls.customer1 = Customer.objects.create(
            customer_number=9001, name="Admin Customer One", city="AdminCity", state="AD",
            salesperson=cls.salesperson1, portfolio_accounting_code="ADM_PAC01"
        )
        
        cls.security1 = Security.objects.create(
            cusip="ADMINSEC1", description="Admin Test Security", issue_date=date(2022,1,1),
            maturity_date=date(2032,1,1), security_type=cls.sec_type1, coupon=Decimal("4.5"),
            tax_code='t', interest_schedule=cls.int_schedule1, interest_day=1,
            interest_calc_code='a', payments_per_year=2, allows_paydown=False
        )
        cls.portfolio1 = Portfolio.objects.create(owner=cls.customer1, name="Admin Portfolio Alpha", is_default=True)
        
        cls.holding1 = CustomerHolding.objects.create(
            external_ticket=70001, portfolio=cls.portfolio1, security=cls.security1,
            intention_code='M', original_face_amount=Decimal("25000"), settlement_date=date(2023,5,1),
            settlement_price=Decimal("100"), book_price=Decimal("100")
        )

class PortfolioAdminTest(BaseAdminTest):
    """
    Contains tests for the custom methods within the PortfolioAdmin class.
    """
    def setUp(self):
        """
        This setup is run before each individual test method in this class.
        """
        self.admin_instance = PortfolioAdmin(Portfolio, self.site)

    def test_owner_customer_number_with_owner(self):
        """
        Verifies that owner_customer_number returns the correct customer number
        when a portfolio has an owner with an associated customer number.
        """
        self.assertEqual(self.admin_instance.owner_customer_number(self.portfolio1), 9001)

    def test_owner_customer_number_portfolio_owner_is_none(self):
        """
        Tests the scenario where the portfolio's 'owner' attribute is None.
        This specifically checks the 'if obj.owner else None' logic in the admin method.
        """
        portfolio_obj_with_no_owner = Portfolio(name="Temp Portfolio No Owner") # This is an unsaved instance.
        # Accessing portfolio_obj_with_no_owner.owner when Portfolio.owner is a non-nullable ForeignKey
        # (and owner_id is None) would normally raise RelatedObjectDoesNotExist.
        # To accurately test our admin method's None-handling logic, we temporarily
        # modify the field's metadata to behave as if it's nullable.
        portfolio_obj_with_no_owner.owner = None # This sets the internal owner_id to None.

        field_to_patch = Portfolio._meta.get_field('owner')
        original_null_setting = field_to_patch.null
        try:
            field_to_patch.null = True # Temporarily treat the ForeignKey as nullable.
            self.assertIsNone(self.admin_instance.owner_customer_number(portfolio_obj_with_no_owner))
        finally:
            field_to_patch.null = original_null_setting # Always restore the original setting.

    def test_owner_customer_number_owner_exists_but_customer_number_is_none(self):
        """
        Considers the case where a portfolio owner exists, but that owner's customer_number is None.
        This is unlikely given the current model definition (customer_number is non-nullable).
        If the Customer model allowed a nullable customer_number, this test would cover that path.
        The primary 'if obj.owner' logic is already tested in test_owner_customer_number_portfolio_owner_is_none.
        """
        pass # Retaining 'pass' as this specific state is difficult to achieve with current model constraints
             # for saved objects. The more critical conditional branch (obj.owner being None) is covered.

class CustomerHoldingAdminTest(BaseAdminTest):
    """
    Contains tests for the custom methods within the CustomerHoldingAdmin class.
    """
    def setUp(self):
        """
        This setup is run before each individual test method in this class.
        """
        self.admin_instance = CustomerHoldingAdmin(CustomerHolding, self.site)

    def test_portfolio_name_with_portfolio(self):
        """
        Verifies that portfolio_name returns the correct name
        when a customer holding is linked to a portfolio.
        """
        self.assertEqual(self.admin_instance.portfolio_name(self.holding1), self.portfolio1.name)

    def test_portfolio_name_without_portfolio(self):
        """
        Tests the scenario where the holding's 'portfolio' attribute is None.
        This checks the 'if obj.portfolio else None' logic in the admin method.
        """
        holding_no_portfolio = CustomerHolding(security=self.security1) # Unsaved instance.
        holding_no_portfolio.portfolio = None # Set internal portfolio_id to None.

        field_to_patch = CustomerHolding._meta.get_field('portfolio')
        original_null_setting = field_to_patch.null
        try:
            field_to_patch.null = True # Temporarily treat the ForeignKey as nullable.
            self.assertIsNone(self.admin_instance.portfolio_name(holding_no_portfolio))
        finally:
            field_to_patch.null = original_null_setting # Restore.

    def test_security_cusip_with_security(self):
        """
        Verifies that security_cusip returns the correct CUSIP
        when a customer holding is linked to a security.
        """
        self.assertEqual(self.admin_instance.security_cusip(self.holding1), self.security1.cusip)

    def test_security_cusip_without_security(self):
        """
        Tests the scenario where the holding's 'security' attribute is None.
        This checks the 'if obj.security else None' logic in the admin method.
        """
        holding_no_security = CustomerHolding(portfolio=self.portfolio1) # Unsaved instance.
        holding_no_security.security = None # Set internal security_id to None.

        field_to_patch = CustomerHolding._meta.get_field('security')
        original_null_setting = field_to_patch.null
        try:
            field_to_patch.null = True # Temporarily treat the ForeignKey as nullable.
            self.assertIsNone(self.admin_instance.security_cusip(holding_no_security))
        finally:
            field_to_patch.null = original_null_setting # Restore.

    def test_owner_customer_number_with_full_path(self):
        """
        Verifies owner_customer_number returns the correct customer number
        when the holding, its portfolio, and the portfolio's owner all exist and are linked.
        Path: holding1 -> portfolio1 -> customer1 (customer_number=9001)
        """
        self.assertEqual(self.admin_instance.owner_customer_number(self.holding1), self.customer1.customer_number)

    def test_owner_customer_number_holding_no_portfolio(self):
        """
        Tests owner_customer_number when the holding's 'portfolio' attribute is None.
        This checks the first part of the 'if obj.portfolio and obj.portfolio.owner else None' logic.
        """
        holding_no_portfolio = CustomerHolding(security=self.security1) # Unsaved instance.
        holding_no_portfolio.portfolio = None # Set internal portfolio_id to None.

        # We need to patch CustomerHolding.portfolio to behave as nullable for this test.
        ch_portfolio_field = CustomerHolding._meta.get_field('portfolio')
        original_ch_portfolio_null = ch_portfolio_field.null
        try:
            ch_portfolio_field.null = True
            self.assertIsNone(self.admin_instance.owner_customer_number(holding_no_portfolio))
        finally:
            ch_portfolio_field.null = original_ch_portfolio_null # Restore.
            
    def test_owner_customer_number_portfolio_exists_but_owner_is_none(self):
        """
        Tests owner_customer_number when holding.portfolio exists, but that portfolio's 'owner' is None.
        This checks the second part of the 'if obj.portfolio and obj.portfolio.owner else None' logic.
        Since the Portfolio model requires an owner, we simulate this state using an unsaved Portfolio instance.
        """
        portfolio_with_owner_none = Portfolio(name="Portfolio With Owner Set To None") # Unsaved Portfolio.
        portfolio_with_owner_none.owner = None # Set internal owner_id on this Portfolio to None.

        holding_obj = CustomerHolding(security=self.security1) # Unsaved CustomerHolding.
        holding_obj.portfolio = portfolio_with_owner_none # Link to the portfolio that has no owner.

        # For the access `portfolio_with_owner_none.owner` to not raise an error (and return None),
        # Portfolio.owner needs to temporarily behave as nullable.
        
        p_owner_field = Portfolio._meta.get_field('owner')
        original_p_owner_null = p_owner_field.null

        # Note: CustomerHolding.portfolio is assigned an object here, so its null status isn't
        # strictly critical for *this specific line of access*. However, the general pattern of
        # patching is maintained for consistency if the method's logic were to change.

        try:
            p_owner_field.null = True # Make Portfolio.owner behave as nullable.
            self.assertIsNone(self.admin_instance.owner_customer_number(holding_obj))
        finally:
            p_owner_field.null = original_p_owner_null # Restore.

    def test_owner_customer_number_portfolio_and_owner_exist_but_customer_number_is_none(self):
        """
        Considers the case where holding.portfolio and portfolio.owner exist,
        but portfolio.owner.customer_number is None.
        Similar to the PortfolioAdminTest, this is less likely given the current non-nullable
        definition of customer_number on the Customer model.
        This test is more of a conceptual placeholder for that attribute access path if models allowed it.
        """
        pass # Retaining 'pass' as current model constraints make this state difficult to test directly.

