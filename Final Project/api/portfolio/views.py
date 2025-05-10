# portfolio/views.py

import os
import logging
import uuid
from django.conf import settings
from django.shortcuts import render, get_object_or_404
from django.contrib.auth.decorators import login_required
from django.core.exceptions import PermissionDenied, ObjectDoesNotExist, ValidationError as DjangoValidationError
from django.db import transaction, IntegrityError
from django.db.models import Sum, F, Value, Max, ExpressionWrapper, DecimalField
from django.db.models.functions import Coalesce
from django.utils import timezone

from decimal import Decimal, ROUND_HALF_UP, InvalidOperation
from datetime import date
from collections import defaultdict


from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.filters import OrderingFilter
from rest_framework import viewsets, status, permissions
from rest_framework.decorators import action
from rest_framework.generics import GenericAPIView
from rest_framework.views import APIView
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.response import Response
from rest_framework import serializers

# Import Celery tasks
from .tasks import (
    import_securities_from_excel,
    import_customers_from_excel,
    import_holdings_from_excel,
    send_salesperson_interest_email,
    import_muni_offerings_from_excel,
    send_salesperson_muni_buy_interest_email,
    import_salespersons_from_excel,
    import_security_types_from_excel,
    import_interest_schedules_from_excel,
)
# Import models and serializers
from .models import (
    Customer, Security, Portfolio, CustomerHolding, MunicipalOffering,
    Salesperson, SecurityType, InterestSchedule
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
    PortfolioSimulationSerializer, # This should now include OfferingToBuySerializer
)
# Import utility functions and the new FilterSet
from .utils import generate_quantlib_cashflows, calculate_bond_analytics
from .filters import CustomerHoldingFilterSet, MuniOfferingFilterSet

# Setup logging
log = logging.getLogger(__name__)

# Define a high base for internally generated tickets for copied holdings
COPIED_HOLDING_TICKET_BASE = 1_000_000_000

# --- View to serve the main index.html page ---
@login_required
def portfolio_analyzer_view(request):
    """ Serves the main index.html template. """
    context = {'is_admin': request.user.is_staff or request.user.is_superuser}
    return render(request, 'index.html', context)


# --- Helper Function for Simulation Calculations ---
def calculate_portfolio_metrics(holdings_list):
    """
    Calculates basic metrics for a list of holding objects/dicts.
    Handles both actual CustomerHolding instances and hypothetical buy dictionaries.
    """
    metrics = {
        "total_par_value": Decimal("0.00"),
        "total_market_value": Decimal("0.00"),
        "total_book_value": Decimal("0.00"),
        "gain_loss": Decimal("0.00"),
        "concentration_by_sec_type": {},
        "holding_count": 0,
        "wal": None, "duration": None, "yield": None, # Placeholders
    }
    if not holdings_list:
        return metrics

    total_par = Decimal("0.00")
    total_market_value_agg = Decimal("0.00")
    total_book_value_agg = Decimal("0.00")
    par_by_sec_type = defaultdict(Decimal)
    valid_holdings_count = 0

    for holding_data in holdings_list:
        is_dict = isinstance(holding_data, dict)
        security_obj_for_metrics = None # Will hold the actual Security object or a compatible structure

        # --- Data Extraction based on type of holding_data ---
        if is_dict and holding_data.get('is_hypothetical_buy'):
            # This is a simulated "buy" from an offering
            # Fields like cusip, description, factor, security_type_name are directly in holding_data
            original_face_amount = holding_data.get('original_face_amount')
            market_price = holding_data.get('market_price')
            book_price = holding_data.get('book_price')
            factor = holding_data.get('factor', Decimal("1.0")) # Default factor if not present
            sec_type_name = holding_data.get('security_type_name', "Unknown Offering Type")

            log.debug(f"Simulated BUY: CUSIP {holding_data.get('cusip')}, Face {original_face_amount}, MktPrice {market_price}, BookPrice {book_price}, Factor {factor}, Type {sec_type_name}")

        elif is_dict: # Older hypothetical holding structure (if any part still uses it - should be phased out)
            security_obj_for_metrics = holding_data.get('security')
            original_face_amount = holding_data.get('original_face_amount')
            market_price = holding_data.get('market_price')
            book_price = holding_data.get('book_price')
            # For this older dict structure, get factor and type from the security object
            factor = security_obj_for_metrics.factor if security_obj_for_metrics and security_obj_for_metrics.factor is not None else Decimal("1.0")
            sec_type_name = security_obj_for_metrics.security_type.name if security_obj_for_metrics and security_obj_for_metrics.security_type else "Unknown"
            log.debug(f"Simulated DICT (non-buy): CUSIP {security_obj_for_metrics.cusip if security_obj_for_metrics else 'N/A'}, Face {original_face_amount}, MktPrice {market_price}, BookPrice {book_price}")

        else: # Actual CustomerHolding object
            security_obj_for_metrics = holding_data.security
            original_face_amount = holding_data.original_face_amount
            market_price = holding_data.market_price
            book_price = holding_data.book_price
            # Get factor and type from the actual security object
            factor = security_obj_for_metrics.factor if security_obj_for_metrics and security_obj_for_metrics.factor is not None else Decimal("1.0")
            sec_type_name = security_obj_for_metrics.security_type.name if security_obj_for_metrics and security_obj_for_metrics.security_type else "Unknown"
            log.debug(f"Actual Holding: ExtTicket {holding_data.external_ticket}, CUSIP {security_obj_for_metrics.cusip if security_obj_for_metrics else 'N/A'}, Face {original_face_amount}, MktPrice {market_price}, BookPrice {book_price}")

        # Validate essential data for metric calculation
        if original_face_amount is None or original_face_amount <= 0:
            log.warning(f"Skipping metric calculation for an item: Invalid face amount. Face: {original_face_amount}")
            continue
        if not (is_dict and holding_data.get('is_hypothetical_buy')) and not security_obj_for_metrics:
            # Only raise this if it's not a hypothetical buy from offering (which doesn't have a full security_obj)
            log.warning(f"Skipping metric calculation for an item: No security object associated.")
            continue


        # Ensure financial values are Decimals
        try:
            original_face_amount = Decimal(str(original_face_amount))
            if market_price is not None: market_price = Decimal(str(market_price))
            if book_price is not None: book_price = Decimal(str(book_price))
            if not isinstance(factor, Decimal): factor = Decimal(str(factor))
        except InvalidOperation:
            log.warning(f"Could not convert financial values to Decimal for metric calculation. Face: {original_face_amount}, MktP: {market_price}, BookP: {book_price}, Factor: {factor}")
            continue

        current_par_for_item = original_face_amount * factor
        total_par += current_par_for_item

        if book_price is not None:
            item_book_value = (current_par_for_item * book_price) / Decimal("100.0")
            total_book_value_agg += item_book_value
            log.debug(f"  Item Book Value: {item_book_value:.2f} (Par: {current_par_for_item:.2f}, BookPrice: {book_price})")

        if market_price is not None:
            item_market_value = (current_par_for_item * market_price) / Decimal("100.0")
            total_market_value_agg += item_market_value
            log.debug(f"  Item Market Value: {item_market_value:.2f} (Par: {current_par_for_item:.2f}, MarketPrice: {market_price})")

        par_by_sec_type[sec_type_name] += current_par_for_item
        valid_holdings_count += 1

    metrics["total_par_value"] = total_par.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    metrics["total_market_value"] = total_market_value_agg.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    metrics["total_book_value"] = total_book_value_agg.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    metrics["holding_count"] = valid_holdings_count

    if metrics["total_book_value"] != Decimal("0.00") or metrics["total_market_value"] != Decimal("0.00"):
        metrics["gain_loss"] = (metrics["total_market_value"] - metrics["total_book_value"]).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    else:
        metrics["gain_loss"] = Decimal("0.00")

    if total_par > 0:
        for sec_type_name_key, type_par_value in par_by_sec_type.items(): # Use different var names
            percentage = (type_par_value / total_par * 100).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            metrics["concentration_by_sec_type"][sec_type_name_key] = percentage
    else:
        metrics["concentration_by_sec_type"] = {}

    log.debug(f"Calculated metrics: TotalPar={metrics['total_par_value']}, TotalMktVal={metrics['total_market_value']}, TotalBookVal={metrics['total_book_value']}, GainLoss={metrics['gain_loss']}, Count={metrics['holding_count']}")
    return metrics


