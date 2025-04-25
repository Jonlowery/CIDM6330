from django.contrib import admin
from .models import Customer, Security, Portfolio, CustomerHolding

@admin.register(Customer)
class CustomerAdmin(admin.ModelAdmin):
    list_display = ('name', 'unique_id')
    search_fields = ('name',)

@admin.register(Security)
class SecurityAdmin(admin.ModelAdmin):
    list_display = ('cusip', 'description', 'issue_date', 'maturity_date')
    list_filter = ('day_count', 'payment_frequency')

@admin.register(Portfolio)
class PortfolioAdmin(admin.ModelAdmin):
    list_display = ('name', 'owner', 'created_at')
    raw_id_fields = ('owner',)

@admin.register(CustomerHolding)
class CustomerHoldingAdmin(admin.ModelAdmin):
    list_display = ('ticket_id', 'portfolio', 'security', 'original_face_amount')
    raw_id_fields = ('portfolio', 'security', 'customer')
