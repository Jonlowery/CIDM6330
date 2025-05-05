# portfolio/admin.py (Updated to display CPR)

from django.contrib import admin
# Import models from the current app, including the new ones
from .models import (
    Customer,
    Security,
    Portfolio,
    CustomerHolding,
    MunicipalOffering,
    Salesperson,         # New
    SecurityType,        # New
    InterestSchedule     # New
)

# --- Register NEW Models ---

@admin.register(Salesperson)
class SalespersonAdmin(admin.ModelAdmin):
    """ Admin configuration for the Salesperson model. """
    list_display = ('salesperson_id', 'name', 'email', 'is_active', 'last_modified_at')
    search_fields = ('salesperson_id', 'name', 'email')
    list_filter = ('is_active',)
    readonly_fields = ('created_at', 'last_modified_at')

@admin.register(SecurityType)
class SecurityTypeAdmin(admin.ModelAdmin):
    """ Admin configuration for the SecurityType model. """
    list_display = ('type_id', 'name', 'last_modified_at')
    search_fields = ('type_id', 'name')
    readonly_fields = ('created_at', 'last_modified_at')

@admin.register(InterestSchedule)
class InterestScheduleAdmin(admin.ModelAdmin):
    """ Admin configuration for the InterestSchedule model. """
    list_display = ('schedule_code', 'name', 'payments_per_year_default', 'last_modified_at')
    search_fields = ('schedule_code', 'name')
    readonly_fields = ('created_at', 'last_modified_at')


# --- Update Existing Model Admins ---

@admin.register(Customer)
class CustomerAdmin(admin.ModelAdmin):
    """ Admin configuration for the Customer model. """
    list_display = (
        'name',
        'customer_number',
        'portfolio_accounting_code', # New field
        'salesperson',               # Changed from name/email to FK relationship
        'state',
        'last_modified_at',
    )
    search_fields = (
        'name',
        'customer_number',
        'salesperson__salesperson_id', # Search related salesperson ID
        'salesperson__name',           # Search related salesperson name
        'portfolio_accounting_code',
    )
    # Use filter_horizontal for a better ManyToMany widget for users
    filter_horizontal = ('users',)
    list_filter = (
        'state',
        'salesperson', # Filter by related salesperson object
    )
    # Use raw_id_fields for salesperson FK if there are many salespeople
    raw_id_fields = ('salesperson',)
    fieldsets = (
        (None, {
            'fields': ('customer_number', 'name', 'users')
        }),
        ('Contact Information', {
            'fields': ('address', 'city', 'state', 'zip_code')
        }),
        ('Salesperson & Accounting', { # Modified Section
            'fields': ('salesperson', 'portfolio_accounting_code'),
        }),
        ('Financial Profile', { # New Section for optional rates
             'fields': ('cost_of_funds_rate', 'federal_tax_bracket_rate'),
             'classes': ('collapse',) # Optional: Make section collapsible
        }),
        ('Internal ID & Timestamps', {
            'fields': ('unique_id', 'created_at', 'last_modified_at'),
            'classes': ('collapse',)
        }),
    )
    # unique_id is editable=False in model, created/modified are auto
    readonly_fields = ('unique_id', 'created_at', 'last_modified_at')

@admin.register(Security)
class SecurityAdmin(admin.ModelAdmin):
    """ Admin configuration for the Security model. """
    # Added 'cpr' to list_display
    list_display = (
        'cusip', 'description',
        'security_type',      # New FK relationship
        'issuer_name',
        'maturity_date',
        'coupon',             # Updated field
        'tax_code',           # New field
        'allows_paydown',     # New field
        'factor',
        'cpr'                 # Added CPR
    )
    search_fields = (
        'cusip',
        'description',
        'issuer_name',
        'sector',
        'security_type__name' # Search related type name
    )
    list_filter = (
        'tax_code',           # New field
        'interest_calc_code', # New field
        'allows_paydown',     # New field
        'callable_flag',
        'security_type',      # Filter by related type object
        'state_of_issuer',
        'sector',
    )
    # Use raw_id_fields for FKs if related tables become large
    raw_id_fields = ('security_type', 'interest_schedule')
    # Added 'cpr' to the 'Financial Terms' fieldset
    fieldsets = (
         (None, {
            'fields': ('cusip', 'description', 'security_type', 'issuer_name', 'sector', 'state_of_issuer')
         }),
         ('Financial Terms', {
             'fields': (
                 'coupon', 'secondary_rate', 'rate_effective_date', # Added new rate fields
                 'currency', 'issue_date', 'maturity_date', 'tax_code', # Added tax_code
                 'payments_per_year', 'interest_day', 'interest_schedule', # Added schedule/day/ppy
                 'interest_calc_code', 'payment_delay_days', # Added calc_code/delay
                 'factor', 'allows_paydown', 'wal', 'cpr' # Added CPR
                )
         }),
         ('Callability', {
            'fields': ('callable_flag', 'call_date')
         }),
         ('Ratings', {
            'fields': ('moody_rating', 'sp_rating', 'fitch_rating')
         }),
         ('Timestamps', {
            'fields': ('created_at', 'last_modified_at'),
            'classes': ('collapse',)
         }),
    )
    # cusip is primary_key=True in model, created/modified are auto
    readonly_fields = ('created_at', 'last_modified_at')

