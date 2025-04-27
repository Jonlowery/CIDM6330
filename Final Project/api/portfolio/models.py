# portfolio/models.py (Added is_default flag to Portfolio)

import uuid
from django.conf import settings
from django.db import models
from django.utils import timezone

class Customer(models.Model):
    """ Represents a customer entity, potentially linked to system users. """
    unique_id = models.UUIDField(
        default=uuid.uuid4,
        editable=False,
        unique=True,
        help_text="Internal unique identifier."
    )
    # External customer number from Excel, used as a primary business key
    customer_number = models.CharField(
        max_length=20,
        unique=True, # Ensures no duplicate customer numbers
        null=True,   # Allow null if not provided initially
        blank=True,  # Allow blank in forms/admin
        help_text="External unique customer number (e.g., from Excel import)"
    )
    # Link to Django's User model for authentication/authorization
    users = models.ManyToManyField(
        settings.AUTH_USER_MODEL, # Use the configured auth user model
        related_name='customers', # Allows user.customers.all() lookup
        blank=True, # Users can exist without being linked to a customer initially
        help_text="System users allowed to view/manage this customer's data"
    )
    # Basic customer information fields
    name = models.CharField(max_length=150, blank=True) # Name might not always be present
    address = models.CharField(max_length=255, blank=True)
    city = models.CharField(max_length=100, blank=True)
    state = models.CharField(max_length=2, blank=True) # Assuming 2-letter state codes
    zip_code = models.CharField(max_length=10, blank=True)

    def __str__(self):
        # String representation for admin display, etc.
        name_display = self.name or "Unnamed Customer"
        number_display = self.customer_number or "No Number"
        return f"{name_display} ({number_display})"

class Security(models.Model):
    """ Represents a financial security (e.g., a bond). """
    cusip = models.CharField(max_length=9, unique=True, help_text="Unique 9-character CUSIP identifier")
    description = models.CharField(max_length=200, blank=True)
    issue_date = models.DateField(null=True, blank=True) # Allow null dates if data is incomplete
    maturity_date = models.DateField(null=True, blank=True)
    call_date = models.DateField(blank=True, null=True, help_text="Optional call date")
    # Use DecimalField for financial values to avoid floating-point inaccuracies
    coupon = models.DecimalField(max_digits=8, decimal_places=5, null=True, blank=True, help_text="Annual coupon rate (e.g., 5.125)")
    wal = models.DecimalField(max_digits=5, decimal_places=3, null=True, blank=True, help_text="Weighted Average Life")

    # Choices for payment frequency
    PAYMENT_FREQ_CHOICES = [
        (1, "Annual"),
        (2, "Semiannual"),
        (4, "Quarterly"),
        (12, "Monthly"),
    ]
    payment_frequency = models.IntegerField(
        choices=PAYMENT_FREQ_CHOICES,
        default=2, # Default to Semiannual
        help_text="Coupon payments per year"
    )

    # Choices for day count convention
    DAY_COUNT_CHOICES = [
        ("30/360", "30/360"),
        ("ACT/360", "Actual/360"),
        ("ACT/365", "Actual/365"),
        # Add others if needed
    ]
    day_count = models.CharField(
        max_length=10, # Increased length slightly for flexibility
        choices=DAY_COUNT_CHOICES,
        default="30/360",
        help_text="Day-count convention used for interest calculation"
    )

    # Paydown factor for amortizing securities
    factor = models.DecimalField(
        max_digits=12, # Allow sufficient precision
        decimal_places=8,
        default=1.0, # Default for non-amortizing securities
        help_text="Current paydown factor (e.g., 1.0 for non-amortizing, <1 for amortizing)"
    )

    def __str__(self):
        # String representation for admin display, etc.
        return f"{self.description or 'No Description'} ({self.cusip})"

class Portfolio(models.Model):
    """ Represents a portfolio of holdings belonging to a customer. """
    owner = models.ForeignKey(
        Customer,
        on_delete=models.CASCADE, # If customer is deleted, delete their portfolios
        related_name='portfolios', # Allows customer.portfolios.all() lookup
        help_text="The customer who owns this portfolio"
    )
    name = models.CharField(max_length=100, help_text="User-defined name for the portfolio")
    created_at = models.DateTimeField(default=timezone.now, editable=False)
    # ManyToMany relationship to Securities through the CustomerHolding model
    securities = models.ManyToManyField(
        Security,
        through='CustomerHolding', # Specifies the intermediate model
        related_name='portfolios' # Allows security.portfolios.all() lookup
    )
    # --- NEW FIELD ---
    # Flag to indicate if this is the default portfolio created automatically
    is_default = models.BooleanField(
        default=False, # New portfolios created via API/manually are NOT default
        help_text="Indicates if this is the default 'Primary Holdings' portfolio for the owner."
    )

    class Meta:
        # Optional: Add constraint to ensure only one default portfolio per owner
        # This prevents accidentally marking multiple portfolios as default for the same customer.
        constraints = [
            models.UniqueConstraint(
                fields=['owner', 'is_default'],
                condition=models.Q(is_default=True), # Constraint only applies when is_default=True
                name='unique_default_portfolio_per_owner'
            )
        ]

    def __str__(self):
        # String representation for admin display, etc.
        default_marker = "[DEFAULT]" if self.is_default else ""
        return f"{self.name} {default_marker} (Owner: {self.owner.customer_number or 'N/A'})"


