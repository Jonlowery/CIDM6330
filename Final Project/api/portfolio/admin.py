from django.contrib import admin
from .models import Customer, Security, Portfolio, CustomerHolding

@admin.register(Customer)
class CustomerAdmin(admin.ModelAdmin):
    list_display = ('name', 'customer_number', 'unique_id') # Added customer_number
    search_fields = ('name', 'customer_number') # Added customer_number
    # Use filter_horizontal for a better ManyToMany widget for users
    filter_horizontal = ('users',)
    list_filter = ('state',) # Example filter

@admin.register(Security)
class SecurityAdmin(admin.ModelAdmin):
    list_display = ('cusip', 'description', 'issue_date', 'maturity_date', 'coupon', 'wal') # Added coupon, wal
    search_fields = ('cusip', 'description') # Added search
    list_filter = ('day_count', 'payment_frequency')

@admin.register(Portfolio)
class PortfolioAdmin(admin.ModelAdmin):
    list_display = ('name', 'owner_customer_number', 'created_at') # Changed owner display
    search_fields = ('name', 'owner__name', 'owner__customer_number') # Allow searching by owner info
    list_filter = ('owner',) # Filter by owner
    raw_id_fields = ('owner',) # Keep raw_id for performance if many customers

    # Method to display owner's customer number in list_display
    def owner_customer_number(self, obj):
        return obj.owner.customer_number
    owner_customer_number.short_description = 'Customer Number' # Column header
    owner_customer_number.admin_order_field = 'owner__customer_number' # Allow sorting


@admin.register(CustomerHolding)
class CustomerHoldingAdmin(admin.ModelAdmin):
    list_display = (
        'ticket_id',
        'portfolio_name', # Custom display field
        'security_cusip', # Custom display field
        'original_face_amount',
        'customer_number' # Custom display field
    )
    search_fields = (
        'ticket_id',
        'portfolio__name',
        'security__cusip',
        'security__description',
        'customer__customer_number',
        'customer__name'
    )
    list_filter = ('portfolio__owner', 'portfolio') # Filter by customer (via portfolio) or portfolio
    raw_id_fields = ('portfolio', 'security', 'customer') # Keep raw_id fields

    # Method to display portfolio name
    def portfolio_name(self, obj):
        return obj.portfolio.name
    portfolio_name.short_description = 'Portfolio'
    portfolio_name.admin_order_field = 'portfolio__name'

    # Method to display security CUSIP
    def security_cusip(self, obj):
        return obj.security.cusip
    security_cusip.short_description = 'CUSIP'
    security_cusip.admin_order_field = 'security__cusip'

    # Method to display customer number
    def customer_number(self, obj):
        # Handle case where customer might be null temporarily if data is inconsistent
        return obj.customer.customer_number if obj.customer else 'N/A'
    customer_number.short_description = 'Customer Number'
    customer_number.admin_order_field = 'customer__customer_number'