@admin.register(Portfolio)
class PortfolioAdmin(admin.ModelAdmin):
    """ Admin configuration for the Portfolio model. """
    list_display = (
        'name',
        'owner_customer_number', # Custom method display
        'is_default',
        'created_at'
    )
    search_fields = ('name', 'owner__name', 'owner__customer_number')
    list_filter = ('owner__name', 'is_default')
    raw_id_fields = ('owner',)
    # created_at is editable=False in model
    readonly_fields = ('created_at',)

    # Method to display owner's customer number in list_display
    @admin.display(description='Owner Customer No.', ordering='owner__customer_number')
    def owner_customer_number(self, obj):
        return obj.owner.customer_number if obj.owner else None

@admin.register(CustomerHolding)
class CustomerHoldingAdmin(admin.ModelAdmin):
    """ Admin configuration for the CustomerHolding model. """
    list_display = (
        'external_ticket', # Changed from ticket_id
        'portfolio_name',
        'security_cusip',
        'original_face_amount',
        'settlement_date',
        'intention_code', # New field
        'owner_customer_number'
    )
    search_fields = (
        'external_ticket', # Changed from ticket_id
        'portfolio__name',
        'security__cusip',
        'security__description',
        'portfolio__owner__name',
        'portfolio__owner__customer_number'
    )
    list_filter = ('portfolio__owner__name', 'portfolio__name', 'intention_code') # Added intention_code
    raw_id_fields = ('portfolio', 'security')
    # ticket_id is primary_key=True and editable=False, created/modified are auto
    readonly_fields = ('ticket_id', 'created_at', 'last_modified_at')

    # Method to display portfolio name
    @admin.display(description='Portfolio', ordering='portfolio__name')
    def portfolio_name(self, obj):
        return obj.portfolio.name if obj.portfolio else None

    # Method to display security CUSIP
    @admin.display(description='CUSIP', ordering='security__cusip')
    def security_cusip(self, obj):
        return obj.security.cusip if obj.security else None

    # Method to display customer number (from portfolio owner)
    @admin.display(description='Owner No.', ordering='portfolio__owner__customer_number')
    def owner_customer_number(self, obj):
        # Safely access related objects
        return obj.portfolio.owner.customer_number if obj.portfolio and obj.portfolio.owner else None


@admin.register(MunicipalOffering)
class MunicipalOfferingAdmin(admin.ModelAdmin):
    """ Admin configuration for the MunicipalOffering model. (No changes needed yet) """
    list_display = (
        'cusip', 'description', 'amount', 'coupon', 'maturity_date',
        'yield_rate', 'price', 'state', 'moody_rating', 'sp_rating', 'last_updated',
    )
    search_fields = ('cusip', 'description', 'state', 'insurance',)
    list_filter = ('state', 'insurance', 'moody_rating', 'sp_rating',)
    # cusip is PK, last_updated is auto
    readonly_fields = ('last_updated',)
    fieldsets = (
        (None, {
            'fields': ('cusip', 'description', 'amount', 'state', 'insurance')
        }),
        ('Financial Details', {
            'fields': ('coupon', 'maturity_date', 'yield_rate', 'price')
        }),
        ('Call Information', {
            'fields': ('call_date', 'call_price'),
            'classes': ('collapse',)
        }),
        ('Ratings', {
            'fields': ('moody_rating', 'sp_rating'),
        }),
         ('Meta', {
            'fields': ('last_updated',),
            'classes': ('collapse',)
        }),
    )
