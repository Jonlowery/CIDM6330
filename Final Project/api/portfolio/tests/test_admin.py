# portfolio/tests/test_admin.py
from django.test import TestCase
from django.contrib.admin.sites import AdminSite
from django.contrib.auth import get_user_model
from decimal import Decimal
from datetime import date

# Import your models
from portfolio.models import (
    Customer, Salesperson, Security, SecurityType, InterestSchedule,
    Portfolio, CustomerHolding
)
# Import your ModelAdmin classes
from portfolio.admin import (
    SalespersonAdmin, SecurityTypeAdmin, InterestScheduleAdmin,
    CustomerAdmin, SecurityAdmin, PortfolioAdmin, CustomerHoldingAdmin,
    MunicipalOfferingAdmin # Assuming MunicipalOfferingAdmin is also in portfolio.admin
)

User = get_user_model()

class BaseAdminTest(TestCase):
    """
    Base class for admin tests, can hold common setup.
    """
    @classmethod
    def setUpTestData(cls):
        cls.site = AdminSite() # A dummy admin site

        # Create common instances needed by admin tests
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
    def setUp(self):
        self.admin_instance = PortfolioAdmin(Portfolio, self.site)

    def test_owner_customer_number_with_owner(self):
        # Portfolio1 is linked to customer1 which has customer_number 9001
        self.assertEqual(self.admin_instance.owner_customer_number(self.portfolio1), 9001)

    def test_owner_customer_number_without_owner(self):
        # Create a portfolio that somehow has no owner (though model field is not null)
        # This test might be more about graceful handling if data integrity is compromised
        # or if the model changes. For now, assuming owner is always present.
        # If owner could be null:
        # portfolio_no_owner = Portfolio(name="No Owner Port") # Don't save, or save with null if allowed
        # self.assertIsNone(self.admin_instance.owner_customer_number(portfolio_no_owner))
        pass # Current model requires owner, so this case is less relevant unless model changes.

    def test_owner_customer_number_owner_without_customer_number(self):
        customer_no_num = Customer.objects.create(name="Cust No Number", city="X", state="Y", portfolio_accounting_code="Z")
        # customer_no_num.customer_number is an IntegerField, defaults to None if not specified & null=True
        # In your model, customer_number is NOT nullable and is an IntegerField.
        # So, this case implies either customer_number=0 or testing how it handles it.
        # If customer_number was nullable:
        # portfolio_with_owner_no_num = Portfolio.objects.create(owner=customer_no_num, name="Owner No Num Port")
        # self.assertIsNone(self.admin_instance.owner_customer_number(portfolio_with_owner_no_num))
        pass # Current model requires customer_number, so direct None is not possible.

class CustomerHoldingAdminTest(BaseAdminTest):
    def setUp(self):
        self.admin_instance = CustomerHoldingAdmin(CustomerHolding, self.site)

    def test_portfolio_name_with_portfolio(self):
        self.assertEqual(self.admin_instance.portfolio_name(self.holding1), self.portfolio1.name)

    def test_portfolio_name_without_portfolio(self):
        # Create a holding instance without saving or with portfolio=None if allowed
        holding_no_portfolio = CustomerHolding(security=self.security1) # Not saved
        self.assertIsNone(self.admin_instance.portfolio_name(holding_no_portfolio))

    def test_security_cusip_with_security(self):
        self.assertEqual(self.admin_instance.security_cusip(self.holding1), self.security1.cusip)

    def test_security_cusip_without_security(self):
        holding_no_security = CustomerHolding(portfolio=self.portfolio1) # Not saved
        self.assertIsNone(self.admin_instance.security_cusip(holding_no_security))

    def test_owner_customer_number_with_full_path(self):
        # holding1 -> portfolio1 -> customer1 (customer_number=9001)
        self.assertEqual(self.admin_instance.owner_customer_number(self.holding1), self.customer1.customer_number)

    def test_owner_customer_number_holding_no_portfolio(self):
        holding_no_portfolio = CustomerHolding(security=self.security1)
        self.assertIsNone(self.admin_instance.owner_customer_number(holding_no_portfolio))

    def test_owner_customer_number_portfolio_no_owner(self):
        # This case assumes Portfolio.owner could be None, which it cannot by current model definition
        # portfolio_no_owner = Portfolio.objects.create(name="Temp Port No Owner") # This would fail
        # holding_with_port_no_owner = CustomerHolding.objects.create(portfolio=portfolio_no_owner, security=self.security1)
        # self.assertIsNone(self.admin_instance.owner_customer_number(holding_with_port_no_owner))
        pass

# Add similar test classes for other ModelAdmin classes if they have custom methods:
# - SalespersonAdmin
# - SecurityTypeAdmin
# - InterestScheduleAdmin
# - CustomerAdmin
# - SecurityAdmin
# - MunicipalOfferingAdmin

# Example: If CustomerAdmin had a custom method:
# class CustomerAdminTest(BaseAdminTest):
#     def setUp(self):
#         self.admin_instance = CustomerAdmin(Customer, self.site)
#
#     def test_custom_customer_method(self):
#         # ... test logic ...
#         pass

# General checks for admin classes (less common to unit test these extensively as Django handles most):
# - Check that search_fields, list_filter, list_display, fieldsets, readonly_fields
#   do not reference non-existent fields (Django usually catches this at startup or when accessing admin).
# - If you have custom get_queryset, get_form, save_model, delete_model overrides, test them thoroughly.
