# portfolio/serializers.py

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
    salesperson = SalespersonSerializer(read_only=True)
    salesperson_id_input = serializers.CharField(
        write_only=True,
        required=False,
        allow_null=True,
        allow_blank=True,
        help_text="ID of the salesperson to assign. Send null or empty string to unassign."
    )

    class Meta:
        model = Customer
        fields = [
            'id', 
            'customer_number', 
            'name', 
            'address', 'city', 'state', 
            'users', 
            'salesperson', 
            'salesperson_id_input', 
            'portfolio_accounting_code', 
            'cost_of_funds_rate', 
            'federal_tax_bracket_rate', 
            'created_at', 'last_modified_at', 
        ]
        read_only_fields = [
            'id', 'salesperson', 'created_at', 'last_modified_at', 'users'
        ]
        extra_kwargs = {
            'name': {'required': True},
            'city': {'required': True},
            'state': {'required': True},
            'portfolio_accounting_code': {'required': True},
        }

    def validate_salesperson_id_input(self, value):
        if value is None or value == '':
            return None 
        try:
            salesperson = Salesperson.objects.get(salesperson_id=value)
            return salesperson 
        except Salesperson.DoesNotExist:
            raise serializers.ValidationError(f"Salesperson with ID '{value}' not found.")
        except Exception as e:
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
        if 'salesperson_id_input' in validated_data:
            salesperson_instance = validated_data.pop('salesperson_id_input')
            instance.salesperson = salesperson_instance
        return super().update(instance, validated_data)


class SecuritySerializer(serializers.ModelSerializer):
    """ Serializer for Security model, reflecting new fields and relationships. """
    security_type = SecurityTypeSerializer(read_only=True)
    interest_schedule = InterestScheduleSerializer(read_only=True)
    security_type_id_input = serializers.IntegerField(
        write_only=True, required=False, allow_null=True,
        help_text="ID (type_id) of the Security Type. Send null to unset."
    )
    interest_schedule_code_input = serializers.CharField(
        write_only=True, required=False, allow_null=True, allow_blank=True,
        help_text="Code (schedule_code) of the Interest Schedule. Send null or empty string to unset."
    )
    coupon = serializers.DecimalField(max_digits=12, decimal_places=8, coerce_to_string=True, allow_null=True)
    secondary_rate = serializers.DecimalField(max_digits=12, decimal_places=8, coerce_to_string=True, allow_null=True)
    factor = serializers.DecimalField(max_digits=18, decimal_places=10, coerce_to_string=True, allow_null=True) 
    wal = serializers.DecimalField(max_digits=8, decimal_places=3, coerce_to_string=True, allow_null=True)
    cpr = serializers.DecimalField(
        max_digits=8, decimal_places=5, coerce_to_string=True, allow_null=True, required=False
    )

    class Meta:
        model = Security
        fields = [
            'cusip', 'description', 'issue_date', 'maturity_date', 'call_date',
            'security_type', 'security_type_id_input', 
            'interest_schedule', 'interest_schedule_code_input',
            'coupon', 'secondary_rate', 'rate_effective_date', 'tax_code', 
            'interest_day', 'interest_calc_code', 'payments_per_year', 
            'allows_paydown', 'payment_delay_days', 'factor', 'wal', 'cpr',
            'issuer_name', 'currency', 'callable_flag', 
            'moody_rating', 'sp_rating', 'fitch_rating', 
            'sector', 'state_of_issuer',
            'created_at', 'last_modified_at',
        ]
        read_only_fields = [
            'security_type', 'interest_schedule', 
            'created_at', 'last_modified_at'
        ]
        extra_kwargs = {
            'description': {'required': True},
            'issue_date': {'required': True},
            'maturity_date': {'required': True},
            'tax_code': {'required': True},
            'interest_day': {'required': True},
            'interest_calc_code': {'required': True},
            'payments_per_year': {'required': True},
            'allows_paydown': {'required': True}, 
            'payment_delay_days': {'required': True},
            'security_type_id_input': {'required': False},
            'interest_schedule_code_input': {'required': False},
            'cpr': {'required': False}, 
        }

    def validate_security_type_id_input(self, value):
        if value is None: return None
        try:
            return SecurityType.objects.get(type_id=value)
        except SecurityType.DoesNotExist:
            raise serializers.ValidationError(f"SecurityType with ID '{value}' not found.")
        except Exception as e:
             log.error(f"Error validating security_type_id_input '{value}': {e}", exc_info=True)
             raise serializers.ValidationError("An error occurred while validating the security type ID.")

    def validate_interest_schedule_code_input(self, value):
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
    security = SecuritySerializer(read_only=True)
    portfolio_id_input = serializers.IntegerField(
        write_only=True,
        help_text="ID of the portfolio this holding belongs to."
    )
    security_cusip_input = serializers.CharField(
        max_length=9,
        write_only=True,
        help_text="CUSIP of the security being held."
    )
    security_cusip = serializers.CharField(source='security.cusip', read_only=True)
    security_description = serializers.CharField(source='security.description', read_only=True)
    customer_number = serializers.IntegerField(source='portfolio.owner.customer_number', read_only=True)
    portfolio_name = serializers.CharField(source='portfolio.name', read_only=True)
    portfolio_id = serializers.IntegerField(source='portfolio.id', read_only=True)
    par_value = serializers.SerializerMethodField(help_text="Calculated current par value (original_face * factor).")
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
            'ticket_id', 'external_ticket', 'portfolio_id', 'portfolio_name', 'customer_number',
            'security', 'security_cusip', 'security_description',
            'intention_code', 'original_face_amount', 'settlement_date', 'settlement_price',
            'book_price', 'book_yield', 'holding_duration', 'holding_average_life',
            'holding_average_life_date', 'market_date', 'market_price', 'market_yield',
            'par_value', 'created_at', 'last_modified_at',
            'portfolio_id_input', 'security_cusip_input',
        ]
        read_only_fields = [
            'ticket_id', 'portfolio_id', 'portfolio_name', 'customer_number',
            'security', 'security_cusip', 'security_description', 'par_value',
            'created_at', 'last_modified_at',
        ]
        extra_kwargs = {
            'external_ticket': {'required': True},
            'intention_code': {'required': True},
            'original_face_amount': {'required': True},
            'settlement_date': {'required': True},
            'settlement_price': {'required': True},
            'book_price': {'required': True},
            'portfolio_id_input': {'required': True, 'write_only': True},
            'security_cusip_input': {'required': True, 'write_only': True},
        }

    def validate_portfolio_id_input(self, value):
        try:
            return Portfolio.objects.get(pk=value)
        except Portfolio.DoesNotExist:
            raise serializers.ValidationError(f"Portfolio with ID {value} does not exist.")

    def validate_security_cusip_input(self, value):
        try:
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
        if 'portfolio_id_input' in validated_data:
            instance.portfolio = validated_data.pop('portfolio_id_input')
        if 'security_cusip_input' in validated_data:
            instance.security = validated_data.pop('security_cusip_input')
        return super().update(instance, validated_data)

    def get_par_value(self, obj):
        if obj.security and obj.original_face_amount is not None:
            try:
                factor = obj.security.factor
                if factor is None: factor = Decimal('1.0')
                elif not isinstance(factor, Decimal):
                     try: factor = Decimal(str(factor))
                     except (InvalidOperation, TypeError, ValueError):
                         log.warning(f"Holding {obj.external_ticket}: Could not convert security factor '{obj.security.factor}' to Decimal. Using 1.0.")
                         factor = Decimal('1.0')
                par_value = obj.original_face_amount * factor
                return par_value.quantize(Decimal('0.01'))
            except (InvalidOperation, TypeError, ValueError) as e:
                 log.error(f"Error calculating par for holding {obj.ticket_id} (Ext: {obj.external_ticket}): {e}", exc_info=True)
                 return None
        return None


