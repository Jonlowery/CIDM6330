# portfolio/admin.py (Added MunicipalOfferingAdmin)

from django.contrib import admin
# Import models from the current app
from .models import Customer, Security, Portfolio, CustomerHolding, MunicipalOffering # Import new model

@admin.register(Customer)
class CustomerAdmin(admin.ModelAdmin):
    """ Admin configuration for the Customer model. """
    # Fields to display in the list view
    list_display = (
        'name',
        'customer_number',
        'salesperson_name', # Added salesperson name
        'salesperson_email', # Added salesperson email
        'unique_id'
    )
    # Fields to allow searching on
    search_fields = (
        'name',
        'customer_number',
        'salesperson_name', # Added salesperson name to search
        'salesperson_email', # Added salesperson email to search
    )
    # Use filter_horizontal for a better ManyToMany widget for users
    # This makes selecting multiple users easier than the default select box
    filter_horizontal = ('users',)
    # Fields to allow filtering by in the sidebar
    list_filter = ('state', 'salesperson_name') # Added salesperson name to filter
    # Define the layout of the add/change form
    fieldsets = (
        (None, { # Main section (no header)
            'fields': ('customer_number', 'name', 'users')
        }),
        ('Contact Information', { # Section for contact details
            'fields': ('address', 'city', 'state', 'zip_code')
        }),
        ('Salesperson Assignment', { # Section for salesperson details
            'fields': ('salesperson_name', 'salesperson_email'),
            # 'classes': ('collapse',) # Optional: Make section collapsible
        }),
        ('Internal ID', { # Section for internal ID, maybe collapsed by default
            'fields': ('unique_id',),
            'classes': ('collapse',)
        }),
    )
    # Make unique_id read-only in the admin form as it's auto-generated
    readonly_fields = ('unique_id',)

@admin.register(Security)
class SecurityAdmin(admin.ModelAdmin):
    """ Admin configuration for the Security model. """
    list_display = (
        'cusip', 'description', 'issue_date', 'maturity_date',
        'coupon', 'wal', 'payment_frequency', 'day_count', 'factor' # Added more fields
    )
    search_fields = ('cusip', 'description')
    list_filter = ('day_count', 'payment_frequency')
    # Define fields for the add/change form if needed, otherwise defaults are used
    # fields = ('cusip', 'description', ...)
    readonly_fields = ('id',) # Make internal ID read-only

@admin.register(Portfolio)
class PortfolioAdmin(admin.ModelAdmin):
    """ Admin configuration for the Portfolio model. """
    list_display = (
        'name',
        'owner_customer_number', # Custom method display
        'is_default', # Display the default flag
        'created_at'
    )
    search_fields = ('name', 'owner__name', 'owner__customer_number')
    list_filter = ('owner__name', 'is_default') # Allow filtering by owner and default status
    # Use raw_id_fields for ForeignKey owner for performance if there are many customers
    raw_id_fields = ('owner',)
    # Make is_default editable, but consider implications (should only be set by import?)
    readonly_fields = ('id', 'created_at',) # created_at is usually read-only

    # Method to display owner's customer number in list_display
    @admin.display(description='Owner Customer No.', ordering='owner__customer_number')
    def owner_customer_number(self, obj):
        # Safely access owner and customer_number
        return obj.owner.customer_number if obj.owner else None

@admin.register(CustomerHolding)
class CustomerHoldingAdmin(admin.ModelAdmin):
    """ Admin configuration for the CustomerHolding model. """
    list_display = (
        'ticket_id',
        'portfolio_name', # Custom display field
        'security_cusip', # Custom display field
        'original_face_amount',
        'owner_customer_number' # Display actual owner number
    )
    search_fields = (
        'ticket_id',
        'portfolio__name',
        'security__cusip',
        'security__description',
        # 'customer__customer_number', # Removed redundant field search
        'portfolio__owner__name', # Search on actual owner name
        'portfolio__owner__customer_number' # Search on actual owner number
    )
    list_filter = ('portfolio__owner__name', 'portfolio__name') # Filter by customer (via portfolio) or portfolio name
    # Use raw_id_fields for performance with large numbers of related objects
    raw_id_fields = ('portfolio', 'security') # Removed 'customer'
    # Make certain fields read-only if they shouldn't be edited directly here
    readonly_fields = ('id', 'ticket_id') # Removed customer fields

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
        return obj.portfolio.owner.customer_number if obj.portfolio and obj.portfolio.owner else None


# --- NEW Admin for Municipal Offerings ---
@admin.register(MunicipalOffering)
class MunicipalOfferingAdmin(admin.ModelAdmin):
    """ Admin configuration for the MunicipalOffering model. """
    list_display = (
        'cusip',
        'description',
        'amount',
        'coupon',
        'maturity_date',
        'yield_rate',
        'price',
        'state',
        'moody_rating',
        'sp_rating',
        'last_updated',
    )
    search_fields = (
        'cusip',
        'description',
        'state',
        'insurance',
    )
    list_filter = (
        'state',
        'insurance',
        'moody_rating',
        'sp_rating',
    )
    readonly_fields = ('id', 'last_updated',) # Make auto fields read-only
    # Define field layout for add/change form if desired
    fieldsets = (
        (None, {
            'fields': ('cusip', 'description', 'amount', 'state', 'insurance')
        }),
        ('Financial Details', {
            'fields': ('coupon', 'maturity_date', 'yield_rate', 'price')
        }),
        ('Call Information', {
            'fields': ('call_date', 'call_price'),
            'classes': ('collapse',) # Optional: collapse this section
        }),
        ('Ratings', {
            'fields': ('moody_rating', 'sp_rating'),
        }),
         ('Meta', {
            'fields': ('last_updated',),
            'classes': ('collapse',)
        }),
    )

