# portfolio/views.py (Add WAL and Duration to sortable fields for Holdings)

import os
import logging
import uuid
from django.conf import settings
from django.shortcuts import render, get_object_or_404
from django.contrib.auth.decorators import login_required
from django.core.exceptions import PermissionDenied, ObjectDoesNotExist, ValidationError as DjangoValidationError
from django.db import transaction, IntegrityError
# *** ADDED ExpressionWrapper, DecimalField ***
from django.db.models import Sum, F, Value, Max, ExpressionWrapper, DecimalField
from django.db.models.functions import Coalesce # For handling nulls in sums
from django.utils import timezone # For date calculations

# --- ADDED FOR SIMULATION ---
from decimal import Decimal, ROUND_HALF_UP, InvalidOperation
from datetime import date
from collections import defaultdict # For concentration calculation
# --- END SIMULATION ADD ---


from django_filters.rest_framework import DjangoFilterBackend # Ensure this is imported
# *** ADDED OrderingFilter ***
from rest_framework.filters import OrderingFilter
from rest_framework import viewsets, status, permissions
from rest_framework.decorators import action
from rest_framework.generics import GenericAPIView
from rest_framework.views import APIView
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.response import Response
from rest_framework import serializers

# Import Celery tasks (ensure task signatures match if arguments changed)
from .tasks import (
    import_securities_from_excel,
    import_customers_from_excel,
    import_holdings_from_excel,
    send_salesperson_interest_email,
    import_muni_offerings_from_excel,
    send_salesperson_muni_buy_interest_email,
)
# Import models and serializers (including new ones)
from .models import (
    Customer, Security, Portfolio, CustomerHolding, MunicipalOffering,
    Salesperson, SecurityType # Import Salesperson, SecurityType
)
from .serializers import (
    ExcelUploadSerializer,
    CustomerSerializer,
    SecuritySerializer,
    PortfolioSerializer,
    CustomerHoldingSerializer,
    SalespersonInterestSerializer,
    MunicipalOfferingSerializer,
    MuniBuyInterestSerializer,
    # *** ADDED Simulation Serializer ***
    PortfolioSimulationSerializer,
    # Add serializers for new models if they need API endpoints (optional)
    # SalespersonSerializer, SecurityTypeSerializer, InterestScheduleSerializer
)

# Setup logging
log = logging.getLogger(__name__)

# Define a high base for internally generated tickets for copied holdings
# Ensure this is significantly higher than any expected ticket from Excel imports
COPIED_HOLDING_TICKET_BASE = 1_000_000_000

# --- View to serve the main index.html page ---
@login_required
def portfolio_analyzer_view(request):
    """ Serves the main index.html template. """
    # Pass admin status to the template context
    context = {'is_admin': request.user.is_staff or request.user.is_superuser}
    # Render the index.html template found by the template loader
    return render(request, 'index.html', context)


# --- Helper Function for Simulation Calculations ---

def calculate_portfolio_metrics(holdings_list):
    """
    Calculates metrics for a list of holding objects (or dictionaries).
    Expects each item to have 'security' (a Security object)
    and 'original_face_amount'. For Gain/Loss, expects 'book_price'
    and 'market_price'.

    Returns a dictionary of calculated metrics.
    NOTE: WAL, Duration, Yield require a dedicated financial library.
    """
    metrics = {
        "total_par_value": Decimal("0.00"),
        "gain_loss": Decimal("0.00"),
        "concentration_by_sec_type": {}, # { "SecTypeName": percentage, ... }
        "holding_count": 0,
        # Placeholders for complex metrics
        "wal": None, # Weighted Average Life
        "duration": None, # Portfolio Duration
        "yield": None, # Portfolio Yield
    }
    if not holdings_list:
        return metrics # Return defaults if no holdings

    total_par = Decimal("0.00")
    total_market_value = Decimal("0.00")
    total_book_value = Decimal("0.00")
    par_by_sec_type = defaultdict(Decimal) # { sec_type_name: total_par }
    valid_holdings_count = 0

    for holding_data in holdings_list:
        # Access data whether it's a dict or an object
        is_dict = isinstance(holding_data, dict)
        face_amount = holding_data.get('original_face_amount') if is_dict else holding_data.original_face_amount
        security = holding_data.get('security') if is_dict else holding_data.security
        book_price = holding_data.get('book_price') if is_dict else holding_data.book_price
        market_price = holding_data.get('market_price') if is_dict else holding_data.market_price

        # --- Basic Validation ---
        if not security or face_amount is None or face_amount <= 0:
            log.debug(f"Skipping holding due to missing security or invalid face amount: {holding_data}")
            continue # Skip holdings without security or valid face amount

        # --- Par Value Calculation ---
        factor = security.factor if security.factor is not None else Decimal("1.0")
        # Ensure factor is Decimal
        if not isinstance(factor, Decimal):
            try: factor = Decimal(str(factor))
            except (InvalidOperation, TypeError, ValueError): factor = Decimal("1.0")
        current_par = face_amount * factor
        total_par += current_par

        # --- Gain/Loss Calculation ---
        # Requires book_price and market_price on the holding
        # Value = Par * Price / 100 (assuming price is per 100 par)
        if book_price is not None:
            try:
                # Ensure prices are Decimal
                if not isinstance(book_price, Decimal): book_price = Decimal(str(book_price))
                total_book_value += (current_par * book_price) / Decimal("100.0")
            except (InvalidOperation, TypeError, ValueError):
                 log.warning(f"Could not calculate book value for holding (Sec: {security.cusip}, Ticket: {holding_data.get('external_ticket', 'N/A') if is_dict else holding_data.external_ticket}): Invalid book_price '{holding_data.get('book_price') if is_dict else holding_data.book_price}'")
        else:
             log.debug(f"Book price missing for holding (Sec: {security.cusip}, Ticket: {holding_data.get('external_ticket', 'N/A') if is_dict else holding_data.external_ticket})")


        if market_price is not None:
            try:
                 # Ensure prices are Decimal
                if not isinstance(market_price, Decimal): market_price = Decimal(str(market_price))
                total_market_value += (current_par * market_price) / Decimal("100.0")
            except (InvalidOperation, TypeError, ValueError):
                 log.warning(f"Could not calculate market value for holding (Sec: {security.cusip}, Ticket: {holding_data.get('external_ticket', 'N/A') if is_dict else holding_data.external_ticket}): Invalid market_price '{holding_data.get('market_price') if is_dict else holding_data.market_price}'")
        else:
             log.debug(f"Market price missing for holding (Sec: {security.cusip}, Ticket: {holding_data.get('external_ticket', 'N/A') if is_dict else holding_data.external_ticket})")


        # --- Concentration Calculation ---
        sec_type = security.security_type
        sec_type_name = sec_type.name if sec_type and sec_type.name else "Unknown"
        par_by_sec_type[sec_type_name] += current_par

        valid_holdings_count += 1

    # --- Final Calculations ---
    metrics["total_par_value"] = total_par.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    metrics["holding_count"] = valid_holdings_count

    # Calculate Gain/Loss if both values are available
    if total_book_value > 0 or total_market_value > 0: # Avoid division by zero or meaningless calc if no values
        metrics["gain_loss"] = (total_market_value - total_book_value).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    else:
        metrics["gain_loss"] = Decimal("0.00") # Or None if preferred

    # Calculate Concentration Percentage
    if total_par > 0:
        for sec_type_name, type_par in par_by_sec_type.items():
            percentage = (type_par / total_par * 100).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP) # Percentage with 2 decimals
            metrics["concentration_by_sec_type"][sec_type_name] = percentage
    else:
         metrics["concentration_by_sec_type"] = {} # Empty if no total par

    # *** Placeholder for complex calculations using a financial library ***
    # metrics["wal"] = calculate_wal(holdings_list)
    # metrics["duration"] = calculate_duration(holdings_list)
    # metrics["yield"] = calculate_yield(holdings_list)

    log.debug(f"Calculated metrics: {metrics}")
    return metrics