# --- API ViewSets ---

class CustomerViewSet(viewsets.ModelViewSet):
    """ API endpoint for viewing and editing Customer instances. """
    serializer_class = CustomerSerializer
    permission_classes = [permissions.IsAuthenticated]
    filter_backends = [DjangoFilterBackend, OrderingFilter]
    filterset_fields = ['customer_number', 'state', 'salesperson__salesperson_id']
    ordering_fields = ['customer_number', 'name', 'state', 'salesperson__name', 'last_modified_at']
    ordering = ['customer_number']

    def get_queryset(self):
        user = self.request.user
        base_queryset = Customer.objects.select_related('salesperson')
        if user.is_staff or user.is_superuser: return base_queryset.all()
        # For non-admin users, if distinct results are needed and this causes issues,
        # alternative strategies for distinctness might be required.
        return base_queryset.filter(users=user).distinct()

class SecurityViewSet(viewsets.ModelViewSet):
    """ API endpoint for viewing and editing Security instances. """
    lookup_field = 'cusip'
    serializer_class = SecuritySerializer
    permission_classes = [permissions.IsAuthenticated]
    filter_backends = [DjangoFilterBackend, OrderingFilter]
    filterset_fields = {
        'cusip': ['exact', 'icontains'], 'security_type__type_id': ['exact'],
        'tax_code': ['exact'], 'interest_calc_code': ['exact'],
        'allows_paydown': ['exact'], 'callable_flag': ['exact'], 'currency': ['exact'],
        'sector': ['exact', 'icontains'], 'state_of_issuer': ['exact'],
        'moody_rating': ['exact'], 'sp_rating': ['exact'], 'fitch_rating': ['exact'],
        'description': ['exact', 'icontains'],
    }
    ordering_fields = [
        'cusip', 'description', 'maturity_date', 'issue_date', 'coupon',
        'tax_code', 'sector', 'state_of_issuer', 'moody_rating', 'sp_rating',
        'fitch_rating', 'security_type__name', 'last_modified_at', 'wal', 'cpr',
    ]
    ordering = ['cusip']

    def get_queryset(self):
        return Security.objects.select_related('security_type', 'interest_schedule').all()

