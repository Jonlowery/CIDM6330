from django.db import models

# Existing Customer model
class Customer(models.Model):
    first_name = models.CharField(max_length=100)
    last_name = models.CharField(max_length=100)
    email = models.EmailField(unique=True)
    date_created = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.first_name} {self.last_name}"


# New Account model
class Account(models.Model):
    account_number = models.CharField(max_length=20, unique=True)
    account_type = models.CharField(max_length=50)
    customer = models.ForeignKey(Customer, on_delete=models.CASCADE, related_name='accounts')
    balance = models.DecimalField(max_digits=12, decimal_places=2)
    date_opened = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Account {self.account_number} for {self.customer}"


# New RiskAssessment model
class RiskAssessment(models.Model):
    customer = models.ForeignKey(Customer, on_delete=models.CASCADE, related_name='risk_assessments')
    risk_score = models.IntegerField()
    assessment_date = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Risk Assessment for {self.customer}: {self.risk_score}"


# New Transaction model
class Transaction(models.Model):
    account = models.ForeignKey(Account, on_delete=models.CASCADE, related_name='transactions')
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    transaction_date = models.DateTimeField(auto_now_add=True)
    description = models.TextField(blank=True, null=True)

    def __str__(self):
        return f"Transaction on {self.account} for {self.amount}"


# New Branch model
class Branch(models.Model):
    branch_name = models.CharField(max_length=100)
    address = models.CharField(max_length=255)

    def __str__(self):
        return self.branch_name
