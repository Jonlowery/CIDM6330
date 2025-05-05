# portfolio/serializers.py (Add CPR field to SecuritySerializer)

from rest_framework import serializers
# Import models using relative path within the app
from .models import (
    Customer, Security, Portfolio, CustomerHolding, MunicipalOffering,
    Salesperson, SecurityType, InterestSchedule # Import new models
)
# Import Decimal types for accurate calculations
from decimal import Decimal, InvalidOperation

# Setup logging
import logging
log = logging.getLogger(__name__)

# --- NEW Serializers for New Models ---

class SalespersonSerializer(serializers.ModelSerializer):
    """ Serializer for the Salesperson model. """
    class Meta:
        model = Salesperson
        fields = [
            'salesperson_id', 'name', 'email', 'is_active',
            'created_at', 'last_modified_at'
        ]
        read_only_fields = ['created_at', 'last_modified_at']

class SecurityTypeSerializer(serializers.ModelSerializer):
    """ Serializer for the SecurityType model. """
    class Meta:
        model = SecurityType
        fields = [
            'type_id', 'name', 'description',
            'created_at', 'last_modified_at'
        ]
        read_only_fields = ['created_at', 'last_modified_at']

class InterestScheduleSerializer(serializers.ModelSerializer):
    """ Serializer for the InterestSchedule model. """
    class Meta:
        model = InterestSchedule
        fields = [
            'schedule_code', 'name', 'payments_per_year_default', 'description',
            'created_at', 'last_modified_at'
        ]
        read_only_fields = ['created_at', 'last_modified_at']


# --- UPDATED Serializers for Existing Models ---

class CustomerSerializer(serializers.ModelSerializer):
    """ Serializer for Customer model, reflecting new fields and relationships. """
    # Use nested serializer for read-only display of salesperson
    salesperson = SalespersonSerializer(read_only=True)
    # Allow writing salesperson via its primary key (salesperson_id)
    salesperson_id_input = serializers.CharField(
        # source='salesperson', # Source mapping handled in validation/create now
        write_only=True,
        required=False, # Allow unassigning or assigning later
        allow_null=True,
        allow_blank=True, # Allow empty string input for unassigning
        help_text="ID of the salesperson to assign. Send null or empty string to unassign."
    )

    class Meta:
        model = Customer
        fields = [
            'id', # Use default 'id' field unless unique_id is explicitly needed
            'customer_number', # Now IntegerField
            'name', # Required
            'address', 'city', 'state', # Removed 'zip_code'
            'users', # ManyToMany relationship (usually handled separately or read-only)
            'salesperson', # Read-only nested representation
            'salesperson_id_input', # Write-only field for setting salesperson FK
            'portfolio_accounting_code', # New required CharField
            'cost_of_funds_rate', # New optional DecimalField
            'federal_tax_bracket_rate', # New optional DecimalField
            'created_at', 'last_modified_at', # Audit fields
        ]
        # Read-only fields cannot be set via the API directly
        read_only_fields = [
            'id', 'salesperson', 'created_at', 'last_modified_at', 'users'
        ]
        # Extra kwargs to ensure required model fields are required by serializer
        extra_kwargs = {
            'name': {'required': True},
            'city': {'required': True},
            'state': {'required': True},
            'portfolio_accounting_code': {'required': True},
            # customer_number is unique=True, DRF handles this implicitly if it's not read-only
        }

    def validate_salesperson_id_input(self, value):
        """ Validate the provided salesperson_id exists and return the instance. """
        if value is None or value == '':
            return None # Allow unassigning
        try:
            # Check if a Salesperson with this ID exists
            salesperson = Salesperson.objects.get(salesperson_id=value)
            return salesperson # Return the instance
        except Salesperson.DoesNotExist:
            raise serializers.ValidationError(f"Salesperson with ID '{value}' not found.")
        except Exception as e:
             # Catch other potential errors during lookup
             log.error(f"Error validating salesperson_id_input '{value}': {e}", exc_info=True)
             raise serializers.ValidationError("An error occurred while validating the salesperson ID.")

    def create(self, validated_data):
        salesperson_instance = validated_data.pop('salesperson_id_input', None)
        customer = Customer.objects.create(**validated_data)
        if salesperson_instance:
            customer.salesperson = salesperson_instance
            customer.save()
        return customer

    def update(self, instance, validated_data):
        # Handle salesperson update separately if salesperson_id_input is provided
        if 'salesperson_id_input' in validated_data:
            salesperson_instance = validated_data.pop('salesperson_id_input')
            instance.salesperson = salesperson_instance

        # Update other fields as usual
        return super().update(instance, validated_data)


