from django.test import TestCase, override_settings
from django.urls import reverse
from rest_framework.test import APIClient
from unittest.mock import patch
from rest_framework import status

# Import models and tasks
from api.models import Customer, Account, RiskAssessment, Transaction, Branch
from api.tasks import process_event, transfer_funds

# -----------------------------
# Repository Persistence Tests
# -----------------------------
class CustomerModelTest(TestCase):
    def test_create_customer(self):
        customer = Customer.objects.create(
            first_name="Test",
            last_name="Customer",
            email="test@example.com"
        )
        self.assertIsNotNone(customer.id)
        self.assertEqual(Customer.objects.count(), 1)

    def test_update_customer(self):
        customer = Customer.objects.create(
            first_name="Test",
            last_name="Customer",
            email="test@example.com"
        )
        customer.first_name = "Updated"
        customer.save()
        updated = Customer.objects.get(id=customer.id)
        self.assertEqual(updated.first_name, "Updated")

    def test_delete_customer(self):
        customer = Customer.objects.create(
            first_name="Test",
            last_name="Customer",
            email="test@example.com"
        )
        customer_id = customer.id
        customer.delete()
        with self.assertRaises(Customer.DoesNotExist):
            Customer.objects.get(id=customer_id)


class AccountModelTest(TestCase):
    def setUp(self):
        self.customer = Customer.objects.create(
            first_name="Test",
            last_name="Customer",
            email="test@example.com"
        )

    def test_create_account(self):
        account = Account.objects.create(
            account_number="ACC123456",
            account_type="Savings",
            customer=self.customer,
            balance=1000.00
        )
        self.assertIsNotNone(account.id)
        self.assertEqual(Account.objects.count(), 1)

    def test_update_account(self):
        account = Account.objects.create(
            account_number="ACC123456",
            account_type="Savings",
            customer=self.customer,
            balance=1000.00
        )
        account.account_type = "Checking"
        account.save()
        updated = Account.objects.get(id=account.id)
        self.assertEqual(updated.account_type, "Checking")

    def test_delete_account(self):
        account = Account.objects.create(
            account_number="ACC123456",
            account_type="Savings",
            customer=self.customer,
            balance=1000.00
        )
        account_id = account.id
        account.delete()
        with self.assertRaises(Account.DoesNotExist):
            Account.objects.get(id=account_id)


class RiskAssessmentModelTest(TestCase):
    def setUp(self):
        self.customer = Customer.objects.create(
            first_name="Test",
            last_name="Customer",
            email="test@example.com"
        )

    def test_create_riskassessment(self):
        risk = RiskAssessment.objects.create(
            customer=self.customer,
            risk_score=5
        )
        self.assertIsNotNone(risk.id)
        self.assertEqual(RiskAssessment.objects.count(), 1)

    def test_update_riskassessment(self):
        risk = RiskAssessment.objects.create(
            customer=self.customer,
            risk_score=5
        )
        risk.risk_score = 8
        risk.save()
        updated = RiskAssessment.objects.get(id=risk.id)
        self.assertEqual(updated.risk_score, 8)

    def test_delete_riskassessment(self):
        risk = RiskAssessment.objects.create(
            customer=self.customer,
            risk_score=5
        )
        risk_id = risk.id
        risk.delete()
        with self.assertRaises(RiskAssessment.DoesNotExist):
            RiskAssessment.objects.get(id=risk_id)


class TransactionModelTest(TestCase):
    def setUp(self):
        self.customer = Customer.objects.create(
            first_name="Test",
            last_name="Customer",
            email="test@example.com"
        )
        self.account = Account.objects.create(
            account_number="ACC123456",
            account_type="Savings",
            customer=self.customer,
            balance=1000.00
        )

    def test_create_transaction(self):
        transaction = Transaction.objects.create(
            account=self.account,
            amount=250.00,
            description="Deposit"
        )
        self.assertIsNotNone(transaction.id)
        self.assertEqual(Transaction.objects.count(), 1)

    def test_update_transaction(self):
        transaction = Transaction.objects.create(
            account=self.account,
            amount=250.00,
            description="Deposit"
        )
        transaction.amount = 300.00
        transaction.save()
        updated = Transaction.objects.get(id=transaction.id)
        self.assertEqual(updated.amount, 300.00)

    def test_delete_transaction(self):
        transaction = Transaction.objects.create(
            account=self.account,
            amount=250.00,
            description="Deposit"
        )
        transaction_id = transaction.id
        transaction.delete()
        with self.assertRaises(Transaction.DoesNotExist):
            Transaction.objects.get(id=transaction_id)


