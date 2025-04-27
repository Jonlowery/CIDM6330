# api/portfolio/serializers.py (Revised Create Method)

from rest_framework import serializers
# Import models using relative path within the app
from .models import Customer, Security, Portfolio, CustomerHolding
# Import Decimal types for accurate calculations
from decimal import Decimal, InvalidOperation

# Setup logging
import logging
log = logging.getLogger(__name__)

class CustomerSerializer(serializers.ModelSerializer):
    """ Serializer for Customer model, used for nesting and lookups. """
    class Meta:
        model = Customer
        # Fields included in the serialized output
        fields = ['id', 'customer_number', 'name']

class SecuritySerializer(serializers.ModelSerializer):
    """ Serializer for Security model. """
    class Meta:
        model = Security
        # Fields included in the serialized output
        fields = [
            'id', 'cusip', 'description', 'issue_date', 'maturity_date',
            'call_date', 'coupon', 'wal', 'payment_frequency', 'day_count', 'factor',
        ]
        # 'id' is typically read-only as it's assigned by the database
        read_only_fields = ['id']

class CustomerHoldingSerializer(serializers.ModelSerializer):
    """ Serializer for CustomerHolding model, including calculated/derived fields. """
    # Provide read-only representations of related fields for easy display
    security_cusip = serializers.SlugRelatedField(source='security', slug_field='cusip', read_only=True)
    customer_number = serializers.CharField(source='customer.customer_number', read_only=True)
    par = serializers.SerializerMethodField() # Calculated field
    maturity_date = serializers.DateField(source='security.maturity_date', read_only=True)
    # Ensure DecimalFields match model definition (max_digits, decimal_places)
    wal = serializers.DecimalField(source='security.wal', max_digits=5, decimal_places=3, read_only=True)
    coupon = serializers.DecimalField(source='security.coupon', max_digits=5, decimal_places=3, read_only=True)
    call_date = serializers.DateField(source='security.call_date', read_only=True)
    description = serializers.CharField(source='security.description', read_only=True)

    # Allow writing to foreign keys using PrimaryKeyRelatedField during create/update
    portfolio = serializers.PrimaryKeyRelatedField(queryset=Portfolio.objects.all())
    security = serializers.PrimaryKeyRelatedField(queryset=Security.objects.all())
    # Customer is automatically set in the view's perform_create based on portfolio owner
    # Making it read_only here prevents accidental direct setting via API
    customer = serializers.PrimaryKeyRelatedField(read_only=True)


    class Meta:
        model = CustomerHolding
        # Define fields included in the API representation
        fields = [
            'id',
            'ticket_id',
            'customer',             # Read-only PK (set in view)
            'customer_number',      # Read-only derived field
            'portfolio',            # Writable PK field (user selects portfolio)
            'security',             # Writable PK field (user selects security)
            'security_cusip',       # Read-only derived field
            'original_face_amount', # Writable field
            'settlement_date',      # Writable field
            'settlement_price',     # Writable field
            'book_price',           # Writable field
            'book_yield',           # Writable field
            'par',                  # Read-only method field
            'maturity_date',        # Read-only derived field
            'wal',                  # Read-only derived field
            'coupon',               # Read-only derived field
            'call_date',            # Read-only derived field
            'description',          # Read-only derived field
        ]
        # Fields that cannot be set directly via the API during creation/update
        read_only_fields = [
            'id', 'ticket_id', 'customer', 'customer_number', 'security_cusip',
            'par', 'maturity_date', 'wal', 'coupon', 'call_date', 'description',
        ]

    def get_par(self, obj):
        """ Calculate current par value based on original face and security factor. """
        # Check if necessary objects and values exist
        if obj.security and obj.original_face_amount is not None:
            try:
                # Get the factor from the related security, default to 1.0 if null
                factor = obj.security.factor if obj.security.factor is not None else Decimal('1.0')
                # Ensure the factor is a Decimal type for accurate calculations
                if not isinstance(factor, Decimal):
                     # Attempt conversion if factor is not Decimal (e.g., float from DB)
                     factor = Decimal(str(factor))
                # Perform calculation using Decimals
                par_value = obj.original_face_amount * factor
                # Round to 2 decimal places standard for currency/par value
                # Using quantize for proper decimal rounding
                return par_value.quantize(Decimal('0.01'))
            except (InvalidOperation, TypeError, ValueError) as e:
                 # Log error if calculation fails
                 log.error(f"Error calculating par for holding {obj.id} (Face: {obj.original_face_amount}, Factor: {obj.security.factor}): {e}", exc_info=True)
                 return None # Return None or appropriate default on error
        return None # Return None if required data is missing