class SecuritySerializer(serializers.ModelSerializer):
    """ Serializer for Security model, reflecting new fields and relationships. """
    # Use nested serializers for read-only display of FK relationships
    security_type = SecurityTypeSerializer(read_only=True)
    interest_schedule = InterestScheduleSerializer(read_only=True)

    # Allow writing FKs via their primary keys using standard fields
    security_type_id_input = serializers.IntegerField(
        # source='security_type', # Handled in validation/create
        write_only=True, required=False, allow_null=True,
        help_text="ID (type_id) of the Security Type. Send null to unset."
    )
    interest_schedule_code_input = serializers.CharField(
        # source='interest_schedule', # Handled in validation/create
        write_only=True, required=False, allow_null=True, allow_blank=True,
        help_text="Code (schedule_code) of the Interest Schedule. Send null or empty string to unset."
    )
    # Ensure DecimalFields use string representation for precision
    # Important: Define these explicitly if you need string coercion,
    # otherwise they might default to float/number in JSON depending on settings.
    coupon = serializers.DecimalField(max_digits=12, decimal_places=8, coerce_to_string=True, allow_null=True)
    secondary_rate = serializers.DecimalField(max_digits=12, decimal_places=8, coerce_to_string=True, allow_null=True)
    factor = serializers.DecimalField(max_digits=18, decimal_places=10, coerce_to_string=True, allow_null=True) # Factor might be null if not applicable
    wal = serializers.DecimalField(max_digits=8, decimal_places=3, coerce_to_string=True, allow_null=True)
    # *** ADD CPR FIELD to serializer ***
    cpr = serializers.DecimalField(
        max_digits=8, decimal_places=5, coerce_to_string=True, allow_null=True, required=False
    )
    # ---------------------------------


    class Meta:
        model = Security
        fields = [
            # Core Identification
            'cusip', # Now PK
            'description', # Required
            # Dates
            'issue_date', # Required
            'maturity_date', # Required
            'call_date', # Optional
            # Type & Schedule (FKs)
            'security_type', # Read-only nested
            'security_type_id_input', # Write-only
            'interest_schedule', # Read-only nested
            'interest_schedule_code_input', # Write-only
            # Financial Terms
            'coupon', # Effective rate (now coerced to string)
            'secondary_rate', # Optional override rate (now coerced to string)
            'rate_effective_date', # Optional date for secondary rate
            'tax_code', # Required ('e' or 't')
            'interest_day', # Required (1-31)
            'interest_calc_code', # Required ('a', 'c', 'h')
            'payments_per_year', # Required
            'allows_paydown', # Required (True/False)
            'payment_delay_days', # Required (>=0)
            'factor', # Current factor (now coerced to string)
            'wal', # Weighted Average Life (optional, now coerced to string)
            # *** ADD CPR FIELD to list ***
            'cpr',
            # ---------------------------
            # Issuer & Other Details
            'issuer_name',
            'currency',
            'callable_flag', # Explicit boolean flag
            'moody_rating', 'sp_rating', 'fitch_rating', # Ratings
            'sector',
            'state_of_issuer',
            # Audit
            'created_at', 'last_modified_at',
        ]
        read_only_fields = [
            'security_type', 'interest_schedule', # Read-only nested representations
            'created_at', 'last_modified_at'
        ]
        # Ensure required model fields are required by serializer
        extra_kwargs = {
            'description': {'required': True},
            'issue_date': {'required': True},
            'maturity_date': {'required': True},
            'tax_code': {'required': True},
            'interest_day': {'required': True},
            'interest_calc_code': {'required': True},
            'payments_per_year': {'required': True},
            'allows_paydown': {'required': True}, # Boolean fields are implicitly required if not nullable/blankable
            'payment_delay_days': {'required': True},
            # Make write-only fields optional on update, required on create is handled elsewhere
            'security_type_id_input': {'required': False},
            'interest_schedule_code_input': {'required': False},
            # *** Add CPR extra_kwargs ***
            'cpr': {'required': False}, # Explicitly mark as not required by the serializer
        }

    def validate_security_type_id_input(self, value):
        """ Validate the provided security_type_id exists and return instance. """
        if value is None: return None
        try:
            return SecurityType.objects.get(type_id=value)
        except SecurityType.DoesNotExist:
            raise serializers.ValidationError(f"SecurityType with ID '{value}' not found.")
        except Exception as e:
             log.error(f"Error validating security_type_id_input '{value}': {e}", exc_info=True)
             raise serializers.ValidationError("An error occurred while validating the security type ID.")

    def validate_interest_schedule_code_input(self, value):
        """ Validate the provided interest_schedule_code exists and return instance. """
        if value is None or value == '': return None
        try:
            return InterestSchedule.objects.get(schedule_code=value)
        except InterestSchedule.DoesNotExist:
            raise serializers.ValidationError(f"InterestSchedule with code '{value}' not found.")
        except Exception as e:
             log.error(f"Error validating interest_schedule_code_input '{value}': {e}", exc_info=True)
             raise serializers.ValidationError("An error occurred while validating the interest schedule code.")

    def create(self, validated_data):
        sec_type_instance = validated_data.pop('security_type_id_input', None)
        int_sched_instance = validated_data.pop('interest_schedule_code_input', None)
        security = Security.objects.create(**validated_data)
        if sec_type_instance:
            security.security_type = sec_type_instance
        if int_sched_instance:
            security.interest_schedule = int_sched_instance
        if sec_type_instance or int_sched_instance:
            security.save()
        return security

    def update(self, instance, validated_data):
        if 'security_type_id_input' in validated_data:
            instance.security_type = validated_data.pop('security_type_id_input')
        if 'interest_schedule_code_input' in validated_data:
            instance.interest_schedule = validated_data.pop('interest_schedule_code_input')

        return super().update(instance, validated_data)