class BranchModelTest(TestCase):
    def test_create_branch(self):
        branch = Branch.objects.create(
            branch_name="Main Branch",
            address="123 Main St"
        )
        self.assertIsNotNone(branch.id)
        self.assertEqual(Branch.objects.count(), 1)

    def test_update_branch(self):
        branch = Branch.objects.create(
            branch_name="Main Branch",
            address="123 Main St"
        )
        branch.branch_name = "Updated Branch"
        branch.save()
        updated = Branch.objects.get(id=branch.id)
        self.assertEqual(updated.branch_name, "Updated Branch")

    def test_delete_branch(self):
        branch = Branch.objects.create(
            branch_name="Main Branch",
            address="123 Main St"
        )
        branch_id = branch.id
        branch.delete()
        with self.assertRaises(Branch.DoesNotExist):
            Branch.objects.get(id=branch_id)


# -------------------------
# API CRUD Operation Tests
# -------------------------
class CustomerAPITest(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_create_customer_api(self):
        url = reverse("customer-list")
        data = {"first_name": "API", "last_name": "Customer", "email": "api@example.com"}
        response = self.client.post(url, data, format="json")
        self.assertEqual(response.status_code, 201)

    def test_get_customer_api(self):
        customer = Customer.objects.create(
            first_name="API", last_name="Customer", email="api@example.com"
        )
        url = reverse("customer-detail", args=[customer.id])
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["first_name"], customer.first_name)

    def test_update_customer_api(self):
        customer = Customer.objects.create(
            first_name="API", last_name="Customer", email="api@example.com"
        )
        url = reverse("customer-detail", args=[customer.id])
        data = {"first_name": "Updated API", "last_name": "Customer", "email": "api@example.com"}
        response = self.client.put(url, data, format="json")
        self.assertEqual(response.status_code, 200)
        customer.refresh_from_db()
        self.assertEqual(customer.first_name, "Updated API")

    def test_delete_customer_api(self):
        customer = Customer.objects.create(
            first_name="API", last_name="Customer", email="api@example.com"
        )
        url = reverse("customer-detail", args=[customer.id])
        response = self.client.delete(url)
        self.assertEqual(response.status_code, 204)
        self.assertEqual(Customer.objects.count(), 0)


# -----------------------
# Celery Task Unit Testing
# -----------------------
class CeleryTaskTest(TestCase):
    def test_process_event_task(self):
        result = process_event.apply(args=("Test Event",))
        self.assertEqual(result.get(), "Processed: Test Event")


class TransferFundsTaskTest(TestCase):
    def setUp(self):
        self.customer = Customer.objects.create(
            first_name="TF", last_name="Tester", email="tf@test.com"
        )
        self.src = Account.objects.create(
            account_number="SRC100", account_type="Checking",
            customer=self.customer, balance=500.00
        )
        self.tgt = Account.objects.create(
            account_number="TGT100", account_type="Savings",
            customer=self.customer, balance=100.00
        )

    def test_transfer_funds_success(self):
        result = transfer_funds.apply(
            args=[self.src.id, self.tgt.id, "150.00"]
        )
        data = result.get(timeout=5)
        self.assertEqual(data["source_balance"], "350.00")
        self.assertEqual(data["target_balance"], "250.00")

    def test_transfer_funds_insufficient(self):
        result = transfer_funds.apply(
            args=[self.src.id, self.tgt.id, "600.00"]
        )
        with self.assertRaises(ValueError):
            result.get(timeout=5)


# -----------------------------
# API Operation Tests
# -----------------------------
class CustomerAssessRiskAPITest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.customer = Customer.objects.create(
            first_name="Async", last_name="User", email="async@example.com"
        )

    @patch("api.tasks.assess_risk_for_customer.delay")
    def test_assess_risk_enqueues_task(self, mock_delay):
        url = reverse("customer-assess-risk", args=[self.customer.id])
        response = self.client.post(url)
        self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED)
        mock_delay.assert_called_once_with(str(self.customer.id))


class AccountTransferAPITest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.cust = Customer.objects.create(
            first_name="Queue", last_name="User", email="queue@test.com"
        )
        self.src = Account.objects.create(
            account_number="SRCQ", account_type="Checking",
            customer=self.cust, balance=500.00
        )
        self.tgt = Account.objects.create(
            account_number="TGTQ", account_type="Savings",
            customer=self.cust, balance=100.00
        )

    @patch("api.tasks.transfer_funds.delay")
    def test_transfer_enqueues_task(self, mock_delay):
        url = reverse("account-transfer", args=[self.src.id])
        data = {"target_account": self.tgt.id, "amount": 150.00}
        response = self.client.post(url, data, format="json")
        self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED)
        mock_delay.assert_called_once_with(self.src.id, self.tgt.id, "150.00")


