# api/portfolio/serializers.py (Added MuniBuyInterestSerializer)

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
    owner = CustomerSerializer(read_only=True)
    holdings = CustomerHoldingSerializer(many=True, read_only=True)
    customer_number_input = serializers.CharField(
        write_only=True, required=False, allow_null=True, allow_blank=True,
        help_text="Admin Only: Specify the customer_number for the new portfolio's owner."
    )
    owner_customer_id = serializers.PrimaryKeyRelatedField(
        queryset=Customer.objects.all(),
        source='owner',
        write_only=True,
        required=False,
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
        fields = [
            'id', 'owner', 'name', 'created_at', 'holdings', 'is_default',
            'customer_number_input', 'owner_customer_id',
            'initial_holding_ids',
        ]
        read_only_fields = ['id', 'created_at', 'holdings', 'owner', 'is_default']

    def validate(self, data):
        """ Custom validation for portfolio CREATION and UPDATE. """
        request = self.context.get('request')
        if not request or not hasattr(request, 'user'):
             raise serializers.ValidationError("Validation Error: Request context is missing user information.")
        user = request.user
        # UPDATE Validation
        if self.instance is not None:
             if 'name' in data and not data.get('name'):
                 raise serializers.ValidationError({'name': 'Portfolio name cannot be empty.'})
             if any(k in data for k in ['owner', 'owner_customer_id', 'customer_number_input', 'is_default', 'initial_holding_ids']):
                 raise serializers.ValidationError("Cannot change owner, default status, or initial holdings during portfolio update.")
             return data
        # CREATE Validation
        intended_owner = None
        is_admin = user.is_staff or user.is_superuser
        customer_number = data.get('customer_number_input')
        owner_instance_from_input = data.get('owner')
        log.debug(f"PortfolioSerializer validate (Create): User={user.username}, Admin={is_admin}, customer_number_input={customer_number}, owner_instance_from_input={owner_instance_from_input}")
        if is_admin:
            if owner_instance_from_input is not None: raise serializers.ValidationError({'owner_customer_id': "Admin must use 'customer_number_input'."})
            if not customer_number: raise serializers.ValidationError({'customer_number_input': "Admin must provide a customer number."})
            try:
                intended_owner = Customer.objects.get(customer_number=customer_number)
                self.context['_intended_owner'] = intended_owner
            except Customer.DoesNotExist: raise serializers.ValidationError({'customer_number_input': f"Customer with number '{customer_number}' not found."})
        else:
            if customer_number is not None: raise serializers.ValidationError({'customer_number_input': "Non-admin users cannot specify 'customer_number_input'."})
            user_customers = user.customers.all()
            customer_count = user_customers.count()
            if customer_count == 0: raise serializers.ValidationError("User is not associated with any customers.")
            elif customer_count == 1:
                 if owner_instance_from_input is not None: raise serializers.ValidationError({'owner_customer_id': "Cannot specify owner ID when associated with only one customer."})
                 intended_owner = user_customers.first()
                 self.context['_intended_owner'] = intended_owner
            else:
                 if owner_instance_from_input is None: raise serializers.ValidationError({'owner_customer_id': "Must specify a valid owner customer ID."})
                 if not user_customers.filter(id=owner_instance_from_input.id).exists(): raise serializers.ValidationError({'owner_customer_id': f"Invalid or inaccessible customer ID ({owner_instance_from_input.id})."})
                 intended_owner = owner_instance_from_input
        initial_ids = data.get('initial_holding_ids')
        if initial_ids:
            if not intended_owner: raise serializers.ValidationError("Internal error: Could not determine portfolio owner for holding validation.")
            valid_holdings = CustomerHolding.objects.filter(id__in=initial_ids, portfolio__owner=intended_owner)
            valid_ids_set = set(valid_holdings.values_list('id', flat=True))
            provided_ids_set = set(initial_ids)
            invalid_ids = provided_ids_set - valid_ids_set
            if invalid_ids: raise serializers.ValidationError({'initial_holding_ids': f"Invalid or inaccessible holding IDs: {list(invalid_ids)}."})
            log.debug(f"Validated initial_holding_ids: {initial_ids} for owner {intended_owner.id}")
        if not data.get('name'): raise serializers.ValidationError({'name': 'Portfolio name is required.'})
        return data

    def create(self, validated_data):
        """ Override create to explicitly handle owner assignment. """
        validated_data.pop('customer_number_input', None)
        validated_data.pop('initial_holding_ids', None)
        owner = validated_data.pop('owner', None) or self.context.pop('_intended_owner', None)
        if not owner: raise serializers.ValidationError("Internal error: Failed to determine portfolio owner.")
        validated_data['owner'] = owner
        validated_data['is_default'] = False
        log.debug(f"PortfolioSerializer create - final validated_data before Model.create: {validated_data}")
        try:
            instance = Portfolio.objects.create(**validated_data)
            return instance
        except Exception as e:
            log.error(f"Error during Portfolio.objects.create: {e}. Data: {validated_data}", exc_info=True)
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