class CustomerHoldingSerializer(serializers.ModelSerializer):
    """
    Serializer for CustomerHolding model. Includes nested Security details.
    """
    # --- ADDED Nested Security Serializer ---
    # This will include the full Security object in the response.
    security = SecuritySerializer(read_only=True)
    # --- END Nested Security Serializer ---

    # Writable fields for relationships (used for input)
    portfolio_id_input = serializers.IntegerField(
        write_only=True,
        help_text="ID of the portfolio this holding belongs to."
    )
    security_cusip_input = serializers.CharField(
        max_length=9,
        write_only=True,
        help_text="CUSIP of the security being held."
    )

    # Read-only fields derived from related models for convenience (used for output)
    # Kept for potential backward compatibility or direct access needs
    security_cusip = serializers.CharField(source='security.cusip', read_only=True)
    security_description = serializers.CharField(source='security.description', read_only=True)
    customer_number = serializers.IntegerField(source='portfolio.owner.customer_number', read_only=True)
    portfolio_name = serializers.CharField(source='portfolio.name', read_only=True)
    portfolio_id = serializers.IntegerField(source='portfolio.id', read_only=True) # Expose portfolio ID for reference

    # Calculated field (Par Value)
    par_value = serializers.SerializerMethodField(help_text="Calculated current par value (original_face * factor).")

    # Ensure DecimalFields use string representation for precision
    original_face_amount = serializers.DecimalField(max_digits=40, decimal_places=8, coerce_to_string=True)
    settlement_price = serializers.DecimalField(max_digits=20, decimal_places=8, coerce_to_string=True)
    book_price = serializers.DecimalField(max_digits=20, decimal_places=8, coerce_to_string=True)
    book_yield = serializers.DecimalField(max_digits=20, decimal_places=8, coerce_to_string=True, allow_null=True)
    holding_duration = serializers.DecimalField(max_digits=20, decimal_places=8, coerce_to_string=True, allow_null=True)
    holding_average_life = serializers.DecimalField(max_digits=20, decimal_places=8, coerce_to_string=True, allow_null=True)
    market_price = serializers.DecimalField(max_digits=20, decimal_places=8, coerce_to_string=True, allow_null=True)
    market_yield = serializers.DecimalField(max_digits=20, decimal_places=8, coerce_to_string=True, allow_null=True)

    class Meta:
        model = CustomerHolding
        fields = [
            # IDs and Relationships (Output focused)
            'ticket_id', # Internal UUID PK
            'external_ticket', # Unique external integer ticket
            'portfolio_id', # Read-only ID of the portfolio
            'portfolio_name', # Read-only name
            'customer_number', # Read-only owner number

            # --- ADDED 'security' field for nested object ---
            'security', # The nested Security object

            # (Optional) Keep flattened fields if needed by frontend
            'security_cusip', # Read-only CUSIP (duplicate of security.cusip)
            'security_description', # Read-only description (duplicate of security.description)

            # Holding Specific Data from Excel
            'intention_code', # Required ('A', 'M', 'T')
            'original_face_amount', # Required
            'settlement_date', # Required
            'settlement_price', # Required
            'book_price', # Required
            'book_yield', # Optional
            'holding_duration', # Optional
            'holding_average_life', # Optional
            'holding_average_life_date', # Optional
            'market_date', # Optional
            'market_price', # Optional
            'market_yield', # Optional
            # Calculated Fields
            'par_value',
            # Audit
            'created_at', 'last_modified_at',
            # Write-only fields for input (Using standard field types now)
            'portfolio_id_input',
            'security_cusip_input',
        ]
        read_only_fields = [
            'ticket_id', # Internal PK is read-only
            'portfolio_id', 'portfolio_name', 'customer_number',
            'security', # Nested object is read-only
            'security_cusip', 'security_description', # Derived fields are read-only
            'par_value', # Calculated field
            'created_at', 'last_modified_at', # Audit fields
        ]
         # Ensure required model fields are required by serializer
        extra_kwargs = {
            'external_ticket': {'required': True},
            'intention_code': {'required': True},
            'original_face_amount': {'required': True},
            'settlement_date': {'required': True},
            'settlement_price': {'required': True},
            'book_price': {'required': True},
            # Make write-only fields required for creation
            'portfolio_id_input': {'required': True, 'write_only': True},
            'security_cusip_input': {'required': True, 'write_only': True},
        }

    def validate_portfolio_id_input(self, value):
        """Check that the portfolio exists."""
        try:
            return Portfolio.objects.get(pk=value)
        except Portfolio.DoesNotExist:
            raise serializers.ValidationError(f"Portfolio with ID {value} does not exist.")

    def validate_security_cusip_input(self, value):
        """Check that the security exists."""
        try:
            # Ensure CUSIP is uppercase for lookup
            return Security.objects.get(cusip=str(value).upper())
        except Security.DoesNotExist:
            raise serializers.ValidationError(f"Security with CUSIP {value} does not exist.")

    def create(self, validated_data):
        portfolio_instance = validated_data.pop('portfolio_id_input')
        security_instance = validated_data.pop('security_cusip_input')
        validated_data['portfolio'] = portfolio_instance
        validated_data['security'] = security_instance
        return CustomerHolding.objects.create(**validated_data)

    def update(self, instance, validated_data):
        # Handle relation updates if provided
        if 'portfolio_id_input' in validated_data:
            instance.portfolio = validated_data.pop('portfolio_id_input')
        if 'security_cusip_input' in validated_data:
            instance.security = validated_data.pop('security_cusip_input')

        # Update other fields as usual
        return super().update(instance, validated_data)


    def get_par_value(self, obj):
        """ Calculate current par value based on original face and security factor. """
        # Check if security object exists (it should now be nested)
        if obj.security and obj.original_face_amount is not None:
            try:
                # Ensure factor is Decimal, default to 1.0 if null/invalid
                factor = obj.security.factor
                # Coerce factor to Decimal if it's not already (e.g., if it's string from serializer)
                if factor is None:
                    factor = Decimal('1.0')
                elif not isinstance(factor, Decimal):
                     try:
                         factor = Decimal(str(factor))
                     except (InvalidOperation, TypeError, ValueError):
                         log.warning(f"Holding {obj.external_ticket}: Could not convert security factor '{obj.security.factor}' to Decimal. Using 1.0.")
                         factor = Decimal('1.0')

                par_value = obj.original_face_amount * factor
                # Quantize to 2 decimal places for typical currency representation
                return par_value.quantize(Decimal('0.01'))
            except (InvalidOperation, TypeError, ValueError) as e:
                 log.error(f"Error calculating par for holding {obj.ticket_id} (Ext: {obj.external_ticket}): {e}", exc_info=True)
                 return None
        return None

