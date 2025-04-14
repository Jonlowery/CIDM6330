from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework import status

from api.tasks import (
    assess_risk_for_customer,
    transfer_funds,
    create_risk_assessment,  # new task for manual POSTs
)
from .models import Customer, Account, RiskAssessment, Transaction, Branch
from .serializers import (
    CustomerSerializer,
    AccountSerializer,
    RiskAssessmentSerializer,
    TransactionSerializer,
    BranchSerializer,
    TransferSerializer,
)


class CustomerViewSet(viewsets.ModelViewSet):
    queryset = Customer.objects.all()
    serializer_class = CustomerSerializer

    @action(detail=True, methods=["post"])
    def assess_risk(self, request, pk=None):
        """
        POST /api/customers/{id}/assess_risk/
        Enqueue a Celery task to perform a risk assessment.
        """
        assess_risk_for_customer.delay(pk)
        return Response(
            {"detail": "Risk assessment enqueued."},
            status=status.HTTP_202_ACCEPTED
        )


class AccountViewSet(viewsets.ModelViewSet):
    queryset = Account.objects.all()
    serializer_class = AccountSerializer

    @action(detail=True, methods=['post'], serializer_class=TransferSerializer)
    def transfer(self, request, pk=None):
        """
        POST /api/accounts/{id}/transfer/
        Body: { "target_account": <id>, "amount": <decimal> }
        Enqueue a Celery task to move funds.
        """
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        target_id = serializer.validated_data["target_account"]
        amount = serializer.validated_data["amount"]

        transfer_funds.delay(self.get_object().id, target_id, str(amount))

        return Response(
            {"detail": "Transfer enqueued."},
            status=status.HTTP_202_ACCEPTED
        )


class RiskAssessmentViewSet(viewsets.ModelViewSet):
    queryset = RiskAssessment.objects.all()
    serializer_class = RiskAssessmentSerializer

    def create(self, request, *args, **kwargs):
        """
        POST /api/risk-assessments/
        Enqueue a Celery task to create a RiskAssessment
        instead of doing it synchronously.
        """
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        # Pull the Customer instance and risk_score from validated_data
        customer = serializer.validated_data["customer"]
        risk_score = serializer.validated_data["risk_score"]

        # Pass only the ID into the Celery task
        create_risk_assessment.delay(customer.id, risk_score)

        return Response(
            {"detail": "Risk assessment creation enqueued."},
            status=status.HTTP_202_ACCEPTED
        )


class TransactionViewSet(viewsets.ModelViewSet):
    queryset = Transaction.objects.all()
    serializer_class = TransactionSerializer


class BranchViewSet(viewsets.ModelViewSet):
    queryset = Branch.objects.all()
    serializer_class = BranchSerializer
