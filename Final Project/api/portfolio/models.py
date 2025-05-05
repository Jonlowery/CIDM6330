# portfolio/models.py (Remove Email Uniqueness from Salesperson)

import uuid
from django.conf import settings
from django.db import models
from django.utils import timezone
# Import validators for specific field constraints
from django.core.validators import MaxValueValidator, MinValueValidator, MinLengthValidator

# --- NEW MODELS ---

class Salesperson(models.Model):
    """
    Represents a salesperson who can be assigned to customers.
    Intended to be populated/managed via admin interface initially.
    """
    # Using a CharField for ID as per Excel `slsm_id`
    salesperson_id = models.CharField(
        max_length=50,
        unique=True,
        primary_key=True, # Using the source system ID as the primary key
        help_text="Unique identifier for the salesperson (from source system/Excel 'slsm_id')."
    )
    name = models.CharField(
        max_length=150,
        blank=True,
        null=True,
        help_text="Full name of the salesperson."
    )
    email = models.EmailField(
        max_length=254,
        blank=True,
        null=True,
        # unique=True, # *** REMOVED: Allow duplicate emails ***
        help_text="Email address of the salesperson. Duplicates are allowed." # Updated help text
    )
    # Add other relevant salesperson fields if needed (e.g., phone, team)
    is_active = models.BooleanField(
        default=True,
        help_text="Is this salesperson currently active?"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    last_modified_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        """ String representation for the Salesperson model. """
        name_display = self.name or "Unnamed Salesperson"
        return f"{name_display} ({self.salesperson_id})"

    class Meta:
        ordering = ['name', 'salesperson_id']
        verbose_name = "Salesperson"
        verbose_name_plural = "Salespeople"

class SecurityType(models.Model):
    """
    Represents the type of a security (e.g., Municipal Bond, Corporate Bond).
    Intended to be populated/managed via admin interface initially.
    """
    # Using Integer primary key as per Excel `sec_type`
    type_id = models.IntegerField(
        unique=True,
        primary_key=True, # Using the source system ID as the primary key
        help_text="Integer identifier for the security type (from source system/Excel 'sec_type')."
    )
    # *** REMOVED unique=True from name field ***
    name = models.CharField(
        max_length=100,
        # unique=True, # Removed constraint
        help_text="Descriptive name of the security type (e.g., 'Municipal Bond - GO'). Name does NOT need to be unique."
    )
    description = models.TextField(
        blank=True,
        null=True,
        help_text="Optional longer description of the security type."
    )
    # Add category/grouping fields if needed later
    created_at = models.DateTimeField(auto_now_add=True)
    last_modified_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        """ String representation for the SecurityType model. """
        # Provide a default name if none is set, although 'name' is required unique
        name_display = self.name or f"Type ID {self.type_id}"
        return f"{name_display} ({self.type_id})"

    class Meta:
        ordering = ['type_id']
        verbose_name = "Security Type"
        verbose_name_plural = "Security Types"

class InterestSchedule(models.Model):
    """
    Represents an interest payment schedule type (e.g., Semiannual, Monthly).
    Intended to be populated/managed via admin interface initially.
    """
    # Using CharField based on Excel `int_sched` being text
    schedule_code = models.CharField(
        max_length=20, # Adjust length as needed
        unique=True,
        primary_key=True, # Using the source system code as the primary key
        help_text="Unique code for the interest schedule (from source system/Excel 'int_sched')."
    )
    # *** REMOVED unique=True from name field ***
    name = models.CharField(
        max_length=100,
        # unique=True, # Removed constraint
        help_text="Descriptive name (e.g., 'Semiannual', 'Monthly'). Name does NOT need to be unique."
    )
    payments_per_year_default = models.PositiveSmallIntegerField(
        null=True,
        blank=True,
        help_text="Typical number of payments per year for this schedule (can be overridden on Security)."
    )
    description = models.TextField(
        blank=True,
        null=True,
        help_text="Optional longer description of the schedule."
    )
    created_at = models.DateTimeField(auto_now_add=True)
    last_modified_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        """ String representation for the InterestSchedule model. """
        name_display = self.name or f"Schedule {self.schedule_code}"
        return f"{name_display} ({self.schedule_code})"

    class Meta:
        ordering = ['schedule_code']
        verbose_name = "Interest Payment Schedule"
        verbose_name_plural = "Interest Payment Schedules"


# --- UPDATED MODELS ---

class Customer(models.Model):
    """ Represents a customer entity, potentially linked to system users and a salesperson. """
    unique_id = models.UUIDField( # Keep internal UUID for potential future use
        default=uuid.uuid4,
        editable=False,
        unique=True,
        help_text="Internal unique identifier (UUID)."
    )
    # Changed customer_number to IntegerField as requested
    customer_number = models.IntegerField(
        unique=True,
        db_index=True, # Add index for faster lookups
        help_text="External unique customer number (from Excel 'cust_num'). Primary external key."
    )
    users = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        related_name='customers',
        blank=True,
        help_text="System users allowed to view/manage this customer's data."
    )
    # Map 'cust_na1' to 'name'
    name = models.CharField(
        max_length=150, # Consider increasing if 'cust_na1' can be longer
        help_text="Customer name (from Excel 'cust_na1'). Required.",
        # Making name required as it's essential for identification
        blank=False, null=False
    )
    # Keep existing address fields, map city/state from Excel
    address = models.CharField(max_length=255, blank=True, null=True) # Optional field
    city = models.CharField(
        max_length=100,
        help_text="City (from Excel 'city'). Required.",
        # Making city required
        blank=False, null=False
    )
    state = models.CharField(
        max_length=2,
        validators=[MinLengthValidator(2)], # Ensure 2 chars
        help_text="Two-letter US state abbreviation (from Excel 'state'). Required.",
        # Making state required
        blank=False, null=False
    )
    # Removed zip_code field

    # --- UPDATED Salesperson Link ---
    # Removed old salesperson_name/email fields
    salesperson = models.ForeignKey(
        Salesperson,
        on_delete=models.SET_NULL, # Keep customer if salesperson deleted, set FK to NULL
        null=True, # Allow customer to have no salesperson initially
        blank=True,
        related_name='assigned_customers',
        help_text="Salesperson assigned to this customer (linked via Excel 'slsm_id')."
    )
    # -----------------------------

    # --- NEW FIELDS from Excel ---
    # Map 'ip_bnk'
    portfolio_accounting_code = models.CharField(
        max_length=50, # Adjust length as needed
        help_text="Internal code signifying portfolio accounting (from Excel 'ip_bnk'). Required.",
        # Making this required as specified
        blank=False, null=False
    )
    # Map 'cost_funds'
    cost_of_funds_rate = models.DecimalField(
        max_digits=11, # 3 before decimal + 8 after = 11 total
        decimal_places=8,
        null=True, blank=True, # Optional field
        help_text="Cost of funds rate as a percentage (from Excel 'cost_funds'). E.g., 1.23456789 for 1.23456789%"
    )
    # Map 'fed_tax_bkt'
    federal_tax_bracket_rate = models.DecimalField(
        max_digits=11, # 3 before decimal + 8 after = 11 total
        decimal_places=8,
        null=True, blank=True, # Optional field
        help_text="Federal tax bracket rate as a percentage (from Excel 'fed_tax_bkt'). E.g., 35.12345678 for 35.12345678%"
    )
    # -----------------------------

    # --- Existing Audit/Internal Fields ---
    created_at = models.DateTimeField(auto_now_add=True)
    last_modified_at = models.DateTimeField(auto_now=True)
    # -----------------------------

    def __str__(self):
        """ String representation for the Customer model. """
        # Name is now required, so no need for "Unnamed Customer" fallback
        return f"{self.name} ({self.customer_number})"

    class Meta:
        ordering = ['customer_number']