# --- API ViewSets ---

class CustomerViewSet(viewsets.ModelViewSet):
    """ API endpoint for viewing and editing Customer instances. """
    serializer_class = CustomerSerializer
    permission_classes = [permissions.IsAuthenticated]
    # *** ADDED OrderingFilter ***
    filter_backends = [DjangoFilterBackend, OrderingFilter]
    filterset_fields = ['customer_number', 'state', 'salesperson__salesperson_id']
    # *** ADDED ordering_fields ***
    ordering_fields = ['customer_number', 'name', 'state', 'salesperson__name', 'last_modified_at']
    ordering = ['customer_number'] # Default ordering

    def get_queryset(self):
        """ Filter customers based on user association or admin status. """
        user = self.request.user
        # Include related salesperson for efficiency if often displayed
        base_queryset = Customer.objects.select_related('salesperson')
        if user.is_staff or user.is_superuser:
            return base_queryset.all()
        # Filter based on the 'users' ManyToMany field
        return base_queryset.filter(users=user).distinct()

class SecurityViewSet(viewsets.ModelViewSet):
    """ API endpoint for viewing and editing Security instances. """
    lookup_field = 'cusip'
    serializer_class = SecuritySerializer
    permission_classes = [permissions.IsAuthenticated] # Or IsAdminUser if only admins can edit securities
    # *** ADDED OrderingFilter ***
    filter_backends = [DjangoFilterBackend, OrderingFilter]
    filterset_fields = {
        'cusip': ['exact', 'icontains'],
        'security_type__type_id': ['exact'],
        'tax_code': ['exact'],
        'interest_calc_code': ['exact'],
        'allows_paydown': ['exact'],
        'callable_flag': ['exact'],
        'currency': ['exact'],
        'sector': ['exact', 'icontains'],
        'state_of_issuer': ['exact'],
        'moody_rating': ['exact'],
        'sp_rating': ['exact'],
        'fitch_rating': ['exact'],
        'description': ['exact', 'icontains'],
    }
    # *** ADDED ordering_fields ***
    ordering_fields = [
        'cusip', 'description', 'maturity_date', 'issue_date', 'coupon',
        'tax_code', 'sector', 'state_of_issuer', 'moody_rating', 'sp_rating',
        'fitch_rating', 'security_type__name', 'last_modified_at',
        'wal', # Allow sorting by Security WAL
    ]
    ordering = ['cusip'] # Default ordering

    def get_queryset(self):
        """ Return all securities, potentially prefetching related types/schedules. """
        # Prefetch related objects often displayed in lists/details
        return Security.objects.select_related('security_type', 'interest_schedule').all()

