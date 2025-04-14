from rest_framework import serializers
from .models import Customer, Account, RiskAssessment, Transaction, Branch

class RiskAssessmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = RiskAssessment
        # explicitly list fields and make id & assessment_date read-only
        fields = ["id", "customer", "risk_score", "assessment_date"]
        read_only_fields = ["id", "assessment_date"]

class CustomerSerializer(serializers.ModelSerializer):
    # Nested list of related RiskAssessment records
    risk_assessments = RiskAssessmentSerializer(many=True, read_only=True)

    class Meta:
        model = Customer
        fields = [
            "id",
            "first_name",
            "last_name",
            "email",
            "date_created",
            "risk_assessments",
        ]


class AccountSerializer(serializers.ModelSerializer):
    class Meta:
        model = Account
        fields = '__all__'


class TransactionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Transaction
        fields = '__all__'


class BranchSerializer(serializers.ModelSerializer):
    class Meta:
        model = Branch
        fields = '__all__'


class TransferSerializer(serializers.Serializer):
    target_account = serializers.IntegerField()
    amount = serializers.DecimalField(max_digits=10, decimal_places=2)
