# api/portfolio/serializers.py (Define create method to clean validated_data)

from rest_framework import serializers
# Import models using relative path within the app
from .models import Customer, Security, Portfolio, CustomerHolding, MunicipalOffering # Import new model
# Import Decimal types for accurate calculations
from decimal import Decimal, InvalidOperation

# Setup logging
import logging
log = logging.getLogger(__name__)

# --- Existing Serializers ---

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
    # Use source='portfolio.owner.customer_number' to get the number from the actual owner
    customer_number = serializers.CharField(source='portfolio.owner.customer_number', read_only=True)
    par = serializers.SerializerMethodField() # Calculated field
    # Use source='security...' for fields derived from the Security model
    maturity_date = serializers.DateField(source='security.maturity_date', read_only=True)
    wal = serializers.DecimalField(source='security.wal', max_digits=5, decimal_places=3, read_only=True, allow_null=True)
    coupon = serializers.DecimalField(source='security.coupon', max_digits=8, decimal_places=5, read_only=True, allow_null=True) # Match model
    call_date = serializers.DateField(source='security.call_date', read_only=True, allow_null=True)
    description = serializers.CharField(source='security.description', read_only=True)

    # Rename 'book_yield' to 'yield_rate' in the output.
    yield_rate = serializers.DecimalField(
        source='book_yield',
        max_digits=8,
        decimal_places=5,
        read_only=True,
        allow_null=True,
    )

    # Allow writing to foreign keys using PrimaryKeyRelatedField during create/update
    portfolio = serializers.PrimaryKeyRelatedField(queryset=Portfolio.objects.all())
    security = serializers.PrimaryKeyRelatedField(queryset=Security.objects.all())

    class Meta:
        model = CustomerHolding
        # Define fields included in the API representation
        fields = [
            'id',
            'ticket_id',
            'customer_number',      # Read-only derived field (from portfolio owner)
            'portfolio',            # Writable PK field (user selects portfolio)
            'security',             # Writable PK field (user selects security)
            'security_cusip',       # Read-only derived field
            'original_face_amount', # Writable field
            'settlement_date',      # Writable field
            'settlement_price',     # Writable field
            'book_price',           # Writable field
            'book_yield',           # Writable field (source for yield_rate)
            'par',                  # Read-only method field
            'maturity_date',        # Read-only derived field
            'wal',                  # Read-only derived field
            'coupon',               # Read-only derived field
            'call_date',            # Read-only derived field
            'description',          # Read-only derived field
            'yield_rate',           # Renamed field in output
        ]
        # Fields that cannot be set directly via the API during creation/update
        read_only_fields = [
            'id', 'ticket_id', 'customer_number', 'security_cusip',
            'par', 'maturity_date', 'wal', 'coupon', 'call_date', 'description',
            'yield_rate',
        ]

    def get_par(self, obj):
        """ Calculate current par value based on original face and security factor. """
        if obj.security and obj.original_face_amount is not None:
            try:
                factor = obj.security.factor if obj.security.factor is not None else Decimal('1.0')
                if not isinstance(factor, Decimal):
                     factor = Decimal(str(factor))
                par_value = obj.original_face_amount * factor
                return par_value.quantize(Decimal('0.01'))
            except (InvalidOperation, TypeError, ValueError) as e:
                 log.error(f"Error calculating par for holding {obj.id} (Face: {obj.original_face_amount}, Factor: {obj.security.factor}): {e}", exc_info=True)
                 return None
        return None