class Security(models.Model):
    """ Represents a financial security (e.g., a bond). """
    # Keep CUSIP as the primary identifier in the DB, maps to Excel 'sec_id'
    cusip = models.CharField(
        max_length=9,
        unique=True,
        primary_key=True, # Using CUSIP as the primary key
        validators=[MinLengthValidator(9)], # Ensure exactly 9 chars if needed
        help_text="Unique 9-character CUSIP identifier (maps to Excel 'sec_id')."
    )
    # Map 'sec_desc_1' to 'description'
    description = models.CharField(
        max_length=200, # Consider increasing if 'sec_desc_1' can be longer
        help_text="Security description (from Excel 'sec_desc_1'). Required.",
        # Making description required
        blank=False, null=False
    )
    # Map 'issue_dt' and 'mat_dt'
    issue_date = models.DateField(
        help_text="Issue date (from Excel 'issue_dt'). Required.",
        # Making issue_date required
        blank=False, null=False
    )
    maturity_date = models.DateField(
        help_text="Maturity date (from Excel 'mat_dt'). Required.",
        # Making maturity_date required
        blank=False, null=False
    )

    # --- UPDATED/NEW Fields from Excel ---
    # Map 'sec_type'
    security_type = models.ForeignKey(
        SecurityType,
        on_delete=models.SET_NULL, # Keep security if type deleted, set FK to NULL
        null=True, # Allow null initially until admin sets it up
        blank=True,
        related_name='securities',
        help_text="Type of the security (linked via Excel 'sec_type')."
    )
    # Store effective rate in 'coupon' field (calculated from 'rate'/'secrate_rate')
    coupon = models.DecimalField(
        max_digits=12, # e.g., 100.12345678 requires 4+8=12 digits
        decimal_places=8, # Increased precision
        null=True, blank=True, # Rate might be zero or not applicable
        help_text="Effective annual coupon rate (calculated from Excel 'rate'/'secrate_rate')."
    )
    # Add field to store the secondary rate if provided (from 'secrate_rate')
    secondary_rate = models.DecimalField(
        max_digits=12, decimal_places=8,
        null=True, blank=True, # Optional field
        help_text="Secondary/override rate (from Excel 'secrate_rate')."
    )
    # Add field for the date associated with the secondary rate (from 'rate_dt')
    rate_effective_date = models.DateField(
        null=True, blank=True, # Optional field
        help_text="Date associated with the secondary rate (from Excel 'rate_dt')."
    )
    # Map 'tax_cd'
    tax_code = models.CharField(
        max_length=1,
        choices=[('e', 'Exempt'), ('t', 'Taxable')],
        help_text="Tax status code (from Excel 'tax_cd'). 'e' or 't'. Required.",
        # Making tax_code required
        blank=False, null=False
    )
    # Map 'int_sched'
    interest_schedule = models.ForeignKey(
        InterestSchedule,
        on_delete=models.SET_NULL, # Keep security if schedule deleted, set FK to NULL
        null=True, # Allow null initially until admin sets it up
        blank=True,
        related_name='securities',
        help_text="Interest payment schedule (linked via Excel 'int_sched')."
    )
    # Map 'int_day'
    interest_day = models.PositiveSmallIntegerField(
        validators=[MinValueValidator(1), MaxValueValidator(31)],
        help_text="Day of the month interest is typically paid (from Excel 'int_day'). Required.",
        # Making interest_day required
        blank=False, null=False
    )
    # Map 'int_calc_cd'
    interest_calc_code = models.CharField(
        max_length=1,
        choices=[('a', 'Actual'), ('c', '30/360'), ('h', 'Actual/365')], # Example choices, adjust as needed
        help_text="Interest calculation code (from Excel 'int_calc_cd'). 'a', 'c', or 'h'. Required.",
        # Making interest_calc_code required
        blank=False, null=False
    )
    # Map 'ppy'
    payments_per_year = models.PositiveSmallIntegerField(
        help_text="Number of coupon payments per year (from Excel 'ppy'). Required.",
        # Making payments_per_year required
        blank=False, null=False
    )
    # Map 'prin_paydown' to 'allows_paydown'
    allows_paydown = models.BooleanField(
        default=False,
        help_text="Does the principal pay down over time? (Derived from Excel 'prin_paydown' 'y'/'n'). Required.",
        # Making allows_paydown required (must be explicitly y or n)
        # The default=False handles cases where the column might be missing,
        # but import logic should ensure it's set based on 'y'/'n'.
        # Consider removing default if import guarantees presence.
    )
    # Map 'pmt_delay'
    payment_delay_days = models.PositiveSmallIntegerField(
        default=0,
        help_text="Delay in days between accrual end and payment date (from Excel 'pmt_delay'). Required.",
        # Making payment_delay_days required (non-negative)
        blank=False, null=False
    )
    # Keep existing factor field, logic handled during import based on allows_paydown
    factor = models.DecimalField(
        max_digits=18, # e.g., 1.1234567890 requires 1+10=11, allow more for safety
        decimal_places=10, # Allow high precision for factors
        default=1.0,
        help_text="Current principal paydown factor (from Excel 'factor', adjusted based on 'allows_paydown')."
    )
    # -----------------------------

    # --- Existing Fields (Review/Confirm Usage) ---
    call_date = models.DateField(blank=True, null=True, help_text="Optional first call date.")
    wal = models.DecimalField(max_digits=8, decimal_places=3, null=True, blank=True, help_text="Weighted Average Life (consider recalculating).")
    # Removed old payment_frequency, day_count

    # --- Fields Moved/Added from MunicipalOffering/Other ---
    # (Assuming these apply generally, not just Munis)
    issuer_name = models.CharField(max_length=200, blank=True, null=True)
    currency = models.CharField(max_length=3, default='USD', blank=True, null=True)
    callable_flag = models.BooleanField(default=False, help_text="Is the security callable? (Set based on call_date presence?).")
    moody_rating = models.CharField(max_length=10, blank=True, null=True)
    sp_rating = models.CharField(max_length=10, blank=True, null=True)
    fitch_rating = models.CharField(max_length=10, blank=True, null=True)
    sector = models.CharField(max_length=100, blank=True, null=True)
    state_of_issuer = models.CharField(max_length=2, blank=True, null=True, validators=[MinLengthValidator(2)])
    # -----------------------------

    # --- Audit/Internal Fields ---
    created_at = models.DateTimeField(auto_now_add=True)
    last_modified_at = models.DateTimeField(auto_now=True)
    # -----------------------------

    def __str__(self):
        """ String representation for the Security model. """
        # Description is now required
        return f"{self.description} ({self.cusip})"

    class Meta:
        ordering = ['cusip']