# --- Review/Update Other Existing Serializers ---

# PortfolioSerializer needs update due to Customer changes (customer_number is Int)
class PortfolioSerializer(serializers.ModelSerializer):
    # Read-only fields for displaying related data
    owner = CustomerSerializer(read_only=True) # Represents the owner in output
    # Holdings are now implicitly linked via CustomerHolding.portfolio FK
    # We can add a count or limited nested view if needed, but keeping simple for now.
    # holdings = CustomerHoldingSerializer(many=True, read_only=True) # Removed for simplicity, query separately if needed

    # Write-only fields for input during creation
    owner_id_input = serializers.IntegerField(
        # source='owner', # Handled in validation/create
        write_only=True, required=False, allow_null=True,
        help_text="ID of the customer who owns this portfolio."
    )
    initial_holding_ids = serializers.ListField(
        child=serializers.IntegerField(), # Assuming we copy based on external_ticket now? Or internal ticket_id?
        # Let's assume copying based on *external_ticket* as that's likely known from source data.
        required=False,
        write_only=True,
        help_text="Optional list of existing holding EXTERNAL TICKET numbers to copy into the new portfolio."
    )

    class Meta:
        model = Portfolio
        fields = [
            'id', 'owner', 'name', 'created_at', 'is_default',
            # Input fields (write-only)
            'owner_id_input',
            'initial_holding_ids',
        ]
        read_only_fields = ['id', 'created_at', 'owner', 'is_default'] # 'holdings' removed from fields

    def validate_owner_id_input(self, value):
        """Validate owner ID based on user permissions."""
        if value is None:
            # Allow None only if logic below handles assigning owner based on user
            return None

        request = self.context.get('request')
        user = request.user
        is_admin = user.is_staff or user.is_superuser

        try:
            intended_owner = Customer.objects.get(pk=value)
        except Customer.DoesNotExist:
            raise serializers.ValidationError(f"Customer with ID {value} not found.")

        # Check permissions
        if not is_admin and not user.customers.filter(pk=value).exists():
            raise serializers.ValidationError(f"You do not have permission to assign portfolios to customer ID {value}.")

        return intended_owner # Return the validated Customer instance


    def validate(self, data):
        """
        Custom validation for portfolio CREATION.
        Determines the intended owner based on user type and input fields.
        Validates initial holdings based on external_ticket.
        """
        # Only run this complex validation during CREATE
        if self.instance is not None:
            # Basic update validation (e.g., name not empty)
            if 'name' in data and not data.get('name'):
                 raise serializers.ValidationError({'name': 'Portfolio name cannot be empty.'})
            # Prevent changing owner or default status on update via this serializer
            if 'owner_id_input' in data:
                raise serializers.ValidationError("Cannot change portfolio owner during update.")
            if 'is_default' in data:
                 raise serializers.ValidationError("Cannot change default status via this endpoint.")
            return data

        # --- CREATE Validation ---
        request = self.context.get('request')
        user = request.user
        is_admin = user.is_staff or user.is_superuser
        log.debug(f"PortfolioSerializer validate (Create): User={user.username}, IsAdmin={is_admin}")

        intended_owner = data.get('owner_id_input') # This is now a Customer instance from validate_owner_id_input or None

        # Determine owner if not provided via input (non-admin case)
        if intended_owner is None:
            if is_admin:
                # Admin MUST provide owner_id_input if not updating
                raise serializers.ValidationError({'owner_id_input': "Admin must provide the owner customer ID."})
            else:
                # Non-admin: assign based on user association
                user_customers = user.customers.all()
                customer_count = user_customers.count()
                if customer_count == 0:
                    raise serializers.ValidationError("User is not associated with any customers.")
                elif customer_count == 1:
                    intended_owner = user_customers.first()
                    log.debug(f"PortfolioSerializer validate (Create/Non-Admin/Single): Auto-selected owner: ID {intended_owner.id}")
                else: # Multiple associated customers, owner_id_input is required
                    raise serializers.ValidationError({'owner_id_input': "Must specify a valid owner customer ID when associated with multiple customers."})

        # Add owner to data dict for use in create/perform_create
        data['owner'] = intended_owner # Assign the actual owner instance

        # Validate initial_holding_ids (external_ticket numbers)
        initial_tickets = data.get('initial_holding_ids')
        if initial_tickets:
            try: initial_tickets_int = [int(t) for t in initial_tickets]
            except (ValueError, TypeError): raise serializers.ValidationError({'initial_holding_ids': "All holding ticket numbers must be integers."})

            # Check if holdings with these external tickets exist FOR THE INTENDED OWNER
            valid_holdings = CustomerHolding.objects.filter(
                external_ticket__in=initial_tickets_int,
                portfolio__owner=intended_owner # IMPORTANT: Check ownership
            )
            valid_tickets_set = set(valid_holdings.values_list('external_ticket', flat=True))
            provided_tickets_set = set(initial_tickets_int)
            invalid_tickets = provided_tickets_set - valid_tickets_set
            if invalid_tickets:
                raise serializers.ValidationError({'initial_holding_ids': f"Invalid or inaccessible holding external ticket numbers for owner {intended_owner.id}: {list(invalid_tickets)}."})
            log.debug(f"PortfolioSerializer validate (Create): Validated initial_holding_ids (external tickets): {initial_tickets_int} for owner {intended_owner.id}")
            # Store the validated queryset for use in perform_create
            data['_holdings_to_copy_qs'] = valid_holdings

        # Validate portfolio name
        if not data.get('name'): raise serializers.ValidationError({'name': 'Portfolio name is required.'})
        log.debug(f"PortfolioSerializer validate (Create): Validation successful for user {user.username}.")
        return data

    # create method remains largely the same, just removes different write_only fields
    def create(self, validated_data):
        """ Handles the creation of a Portfolio instance. """
        log.debug(f"PortfolioSerializer create: Received validated_data: {validated_data}")
        # Owner instance is now directly in validated_data['owner'] from validate()
        validated_data.pop('owner_id_input', None) # Remove the input field if present
        validated_data.pop('initial_holding_ids', None)
        validated_data.pop('_holdings_to_copy_qs', None) # Remove temporary validation data

        if 'owner' not in validated_data: raise serializers.ValidationError("Internal error: Owner information missing during create.")
        validated_data['is_default'] = False # Ensure new portfolios are not default

        log.debug(f"PortfolioSerializer create: Calling Portfolio.objects.create with cleaned data: {validated_data}")
        try:
            instance = Portfolio.objects.create(**validated_data)
            log.info(f"PortfolioSerializer create: Successfully created Portfolio ID {instance.id}")
            return instance
        except Exception as e:
            log.error(f"PortfolioSerializer create: Error during Portfolio.objects.create: {e}. Data: {validated_data}", exc_info=True)
            raise serializers.ValidationError(f"An unexpected error occurred: {e}") from e