class CustomerHolding(models.Model):
    """ Represents a specific holding of a security within a customer's portfolio. """
    # Unique identifier for the holding record itself
    ticket_id = models.UUIDField(
        default=uuid.uuid4,
        editable=False,
        unique=True,
        help_text="Unique internal identifier for this holding record",
    )
    # Link to the customer (redundant but potentially useful for direct queries)
    # Ensure consistency with portfolio.owner
    customer = models.ForeignKey(
        Customer,
        on_delete=models.CASCADE, # If customer is deleted, delete their holdings
        related_name='holdings', # Allows customer.holdings.all() lookup
        null=True, # Allow null temporarily if needed, but should always be set
        blank=True,
        help_text="The customer associated with this holding (should match portfolio owner)"
    )
    # Mirror the external customer number for potential lookups/reporting
    customer_number = models.CharField(
        max_length=20,
        help_text="External customer number (should match portfolio owner's number)",
        null=True,
        blank=True
    )
    # Link to the specific portfolio this holding belongs to
    portfolio = models.ForeignKey(
        Portfolio,
        on_delete=models.CASCADE, # If portfolio is deleted, delete its holdings
        related_name='holdings', # Allows portfolio.holdings.all() lookup
        help_text="The portfolio this holding belongs to"
    )
    # Link to the specific security being held
    security = models.ForeignKey(
        Security,
        on_delete=models.CASCADE, # If security is deleted, delete holdings (consider PROTECT?)
        related_name='holdings', # Allows security.holdings.all() lookup
        help_text="The security being held"
    )

    # Financial details of the specific holding
    original_face_amount = models.DecimalField(
        max_digits=15, # Increased precision for larger face amounts
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Original face value of the holding at purchase/acquisition"
    )
    settlement_date = models.DateField(
        null=True,
        blank=True,
        help_text="Date the holding settled"
    )
    settlement_price = models.DecimalField(
        max_digits=12,
        decimal_places=6, # Increased precision for price
        null=True,
        blank=True,
        help_text="Price at which the holding settled"
    )
    book_price = models.DecimalField(
        max_digits=12,
        decimal_places=6, # Increased precision for price
        null=True,
        blank=True,
        help_text="Book value price of the holding"
    )
    book_yield = models.DecimalField(
        max_digits=8, # Increased precision for yield
        decimal_places=5,
        null=True,
        blank=True,
        help_text="Book yield of the holding"
    )
    # --- Redundant fields copied from Security for snapshot/performance ---
    # These might become out of sync if the Security record changes.
    # Consider if they are truly needed or if fetching from Security is better.
    # If kept, ensure they are updated when Security changes or when copied.
    wal = models.DecimalField(max_digits=5, decimal_places=3, null=True, blank=True, help_text="WAL at time of snapshot/copy")
    coupon = models.DecimalField(max_digits=8, decimal_places=5, null=True, blank=True, help_text="Coupon at time of snapshot/copy")
    call_date = models.DateField(null=True, blank=True, help_text="Call date at time of snapshot/copy")
    maturity_date = models.DateField(null=True, blank=True, help_text="Maturity date at time of snapshot/copy")
    description = models.CharField(max_length=200, null=True, blank=True, help_text="Description at time of snapshot/copy")

    class Meta:
        # Optional: Add constraint to ensure a security is only held once per portfolio
        constraints = [
            models.UniqueConstraint(fields=['portfolio', 'security'], name='unique_security_per_portfolio')
        ]

    def __str__(self):
        # String representation for admin display, etc.
        face_display = f"{self.original_face_amount:,.2f}" if self.original_face_amount is not None else "N/A Face"
        cusip_display = self.security.cusip if self.security else "No CUSIP"
        return f"Holding {self.id} — {cusip_display} ({face_display}) in Portfolio {self.portfolio_id}"

