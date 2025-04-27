# portfolio/models.py

import uuid
from django.conf import settings
from django.db import models
from django.utils import timezone

class Customer(models.Model):
    unique_id = models.UUIDField(
        default=uuid.uuid4,
        editable=False,
        unique=True
    )
    # External customer number from Excel
    customer_number = models.CharField(
        max_length=20,
        unique=True,
        null=True,
        blank=True,
        help_text="External unique customer number from Excel"
    )
    # Users associated with this customer
    users = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        related_name='customers',
        blank=True,
        help_text="Users allowed to see this customer's data"
    )
    name = models.CharField(max_length=150)
    address = models.CharField(max_length=255)
    city = models.CharField(max_length=100)
    state = models.CharField(max_length=2)
    zip_code = models.CharField(max_length=10)

    def __str__(self):
        return f"{self.name} ({self.customer_number})"


class Security(models.Model):
    cusip = models.CharField(max_length=9, unique=True)
    description = models.CharField(max_length=200)
    issue_date = models.DateField()
    maturity_date = models.DateField()
    call_date = models.DateField(blank=True, null=True)
    coupon = models.DecimalField(max_digits=5, decimal_places=3)
    wal = models.DecimalField(max_digits=5, decimal_places=3)

    PAYMENT_FREQ_CHOICES = [
        (1, "Annual"),
        (2, "Semiannual"),
        (4, "Quarterly"),
        (12, "Monthly"),
    ]
    payment_frequency = models.IntegerField(
        choices=PAYMENT_FREQ_CHOICES,
        default=2,
        help_text="Coupon payments per year"
    )

    DAY_COUNT_CHOICES = [
        ("30/360", "30/360"),
        ("ACT/360", "Actual/360"),
        ("ACT/365", "Actual/365"),
    ]
    day_count = models.CharField(
        max_length=7,
        choices=DAY_COUNT_CHOICES,
        default="30/360",
        help_text="Day-count convention"
    )

    factor = models.DecimalField(
        max_digits=12,
        decimal_places=8,
        default=1.0,
        help_text="Paydown factor (0–1)"
    )

    def __str__(self):
        return f"{self.description} ({self.cusip})"


class Portfolio(models.Model):
    owner = models.ForeignKey(
        Customer,
        on_delete=models.CASCADE,
        related_name='portfolios'
    )
    name = models.CharField(max_length=100)
    created_at = models.DateTimeField(default=timezone.now)
    securities = models.ManyToManyField(
        Security,
        through='CustomerHolding',
        related_name='portfolios'
    )

    def __str__(self):
        return f"{self.name} (Owner: {self.owner.customer_number})"


class CustomerHolding(models.Model):
    ticket_id = models.UUIDField(
        default=uuid.uuid4,
        editable=False,
        unique=True,
        help_text="Unique ticket identifier",
        null=True,
        blank=True
    )
    customer = models.ForeignKey(
        Customer,
        on_delete=models.CASCADE,
        related_name='holdings',
        null=True,
        blank=True
    )
    # Mirror the external customer number for lookup
    customer_number = models.CharField(
        max_length=20,
        help_text="External customer number for lookup",
        null=True,
        blank=True
    )
    portfolio = models.ForeignKey(
        Portfolio,
        on_delete=models.CASCADE,
        related_name='holdings'
    )
    security = models.ForeignKey(
        Security,
        on_delete=models.CASCADE,
        related_name='holdings'
    )

    original_face_amount = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        null=True,
        blank=True
    )
    settlement_date = models.DateField(
        null=True,
        blank=True
    )
    settlement_price = models.DecimalField(
        max_digits=12,
        decimal_places=4,
        null=True,
        blank=True
    )
    book_price = models.DecimalField(
        max_digits=12,
        decimal_places=4,
        null=True,
        blank=True
    )
    book_yield = models.DecimalField(
        max_digits=5,
        decimal_places=3,
        null=True,
        blank=True
    )
    wal = models.DecimalField(
        max_digits=5,
        decimal_places=3,
        null=True,
        blank=True
    )
    coupon = models.DecimalField(
        max_digits=5,
        decimal_places=3,
        null=True,
        blank=True
    )
    call_date = models.DateField(
        null=True,
        blank=True
    )
    maturity_date = models.DateField(
        null=True,
        blank=True
    )
    description = models.CharField(
        max_length=200,
        null=True,
        blank=True
    )

    def __str__(self):
        return f"Ticket {self.ticket_id} — {self.security.cusip} ({self.original_face_amount})"