class PortfolioViewSet(viewsets.ModelViewSet):
    """
    API endpoint for viewing and editing Portfolio instances.
    Allows filtering by owner ID via query parameter '?owner=<customer_id>'.
    """
    serializer_class = PortfolioSerializer
    permission_classes = [permissions.IsAuthenticated]
    # *** ADDED OrderingFilter ***
    filter_backends = [DjangoFilterBackend, OrderingFilter]
    filterset_fields = ['owner']
    # *** ADDED ordering_fields ***
    ordering_fields = ['name', 'owner__customer_number', 'owner__name', 'created_at', 'is_default']
    ordering = ['owner__customer_number', 'name'] # Default ordering

    def get_queryset(self):
        """
        Filter portfolios based on user association or admin status first,
        then allow further filtering via query parameters (like owner).
        """
        user = self.request.user
        # Optimize by selecting related owner
        base_queryset = Portfolio.objects.select_related('owner') # Removed prefetch for simplicity here

        # Apply permission filtering first
        if user.is_staff or user.is_superuser:
            permitted_queryset = base_queryset.all() # Admins can see all
        else:
            # Non-admins see portfolios owned by customers they are linked to
            permitted_queryset = base_queryset.filter(owner__users=user).distinct()

        # The DjangoFilterBackend and OrderingFilter will automatically apply further
        # filtering/ordering based on query parameters to the permitted_queryset.
        return permitted_queryset

    def get_serializer_context(self):
        """ Add request to the serializer context. """
        context = super().get_serializer_context()
        context['request'] = self.request
        return context

    # create method uses perform_create, which handles the logic
    def create(self, request, *args, **kwargs):
        """ Handles POST requests to create a new Portfolio. """
        log.info(f"PortfolioViewSet CREATE - Raw request.data: {request.data}")
        log.info(f"PortfolioViewSet CREATE - User: {request.user}, IsAdmin: {request.user.is_staff or request.user.is_superuser}")
        serializer = self.get_serializer(data=request.data)
        try:
            serializer.is_valid(raise_exception=True)
            log.info("PortfolioViewSet CREATE - serializer.is_valid() PASSED.")
            # perform_create handles saving and copying holdings
            self.perform_create(serializer)
            headers = self.get_success_headers(serializer.data)
            return Response(serializer.data, status=status.HTTP_201_CREATED, headers=headers)
        except serializers.ValidationError as ve:
             log.warning(f"PortfolioViewSet CREATE - VALIDATION FAILED. Errors: {ve.detail}")
             return Response(ve.detail, status=status.HTTP_400_BAD_REQUEST) # Return 400 on validation error
        except Exception as e:
            log.error(f"PortfolioViewSet CREATE - UNEXPECTED ERROR: {e}", exc_info=True)
            # Return a generic 500 error for unexpected issues
            return Response({"error": "An unexpected error occurred during portfolio creation."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


    def perform_create(self, serializer):
        """ Creates the Portfolio instance and handles initial holding copy. """
        log.info("PortfolioViewSet perform_create - Starting portfolio creation...")
        # Owner should be determined and added to validated_data by the serializer's validate method
        owner = serializer.validated_data.get('owner')
        if not owner:
            # This case should ideally be prevented by serializer validation
            log.error(f"PortfolioViewSet perform_create: Owner missing in validated_data for user {self.request.user.username}.")
            raise serializers.ValidationError("Internal error: Could not determine portfolio owner during creation.")

        # Get the queryset of holdings to copy (validated in serializer)
        holdings_to_copy_qs = serializer.validated_data.get('_holdings_to_copy_qs')

        new_portfolio = None
        try:
            # Use a transaction to ensure portfolio and holdings are created/copied atomically
            with transaction.atomic():
                # Save the portfolio instance using the validated data
                # Owner is already part of validated_data from the validate method
                # is_default=False is handled by serializer create or model default
                log.info("PortfolioViewSet perform_create - Calling serializer.save()...")
                new_portfolio = serializer.save() # is_default=False is handled in serializer create

                log.info(f"PortfolioViewSet perform_create - Portfolio '{new_portfolio.name}' (ID: {new_portfolio.id}) created for owner {new_portfolio.owner.customer_number}.")

                # Copy initial holdings if the validated queryset exists
                if holdings_to_copy_qs:
                    log.info(f"PortfolioViewSet perform_create - Attempting to copy {holdings_to_copy_qs.count()} initial holdings into new portfolio {new_portfolio.id}...")

                    # --- Generate New External Tickets ---
                    # Find the current maximum external_ticket value
                    # Use Coalesce to handle the case where there are no holdings yet (defaults to 0)
                    max_ticket_result = CustomerHolding.objects.aggregate(
                        max_ticket=Coalesce(Max('external_ticket'), Value(0))
                    )
                    current_max_ticket = max_ticket_result['max_ticket']

                    # Determine the starting point for new tickets, ensuring it's above the base
                    next_ticket = max(current_max_ticket + 1, COPIED_HOLDING_TICKET_BASE)
                    log.info(f"Starting next external_ticket for copied holdings at: {next_ticket} (Current max: {current_max_ticket}, Base: {COPIED_HOLDING_TICKET_BASE})")
                    # --- End Ticket Generation Prep ---

                    new_holdings_to_create = []
                    for original_holding in holdings_to_copy_qs.select_related('security'):
                        # Create a new holding instance linked to the new portfolio
                        new_holding = CustomerHolding(
                            # *** Assign the newly generated external_ticket ***
                            external_ticket = next_ticket,
                            portfolio=new_portfolio,
                            security=original_holding.security,
                            intention_code=original_holding.intention_code,
                            original_face_amount=original_holding.original_face_amount,
                            settlement_date=original_holding.settlement_date,
                            settlement_price=original_holding.settlement_price,
                            book_price=original_holding.book_price,
                            book_yield=original_holding.book_yield,
                            holding_duration=original_holding.holding_duration,
                            holding_average_life=original_holding.holding_average_life,
                            holding_average_life_date=original_holding.holding_average_life_date,
                            market_date=original_holding.market_date,
                            market_price=original_holding.market_price,
                            market_yield=original_holding.market_yield
                            # ticket_id (PK) will be auto-generated
                        )
                        new_holdings_to_create.append(new_holding)
                        next_ticket += 1 # Increment for the next holding

                    if new_holdings_to_create:
                        log.info(f"PortfolioViewSet perform_create - Bulk creating {len(new_holdings_to_create)} new holdings...")
                        # This bulk_create should now succeed as external_ticket is provided
                        try:
                            created_list = CustomerHolding.objects.bulk_create(new_holdings_to_create)
                            copied_holdings_count = len(created_list)
                            log.info(f"PortfolioViewSet perform_create - Successfully copied {copied_holdings_count} holdings into portfolio {new_portfolio.id}.")
                        except IntegrityError as copy_ie:
                            # This could still happen if somehow the generated ticket conflicts (e.g., race condition if not properly locked)
                            # Or if another unique constraint is violated (e.g., portfolio+security if that was re-added)
                            log.error(f"PortfolioViewSet perform_create - IntegrityError during bulk copy of holdings into portfolio {new_portfolio.id}: {copy_ie}. Holdings were NOT copied.", exc_info=True)
                            # Raise a more specific error for the frontend
                            raise serializers.ValidationError({"initial_holding_ids": f"Could not copy holdings due to a data conflict: {copy_ie}"})
                    else:
                        log.info(f"PortfolioViewSet perform_create - No valid holdings found to copy for portfolio {new_portfolio.id}.")

        except IntegrityError as ie:
             # Catch potential unique constraint errors during portfolio create itself
             log.error(f"PortfolioViewSet perform_create - TRANSACTION ERROR (Integrity) creating portfolio: {ie}", exc_info=True)
             # Raise a validation error to signal failure
             raise serializers.ValidationError(f"An integrity error occurred while creating the portfolio: {ie}") from ie
        except Exception as e:
            log.error(f"PortfolioViewSet perform_create - TRANSACTION ERROR: {e}", exc_info=True)
            raise serializers.ValidationError(f"An error occurred during portfolio creation or holding copy: {e}") from e
        log.info("PortfolioViewSet perform_create - Finished.")


    def perform_destroy(self, instance):
        """ Prevent deletion of the default portfolio. """
        user = self.request.user
        log.info(f"User {user.username} attempting to delete portfolio '{instance.name}' (ID: {instance.id}, Default: {instance.is_default})")
        # Check permissions (owner or admin)
        if not (user.is_staff or user.is_superuser):
            # Ensure the user is associated with the portfolio's owner
            if not user.customers.filter(id=instance.owner_id).exists():
                raise PermissionDenied("You do not have permission to delete this portfolio.")
        # Prevent deletion of default portfolio
        if instance.is_default:
            # Use ValidationError for consistency with DRF error handling
            raise serializers.ValidationError({"detail": "Cannot delete the default 'Primary Holdings' portfolio."})
        log.info(f"Proceeding with deletion of portfolio '{instance.name}' (ID: {instance.id}) by user {user.username}.")
        instance.delete()

    # --- UPDATED simulate_swap action ---
    @action(detail=True, methods=['post'], url_path='simulate_swap', url_name='simulate-swap', permission_classes=[permissions.IsAuthenticated])
    def simulate_swap(self, request, pk=None):
        """
        Simulates adding/removing securities from a portfolio and calculates the impact.
        Expects JSON body like:
        {
            "holdings_to_remove": [{"external_ticket": 12345}, {"external_ticket": 67890}],
            "securities_to_add": [{"cusip": "912828ABC", "original_face_amount": "50000.00"}]
        }
        """
        portfolio = self.get_object() # Get the specific portfolio instance (handles 404)
        log.info(f"Simulate swap requested for portfolio {portfolio.name} (ID: {portfolio.id}) by user {request.user.username}")

        # --- Validate Input Data ---
        serializer = PortfolioSimulationSerializer(data=request.data)
        if not serializer.is_valid():
            log.warning(f"Invalid simulation input for portfolio {portfolio.id}: {serializer.errors}")
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        validated_data = serializer.validated_data
        holdings_to_remove_input = validated_data.get('holdings_to_remove', [])
        securities_to_add_input = validated_data.get('securities_to_add', [])
        log.debug(f"Simulation Input - Remove: {holdings_to_remove_input}")
        log.debug(f"Simulation Input - Add: {securities_to_add_input}")

        # --- Get Current Portfolio State ---
        # Ensure security_type is prefetched for concentration calc
        current_holdings = list(
            portfolio.holdings.select_related('security', 'security__security_type').all()
        )
        # Calculate metrics for the current state
        current_metrics = calculate_portfolio_metrics(current_holdings)

        # --- Build Simulated Portfolio State ---
        simulated_holdings = list(current_holdings) # Start with a copy

        # 1. Remove specified holdings
        removed_tickets = {item['external_ticket'] for item in holdings_to_remove_input}
        holdings_kept = []
        for holding in simulated_holdings:
            if holding.external_ticket not in removed_tickets:
                holdings_kept.append(holding)
            else:
                log.debug(f"Simulating removal of holding ticket {holding.external_ticket} (CUSIP: {holding.security.cusip})")
        simulated_holdings = holdings_kept # Update list to only kept holdings

        # 2. Add specified securities (as hypothetical holding dicts)
        securities_added_cusips = {item['cusip'].upper() for item in securities_to_add_input}
        # Fetch all required securities in one query, including security_type
        try:
            securities_to_add_db = Security.objects.select_related('security_type').filter(
                cusip__in=securities_added_cusips
            )
            securities_map = {sec.cusip: sec for sec in securities_to_add_db}
        except Exception as e:
             log.error(f"Error fetching securities for simulation: {e}", exc_info=True)
             return Response({"error": "Could not retrieve securities to add for simulation."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        for item_to_add in securities_to_add_input:
            cusip = item_to_add['cusip'].upper()
            face_amount = item_to_add['original_face_amount'] # Already validated as Decimal by serializer
            security_obj = securities_map.get(cusip)

            if not security_obj:
                log.warning(f"Simulation: Security with CUSIP {cusip} not found in database. Cannot add to simulation.")
                # Optionally return an error, or just skip this addition
                return Response({"error": f"Security CUSIP {cusip} not found."}, status=status.HTTP_400_BAD_REQUEST)

            log.debug(f"Simulating addition of CUSIP {cusip} with face amount {face_amount}")
            # Create a dictionary representing the hypothetical holding
            # Include fields needed by calculate_portfolio_metrics
            hypothetical_holding = {
                "security": security_obj,
                "original_face_amount": face_amount,
                # Assume market price = 100 and book price = 100 for added securities
                # if gain/loss calculation is needed. This is a simplification.
                "market_price": Decimal("100.0"),
                "book_price": Decimal("100.0"),
                # Add other fields if calculate_portfolio_metrics needs them
            }
            simulated_holdings.append(hypothetical_holding)

        # --- Calculate Simulated Portfolio Metrics ---
        simulated_metrics = calculate_portfolio_metrics(simulated_holdings)

        # --- Calculate Deltas ---
        delta_metrics = {}
        # Define fields to calculate delta for (add complex ones later)
        numeric_fields = ["total_par_value", "gain_loss"]
        # Add complex metric keys here once calculated
        # complex_metric_keys = ["wal", "duration", "yield"]
        # all_numeric_keys = numeric_fields + complex_metric_keys

        try:
            for field in numeric_fields: # Iterate only over currently calculated fields
                current_val = current_metrics.get(field, Decimal("0.00"))
                simulated_val = simulated_metrics.get(field, Decimal("0.00"))
                # Ensure values are Decimal before subtraction
                if not isinstance(current_val, Decimal): current_val = Decimal(str(current_val or "0.00"))
                if not isinstance(simulated_val, Decimal): simulated_val = Decimal(str(simulated_val or "0.00"))

                delta = simulated_val - current_val
                # Format delta appropriately (e.g., currency)
                delta_metrics[field] = delta.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

            # Delta for count
            delta_metrics["holding_count"] = simulated_metrics.get("holding_count", 0) - current_metrics.get("holding_count", 0)

            # Delta for concentration (more complex: compare dicts)
            delta_metrics["concentration_by_sec_type"] = {}
            all_sec_types = set(current_metrics["concentration_by_sec_type"].keys()) | set(simulated_metrics["concentration_by_sec_type"].keys())
            for sec_type_name in all_sec_types:
                current_pct = current_metrics["concentration_by_sec_type"].get(sec_type_name, Decimal("0.00"))
                simulated_pct = simulated_metrics["concentration_by_sec_type"].get(sec_type_name, Decimal("0.00"))
                delta_pct = simulated_pct - current_pct
                delta_metrics["concentration_by_sec_type"][sec_type_name] = delta_pct.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


        except (TypeError, InvalidOperation) as calc_e:
             log.error(f"Error calculating simulation deltas: {calc_e}", exc_info=True)
             # Return partial results or an error
             return Response({"error": "Error calculating simulation differences."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


        # --- Format Response ---
        # Convert Decimals back to strings for JSON consistency
        def format_metrics(metrics_dict):
            formatted = {}
            for key, value in metrics_dict.items():
                if key == "concentration_by_sec_type":
                    # Format concentration percentages
                    formatted[key] = {k: f"{v:.2f}%" for k, v in value.items()}
                elif isinstance(value, Decimal):
                    # Format currency/par/gain-loss values
                    formatted[key] = f"{value:,.2f}"
                # Add specific formatting for WAL, Duration, Yield later if needed
                # elif key == "wal": formatted[key] = f"{value:.2f}" # Example
                # elif key == "duration": formatted[key] = f"{value:.2f}" # Example
                # elif key == "yield": formatted[key] = f"{value:.4f}%" # Example
                else:
                    formatted[key] = value # Keep non-decimals (like count) as they are
            return formatted

        # Format delta concentration separately
        def format_delta_concentration(conc_dict):
            formatted = {}
            for key, value in conc_dict.items():
                 formatted[key] = f"{value:+.2f}%" # Show sign for delta percentage
            return formatted

        delta_formatted = format_metrics(delta_metrics)
        if "concentration_by_sec_type" in delta_metrics:
             delta_formatted["concentration_by_sec_type"] = format_delta_concentration(delta_metrics["concentration_by_sec_type"])


        # --- Add Placeholders for Analysis ---
        analysis_results = {
            "break_even": "Calculation logic not implemented.",
            "horizon_net_benefit": "Calculation logic not implemented."
        }
        # --- End Placeholders ---


        response_data = {
            "message": "Simulation complete.",
            "current_portfolio": format_metrics(current_metrics),
            "simulated_portfolio": format_metrics(simulated_metrics),
            "delta": delta_formatted,
            "analysis": analysis_results # Include analysis placeholders
        }

        log.info(f"Simulation for portfolio {portfolio.id} completed successfully.")
        return Response(response_data, status=status.HTTP_200_OK)


class CustomerHoldingViewSet(viewsets.ModelViewSet):
    """ API endpoint for viewing and editing CustomerHolding instances. """
    serializer_class = CustomerHoldingSerializer
    permission_classes = [permissions.IsAuthenticated]
    # *** ADDED OrderingFilter ***
    filter_backends = [DjangoFilterBackend, OrderingFilter]
    filterset_fields = {
        'portfolio': ['exact'],
        'portfolio__owner': ['exact'],
        'portfolio__owner__customer_number': ['exact'], # Filter by owner's number
        'security__cusip': ['exact', 'icontains'], # Filter by security CUSIP
        'security__description': ['exact', 'icontains'],
        'intention_code': ['exact'], # Filter by intention
        'settlement_date': ['exact', 'gte', 'lte', 'range'], # Date filters
    }
    # *** UPDATED ordering_fields for CustomerHoldingViewSet ***
    ordering_fields = [
        'external_ticket', 'intention_code', 'original_face_amount',
        'settlement_date', 'settlement_price', 'book_price', 'book_yield',
        'market_date', 'market_price', 'market_yield',
        'security__cusip', 'security__description', 'security__maturity_date',
        'security__coupon', 'security__factor',
        'portfolio__name', 'last_modified_at',
        'calculated_par_value',
        # *** ADDED WAL and Duration/Avg Life fields ***
        'security__wal', # Sort by Security's WAL field
        'holding_duration', # Sort by Holding's duration field
        'holding_average_life', # Sort by Holding's average life field
    ]
    ordering = ['portfolio', 'security__cusip'] # Default ordering

    def get_queryset(self):
        """
        Filter holdings based on user association or admin status.
        Annotates the queryset with calculated_par_value for sorting.
        """
        user = self.request.user
        # Optimize by selecting related portfolio, owner, and security
        base_queryset = CustomerHolding.objects.select_related(
            'portfolio__owner',
            'security',
            # Add related fields from security if needed often
            'security__security_type',
            'security__interest_schedule'
        )

        # Apply permission filtering first
        if user.is_staff or user.is_superuser:
            permitted_queryset = base_queryset.all()
        else:
            # Filter holdings belonging to portfolios owned by customers associated with the user
            permitted_queryset = base_queryset.filter(portfolio__owner__users=user).distinct()

        # *** ANNOTATE queryset to calculate par value ***
        # Use Coalesce to handle potential null factor, default to 1.0
        annotated_queryset = permitted_queryset.annotate(
            calculated_par_value=ExpressionWrapper(
                F('original_face_amount') * Coalesce(F('security__factor'), Value(Decimal('1.0'))),
                output_field=DecimalField(max_digits=40, decimal_places=8) # Match precision if needed
            )
        )

        # The DjangoFilterBackend and OrderingFilter will automatically apply further
        # filtering/ordering based on query parameters to the annotated_queryset.
        # OrderingFilter can now use 'calculated_par_value'.
        return annotated_queryset

    def perform_create(self, serializer):
        """ Validate user permission before creating a holding. """
        user = self.request.user
        portfolio = serializer.validated_data.get('portfolio')
        # Portfolio is required by the serializer, so it should exist here
        if not portfolio:
             # Should be caught by serializer validation, but double-check
             log.error(f"perform_create CustomerHolding: Portfolio missing in validated_data.")
             raise serializers.ValidationError({"portfolio": "Portfolio is required."})

        # Check if user has permission for the target portfolio's owner
        if not (user.is_staff or user.is_superuser):
            if not user.customers.filter(id=portfolio.owner_id).exists():
                log.warning(f"User {user.username} permission denied to create holding in portfolio {portfolio.id} (Owner: {portfolio.owner_id}).")
                raise PermissionDenied("You do not have permission to add holdings to this portfolio.")

        # If permission granted, save the holding
        try:
            instance = serializer.save()
            log.info(f"User {user.username} created holding (ExtTicket: {instance.external_ticket}) for sec {instance.security.cusip} in portfolio {portfolio.id}")
        except IntegrityError as ie:
            # Catch potential unique constraint violations (e.g., external_ticket, portfolio+security)
            log.error(f"IntegrityError creating holding for user {user.username} in portfolio {portfolio.id}: {ie}", exc_info=True)
            # Raise ValidationError to return a 400 response
            raise serializers.ValidationError(f"Could not create holding due to a data conflict: {ie}") from ie
        except Exception as e:
            log.error(f"Error creating holding for user {user.username} in portfolio {portfolio.id}: {e}", exc_info=True)
            raise # Re-raise other unexpected errors


# ImportExcelView needs updates based on new task logic/filenames
class ImportExcelView(GenericAPIView):
    """ API endpoint for Admins to upload Excel files for bulk import. """
    parser_classes = [MultiPartParser, FormParser]
    permission_classes = [permissions.IsAdminUser] # Only admins can upload
    serializer_class = ExcelUploadSerializer # Simple serializer for file upload

    def post(self, request, format=None):
        """ Handle file upload and trigger the appropriate Celery task. """
        serializer = self.get_serializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        file_obj = serializer.validated_data['file']
        original_filename = file_obj.name
        log.info(f"Admin {request.user.username} attempting to upload file: {original_filename}")

        task_to_run = None
        task_name = "Unknown Import"
        file_path_str = None # Store path for task argument

        # --- Determine which task to run based on filename ---
        # Use expected filenames from tasks.py
        expected_filenames = {
            'Security.xlsx': (import_securities_from_excel, "Securities Import"),
            'Customer.xlsx': (import_customers_from_excel, "Customers Import"),
            'Holdings.xlsx': (import_holdings_from_excel, "Holdings Import"),
            'muni_offerings.xlsx': (import_muni_offerings_from_excel, "Municipal Offerings Import"),
            # Add lookup file imports if needed
            'Salesperson.xlsx': (import_salespersons_from_excel, "Salespersons Import"),
            'SecurityType.xlsx': (import_security_types_from_excel, "Security Types Import"),
            'InterestSchedule.xlsx': (import_interest_schedules_from_excel, "Interest Schedules Import"),
        }

        matched = False
        for expected_name, (task_func, friendly_name) in expected_filenames.items():
            # Allow case-insensitive matching, maybe check endswith('.xlsx') too
            if original_filename.lower() == expected_name.lower():
                task_to_run = task_func
                task_name = friendly_name
                matched = True
                log.info(f"Matched uploaded file '{original_filename}' to task '{task_name}'")
                break

        if not matched:
            log.warning(f"Uploaded file '{original_filename}' does not match expected import filenames.")
            return Response({
                'error': "Filename does not match expected import types (e.g., Security.xlsx, Customer.xlsx, Holdings.xlsx, muni_offerings.xlsx, Salesperson.xlsx, etc.)."
            }, status=status.HTTP_400_BAD_REQUEST)

        # --- Save file securely ---
        # Define a secure upload directory (consider making this configurable)
        upload_dir = settings.BASE_DIR / 'data' / 'imports' / 'uploads'
        upload_dir.mkdir(parents=True, exist_ok=True) # Ensure directory exists

        # Generate a unique filename to prevent conflicts/overwrites
        file_extension = os.path.splitext(original_filename)[1]
        unique_filename = f"{uuid.uuid4()}{file_extension}"
        file_path = upload_dir / unique_filename
        file_path_str = str(file_path)

        try:
            with open(file_path, 'wb+') as destination:
                for chunk in file_obj.chunks():
                    destination.write(chunk)
            log.info(f"Successfully saved uploaded file '{original_filename}' as '{file_path_str}'.")
        except Exception as e:
            log.error(f"Error saving uploaded file '{original_filename}' to '{file_path_str}': {e}", exc_info=True)
            # Attempt cleanup if save failed
            if file_path.exists():
                try: os.remove(file_path)
                except OSError: pass
            return Response({'error': f'Failed to save uploaded file: {e}'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        # --- Trigger Celery task ---
        if task_to_run and file_path_str:
            try:
                # Use immutable signature .si() to pass the file path
                task_signature = task_to_run.si(file_path_str)
                task_result = task_signature.delay()
                log.info(f"Triggered Celery task {task_to_run.__name__} ID {task_result.id} for file {file_path_str}")
                return Response({
                    'message': f'File "{original_filename}" uploaded. {task_name} task ({task_result.id}) started.',
                    'task_id': task_result.id
                }, status=status.HTTP_202_ACCEPTED)
            except Exception as e:
                log.error(f"Error triggering Celery task for file '{file_path_str}': {e}", exc_info=True)
                # Attempt cleanup if task trigger failed
                if file_path.exists():
                    try: os.remove(file_path); log.info(f"Cleaned up '{file_path_str}' after task trigger failure.")
                    except OSError as re: log.error(f"Error removing '{file_path_str}': {re}")
                return Response({'error': f'File saved, but failed to trigger processing task: {e}'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        else:
             # Should not happen if matched=True, but handle defensively
             log.error("Internal error: Task or file path missing after successful file match and save.")
             return Response({'error': 'Internal server error during import initiation.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


# EmailSalespersonInterestView needs update for salesperson FK
class EmailSalespersonInterestView(APIView):
    """ API endpoint for users to notify salesperson about SELL interest. """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, *args, **kwargs):
        """ Handles POST request to trigger sell interest email. """
        serializer = SalespersonInterestSerializer(data=request.data)
        if not serializer.is_valid():
            log.warning(f"Invalid data for SELL interest email from {request.user.username}: {serializer.errors}")
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        validated_data = serializer.validated_data
        customer_id = validated_data['customer_id'] # Internal Customer ID
        selected_bonds = validated_data['selected_bonds']

        try:
            # Fetch customer and their assigned salesperson
            customer = Customer.objects.select_related('salesperson').get(id=customer_id)
        except Customer.DoesNotExist:
            log.warning(f"User {request.user.username} requested SELL email for non-existent customer ID: {customer_id}")
            return Response({"error": f"Customer with ID {customer_id} not found."}, status=status.HTTP_404_NOT_FOUND)

        # Verify User Permission
        user = request.user
        is_admin = user.is_staff or user.is_superuser
        if not (is_admin or user.customers.filter(id=customer.id).exists()):
            log.warning(f"User {user.username} permission denied for SELL email, customer ID: {customer_id}")
            return Response({"error": "Permission denied for this customer."}, status=status.HTTP_403_FORBIDDEN)

        # Check if salesperson and email exist
        salesperson = customer.salesperson
        if not salesperson or not salesperson.email:
            log.warning(f"Attempted SELL email for customer {customer.customer_number}, but no salesperson or salesperson email is configured.")
            return Response({"error": "Salesperson email is not configured for this customer."}, status=status.HTTP_400_BAD_REQUEST)

        salesperson_email = salesperson.email
        salesperson_name = salesperson.name or '' # Use salesperson name

        # Trigger Asynchronous Email Task
        try:
            # Pass necessary details to the task
            task_signature = send_salesperson_interest_email.s(
                salesperson_email=salesperson_email,
                salesperson_name=salesperson_name,
                customer_name=customer.name or '', # Customer name is required now
                customer_number=customer.customer_number, # Customer number is required now
                selected_bonds=selected_bonds
            )
            task_result = task_signature.delay()
            log.info(f"User {user.username} triggered SELL interest email task {task_result.id} for customer {customer.customer_number} to {salesperson_email}")
            return Response({"message": "Email task queued successfully. The salesperson will be notified."}, status=status.HTTP_200_OK)
        except Exception as e:
            log.error(f"Error triggering Celery task 'send_salesperson_interest_email' for customer {customer.customer_number}: {e}", exc_info=True)
            return Response({"error": "Failed to queue email task. Please try again later."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


# MunicipalOfferingViewSet (No model changes yet, but could add filters)
class MunicipalOfferingViewSet(viewsets.ReadOnlyModelViewSet):
    """ API endpoint that allows municipal offerings to be viewed. """
    queryset = MunicipalOffering.objects.all() # Default ordering removed here, handled by OrderingFilter
    serializer_class = MunicipalOfferingSerializer
    permission_classes = [permissions.IsAuthenticated] # All authenticated users can view offerings
    # *** ADDED OrderingFilter ***
    filter_backends = [DjangoFilterBackend, OrderingFilter]
    filterset_fields = {
        'cusip': ['exact', 'icontains'],
        'description': ['exact', 'icontains'],
        'state': ['exact'],
        'moody_rating': ['exact'],
        'sp_rating': ['exact'],
        'insurance': ['exact', 'icontains'],
        # Add other fields if needed, e.g., maturity_date ranges
        # 'maturity_date': ['exact', 'gte', 'lte', 'range'],
    }
    # *** ADDED ordering_fields ***
    ordering_fields = [
        'cusip', 'description', 'amount', 'coupon', 'maturity_date',
        'yield_rate', 'price', 'state', 'moody_rating', 'sp_rating',
        'call_date', 'call_price', 'insurance', 'last_updated'
    ]
    ordering = ['maturity_date', 'cusip'] # Default ordering


# EmailSalespersonMuniBuyInterestView needs update for salesperson FK
class EmailSalespersonMuniBuyInterestView(APIView):
    """ API endpoint for users to notify salesperson about BUY interest in municipal offerings. """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, *args, **kwargs):
        """ Handles the POST request to send the buy interest email. """
        serializer = MuniBuyInterestSerializer(data=request.data)
        if not serializer.is_valid():
            log.warning(f"Invalid data for muni BUY interest email from {request.user.username}: {serializer.errors}")
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        validated_data = serializer.validated_data
        customer_id = validated_data['customer_id'] # Internal Customer ID
        selected_offerings = validated_data['selected_offerings']

        # Retrieve Customer and Salesperson
        try:
            customer = Customer.objects.select_related('salesperson').get(id=customer_id)
        except Customer.DoesNotExist:
            log.warning(f"User {request.user.username} requested muni BUY email for non-existent customer ID: {customer_id}")
            return Response({"error": f"Customer with ID {customer_id} not found."}, status=status.HTTP_404_NOT_FOUND)

        # Verify User Permission
        user = request.user
        is_admin = user.is_staff or user.is_superuser
        if not (is_admin or user.customers.filter(id=customer.id).exists()):
            log.warning(f"User {user.username} permission denied for muni BUY email, customer ID: {customer_id}")
            return Response({"error": "You do not have permission to perform this action for this customer."}, status=status.HTTP_403_FORBIDDEN)

        # Check for Salesperson Email
        salesperson = customer.salesperson
        if not salesperson or not salesperson.email:
            log.warning(f"Attempted muni BUY email for customer {customer.customer_number}, but no salesperson or salesperson email configured.")
            return Response({"error": "Salesperson email is not configured for this customer."}, status=status.HTTP_400_BAD_REQUEST)

        salesperson_email = salesperson.email
        salesperson_name = salesperson.name or ''

        # Trigger Asynchronous Email Task
        try:
            task_signature = send_salesperson_muni_buy_interest_email.s(
                salesperson_email=salesperson_email,
                salesperson_name=salesperson_name,
                customer_name=customer.name, # Name is required now
                customer_number=customer.customer_number, # Number is required now
                selected_offerings=selected_offerings
            )
            task_result = task_signature.delay()
            log.info(f"User {user.username} triggered muni BUY interest email task {task_result.id} for customer {customer.customer_number} to {salesperson_email}")
            return Response({"message": "Email task queued successfully. The salesperson will be notified of the buy interest."}, status=status.HTTP_200_OK)
        except Exception as e:
            log.error(f"Error triggering Celery task 'send_salesperson_muni_buy_interest_email' for customer {customer.customer_number}: {e}", exc_info=True)
            return Response({"error": "Failed to queue email task. Please try again later."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

