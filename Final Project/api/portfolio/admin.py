# portfolio/admin.py (Added Salesperson fields to CustomerAdmin)

from django.contrib import admin
# Import models from the current app
from .models import Customer, Security, Portfolio, CustomerHolding

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
    list_filter = ('owner', 'is_default') # Allow filtering by owner and default status
    # Use raw_id_fields for ForeignKey owner for performance if there are many customers
    raw_id_fields = ('owner',)
    # Make is_default editable, but consider implications (should only be set by import?)
    # readonly_fields = ('created_at',) # created_at is usually read-only

    # Method to display owner's customer number in list_display
    @admin.display(description='Owner Customer No.', ordering='owner__customer_number')
    def owner_customer_number(self, obj):
        # Safely access owner and customer_number
        return obj.owner.customer_number if obj.owner else None
    # owner_customer_number.short_description = 'Customer Number' # Set via @admin.display
    # owner_customer_number.admin_order_field = 'owner__customer_number' # Set via @admin.display


@admin.register(CustomerHolding)
class CustomerHoldingAdmin(admin.ModelAdmin):
    """ Admin configuration for the CustomerHolding model. """
    list_display = (
        'ticket_id',
        'portfolio_name', # Custom display field
        'security_cusip', # Custom display field
        'original_face_amount',
        'customer_number' # Custom display field (redundant customer number)
    )
    search_fields = (
        'ticket_id',
        'portfolio__name',
        'security__cusip',
        'security__description',
        'customer__customer_number', # Search on redundant field
        'portfolio__owner__name', # Search on actual owner name
        'portfolio__owner__customer_number' # Search on actual owner number
    )
    list_filter = ('portfolio__owner', 'portfolio') # Filter by customer (via portfolio) or portfolio
    # Use raw_id_fields for performance with large numbers of related objects
    raw_id_fields = ('portfolio', 'security', 'customer')
    # Make certain fields read-only if they shouldn't be edited directly here
    readonly_fields = ('ticket_id', 'customer', 'customer_number') # Customer fields are set via portfolio

    # Method to display portfolio name
    @admin.display(description='Portfolio', ordering='portfolio__name')
    def portfolio_name(self, obj):
        return obj.portfolio.name if obj.portfolio else None
    # portfolio_name.short_description = 'Portfolio' # Set via @admin.display
    # portfolio_name.admin_order_field = 'portfolio__name' # Set via @admin.display

    # Method to display security CUSIP
    @admin.display(description='CUSIP', ordering='security__cusip')
    def security_cusip(self, obj):
        return obj.security.cusip if obj.security else None
    # security_cusip.short_description = 'CUSIP' # Set via @admin.display
    # security_cusip.admin_order_field = 'security__cusip' # Set via @admin.display

    # Method to display customer number (from the redundant field)
    @admin.display(description='Customer No.', ordering='customer_number')
    def customer_number(self, obj):
        # Display the potentially redundant customer number stored on the holding
        return obj.customer_number
    # customer_number.short_description = 'Customer Number' # Set via @admin.display
    # customer_number.admin_order_field = 'customer__customer_number' # Set via @admin.display