# ExcelUploadSerializer remains the same
class ExcelUploadSerializer(serializers.Serializer):
    file = serializers.FileField()

# SelectedBondSerializer (for SELL interest) remains the same
class SelectedBondSerializer(serializers.Serializer):
    cusip = serializers.CharField(max_length=9, required=True, allow_blank=False)
    par = serializers.CharField(required=True, allow_blank=False)
    def validate_par(self, value):
        try: Decimal(value); return value
        except InvalidOperation: raise serializers.ValidationError("Invalid par amount format.")

# SalespersonInterestSerializer (for SELL interest) remains the same
class SalespersonInterestSerializer(serializers.Serializer):
    customer_id = serializers.IntegerField(required=True) # Still using internal Customer ID
    selected_bonds = serializers.ListField(child=SelectedBondSerializer(), allow_empty=False, required=True)
    def validate_customer_id(self, value):
        try: Customer.objects.get(id=value); return value
        except Customer.DoesNotExist: raise serializers.ValidationError(f"Customer with ID {value} not found.")


# MunicipalOfferingSerializer remains largely the same, but review fields vs Security
class MunicipalOfferingSerializer(serializers.ModelSerializer):
    # Ensure DecimalFields use string representation
    amount = serializers.DecimalField(max_digits=15, decimal_places=2, coerce_to_string=True, allow_null=True)
    coupon = serializers.DecimalField(max_digits=8, decimal_places=5, coerce_to_string=True, allow_null=True)
    yield_rate = serializers.DecimalField(max_digits=8, decimal_places=5, coerce_to_string=True, allow_null=True)
    price = serializers.DecimalField(max_digits=12, decimal_places=6, coerce_to_string=True, allow_null=True)
    call_price = serializers.DecimalField(max_digits=12, decimal_places=6, coerce_to_string=True, allow_null=True)

    class Meta:
        model = MunicipalOffering
        # Consider adding fields from Security if they should be consistent (e.g., sector, state_of_issuer?)
        fields = [
            'id', 'cusip', 'amount', 'description', 'coupon', 'maturity_date',
            'yield_rate', 'price', 'moody_rating', 'sp_rating', 'call_date',
            'call_price', 'state', 'insurance', 'last_updated',
        ]
        read_only_fields = fields # Offerings are typically read-only via API

