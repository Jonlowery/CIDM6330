# portfolio/models.py (Added MunicipalOffering model)

import uuid
from django.conf import settings
from django.db import models
from django.utils import timezone

class Customer(models.Model):
    """ Represents a customer entity, potentially linked to system users and a salesperson. """
    unique_id = models.UUIDField(
        default=uuid.uuid4,
        editable=False,
        unique=True,
        help_text="Internal unique identifier."
    )
    customer_number = models.CharField(
        max_length=20,
        unique=True,
        null=True,
        blank=True,
        help_text="External unique customer number (e.g., from Excel import)"
    )
    users = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        related_name='customers',
        blank=True,
        help_text="System users allowed to view/manage this customer's data"
    )
    name = models.CharField(max_length=150, blank=True)
    address = models.CharField(max_length=255, blank=True)
    city = models.CharField(max_length=100, blank=True)
    state = models.CharField(max_length=2, blank=True)
    zip_code = models.CharField(max_length=10, blank=True)

    # --- SALESPERSON FIELDS ---
    salesperson_name = models.CharField(
        max_length=150,
        blank=True,
        null=True,
        help_text="Name of the salesperson assigned to this customer."
    )
    salesperson_email = models.EmailField(
        max_length=254, # Standard max length for emails
        blank=True,
        null=True,
        help_text="Email address of the assigned salesperson for notifications."
    )
    # -----------------------------

    def __str__(self):
        name_display = self.name or "Unnamed Customer"
        number_display = self.customer_number or "No Number"
        return f"{name_display} ({number_display})"

class Security(models.Model):
    """ Represents a financial security (e.g., a bond). """
    cusip = models.CharField(max_length=9, unique=True, help_text="Unique 9-character CUSIP identifier")
    description = models.CharField(max_length=200, blank=True)
    issue_date = models.DateField(null=True, blank=True)
    maturity_date = models.DateField(null=True, blank=True)
    call_date = models.DateField(blank=True, null=True, help_text="Optional call date")
    coupon = models.DecimalField(max_digits=8, decimal_places=5, null=True, blank=True, help_text="Annual coupon rate (e.g., 5.125)")
    wal = models.DecimalField(max_digits=5, decimal_places=3, null=True, blank=True, help_text="Weighted Average Life")

    PAYMENT_FREQ_CHOICES = [
        (1, "Annual"), (2, "Semiannual"), (4, "Quarterly"), (12, "Monthly"),
    ]
    payment_frequency = models.IntegerField(choices=PAYMENT_FREQ_CHOICES, default=2, help_text="Coupon payments per year")

    DAY_COUNT_CHOICES = [
        ("30/360", "30/360"), ("ACT/360", "Actual/360"), ("ACT/365", "Actual/365"),
    ]
    day_count = models.CharField(max_length=10, choices=DAY_COUNT_CHOICES, default="30/360", help_text="Day-count convention")

    factor = models.DecimalField(max_digits=12, decimal_places=8, default=1.0, help_text="Current paydown factor")

    def __str__(self):
        return f"{self.description or 'No Description'} ({self.cusip})"

class Portfolio(models.Model):
    """ Represents a portfolio of holdings belonging to a customer. """
    owner = models.ForeignKey(
        Customer,
        on_delete=models.CASCADE,
        related_name='portfolios',
        help_text="The customer who owns this portfolio"
    )
    name = models.CharField(max_length=100, help_text="User-defined name for the portfolio")
    created_at = models.DateTimeField(default=timezone.now, editable=False)
    # Removed 'securities' M2M as holdings define the link
    # securities = models.ManyToManyField(
    #     Security,
    #     through='CustomerHolding',
    #     related_name='portfolios'
    # )
    is_default = models.BooleanField(
        default=False,
        help_text="Indicates if this is the default 'Primary Holdings' portfolio for the owner."
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['owner', 'is_default'],
                condition=models.Q(is_default=True),
                name='unique_default_portfolio_per_owner'
            )
        ]

    def __str__(self):
        default_marker = "[DEFAULT]" if self.is_default else ""
        return f"{self.name} {default_marker} (Owner: {self.owner.customer_number or 'N/A'})"


