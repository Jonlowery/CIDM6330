from django.contrib import admin
from .models import Customer, Account, RiskAssessment, Transaction, Branch

admin.site.register(Customer)
admin.site.register(Account)
admin.site.register(RiskAssessment)
admin.site.register(Transaction)
admin.site.register(Branch)