# --- Updated PortfolioSerializer ---
class PortfolioSerializer(serializers.ModelSerializer):
    # Display owner details using nested serializer (read-only)
    owner = CustomerSerializer(read_only=True)
    # Display holdings using nested serializer (read-only for list/detail view)
    holdings = CustomerHoldingSerializer(many=True, read_only=True)

    # --- Fields specifically for Portfolio Creation ---
    # Field for ADMINS to specify owner by customer number
    customer_number_input = serializers.CharField(
        write_only=True, required=False, allow_null=True, allow_blank=True,
        help_text="Admin Only: Specify the customer_number for the new portfolio's owner."
    )
    # Field for NON-ADMINS (with multiple customers) to specify owner by customer ID
    # Using PrimaryKeyRelatedField handles validation and conversion to Customer instance
    owner_customer_id = serializers.PrimaryKeyRelatedField(
        queryset=Customer.objects.all(), # Base queryset for validation
        source='owner',         # On write, map this input to the 'owner' model field
        write_only=True,        # Not included in response representation
        required=False,         # Required only conditionally (checked in validate)
        allow_null=True,        # Allow null initially
        help_text="Non-Admin (Multi-Customer) Only: Specify the ID of the customer to own this portfolio."
    )
    # --- NEW FIELD ---
    # Field to accept list of existing holding IDs to copy
    initial_holding_ids = serializers.ListField(
        child=serializers.IntegerField(), # Expects a list of integers
        required=False,                   # Optional field
        write_only=True,                  # Not included in response
        help_text="Optional list of existing holding IDs to copy into the new portfolio."
    )

    class Meta:
        model = Portfolio
        fields = [
            'id', 'owner', 'name', 'created_at', 'holdings',
            'customer_number_input', 'owner_customer_id',
            'initial_holding_ids', # Include new field
        ]
        read_only_fields = ['id', 'created_at', 'holdings']

    def validate(self, data):
        """
        Custom validation for portfolio CREATION.
        Validates owner assignment and the optional 'initial_holding_ids'.
        """
        request = self.context.get('request')
        if not request or not hasattr(request, 'user'):
             raise serializers.ValidationError("Validation Error: Request context is missing user information.")

        user = request.user
        # Skip this validation during updates
        if self.instance is not None:
             return data

        # --- Determine the intended owner ---
        intended_owner = None
        is_admin = user.is_staff or user.is_superuser
        customer_number = data.get('customer_number_input')
        # 'owner' field is populated if owner_customer_id was valid
        owner_instance_from_input = data.get('owner')

        log.debug(f"PortfolioSerializer validate (Create): User={user.username}, Admin={is_admin}, customer_number_input={customer_number}, owner_instance_from_input={owner_instance_from_input}")

        if is_admin:
            # Admin validation (as before)
            if owner_instance_from_input is not None:
                raise serializers.ValidationError({'owner_customer_id': "Admin must use 'customer_number_input', not 'owner_customer_id'."})
            if not customer_number:
                 raise serializers.ValidationError({'customer_number_input': "Admin must provide a customer number."})
            try:
                # Find the intended owner based on the admin's input
                intended_owner = Customer.objects.get(customer_number=customer_number)
                # Store intended owner in context for create method (alternative to passing via save)
                self.context['_intended_owner'] = intended_owner
            except Customer.DoesNotExist:
                 raise serializers.ValidationError({'customer_number_input': f"Customer with number '{customer_number}' not found."})
        else:
            # Non-admin validation (as before)
            if customer_number is not None:
                 raise serializers.ValidationError({'customer_number_input': "Non-admin users cannot specify 'customer_number_input'."})

            customer_count = user.customers.count()
            if customer_count == 0:
                 raise serializers.ValidationError("User is not associated with any customers.")
            elif customer_count == 1:
                 if owner_instance_from_input is not None:
                      raise serializers.ValidationError({'owner_customer_id': "Cannot specify owner ID when associated with only one customer."})
                 # Intended owner is the user's single associated customer
                 intended_owner = user.customers.first()
                 self.context['_intended_owner'] = intended_owner
            else: # Multi-customer non-admin
                 if owner_instance_from_input is None:
                      raise serializers.ValidationError({'owner_customer_id': "Must specify a valid owner customer ID when associated with multiple customers."})
                 if not user.customers.filter(id=owner_instance_from_input.id).exists():
                      raise serializers.ValidationError({'owner_customer_id': f"Invalid or inaccessible customer ID ({owner_instance_from_input.id}) provided."})
                 # Intended owner is the one specified and validated
                 intended_owner = owner_instance_from_input
                 # No need to store in context, as 'owner' is already in data

        # --- Validate initial_holding_ids (if provided) ---
        initial_ids = data.get('initial_holding_ids')
        if initial_ids:
            if not intended_owner:
                # This check ensures owner is determined before validating holdings
                # It relies on the logic above correctly setting intended_owner
                # or raising an error if it can't be determined.
                log.error("Cannot validate initial_holding_ids because intended owner could not be determined.")
                raise serializers.ValidationError("Internal error: Could not determine portfolio owner for holding validation.")

            # Check if all provided IDs exist and belong to the intended owner
            valid_holdings = CustomerHolding.objects.filter(
                id__in=initial_ids,
                portfolio__owner=intended_owner # Crucial check
            )
            valid_ids_set = set(valid_holdings.values_list('id', flat=True))
            provided_ids_set = set(initial_ids)

            invalid_ids = provided_ids_set - valid_ids_set
            if invalid_ids:
                log.warning(f"User {user.username} provided invalid/inaccessible initial_holding_ids: {invalid_ids} for owner {intended_owner.id}")
                raise serializers.ValidationError({
                    'initial_holding_ids': f"Invalid or inaccessible holding IDs provided: {list(invalid_ids)}. Holdings must belong to the target portfolio owner."
                })
            log.debug(f"Validated initial_holding_ids: {initial_ids} for owner {intended_owner.id}")

        return data

    # --- REVISED create method ---
    def create(self, validated_data):
        """
        Override create to explicitly handle owner assignment and remove write-only fields.
        """
        # Remove purely informational write-only fields
        validated_data.pop('customer_number_input', None)
        validated_data.pop('initial_holding_ids', None) # Holding copy logic is in the view

        # Determine the owner instance. It should either be in validated_data['owner']
        # (set by owner_customer_id field for multi-customer non-admins)
        # or stored in context by the validate method for admins/single-customer users.
        owner = validated_data.pop('owner', None) # Get owner if set by owner_customer_id
        if owner is None:
            # If not set by owner_customer_id, get it from context (set in validate)
            owner = self.context.pop('_intended_owner', None)

        if not owner:
            # If owner is still None, something went wrong in validation or context passing
            log.error("PortfolioSerializer create: Owner instance could not be determined.")
            raise serializers.ValidationError("Internal error: Failed to determine portfolio owner.")

        # Add the determined owner instance directly to the data for model creation
        validated_data['owner'] = owner

        log.debug(f"PortfolioSerializer create - final validated_data before Model.create: {validated_data}")

        try:
            # Directly create the Portfolio instance using the model manager
            # This bypasses super().create() which might have complex M2M handling we don't need here
            instance = Portfolio.objects.create(**validated_data)
            return instance
        except TypeError as e:
            log.error(f"TypeError during Portfolio.objects.create: {e}. Data: {validated_data}", exc_info=True)
            raise serializers.ValidationError(f"Internal error during portfolio creation: {e}") from e
        except Exception as e:
            log.error(f"Unexpected error during Portfolio.objects.create: {e}. Data: {validated_data}", exc_info=True)
            raise serializers.ValidationError(f"An unexpected error occurred: {e}") from e


class ExcelUploadSerializer(serializers.Serializer):
    """ Serializer for the file upload endpoint in ImportExcelView. """
    file = serializers.FileField()