class PortfolioSerializer(serializers.ModelSerializer):
    owner = CustomerSerializer(read_only=True) 
    owner_id_input = serializers.IntegerField(
        write_only=True, required=False, allow_null=True,
        help_text="ID of the customer who owns this portfolio."
    )
    initial_holding_ids = serializers.ListField(
        child=serializers.IntegerField(), 
        required=False,
        write_only=True,
        help_text="Optional list of existing holding EXTERNAL TICKET numbers to copy into the new portfolio."
    )

    class Meta:
        model = Portfolio
        fields = [
            'id', 'owner', 'name', 'created_at', 'is_default',
            'owner_id_input', 'initial_holding_ids',
        ]
        read_only_fields = ['id', 'created_at', 'owner', 'is_default'] 

    def validate_owner_id_input(self, value):
        if value is None:
            return None
        request = self.context.get('request')
        user = request.user
        is_admin = user.is_staff or user.is_superuser
        try:
            intended_owner = Customer.objects.get(pk=value)
        except Customer.DoesNotExist:
            raise serializers.ValidationError(f"Customer with ID {value} not found.")
        if not is_admin and not user.customers.filter(pk=value).exists():
            raise serializers.ValidationError(f"You do not have permission to assign portfolios to customer ID {value}.")
        return intended_owner 

    def validate(self, data):
        if self.instance is not None:
            if 'name' in data and not data.get('name'):
                 raise serializers.ValidationError({'name': 'Portfolio name cannot be empty.'})
            if 'owner_id_input' in data:
                raise serializers.ValidationError("Cannot change portfolio owner during update.")
            if 'is_default' in data:
                 raise serializers.ValidationError("Cannot change default status via this endpoint.")
            return data
        request = self.context.get('request')
        user = request.user
        is_admin = user.is_staff or user.is_superuser
        intended_owner = data.get('owner_id_input') 
        if intended_owner is None:
            if is_admin:
                raise serializers.ValidationError({'owner_id_input': "Admin must provide the owner customer ID."})
            else:
                user_customers = user.customers.all()
                customer_count = user_customers.count()
                if customer_count == 0:
                    raise serializers.ValidationError("User is not associated with any customers.")
                elif customer_count == 1:
                    intended_owner = user_customers.first()
                else: 
                    raise serializers.ValidationError({'owner_id_input': "Must specify a valid owner customer ID when associated with multiple customers."})
        data['owner'] = intended_owner 
        initial_tickets = data.get('initial_holding_ids')
        if initial_tickets:
            try: initial_tickets_int = [int(t) for t in initial_tickets]
            except (ValueError, TypeError): raise serializers.ValidationError({'initial_holding_ids': "All holding ticket numbers must be integers."})
            valid_holdings = CustomerHolding.objects.filter(
                external_ticket__in=initial_tickets_int,
                portfolio__owner=intended_owner 
            )
            valid_tickets_set = set(valid_holdings.values_list('external_ticket', flat=True))
            provided_tickets_set = set(initial_tickets_int)
            invalid_tickets = provided_tickets_set - valid_tickets_set
            if invalid_tickets:
                raise serializers.ValidationError({'initial_holding_ids': f"Invalid or inaccessible holding external ticket numbers for owner {intended_owner.id}: {list(invalid_tickets)}."})
            data['_holdings_to_copy_qs'] = valid_holdings
        if not data.get('name'): raise serializers.ValidationError({'name': 'Portfolio name is required.'})
        return data

    def create(self, validated_data):
        validated_data.pop('owner_id_input', None) 
        validated_data.pop('initial_holding_ids', None)
        validated_data.pop('_holdings_to_copy_qs', None) 
        if 'owner' not in validated_data: raise serializers.ValidationError("Internal error: Owner information missing during create.")
        validated_data['is_default'] = False 
        try:
            instance = Portfolio.objects.create(**validated_data)
            return instance
        except Exception as e:
            log.error(f"PortfolioSerializer create: Error during Portfolio.objects.create: {e}. Data: {validated_data}", exc_info=True)
            raise serializers.ValidationError(f"An unexpected error occurred: {e}") from e