# -----------------------------
# Integration Test for Assess Risk Endpoint
# -----------------------------
@override_settings(
    CELERY_TASK_ALWAYS_EAGER=True,
    CELERY_TASK_EAGER_PROPAGATES=True
)
class CustomerAssessRiskIntegrationTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.customer = Customer.objects.create(
            first_name="Integration",
            last_name="Tester",
            email="int@test.com"
        )

    def test_assess_risk_creates_risk_assessment(self):
        url = reverse("customer-assess-risk", args=[self.customer.id])
        response = self.client.post(url, {}, format="json")
        self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED)
        assessments = RiskAssessment.objects.filter(customer=self.customer)
        self.assertEqual(assessments.count(), 1)
# -----------------------------
# Integration Test for Transfer Endpoint
# -----------------------------
@override_settings(
    CELERY_TASK_ALWAYS_EAGER=True,
    CELERY_TASK_EAGER_PROPAGATES=True
)
class AccountTransferIntegrationTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        # Create a customer and two accounts
        self.customer = Customer.objects.create(
            first_name="Int", last_name="Transfer", email="int@transfer.com"
        )
        self.src = Account.objects.create(
            account_number="SRCINT", account_type="Checking",
            customer=self.customer, balance=500.00
        )
        self.tgt = Account.objects.create(
            account_number="TGTINT", account_type="Savings",
            customer=self.customer, balance=100.00
        )

    def test_transfer_updates_balances(self):
        url = reverse("account-transfer", args=[self.src.id])
        data = {"target_account": self.tgt.id, "amount": 150.00}
        response = self.client.post(url, data, format="json")
        # Should enqueue & (eagerly) run the task
        self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED)

        # Refresh from DB and verify balances changed
        self.src.refresh_from_db()
        self.tgt.refresh_from_db()
        self.assertEqual(self.src.balance, 350.00)
        self.assertEqual(self.tgt.balance, 250.00)
from api.tasks import create_risk_assessment
from api.models import RiskAssessment

# -----------------------
# Celery Task Unit Test
# -----------------------
class CreateRiskAssessmentTaskTest(TestCase):
    def setUp(self):
        self.customer = Customer.objects.create(
            first_name="CRT", last_name="Tester", email="crt@test.com"
        )

    def test_create_risk_assessment_task(self):
        # Run the task synchronously
        result = create_risk_assessment.apply(
            args=[self.customer.id, 42]
        )
        data = result.get(timeout=5)
        # Task should return a dict with the new record’s info
        self.assertEqual(data["customer"], self.customer.id)
        self.assertEqual(data["risk_score"], 42)
        # And the DB record should exist
        ra = RiskAssessment.objects.get(id=data["id"])
        self.assertEqual(ra.risk_score, 42)
        self.assertEqual(ra.customer_id, self.customer.id)


# -----------------------------
# API Mock‑based Queue Test
# -----------------------------
class RiskAssessmentQueueAPITest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.customer = Customer.objects.create(
            first_name="Queue", last_name="User", email="queue@test.com"
        )

    @patch("api.tasks.create_risk_assessment.delay")
    def test_risk_assessment_enqueues_task(self, mock_delay):
        url = reverse("riskassessment-list")  # your router’s name for RiskAssessmentViewSet
        data = {"customer": self.customer.id, "risk_score": 99}
        response = self.client.post(url, data, format="json")
        self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED)
        mock_delay.assert_called_once_with(self.customer.id, 99)


# --------------------------------------
# Integration Test with Eager Celery Mode
# --------------------------------------
@override_settings(
    CELERY_TASK_ALWAYS_EAGER=True,
    CELERY_TASK_EAGER_PROPAGATES=True
)
class RiskAssessmentIntegrationTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.customer = Customer.objects.create(
            first_name="Int", last_name="Risk", email="int@risk.com"
        )

    def test_manual_post_creates_assessment(self):
        url = reverse("riskassessment-list")
        data = {"customer": self.customer.id, "risk_score": 123}
        response = self.client.post(url, data, format="json")
        # Should enqueue & (eagerly) run the task
        self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED)

        # Now a RiskAssessment must exist
        ra = RiskAssessment.objects.get(customer=self.customer)
        self.assertEqual(ra.risk_score, 123)