class PortfolioSerializer(serializers.ModelSerializer):
    # Read-only fields for displaying related data
    owner = CustomerSerializer(read_only=True) # Represents the owner in output
    holdings = CustomerHoldingSerializer(many=True, read_only=True) # Represents holdings in output

    # Write-only fields for input during creation
    customer_number_input = serializers.CharField(
        write_only=True, required=False, allow_null=True, allow_blank=True,
        help_text="Admin Only: Specify the customer_number for the new portfolio's owner."
    )
    # --- Field is decoupled from source='owner' ---
    owner_customer_id = serializers.PrimaryKeyRelatedField(
        queryset=Customer.objects.all(),
        write_only=True,
        required=False, # Still explicitly False
        allow_null=True,
        help_text="Non-Admin (Multi-Customer) Only: Specify the ID of the customer to own this portfolio."
    )
    initial_holding_ids = serializers.ListField(
        child=serializers.IntegerField(),
        required=False,
        write_only=True,
        help_text="Optional list of existing holding IDs to copy into the new portfolio."
    )

    class Meta:
        model = Portfolio
        # 'owner' field here refers to the read-only nested representation for output
        fields = [
            'id', 'owner', 'name', 'created_at', 'holdings', 'is_default',
            # Input fields (write-only)
            'customer_number_input', 'owner_customer_id',
            'initial_holding_ids',
        ]
        # 'owner' in read_only_fields refers to preventing direct write to the nested 'owner' representation
        read_only_fields = ['id', 'created_at', 'holdings', 'owner', 'is_default']

    def validate(self, data):
        """
        Custom validation for portfolio CREATION and UPDATE.
        Determines the intended owner based on user type and input fields,
        adds the 'owner' instance to the data dictionary.
        """
        request = self.context.get('request')
        if not request or not hasattr(request, 'user'):
             log.error("PortfolioSerializer validate: Request context missing user.")
             raise serializers.ValidationError("Validation Error: Request context is missing user information.")

        user = request.user
        log.debug(f"PortfolioSerializer validate: User={user.username}, IsAdmin={user.is_staff or user.is_superuser}, Instance exists={self.instance is not None}")
        log.debug(f"PortfolioSerializer validate: Incoming data={data}")

        # --- UPDATE Validation ---
        if self.instance is not None: # Check if this is an update operation
             log.debug("PortfolioSerializer validate: Running UPDATE validation.")
             if 'name' in data and not data.get('name'):
                 raise serializers.ValidationError({'name': 'Portfolio name cannot be empty.'})
             forbidden_update_keys = ['owner', 'owner_customer_id', 'customer_number_input', 'is_default', 'initial_holding_ids']
             if any(k in data for k in forbidden_update_keys):
                 log.warning(f"PortfolioSerializer validate (Update): Attempt to modify forbidden fields by User={user.username}. Data: {data}")
                 raise serializers.ValidationError("Cannot change owner, default status, or initial holdings during portfolio update.")
             return data

        # --- CREATE Validation ---
        log.debug("PortfolioSerializer validate: Running CREATE validation.")
        intended_owner = None
        is_admin = user.is_staff or user.is_superuser
        customer_number = data.get('customer_number_input')
        owner_id_instance = data.get('owner_customer_id') # Get the Customer instance if provided (PrimaryKeyRelatedField gives instance)

        log.debug(f"PortfolioSerializer validate (Create): is_admin={is_admin}, customer_number_input='{customer_number}', owner_customer_id_instance='{owner_id_instance}'")

        # Case 1: Admin User
        if is_admin:
            if owner_id_instance is not None:
                raise serializers.ValidationError({'owner_customer_id': "Admin must use 'customer_number_input', not 'owner_customer_id'."})
            if not customer_number:
                raise serializers.ValidationError({'customer_number_input': "Admin must provide a customer number via 'customer_number_input'."})
            try:
                intended_owner = Customer.objects.get(customer_number=customer_number)
                log.debug(f"PortfolioSerializer validate (Create/Admin): Found owner by number '{customer_number}': ID {intended_owner.id}")
            except Customer.DoesNotExist:
                raise serializers.ValidationError({'customer_number_input': f"Customer with number '{customer_number}' not found."})

        # Case 2: Non-Admin User
        else:
            if customer_number is not None:
                raise serializers.ValidationError({'customer_number_input': "Non-admin users cannot specify 'customer_number_input'."})

            user_customers = user.customers.all()
            customer_count = user_customers.count()
            log.debug(f"PortfolioSerializer validate (Create/Non-Admin): User associated with {customer_count} customers.")

            if customer_count == 0:
                log.error(f"PortfolioSerializer validate (Create/Non-Admin): User {user.username} is not associated with any customers.")
                raise serializers.ValidationError("User is not associated with any customers.")

            elif customer_count == 1:
                 if owner_id_instance is not None:
                     raise serializers.ValidationError({'owner_customer_id': "Cannot specify owner ID ('owner_customer_id') when associated with only one customer."})
                 intended_owner = user_customers.first()
                 log.debug(f"PortfolioSerializer validate (Create/Non-Admin/Single): Auto-selected owner: ID {intended_owner.id}")

            else: # Multiple associated customers
                 if owner_id_instance is None:
                     raise serializers.ValidationError({'owner_customer_id': "Must specify a valid owner customer ID via 'owner_customer_id'."})
                 # Check if the provided Customer instance is actually associated with the user
                 if not user_customers.filter(id=owner_id_instance.id).exists():
                     raise serializers.ValidationError({'owner_customer_id': f"Invalid or inaccessible customer ID ({owner_id_instance.id})."})
                 # If valid, use the instance provided by PrimaryKeyRelatedField
                 intended_owner = owner_id_instance
                 log.debug(f"PortfolioSerializer validate (Create/Non-Admin/Multi): Validated owner from input ID: {intended_owner.id}")


        # Add owner to data dict for use in create/perform_create
        if intended_owner:
            data['owner'] = intended_owner # Add the actual owner instance to the data
            log.debug(f"PortfolioSerializer validate (Create): Added intended_owner (ID: {intended_owner.id}) to data dict.")
        else:
            # This should not be reachable if logic above is correct
            log.error("PortfolioSerializer validate (Create): Failed to determine intended_owner.")
            raise serializers.ValidationError("Internal error: Could not determine portfolio owner.")

        # Validate initial_holding_ids (if provided)
        # Note: initial_holding_ids is NOT a model field, it's handled in perform_create
        initial_ids = data.get('initial_holding_ids')
        if initial_ids:
            if not intended_owner: # Should be set if we reached here
                 log.error("PortfolioSerializer validate (Create): Cannot validate initial_holding_ids without intended_owner.")
                 raise serializers.ValidationError("Internal error: Could not determine portfolio owner for holding validation.")
            try:
                initial_ids_int = [int(id_val) for id_val in initial_ids]
            except (ValueError, TypeError):
                 raise serializers.ValidationError({'initial_holding_ids': "All holding IDs must be integers."})
            valid_holdings = CustomerHolding.objects.filter(id__in=initial_ids_int, portfolio__owner=intended_owner)
            valid_ids_set = set(valid_holdings.values_list('id', flat=True))
            provided_ids_set = set(initial_ids_int)
            invalid_ids = provided_ids_set - valid_ids_set
            if invalid_ids:
                raise serializers.ValidationError({'initial_holding_ids': f"Invalid or inaccessible holding IDs for owner {intended_owner.id}: {list(invalid_ids)}."})
            log.debug(f"PortfolioSerializer validate (Create): Validated initial_holding_ids: {initial_ids_int} for owner {intended_owner.id}")

        # Validate portfolio name
        if not data.get('name'):
            raise serializers.ValidationError({'name': 'Portfolio name is required.'})

        log.debug(f"PortfolioSerializer validate (Create): Validation successful for user {user.username}.")

        # Return the modified data dictionary which now includes the 'owner' instance
        # It still includes the write_only fields at this point.
        return data

    # --- ADDED create method ---
    def create(self, validated_data):
        """
        Handles the creation of a Portfolio instance.
        Removes non-model fields before calling Portfolio.objects.create.
        """
        log.debug(f"PortfolioSerializer create: Received validated_data: {validated_data}")

        # Remove fields that are not part of the Portfolio model before creating
        validated_data.pop('customer_number_input', None)
        validated_data.pop('owner_customer_id', None)
        validated_data.pop('initial_holding_ids', None) # This is handled in perform_create

        # Ensure 'owner' is present (should have been added in validate)
        if 'owner' not in validated_data:
             log.error("PortfolioSerializer create: 'owner' missing in validated_data.")
             raise serializers.ValidationError("Internal error: Owner information missing during create.")

        # Set is_default explicitly
        validated_data['is_default'] = False

        log.debug(f"PortfolioSerializer create: Calling Portfolio.objects.create with cleaned data: {validated_data}")
        try:
            # Create the portfolio instance using the cleaned data
            instance = Portfolio.objects.create(**validated_data)
            log.info(f"PortfolioSerializer create: Successfully created Portfolio ID {instance.id}")
            return instance
        except TypeError as e:
            # Catch potential TypeErrors from unexpected kwargs again, just in case
            log.error(f"PortfolioSerializer create: TypeError during Portfolio.objects.create: {e}. Data: {validated_data}", exc_info=True)
            raise serializers.ValidationError(f"An unexpected error occurred during portfolio creation: {e}") from e
        except Exception as e:
            # Catch other potential errors during creation
            log.error(f"PortfolioSerializer create: Error during Portfolio.objects.create: {e}. Data: {validated_data}", exc_info=True)
            raise serializers.ValidationError(f"An unexpected error occurred: {e}") from e