class Portfolio(models.Model):
    """ Represents a portfolio of holdings belonging to a customer. (No changes in this step) """
    owner = models.ForeignKey(
        Customer,
        on_delete=models.CASCADE, # If customer is deleted, delete their portfolios
        related_name='portfolios',
        help_text="The customer who owns this portfolio."
    )
    name = models.CharField(
        max_length=100,
        help_text="User-defined name for the portfolio."
    )
    created_at = models.DateTimeField(
        default=timezone.now,
        editable=False
    )
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
        ordering = ['owner__customer_number', 'name']

    def __str__(self):
        """ String representation for the Portfolio model. """
        default_marker = "[DEFAULT]" if self.is_default else ""
        owner_display = self.owner.customer_number if self.owner else "N/A"
        return f"{self.name} {default_marker} (Owner: {owner_display})"


class CustomerHolding(models.Model):
    """ Represents a specific holding of a security within a customer's portfolio. """
    # Keep internal UUID as primary key for stable internal references
    ticket_id = models.UUIDField(
        default=uuid.uuid4,
        editable=False,
        unique=True,
        primary_key=True,
        help_text="Unique internal identifier (UUID) for this holding record.",
    )
    # Add external ticket number from Excel, ensure it's unique
    external_ticket = models.IntegerField(
        unique=True,
        db_index=True, # Index for faster lookups if needed
        help_text="Unique external ticket number (from Excel 'ticket')."
    )
    portfolio = models.ForeignKey(
        Portfolio,
        on_delete=models.CASCADE, # If portfolio is deleted, delete its holdings
        related_name='holdings',
        help_text="The portfolio this holding belongs to."
    )
    security = models.ForeignKey(
        Security,
        on_delete=models.CASCADE, # If security is deleted, delete holdings (consider PROTECT?)
        related_name='holdings',
        help_text="The security being held (linked via Excel 'sec_id' -> CUSIP)."
    )

    # --- UPDATED/NEW Fields from Excel ---
    # Map 'lc_xf1_cd'
    intention_code = models.CharField(
        max_length=1,
        choices=[('A', 'Available for Sale'), ('M', 'Held to Maturity'), ('T', 'Held for Trading')],
        help_text="Holding intention code (from Excel 'lc_xf1_cd'). Required.",
        # Making intention_code required
        blank=False, null=False
    )
    # Update precision for existing fields, map from Excel
    original_face_amount = models.DecimalField(
        max_digits=40, # As requested
        decimal_places=8,
        help_text="Original face value of the holding (from Excel 'orig_face'). Required.",
        # Making original_face_amount required (non-negative handled by validator/clean logic)
        blank=False, null=False
    )
    settlement_date = models.DateField(
        help_text="Date the holding settled (from Excel 'settle_dt'). Required.",
        # Making settlement_date required
        blank=False, null=False
    )
    settlement_price = models.DecimalField(
        max_digits=20, # 12 before decimal + 8 after = 20 total
        decimal_places=8,
        help_text="Price at which the holding settled (from Excel 'set_price'). Required.",
        # Making settlement_price required (non-negative handled by validator/clean logic)
        blank=False, null=False
    )
    book_price = models.DecimalField(
        max_digits=20, # 12 before decimal + 8 after = 20 total
        decimal_places=8,
        help_text="Book value price of the holding (from Excel 'book_price'). Required.",
        # Making book_price required (non-negative handled by validator/clean logic)
        blank=False, null=False
    )
    book_yield = models.DecimalField(
        max_digits=20, # 12 before decimal + 8 after = 20 total
        decimal_places=8,
        null=True, blank=True, # Yield might not always be present/calculable
        help_text="Book yield of the holding (from Excel 'book_yield')."
    )
    # Add new fields, map from Excel
    holding_duration = models.DecimalField(
        max_digits=20, # 12 before decimal + 8 after = 20 total
        decimal_places=8,
        null=True, blank=True, # Allow null as it might be calculated later or not provided
        help_text="Calculated duration of the holding at a point in time (from Excel 'hold_duration')."
    )
    holding_average_life = models.DecimalField(
        max_digits=20, # 12 before decimal + 8 after = 20 total
        decimal_places=8,
        null=True, blank=True, # Allow null
        help_text="Calculated average life of the holding at a point in time (from Excel 'hold_avg_life')."
    )
    holding_average_life_date = models.DateField(
        null=True, blank=True, # Optional field
        help_text="Date corresponding to the average life calculation (from Excel 'hold_avg_life_dt')."
    )
    market_date = models.DateField(
        null=True, blank=True, # Optional field
        help_text="Date of the market valuation (from Excel 'mkt_dt')."
    )
    market_price = models.DecimalField(
        max_digits=20, # 12 before decimal + 8 after = 20 total
        decimal_places=8,
        null=True, blank=True, # Optional field
        help_text="Market price on the market date (from Excel 'mkt_price')."
    )
    market_yield = models.DecimalField(
        max_digits=20, # 12 before decimal + 8 after = 20 total
        decimal_places=8,
        null=True, blank=True, # Optional field
        help_text="Market yield on the market date (from Excel 'mkt_yield')."
    )
    # -----------------------------

    # --- Audit/Internal Fields ---
    created_at = models.DateTimeField(auto_now_add=True)
    last_modified_at = models.DateTimeField(auto_now=True)
    # -----------------------------

    class Meta:
        # *** REMOVED the conflicting unique constraint ***
        # constraints = [
        #     models.UniqueConstraint(fields=['portfolio', 'security'], name='unique_security_per_portfolio')
        # ]
        # Add index on external_ticket for faster lookups if needed, although unique=True implies an index
        indexes = [
            models.Index(fields=['external_ticket']),
            models.Index(fields=['portfolio', 'security']), # Keep index for querying efficiency
        ]
        ordering = ['portfolio', 'security__cusip'] # Default ordering

    def __str__(self):
        """ String representation for the CustomerHolding model. """
        face_display = f"{self.original_face_amount:,.2f}" if self.original_face_amount is not None else "N/A Face"
        cusip_display = self.security.cusip if self.security else "No CUSIP"
        portfolio_name = self.portfolio.name if self.portfolio else "No Portfolio"
        # Show external ticket number primarily
        ticket_display = self.external_ticket if self.external_ticket is not None else self.ticket_id
        return f"Holding {ticket_display} — {cusip_display} ({face_display}) in Portfolio '{portfolio_name}'"