class CustomerHolding(models.Model):
    """ Represents a specific holding of a security within a customer's portfolio. """
    ticket_id = models.UUIDField(
        default=uuid.uuid4, editable=False, unique=True,
        help_text="Unique internal identifier for this holding record",
    )
    # Removed redundant customer fields - link is via portfolio.owner
    # customer = models.ForeignKey(
    #     Customer, on_delete=models.CASCADE, related_name='holdings',
    #     null=True, blank=True,
    #     help_text="The customer associated with this holding (should match portfolio owner)"
    # )
    # customer_number = models.CharField(
    #     max_length=20, help_text="External customer number (should match portfolio owner's number)",
    #     null=True, blank=True
    # )
    portfolio = models.ForeignKey(
        Portfolio, on_delete=models.CASCADE, related_name='holdings',
        help_text="The portfolio this holding belongs to"
    )
    security = models.ForeignKey(
        Security, on_delete=models.CASCADE, related_name='holdings',
        help_text="The security being held"
    )

    original_face_amount = models.DecimalField(
        max_digits=15, decimal_places=2, null=True, blank=True,
        help_text="Original face value of the holding at purchase/acquisition"
    )
    settlement_date = models.DateField(null=True, blank=True, help_text="Date the holding settled")
    settlement_price = models.DecimalField(max_digits=12, decimal_places=6, null=True, blank=True, help_text="Price at which the holding settled")
    book_price = models.DecimalField(max_digits=12, decimal_places=6, null=True, blank=True, help_text="Book value price of the holding")
    book_yield = models.DecimalField(max_digits=8, decimal_places=5, null=True, blank=True, help_text="Book yield of the holding")

    # Removed redundant fields copied from Security - fetch dynamically via security relation
    # wal = models.DecimalField(max_digits=5, decimal_places=3, null=True, blank=True, help_text="WAL at time of snapshot/copy")
    # coupon = models.DecimalField(max_digits=8, decimal_places=5, null=True, blank=True, help_text="Coupon at time of snapshot/copy")
    # call_date = models.DateField(null=True, blank=True, help_text="Call date at time of snapshot/copy")
    # maturity_date = models.DateField(null=True, blank=True, help_text="Maturity date at time of snapshot/copy")
    # description = models.CharField(max_length=200, null=True, blank=True, help_text="Description at time of snapshot/copy")

    class Meta:
        constraints = [
            # Ensure a security is only held once per portfolio
            models.UniqueConstraint(fields=['portfolio', 'security'], name='unique_security_per_portfolio')
        ]
        ordering = ['portfolio', 'security__cusip'] # Default ordering

    def __str__(self):
        face_display = f"{self.original_face_amount:,.2f}" if self.original_face_amount is not None else "N/A Face"
        cusip_display = self.security.cusip if self.security else "No CUSIP"
        portfolio_name = self.portfolio.name if self.portfolio else "No Portfolio"
        return f"Holding {self.ticket_id} — {cusip_display} ({face_display}) in Portfolio '{portfolio_name}'"


# --- NEW MODEL for Municipal Offerings ---
class MunicipalOffering(models.Model):
    """ Represents a municipal bond offering available for purchase. """
    cusip = models.CharField(
        max_length=9,
        unique=True, # Assuming CUSIP uniquely identifies an offering
        help_text="Unique 9-character CUSIP identifier for the offering."
    )
    amount = models.DecimalField(
        max_digits=15, decimal_places=2, null=True, blank=True,
        help_text="Amount of the offering available (e.g., par value)."
    )
    description = models.CharField(
        max_length=255, blank=True,
        help_text="Description of the bond offering."
    )
    coupon = models.DecimalField(
        max_digits=8, decimal_places=5, null=True, blank=True,
        help_text="Annual coupon rate of the bond."
    )
    maturity_date = models.DateField(
        null=True, blank=True,
        help_text="Maturity date of the bond."
    )
    yield_rate = models.DecimalField( # Using yield_rate to avoid keyword conflict
        max_digits=8, decimal_places=5, null=True, blank=True,
        help_text="Yield of the offering."
    )
    price = models.DecimalField(
        max_digits=12, decimal_places=6, null=True, blank=True,
        help_text="Price of the offering."
    )
    moody_rating = models.CharField(
        max_length=10, blank=True, null=True,
        help_text="Moody's credit rating."
    )
    sp_rating = models.CharField( # Standard & Poor's Rating
        max_length=10, blank=True, null=True,
        help_text="S&P credit rating."
    )
    call_date = models.DateField(
        null=True, blank=True,
        help_text="Optional call date for the bond."
    )
    call_price = models.DecimalField(
        max_digits=12, decimal_places=6, null=True, blank=True,
        help_text="Optional call price for the bond."
    )
    state = models.CharField(
        max_length=2, blank=True, null=True,
        help_text="State associated with the bond offering (e.g., issuer state)."
    )
    insurance = models.CharField(
        max_length=50, blank=True, null=True,
        help_text="Bond insurer, if any."
    )
    last_updated = models.DateTimeField(
        auto_now=True, # Automatically set to now on save
        help_text="Timestamp when this offering record was last updated by the import."
    )

    class Meta:
        verbose_name = "Municipal Offering"
        verbose_name_plural = "Municipal Offerings"
        ordering = ['maturity_date', 'cusip'] # Default ordering

    def __str__(self):
        return f"Offering: {self.cusip} - {self.description or 'No Description'}"