class PortfolioViewSet(viewsets.ModelViewSet):
    """ API endpoint for viewing and editing Portfolio instances. """
    serializer_class = PortfolioSerializer
    permission_classes = [permissions.IsAuthenticated]
    filter_backends = [DjangoFilterBackend, OrderingFilter]
    filterset_fields = ['owner']
    ordering_fields = ['name', 'owner__customer_number', 'owner__name', 'created_at', 'is_default']
    ordering = ['owner__customer_number', 'name']

    def get_queryset(self):
        user = self.request.user
        base_queryset = Portfolio.objects.select_related('owner')
        if user.is_staff or user.is_superuser:
            permitted_queryset = base_queryset.all()
        else:
            permitted_queryset = base_queryset.filter(owner__users=user).distinct()
        return permitted_queryset

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context['request'] = self.request
        return context

    def create(self, request, *args, **kwargs):
        log.info(f"PortfolioViewSet CREATE - Raw request.data: {request.data}")
        log.info(f"PortfolioViewSet CREATE - User: {request.user}, IsAdmin: {request.user.is_staff or request.user.is_superuser}")
        serializer = self.get_serializer(data=request.data)
        try:
            serializer.is_valid(raise_exception=True)
            log.info("PortfolioViewSet CREATE - serializer.is_valid() PASSED.")
            self.perform_create(serializer)
            headers = self.get_success_headers(serializer.data)
            return Response(serializer.data, status=status.HTTP_201_CREATED, headers=headers)
        except serializers.ValidationError as ve:
             log.warning(f"PortfolioViewSet CREATE - VALIDATION FAILED. Errors: {ve.detail}")
             return Response(ve.detail, status=status.HTTP_400_BAD_REQUEST)
        except Exception as e:
            log.error(f"PortfolioViewSet CREATE - UNEXPECTED ERROR: {e}", exc_info=True)
            return Response({"error": "An unexpected error occurred during portfolio creation."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


    def perform_create(self, serializer):
        log.info("PortfolioViewSet perform_create - Starting portfolio creation...")
        owner = serializer.validated_data.get('owner')
        if not owner:
            log.error(f"PortfolioViewSet perform_create: Owner missing...")
            raise serializers.ValidationError("Internal error: Could not determine portfolio owner.")
        holdings_to_copy_qs = serializer.validated_data.get('_holdings_to_copy_qs')
        new_portfolio = None
        try:
            with transaction.atomic():
                log.info("PortfolioViewSet perform_create - Calling serializer.save()...")
                new_portfolio = serializer.save()
                log.info(f"PortfolioViewSet perform_create - Portfolio '{new_portfolio.name}' created.")
                if holdings_to_copy_qs:
                    log.info(f"PortfolioViewSet perform_create - Copying {holdings_to_copy_qs.count()} holdings...")
                    max_ticket_result = CustomerHolding.objects.aggregate(max_ticket=Coalesce(Max('external_ticket'), Value(0)))
                    current_max_ticket = max_ticket_result['max_ticket']
                    next_ticket = max(current_max_ticket + 1, COPIED_HOLDING_TICKET_BASE)
                    log.info(f"Starting next external_ticket at: {next_ticket}")
                    new_holdings_to_create = []
                    for original_holding in holdings_to_copy_qs.select_related('security'):
                        new_holdings_to_create.append(CustomerHolding(
                            external_ticket=next_ticket, portfolio=new_portfolio, security=original_holding.security,
                            intention_code=original_holding.intention_code, original_face_amount=original_holding.original_face_amount,
                            settlement_date=original_holding.settlement_date, settlement_price=original_holding.settlement_price,
                            book_price=original_holding.book_price, book_yield=original_holding.book_yield,
                            holding_duration=original_holding.holding_duration, holding_average_life=original_holding.holding_average_life,
                            holding_average_life_date=original_holding.holding_average_life_date, market_date=original_holding.market_date,
                            market_price=original_holding.market_price, market_yield=original_holding.market_yield
                        ))
                        next_ticket += 1
                    if new_holdings_to_create:
                        log.info(f"PortfolioViewSet perform_create - Attempting bulk create...")
                        try:
                            created_list = CustomerHolding.objects.bulk_create(new_holdings_to_create)
                            log.info(f"PortfolioViewSet perform_create - Bulk created {len(created_list)} holdings.")
                        except Exception as bulk_ex:
                            log.error(f"PortfolioViewSet perform_create - Error during bulk copy: {bulk_ex}", exc_info=True)
                            raise serializers.ValidationError({"initial_holding_ids": f"Error copying holdings: {bulk_ex}"})
        except Exception as e:
            log.error(f"PortfolioViewSet perform_create - TRANSACTION ERROR: {e}", exc_info=True)
            raise serializers.ValidationError(f"Error creating portfolio/copying holdings: {e}") from e
        log.info("PortfolioViewSet perform_create - Finished.")

    def perform_destroy(self, instance):
        user = self.request.user
        log.info(f"User {user.username} deleting portfolio '{instance.name}'")
        if not (user.is_staff or user.is_superuser):
            if not user.customers.filter(id=instance.owner_id).exists():
                raise PermissionDenied("Permission denied.")
        if instance.is_default:
            raise serializers.ValidationError({"detail": "Cannot delete default portfolio."})
        instance.delete()

    @action(detail=True, methods=['post'], url_path='simulate_swap', url_name='simulate-swap', permission_classes=[permissions.IsAuthenticated])
    def simulate_swap(self, request, pk=None):
        portfolio = self.get_object()
        log.info(f"Simulate swap requested for portfolio {portfolio.name} (ID: {portfolio.id}) by user {request.user.username}")
        log.debug(f"Simulate swap - Raw request data: {request.data}")

        serializer = PortfolioSimulationSerializer(data=request.data)
        if not serializer.is_valid():
            log.warning(f"Invalid simulation input for portfolio {portfolio.id}: {serializer.errors}")
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        validated_data = serializer.validated_data
        holdings_to_remove_input = validated_data.get('holdings_to_remove', [])
        offerings_to_buy_input = validated_data.get('offerings_to_buy', [])

        # --- 1. Calculate metrics for the CURRENT portfolio ---
        current_holdings_qs = portfolio.holdings.select_related(
            'security', 'security__security_type', 'security__interest_schedule'
        ).all()
        current_metrics = calculate_portfolio_metrics(list(current_holdings_qs))
        log.debug(f"Current portfolio metrics: {current_metrics}")

        # --- 2. Construct the SIMULATED portfolio ---
        simulated_holdings_list = []

        # Start with existing holdings and filter out those "sold"
        removed_tickets = {item['external_ticket'] for item in holdings_to_remove_input}
        for holding in current_holdings_qs:
            if holding.external_ticket not in removed_tickets:
                simulated_holdings_list.append(holding)
            else:
                log.debug(f"Simulating SALE of holding external_ticket: {holding.external_ticket}")

        # Add "bought" offerings as hypothetical holdings
        offering_cusips_to_buy = {item['offering_cusip'].upper() for item in offerings_to_buy_input}

        municipal_offerings_db = MunicipalOffering.objects.filter(cusip__in=offering_cusips_to_buy)
        offerings_map = {off.cusip: off for off in municipal_offerings_db}

        for item_to_buy in offerings_to_buy_input:
            offering_cusip = item_to_buy['offering_cusip'].upper()
            par_to_buy = item_to_buy['par_to_buy']

            offering_obj = offerings_map.get(offering_cusip)

            if not offering_obj:
                log.warning(f"Simulate swap: MunicipalOffering CUSIP {offering_cusip} not found.")
                return Response({"error": f"MunicipalOffering CUSIP {offering_cusip} not found."}, status=status.HTTP_400_BAD_REQUEST)

            # Construct hypothetical buy using ONLY offering data
            hypothetical_buy = {
                "is_hypothetical_buy": True,
                "cusip": offering_obj.cusip, # From MunicipalOffering
                "description": offering_obj.description, # From MunicipalOffering
                "original_face_amount": par_to_buy, # User input
                "market_price": offering_obj.price, # Price from MunicipalOffering
                "book_price": offering_obj.price, # For a new buy, book price is purchase price
                "factor": Decimal("1.0"), # Assume factor is 1.0 for new offerings
                "security_type_name": "Municipal Offering", # Generic type for concentration
                # Add other fields from MunicipalOffering if needed by calculate_portfolio_metrics
                # or for display, e.g., coupon, maturity_date.
                # For now, the core metrics rely on the above.
                "coupon": offering_obj.coupon,
                "maturity_date": offering_obj.maturity_date,
                # Placeholder for fields usually on Security model, if metrics function expects them
                # These might not be strictly necessary for value/gain-loss but could be for other analytics
                "allows_paydown": False, # Typical assumption for new issue unless specified
                "interest_calc_code": "c", # Common default (30/360) - make this configurable if needed
                "payments_per_year": 2, # Common default (Semi-annual) - make this configurable if needed
            }
            simulated_holdings_list.append(hypothetical_buy)
            log.debug(f"Simulating BUY of offering CUSIP: {offering_cusip}, Par: {par_to_buy}, Price: {offering_obj.price}, Desc: {offering_obj.description}")

        # --- 3. Calculate metrics for the SIMULATED portfolio ---
        simulated_metrics = calculate_portfolio_metrics(simulated_holdings_list)
        log.debug(f"Simulated portfolio metrics: {simulated_metrics}")

        # --- 4. Calculate DELTA metrics ---
        delta_metrics = {}
        all_metric_keys = set(current_metrics.keys()) | set(simulated_metrics.keys())

        for field in ["total_par_value", "gain_loss", "total_market_value", "total_book_value"]:
            current_val = current_metrics.get(field, Decimal("0.00"))
            simulated_val = simulated_metrics.get(field, Decimal("0.00"))
            if not isinstance(current_val, Decimal): current_val = Decimal(str(current_val or "0.00"))
            if not isinstance(simulated_val, Decimal): simulated_val = Decimal(str(simulated_val or "0.00"))
            delta = simulated_val - current_val
            delta_metrics[field] = delta.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

        delta_metrics["holding_count"] = simulated_metrics.get("holding_count", 0) - current_metrics.get("holding_count", 0)

        delta_metrics["concentration_by_sec_type"] = {}
        current_concentration = current_metrics.get("concentration_by_sec_type", {})
        simulated_concentration = simulated_metrics.get("concentration_by_sec_type", {})
        all_sec_types = set(current_concentration.keys()) | set(simulated_concentration.keys())

        for sec_type_name in all_sec_types:
            current_pct = current_concentration.get(sec_type_name, Decimal("0.00"))
            simulated_pct = simulated_concentration.get(sec_type_name, Decimal("0.00"))
            if not isinstance(current_pct, Decimal): current_pct = Decimal(str(current_pct or "0.00"))
            if not isinstance(simulated_pct, Decimal): simulated_pct = Decimal(str(simulated_pct or "0.00"))
            delta_pct = simulated_pct - current_pct
            delta_metrics["concentration_by_sec_type"][sec_type_name] = delta_pct.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

        log.debug(f"Delta metrics: {delta_metrics}")

        # --- 5. Format for Response ---
        def format_metrics_for_response(metrics_dict):
            formatted = {}
            for key, value in metrics_dict.items():
                if key == "concentration_by_sec_type":
                    formatted[key] = {k: f"{v:.2f}%" for k, v in value.items()}
                elif isinstance(value, Decimal):
                    formatted[key] = f"{value:,.2f}"
                else:
                    formatted[key] = value
            return formatted

        def format_delta_concentration_for_response(conc_dict):
            return {key: f"{value:+.2f}%" for key, value in conc_dict.items()}

        delta_formatted_response = format_metrics_for_response(delta_metrics)
        if "concentration_by_sec_type" in delta_metrics:
            delta_formatted_response["concentration_by_sec_type"] = format_delta_concentration_for_response(
                delta_metrics["concentration_by_sec_type"]
            )

        analysis_results = {
            "break_even_analysis": "Calculation logic not yet implemented.",
            "horizon_net_benefit_analysis": "Calculation logic not yet implemented."
        }

        response_data = {
            "message": "Swap simulation complete.",
            "current_portfolio_metrics": format_metrics_for_response(current_metrics),
            "simulated_portfolio_metrics": format_metrics_for_response(simulated_metrics),
            "delta_metrics": delta_formatted_response,
            "swap_analysis": analysis_results
        }
        log.info(f"Simulation for portfolio {portfolio.id} completed successfully.")
        return Response(response_data, status=status.HTTP_200_OK)

    @action(detail=True, methods=['get'], url_path='aggregated-cash-flows', url_name='aggregated-cash-flows')
    def aggregated_cash_flows(self, request, pk=None):
        portfolio = self.get_object()
        log.info(f"Aggregated cash flow calculation requested for portfolio ID: {portfolio.id} ('{portfolio.name}') by user {request.user.username}")
        log.debug(f"Aggregated CF - Query Params Received: {request.query_params}")

        evaluation_date = date.today()
        log.debug(f"Aggregated CF - Using evaluation date: {evaluation_date} for portfolio {portfolio.id}")

        holdings_qs = portfolio.holdings.select_related(
            'security', 'security__security_type'
        ).all()
        holding_filterset = CustomerHoldingFilterSet(request.query_params, queryset=holdings_qs)

        if not holding_filterset.is_valid():
             log.warning(f"Aggregated CF - Invalid filter parameters received: {holding_filterset.errors}")
             filtered_holdings = holding_filterset.queryset.none()
        else:
            filtered_holdings = holding_filterset.qs

        log.info(f"Aggregated CF - Initial holding count: {holdings_qs.count()}, Filtered holding count: {filtered_holdings.count()}")

        if not filtered_holdings.exists():
            log.info(f"Aggregated CF - Portfolio {portfolio.id} has no holdings matching the filter criteria. Returning empty list.")
            return Response([], status=status.HTTP_200_OK)

        aggregated_flows_by_date = defaultdict(lambda: {'interest': Decimal(0), 'principal': Decimal(0)})
        total_holdings_processed = 0
        total_individual_flows = 0

        for holding in filtered_holdings:
            log.debug(f"Aggregated CF - Processing holding ExtTicket: {holding.external_ticket}")
            if not holding.security:
                log.warning(f"Aggregated CF - Skipping holding {holding.external_ticket}: Missing security data.")
                continue
            _, ql_detailed_flows, _, cf_error = generate_quantlib_cashflows(holding, evaluation_date)
            if cf_error:
                log.error(f"Aggregated CF - Cash flow generation failed for holding {holding.external_ticket}: {cf_error}")
                continue
            if not ql_detailed_flows:
                 log.debug(f"Aggregated CF - No future cash flows generated for holding {holding.external_ticket}.")
                 continue
            total_holdings_processed += 1
            total_individual_flows += len(ql_detailed_flows)
            for flow_tuple in ql_detailed_flows:
                flow_obj, flow_type = flow_tuple
                flow_date_val = flow_obj.date().to_date() # Renamed variable
                try:
                    flow_amount = Decimal(str(flow_obj.amount()))
                    if flow_type == 'Interest':
                        aggregated_flows_by_date[flow_date_val]['interest'] += flow_amount
                    elif flow_type == 'Principal':
                        aggregated_flows_by_date[flow_date_val]['principal'] += flow_amount
                except InvalidOperation:
                     log.error(f"Aggregated CF - Could not convert flow amount {flow_obj.amount()} to Decimal for holding {holding.external_ticket} on date {flow_date_val}.")
                except Exception as agg_e:
                     log.error(f"Aggregated CF - Error aggregating flow for holding {holding.external_ticket} on date {flow_date_val}: {agg_e}")

        log.info(f"Aggregated CF - Processed {total_holdings_processed}/{filtered_holdings.count()} filtered holdings, aggregating {total_individual_flows} individual flows for portfolio {portfolio.id}.")
        formatted_response = []
        for flow_date_obj in sorted(aggregated_flows_by_date.keys()):
            data = aggregated_flows_by_date[flow_date_obj]
            total_interest = data['interest'].quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            total_principal = data['principal'].quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            total_flow = (total_interest + total_principal)
            formatted_response.append({
                "date": flow_date_obj.isoformat(), "total_interest": str(total_interest),
                "total_principal": str(total_principal), "total_flow": str(total_flow)
            })
        return Response(formatted_response, status=status.HTTP_200_OK)


class CustomerHoldingViewSet(viewsets.ModelViewSet):
    serializer_class = CustomerHoldingSerializer
    permission_classes = [permissions.IsAuthenticated]
    filter_backends = [DjangoFilterBackend, OrderingFilter]
    filterset_class = CustomerHoldingFilterSet
    ordering_fields = [
        'external_ticket', 'intention_code', 'original_face_amount',
        'settlement_date', 'settlement_price', 'book_price', 'book_yield',
        'market_date', 'market_price', 'market_yield',
        'security__cusip', 'security__description', 'security__maturity_date',
        'security__coupon', 'security__factor', 'security__cpr',
        'portfolio__name', 'last_modified_at', 'calculated_par_value',
        'security__wal', 'holding_duration', 'holding_average_life',
    ]
    ordering = ['portfolio', 'security__cusip'] # Default ordering if client doesn't specify
    lookup_field = 'external_ticket'

    def get_queryset(self):
        user = self.request.user
        # Base queryset with necessary select_related for efficiency
        base_queryset = CustomerHolding.objects.select_related(
            'portfolio__owner', 'security', 'security__security_type', 'security__interest_schedule'
        )

        # Apply permissions: staff/superusers see all, others see only their customers' holdings
        if user.is_staff or user.is_superuser:
            permitted_queryset = base_queryset.all()
        else:
            # Permanent change: Removed .distinct() as it was causing sorting issues.
            # If duplicate rows appear for non-admin users and this is undesired,
            # a different approach to ensure uniqueness will be needed.
            log.info(f"CustomerHoldingViewSet: Applying filter for non-admin user {user.username} WITHOUT .distinct().")
            permitted_queryset = base_queryset.filter(portfolio__owner__users=user)

        # Annotate with calculated_par_value (used for display or potentially sorting if added to ordering_fields)
        annotated_queryset = permitted_queryset.annotate(
            calculated_par_value=ExpressionWrapper(
                F('original_face_amount') * Coalesce(F('security__factor'), Value(Decimal('1.0'))),
                output_field=DecimalField(max_digits=40, decimal_places=8)
            )
        )
        return annotated_queryset

    def list(self, request, *args, **kwargs):
        """
        Overrides the default list action to add logging for received query parameters.
        """
        log.info("="*50)
        log.info(f"CustomerHoldingViewSet LIST request received.")
        log.info(f"User: {request.user.username} (Is Staff: {request.user.is_staff}, Is Superuser: {request.user.is_superuser})")
        # --- ADDED LOGGING FOR RECEIVED QUERY PARAMETERS ---
        log.info(f"RECEIVED Query Params by Backend: {request.query_params.dict()}")
        print(f"DEBUG RECEIVED Query Params by Backend: {request.query_params.dict()}") # Also print to console
        # --- END ADDED LOGGING ---

        queryset = self.filter_queryset(self.get_queryset())

        page = self.paginate_queryset(queryset)
        if page is not None:
            serializer = self.get_serializer(page, many=True)
            log.info(f"Returning PAGINATED response. Page size: {len(serializer.data)} items.")
            log.info("="*50)
            return self.get_paginated_response(serializer.data)

        serializer = self.get_serializer(queryset, many=True)
        log.info(f"Returning NON-PAGINATED response. Total items: {len(serializer.data)}.")
        log.info("="*50)
        return Response(serializer.data)


    def perform_create(self, serializer):
        user = self.request.user
        portfolio = serializer.validated_data.get('portfolio')
        if not portfolio:
             log.error(f"perform_create CustomerHolding: Portfolio missing.")
             raise serializers.ValidationError({"portfolio": "Portfolio is required."})
        if not (user.is_staff or user.is_superuser):
            if not user.customers.filter(id=portfolio.owner_id).exists():
                log.warning(f"User {user.username} permission denied for holding.")
                raise PermissionDenied("Permission denied.")
        try:
            instance = serializer.save()
            log.info(f"User {user.username} created holding {instance.external_ticket}")
        except IntegrityError as ie:
            log.error(f"IntegrityError creating holding: {ie}", exc_info=True)
            raise serializers.ValidationError(f"Conflict creating holding: {ie}") from ie
        except Exception as e:
            log.error(f"Error creating holding: {e}", exc_info=True)
            raise


    @action(detail=True, methods=['get'], url_path='cash-flows', url_name='cash-flows')
    def cash_flows(self, request, external_ticket=None):
        holding = self.get_object()
        log.info(f"Cash flow calculation requested for holding {holding.external_ticket}")
        if not hasattr(holding, 'security') or holding.security is None:
             try: holding = CustomerHolding.objects.select_related('security').get(external_ticket=holding.external_ticket)
             except CustomerHolding.DoesNotExist: return Response({"error": "Holding not found."}, status=status.HTTP_404_NOT_FOUND)
        evaluation_date = holding.market_date if holding.market_date else date.today()
        try:
            _, ql_detailed_flows, _, cf_error = generate_quantlib_cashflows(holding, evaluation_date)
            if cf_error:
                 log.error(f"Cash flow generation failed for {holding.external_ticket}: {cf_error}")
                 return Response({"error": cf_error}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
            if not ql_detailed_flows:
                log.info(f"No cash flows generated for holding {holding.external_ticket}.")
                return Response([], status=status.HTTP_200_OK)
            formatted_flows = [
                {"date": flow_tuple[0].date().to_date().isoformat(),
                 "amount": str(Decimal(str(flow_tuple[0].amount())).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)),
                 "type": flow_tuple[1]
                 }
                for flow_tuple in ql_detailed_flows
            ]
            return Response(formatted_flows, status=status.HTTP_200_OK)
        except ImportError:
             log.error("QuantLib-Python library not found.")
             return Response({"error": "Calculation library not available."}, status=status.HTTP_501_NOT_IMPLEMENTED)
        except Exception as e:
            log.error(f"Unexpected error during cash flow calculation for holding {holding.external_ticket}: {e}", exc_info=True)
            return Response({"error": "Unexpected error during cash flow calculation."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


    @action(detail=True, methods=['get'], url_path='financial-analysis', url_name='financial-analysis')
    def financial_analysis(self, request, external_ticket=None):
        holding = self.get_object()
        log.info(f"Financial analysis requested for holding {holding.external_ticket}")
        if not hasattr(holding, 'security') or holding.security is None:
             try: holding = CustomerHolding.objects.select_related('security').get(external_ticket=holding.external_ticket)
             except CustomerHolding.DoesNotExist: return Response({"error": "Holding not found."}, status=status.HTTP_404_NOT_FOUND)
        if holding.market_price is None or holding.market_price <= 0:
             return Response({"error": "Market price required."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            analytics_results = calculate_bond_analytics(holding)
            if analytics_results.get('error'):
                log.error(f"Financial analysis failed for {holding.external_ticket}: {analytics_results['error']}")
                status_code = status.HTTP_500_INTERNAL_SERVER_ERROR if "calculation" in analytics_results['error'].lower() else status.HTTP_400_BAD_REQUEST
                return Response({"error": analytics_results['error']}, status=status_code)
            for key in ['ytm', 'duration_modified', 'duration_macaulay', 'convexity']:
                 if analytics_results[key] is not None:
                     analytics_results[key] = str(analytics_results[key])
            return Response(analytics_results, status=status.HTTP_200_OK)
        except ImportError:
             log.error("QuantLib-Python library not found.")
             return Response({"error": "Calculation library not available."}, status=status.HTTP_501_NOT_IMPLEMENTED)
        except Exception as e:
            log.error(f"Unexpected error during financial analysis for holding {holding.external_ticket}: {e}", exc_info=True)
            return Response({"error": "Unexpected error during financial analysis."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class ImportExcelView(GenericAPIView):
    parser_classes = [MultiPartParser, FormParser]
    permission_classes = [permissions.IsAdminUser]
    serializer_class = ExcelUploadSerializer
    def post(self, request, format=None):
        serializer = self.get_serializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        file_obj = serializer.validated_data['file']
        original_filename = file_obj.name
        log.info(f"Admin {request.user.username} attempting to upload file: {original_filename}")
        task_to_run = None
        task_name = "Unknown Import"
        file_path_str = None
        expected_filenames = {
            'Security.xlsx': (import_securities_from_excel, "Securities Import"),
            'Customer.xlsx': (import_customers_from_excel, "Customers Import"),
            'Holdings.xlsx': (import_holdings_from_excel, "Holdings Import"),
            'muni_offerings.xlsx': (import_muni_offerings_from_excel, "Municipal Offerings Import"),
            'Salesperson.xlsx': (import_salespersons_from_excel, "Salespersons Import"),
            'SecurityType.xlsx': (import_security_types_from_excel, "Security Types Import"),
            'InterestSchedule.xlsx': (import_interest_schedules_from_excel, "Interest Schedules Import"),
        }
        matched = False
        for expected_name, (task_func, friendly_name) in expected_filenames.items():
            if original_filename.lower() == expected_name.lower():
                task_to_run = task_func
                task_name = friendly_name
                matched = True
                log.info(f"Matched uploaded file '{original_filename}' to task '{task_name}'")
                break
        if not matched:
            log.warning(f"Uploaded file '{original_filename}' does not match expected import filenames.")
            return Response({'error': "Filename does not match expected import types (...)."}, status=status.HTTP_400_BAD_REQUEST)
        upload_dir = settings.BASE_DIR / 'data' / 'imports' / 'uploads'
        upload_dir.mkdir(parents=True, exist_ok=True)
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
            if file_path.exists():
                try: os.remove(file_path)
                except OSError: pass
            return Response({'error': f'Failed to save uploaded file: {e}'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        if task_to_run and file_path_str:
            try:
                task_signature = task_to_run.si(file_path_str)
                task_result = task_signature.delay()
                log.info(f"Triggered Celery task {task_to_run.__name__} ID {task_result.id} for file {file_path_str}")
                return Response({'message': f'File "{original_filename}" uploaded. {task_name} task ({task_result.id}) started.', 'task_id': task_result.id}, status=status.HTTP_202_ACCEPTED)
            except Exception as e:
                log.error(f"Error triggering Celery task for file '{file_path_str}': {e}", exc_info=True)
                if file_path.exists():
                    try: os.remove(file_path); log.info(f"Cleaned up '{file_path_str}' after task trigger failure.")
                    except OSError as re: log.error(f"Error removing '{file_path_str}': {re}")
                return Response({'error': f'File saved, but failed to trigger processing task: {e}'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        else:
             log.error("Internal error: Task or file path missing after successful file match and save.")
             return Response({'error': 'Internal server error during import initiation.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class EmailSalespersonInterestView(APIView):
    permission_classes = [permissions.IsAuthenticated]
    def post(self, request, *args, **kwargs):
        serializer = SalespersonInterestSerializer(data=request.data)
        if not serializer.is_valid():
            log.warning(f"Invalid data for SELL interest email from {request.user.username}: {serializer.errors}")
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        validated_data = serializer.validated_data
        customer_id = validated_data['customer_id']
        selected_bonds = validated_data['selected_bonds']
        try:
            customer = Customer.objects.select_related('salesperson').get(id=customer_id)
        except Customer.DoesNotExist:
            log.warning(f"User {request.user.username} requested SELL email for non-existent customer ID: {customer_id}")
            return Response({"error": f"Customer with ID {customer_id} not found."}, status=status.HTTP_404_NOT_FOUND)
        user = request.user
        is_admin = user.is_staff or user.is_superuser
        if not (is_admin or user.customers.filter(id=customer.id).exists()):
            log.warning(f"User {user.username} permission denied for SELL email, customer ID: {customer_id}")
            return Response({"error": "Permission denied for this customer."}, status=status.HTTP_403_FORBIDDEN)
        salesperson = customer.salesperson
        if not salesperson or not salesperson.email:
            log.warning(f"Attempted SELL email for customer {customer.customer_number}, but no salesperson or salesperson email is configured.")
            return Response({"error": "Salesperson email is not configured for this customer."}, status=status.HTTP_400_BAD_REQUEST)
        salesperson_email = salesperson.email
        salesperson_name = salesperson.name or ''
        try:
            task_signature = send_salesperson_interest_email.s(
                salesperson_email=salesperson_email, salesperson_name=salesperson_name,
                customer_name=customer.name or '', customer_number=customer.customer_number,
                selected_bonds=selected_bonds
            )
            task_result = task_signature.delay()
            log.info(f"User {user.username} triggered SELL interest email task {task_result.id} for customer {customer.customer_number} to {salesperson_email}")
            return Response({"message": "Email task queued successfully. The salesperson will be notified."}, status=status.HTTP_200_OK)
        except Exception as e:
            log.error(f"Error triggering Celery task 'send_salesperson_interest_email' for customer {customer.customer_number}: {e}", exc_info=True)
            return Response({"error": "Failed to queue email task. Please try again later."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

class MunicipalOfferingViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = MunicipalOffering.objects.all()
    serializer_class = MunicipalOfferingSerializer
    permission_classes = [permissions.IsAuthenticated]
    filter_backends = [DjangoFilterBackend, OrderingFilter]
    filterset_class = MuniOfferingFilterSet
    ordering_fields = [
        'cusip', 'description', 'amount', 'coupon', 'maturity_date',
        'yield_rate', 'price', 'state', 'moody_rating', 'sp_rating',
        'call_date', 'call_price', 'insurance', 'last_updated'
    ]
    ordering = ['maturity_date', 'cusip']

class EmailSalespersonMuniBuyInterestView(APIView):
    permission_classes = [permissions.IsAuthenticated]
    def post(self, request, *args, **kwargs):
        serializer = MuniBuyInterestSerializer(data=request.data)
        if not serializer.is_valid():
            log.warning(f"Invalid data for muni BUY interest email from {request.user.username}: {serializer.errors}")
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        validated_data = serializer.validated_data
        customer_id = validated_data['customer_id']
        selected_offerings = validated_data['selected_offerings']
        try:
            customer = Customer.objects.select_related('salesperson').get(id=customer_id)
        except Customer.DoesNotExist:
            log.warning(f"User {request.user.username} requested muni BUY email for non-existent customer ID: {customer_id}")
            return Response({"error": f"Customer with ID {customer_id} not found."}, status=status.HTTP_404_NOT_FOUND)
        user = request.user
        is_admin = user.is_staff or user.is_superuser
        if not (is_admin or user.customers.filter(id=customer.id).exists()):
            log.warning(f"User {user.username} permission denied for muni BUY email, customer ID: {customer_id}")
            return Response({"error": "You do not have permission to perform this action for this customer."}, status=status.HTTP_403_FORBIDDEN)
        salesperson = customer.salesperson
        if not salesperson or not salesperson.email:
            log.warning(f"Attempted muni BUY email for customer {customer.customer_number}, but no salesperson or salesperson email is configured.")
            return Response({"error": "Salesperson email is not configured for this customer."}, status=status.HTTP_400_BAD_REQUEST)
        salesperson_email = salesperson.email
        salesperson_name = salesperson.name or ''
        try:
            task_signature = send_salesperson_muni_buy_interest_email.s(
                salesperson_email=salesperson_email, salesperson_name=salesperson_name,
                customer_name=customer.name, customer_number=customer.customer_number,
                selected_offerings=selected_offerings
            )
            task_result = task_signature.delay()
            log.info(f"User {user.username} triggered muni BUY interest email task {task_result.id} for customer {customer.customer_number} to {salesperson_email}")
            return Response({"message": "Email task queued successfully. The salesperson will be notified of the buy interest."}, status=status.HTTP_200_OK)
        except Exception as e:
            log.error(f"Error triggering Celery task 'send_salesperson_muni_buy_interest_email' for customer {customer.customer_number}: {e}", exc_info=True)
            # Corrected line: status parameter should be inside the Response() call
            return Response({"error": "Failed to queue email task. Please try again later."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