# --- MunicipalOffering Model (No changes requested in this step) ---
# Review if any fields added to Security should also be added here for consistency
# e.g., security_type, issuer_name, sector, state_of_issuer, ratings?
# For now, leaving it as is.
class MunicipalOffering(models.Model):
    """ Represents a municipal bond offering available for purchase. """
    cusip = models.CharField(max_length=9, unique=True, help_text="Unique 9-character CUSIP identifier.")
    amount = models.DecimalField(max_digits=15, decimal_places=2, null=True, blank=True, help_text="Amount available.")
    description = models.CharField(max_length=255, blank=True, help_text="Description.")
    coupon = models.DecimalField(max_digits=8, decimal_places=5, null=True, blank=True, help_text="Coupon rate.")
    maturity_date = models.DateField(null=True, blank=True, help_text="Maturity date.")
    yield_rate = models.DecimalField(max_digits=8, decimal_places=5, null=True, blank=True, help_text="Yield.")
    price = models.DecimalField(max_digits=12, decimal_places=6, null=True, blank=True, help_text="Price.")
    moody_rating = models.CharField(max_length=10, blank=True, null=True, help_text="Moody's rating.")
    sp_rating = models.CharField(max_length=10, blank=True, null=True, help_text="S&P rating.")
    call_date = models.DateField(null=True, blank=True, help_text="Call date.")
    call_price = models.DecimalField(max_digits=12, decimal_places=6, null=True, blank=True, help_text="Call price.")
    state = models.CharField(max_length=2, blank=True, null=True, help_text="State.")
    insurance = models.CharField(max_length=50, blank=True, null=True, help_text="Insurance.")
    last_updated = models.DateTimeField(auto_now=True, help_text="Last updated timestamp.")

    class Meta:
        verbose_name = "Municipal Offering"
        verbose_name_plural = "Municipal Offerings"
        ordering = ['maturity_date', 'cusip']

    def __str__(self):
        """ String representation for the MunicipalOffering model. """
        return f"Offering: {self.cusip} - {self.description or 'No Description'}"