class ExcelUploadSerializer(serializers.Serializer):
    file = serializers.FileField()

class SelectedBondSerializer(serializers.Serializer):
    cusip = serializers.CharField(max_length=9, required=True, allow_blank=False)
    par = serializers.CharField(required=True, allow_blank=False)
    def validate_par(self, value):
        try: Decimal(value); return value
        except InvalidOperation: raise serializers.ValidationError("Invalid par amount format.")

class SalespersonInterestSerializer(serializers.Serializer):
    customer_id = serializers.IntegerField(required=True) 
    selected_bonds = serializers.ListField(child=SelectedBondSerializer(), allow_empty=False, required=True)
    def validate_customer_id(self, value):
        try: Customer.objects.get(id=value); return value
        except Customer.DoesNotExist: raise serializers.ValidationError(f"Customer with ID {value} not found.")


class MunicipalOfferingSerializer(serializers.ModelSerializer):
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
            'call_price', 'state', 'insurance', 'last_updated',
        ]
        read_only_fields = fields 

class SelectedOfferingSerializer(serializers.Serializer):
    cusip = serializers.CharField(max_length=9, required=True, allow_blank=False)
    description = serializers.CharField(required=True, allow_blank=False)

class MuniBuyInterestSerializer(serializers.Serializer):
    customer_id = serializers.IntegerField(required=True) 
    selected_offerings = serializers.ListField(child=SelectedOfferingSerializer(), allow_empty=False, required=True)
    def validate_customer_id(self, value):
        try: Customer.objects.get(id=value); return value
        except Customer.DoesNotExist: raise serializers.ValidationError(f"Customer with ID {value} not found.")


# --- Serializers for Portfolio Simulation / Swap ---

class HoldingToRemoveSerializer(serializers.Serializer):
    """ Defines the identifier for a holding to be removed in simulation. """
    external_ticket = serializers.IntegerField(required=True)
    # Future consideration: Add 'par_to_sell' if partial "sales" are needed.
    # For now, assumes full sale of the holding identified by external_ticket.

class OfferingToBuySerializer(serializers.Serializer):
    """ Defines a municipal offering and par amount to be "bought" in simulation. """
    offering_cusip = serializers.CharField(
        max_length=9, 
        required=True,
        help_text="CUSIP of the Municipal Offering to buy."
    )
    par_to_buy = serializers.DecimalField(
        max_digits=40, decimal_places=8, required=True, coerce_to_string=True,
        help_text="The par amount of the offering to 'buy'."
    )

    def validate_par_to_buy(self, value):
        """ Ensure par amount to buy is positive. """
        if value <= 0:
            raise serializers.ValidationError("Par amount to buy must be positive.")
        return value

class PortfolioSimulationSerializer(serializers.Serializer):
    """
    Serializer for validating the input for the portfolio simulation (swap) endpoint.
    """
    holdings_to_remove = HoldingToRemoveSerializer(many=True, required=False, default=[], help_text="List of current holdings to 'sell'.")
    offerings_to_buy = OfferingToBuySerializer(many=True, required=False, default=[], help_text="List of municipal offerings to 'buy'.")

    def validate(self, data):
        """ Ensure at least one action (sell or buy) is specified. """
        if not data.get('holdings_to_remove') and not data.get('offerings_to_buy'):
            raise serializers.ValidationError("Must specify at least one holding to 'sell' or offering to 'buy'.")
        return data