# SelectedOfferingSerializer (for BUY interest) remains the same
class SelectedOfferingSerializer(serializers.Serializer):
    cusip = serializers.CharField(max_length=9, required=True, allow_blank=False)
    description = serializers.CharField(required=True, allow_blank=False)

# MuniBuyInterestSerializer (for BUY interest) remains the same
class MuniBuyInterestSerializer(serializers.Serializer):
    customer_id = serializers.IntegerField(required=True) # Still using internal Customer ID
    selected_offerings = serializers.ListField(child=SelectedOfferingSerializer(), allow_empty=False, required=True)
    def validate_customer_id(self, value):
        try: Customer.objects.get(id=value); return value
        except Customer.DoesNotExist: raise serializers.ValidationError(f"Customer with ID {value} not found.")


# --- NEW Serializer for Portfolio Simulation ---

class HoldingToRemoveSerializer(serializers.Serializer):
    """ Defines the identifier for a holding to be removed in simulation. """
    # Using external_ticket as it's the main identifier from imports
    external_ticket = serializers.IntegerField(required=True)

class SecurityToAddSerializer(serializers.Serializer):
    """ Defines a security and its face amount to be added in simulation. """
    cusip = serializers.CharField(max_length=9, required=True)
    # Face amount is required to calculate portfolio metrics
    original_face_amount = serializers.DecimalField(
        max_digits=40, decimal_places=8, required=True, coerce_to_string=True
    )

    def validate_original_face_amount(self, value):
        """ Ensure face amount is positive. """
        if value <= 0:
            raise serializers.ValidationError("Face amount must be positive.")
        return value

class PortfolioSimulationSerializer(serializers.Serializer):
    """
    Serializer for validating the input for the portfolio simulation endpoint.
    """
    holdings_to_remove = HoldingToRemoveSerializer(many=True, required=False, default=[])
    securities_to_add = SecurityToAddSerializer(many=True, required=False, default=[])

    def validate(self, data):
        """ Ensure at least one action (add or remove) is specified. """
        if not data.get('holdings_to_remove') and not data.get('securities_to_add'):
            raise serializers.ValidationError("Must specify at least one holding to remove or security to add.")
        return data