class ExcelUploadSerializer(serializers.Serializer):
    """ Serializer for the file upload endpoint in ImportExcelView. """
    file = serializers.FileField()

class SelectedBondSerializer(serializers.Serializer):
    """ Nested serializer for validating individual bonds in the SELL interest email request. """
    cusip = serializers.CharField(max_length=9, required=True, allow_blank=False)
    par = serializers.CharField(required=True, allow_blank=False) # Keep as string for precision

    def validate_par(self, value):
        """ Validate that the 'par' string can be converted to a Decimal. """
        try: Decimal(value)
        except InvalidOperation: raise serializers.ValidationError("Invalid par amount format.")
        return value

class SalespersonInterestSerializer(serializers.Serializer):
    """ Serializer for validating the request to email the salesperson about SELL interest. """
    customer_id = serializers.IntegerField(required=True)
    selected_bonds = serializers.ListField(
        child=SelectedBondSerializer(), allow_empty=False, required=True
    )

    def validate_customer_id(self, value):
        """ Check if the customer exists. """
        try: Customer.objects.get(id=value)
        except Customer.DoesNotExist: raise serializers.ValidationError(f"Customer with ID {value} not found.")
        return value


class MunicipalOfferingSerializer(serializers.ModelSerializer):
    """ Serializer for the MunicipalOffering model. """
    amount = serializers.DecimalField(max_digits=15, decimal_places=2, coerce_to_string=True, allow_null=True)
    coupon = serializers.DecimalField(max_digits=8, decimal_places=5, coerce_to_string=True, allow_null=True)
    yield_rate = serializers.DecimalField(max_digits=8, decimal_places=5, coerce_to_string=True, allow_null=True)
    price = serializers.DecimalField(max_digits=12, decimal_places=6, coerce_to_string=True, allow_null=True)
    call_price = serializers.DecimalField(max_digits=12, decimal_places=6, coerce_to_string=True, allow_null=True)

    class Meta:
        model = MunicipalOffering
        fields = [
            'id', 'cusip', 'amount', 'description', 'coupon', 'maturity_date',
            'yield_rate', 'price', 'moody_rating', 'sp_rating', 'call_date',
            'call_price', 'state', 'insurance',
        ]
        read_only_fields = fields


# --- NEW SERIALIZER for Muni Buy Interest ---

class SelectedOfferingSerializer(serializers.Serializer):
    """ Nested serializer for validating selected offerings in the BUY interest request. """
    cusip = serializers.CharField(max_length=9, required=True, allow_blank=False)
    description = serializers.CharField(required=True, allow_blank=False) # Include description as per plan

class MuniBuyInterestSerializer(serializers.Serializer):
    """ Serializer for validating the request to email salesperson about BUY interest. """
    customer_id = serializers.IntegerField(required=True)
    selected_offerings = serializers.ListField(
        child=SelectedOfferingSerializer(),
        allow_empty=False, # Must provide at least one offering
        required=True
    )

    def validate_customer_id(self, value):
        """ Check if the customer exists. """
        try:
            Customer.objects.get(id=value)
        except Customer.DoesNotExist:
            raise serializers.ValidationError(f"Customer with ID {value} not found.")
        return value
