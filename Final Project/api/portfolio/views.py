# api/portfolio/views.py (Added more logging to PortfolioViewSet.create)

import os
import logging # For logging
import uuid # For unique filenames in import view
from django.conf import settings
from django.shortcuts import render, get_object_or_404
from django.contrib.auth.decorators import login_required
# Import necessary exceptions
from django.core.exceptions import PermissionDenied, ObjectDoesNotExist
# Import transaction for atomic operations
from django.db import transaction

from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import viewsets, status, permissions
from rest_framework.decorators import action
from rest_framework.generics import GenericAPIView
from rest_framework.views import APIView # Import APIView
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.response import Response # For API responses
from rest_framework import serializers # For raising validation errors

# Import Celery tasks
from .tasks import (
    import_securities_from_excel,
    import_customers_from_excel,
    import_holdings_from_excel,
    send_salesperson_interest_email, # Sell interest email task
    import_muni_offerings_from_excel,
    send_salesperson_muni_buy_interest_email, # <-- Import the new buy interest task
)
# Import models and serializers
from .models import Customer, Security, Portfolio, CustomerHolding, MunicipalOffering # Import new model
from .serializers import (
    ExcelUploadSerializer,
    CustomerSerializer,
    SecuritySerializer,
    PortfolioSerializer,
    CustomerHoldingSerializer,
    SalespersonInterestSerializer, # Sell interest serializer
    MunicipalOfferingSerializer,
    MuniBuyInterestSerializer, # <-- Import the new buy interest serializer
)

# Setup logging
log = logging.getLogger(__name__)

# --- View to serve the main index.html page ---
@login_required
def portfolio_analyzer_view(request):
    """ Serves the main index.html template. """
    context = {'is_admin': request.user.is_staff or request.user.is_superuser}
    return render(request, 'index.html', context)

# --- API ViewSets ---

class CustomerViewSet(viewsets.ModelViewSet):
    """ API endpoint for viewing and editing Customer instances. """
    serializer_class = CustomerSerializer
    permission_classes = [permissions.IsAuthenticated]
    def get_queryset(self):
        user = self.request.user
        if user.is_staff or user.is_superuser: return Customer.objects.all()
        return Customer.objects.filter(users=user).distinct()

class SecurityViewSet(viewsets.ModelViewSet):
    """ API endpoint for viewing and editing Security instances. """
    queryset = Security.objects.all()
    serializer_class = SecuritySerializer
    permission_classes = [permissions.IsAuthenticated]
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['cusip']

class PortfolioViewSet(viewsets.ModelViewSet):
    """ API endpoint for viewing and editing Portfolio instances. """
    serializer_class = PortfolioSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        base_queryset = Portfolio.objects.select_related('owner').prefetch_related('holdings__security')
        if user.is_staff or user.is_superuser: return base_queryset.all()
        return base_queryset.filter(owner__users=user).distinct()

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context['request'] = self.request
        return context

    # --- UPDATED create method with more logging ---
    def create(self, request, *args, **kwargs):
        """ Handles POST requests to create a new Portfolio. Includes more logging. """
        # --- START DEBUG LOGGING ---
        # Log raw data FIRST
        log.info(f"PortfolioViewSet CREATE - Step 1: Raw request.data: {request.data}")
        log.info(f"PortfolioViewSet CREATE - Step 2: User: {request.user}, IsAdmin: {request.user.is_staff or request.user.is_superuser}")
        # --- END DEBUG LOGGING ---

        serializer = None # Initialize serializer to None
        try:
            # --- START DEBUG LOGGING ---
            log.info("PortfolioViewSet CREATE - Step 3: Calling get_serializer...")
            # Standard DRF logic: Get the serializer instance
            serializer = self.get_serializer(data=request.data)
            log.info(f"PortfolioViewSet CREATE - Step 4: Serializer instance created: {type(serializer)}")
            # --- END DEBUG LOGGING ---

            # --- START DEBUG LOGGING ---
            log.info("PortfolioViewSet CREATE - Step 5: Calling serializer.is_valid()...")
            # Validate the data using the serializer (this calls PortfolioSerializer.validate)
            serializer.is_valid(raise_exception=True)
            log.info("PortfolioViewSet CREATE - Step 6: serializer.is_valid() PASSED.")
            # --- END DEBUG LOGGING ---

            # Log validated data *after* validation succeeds (optional, but can be useful)
            # log.info(f"Serializer validated_data after is_valid: {serializer.validated_data}")

            # Call perform_create if validation passes
            self.perform_create(serializer)

            # Prepare and return the success response
            headers = self.get_success_headers(serializer.data)
            return Response(serializer.data, status=status.HTTP_201_CREATED, headers=headers)

        except serializers.ValidationError as ve:
             # Log validation errors specifically
             log.warning(f"PortfolioViewSet CREATE - VALIDATION FAILED. Errors: {ve.detail}")
             # Re-raise the validation error to let DRF handle the 400 response
             raise ve
        except Exception as e:
            # Log any other unexpected errors during creation
            # Check if serializer was even instantiated before logging its type
            serializer_type_info = f"Serializer type: {type(serializer)}" if serializer else "Serializer not instantiated."
            log.error(f"PortfolioViewSet CREATE - UNEXPECTED ERROR: {e}. {serializer_type_info}", exc_info=True)
            # Re-raise the exception; DRF's exception handler might return a 500 error
            raise
    # --- END of updated create method ---

    def perform_create(self, serializer):
        """ Creates the Portfolio instance and handles initial holding copy. """
        # This method is called by `create` AFTER serializer.is_valid() passes.
        log.info("PortfolioViewSet perform_create - Step 7: Starting portfolio creation...") # Added log
        user = self.request.user
        owner = serializer.validated_data.get('owner') # Owner determined during validation

        # Fallback to get owner from context if not directly in validated_data
        # (This handles admin and single-customer non-admin cases where owner isn't directly mapped)
        if not owner:
             owner_from_context = self.get_serializer_context().get('_intended_owner')
             if owner_from_context:
                 log.info("PortfolioViewSet perform_create - Owner determined from context.") # Added log
                 owner = owner_from_context
             else:
                 # This should ideally not happen if validation passed, but log defensively
                 log.error(f"PortfolioViewSet perform_create: Failed to determine portfolio owner for user {user.username} after validation.")
                 raise serializers.ValidationError("Internal error: Failed to determine the portfolio owner during creation.")
        else:
            log.info("PortfolioViewSet perform_create - Owner determined from serializer validated_data.") # Added log


        # Get initial holding IDs directly from request data (as done previously)
        # Note: This happens *after* validation, so it assumes the IDs were valid if provided
        initial_holding_ids_raw = self.get_serializer_context().get('request').data.get('initial_holding_ids', [])
        initial_holding_ids = []
        if initial_holding_ids_raw:
            try:
                # Ensure IDs are integers
                initial_holding_ids = [int(id_val) for id_val in initial_holding_ids_raw]
                log.info(f"PortfolioViewSet perform_create - Parsed initial_holding_ids: {initial_holding_ids}") # Added log
            except (ValueError, TypeError):
                log.warning(f"PortfolioViewSet perform_create: Invalid format for initial_holding_ids: {initial_holding_ids_raw}. Ignoring.")
                initial_holding_ids = []
        else:
            log.info("PortfolioViewSet perform_create - No initial_holding_ids provided.") # Added log


        new_portfolio = None
        copied_holdings_count = 0
        try:
            # Use a transaction to ensure portfolio creation and holding copy are atomic
            with transaction.atomic():
                log.info("PortfolioViewSet perform_create - Step 8: Calling serializer.save()...") # Added log
                # Save the portfolio instance using the validated data (owner is now set)
                # The serializer's create method is NOT called here because we override perform_create
                # We need to pass the owner explicitly if it came from context
                new_portfolio = serializer.save(owner=owner, is_default=False) # Pass owner explicitly

                log.info(f"PortfolioViewSet perform_create - Step 9: Portfolio '{new_portfolio.name}' (ID: {new_portfolio.id}) created for owner {new_portfolio.owner.customer_number}.")

                # Copy initial holdings if requested and valid IDs were provided
                if initial_holding_ids:
                    log.info(f"PortfolioViewSet perform_create - Step 10: Attempting to copy {len(initial_holding_ids)} initial holdings into new portfolio {new_portfolio.id}...")
                    # Fetch holdings belonging to the correct owner
                    holdings_to_copy = CustomerHolding.objects.filter(
                        id__in=initial_holding_ids,
                        portfolio__owner=owner # Ensure we only copy holdings the owner actually owns
                    ).select_related('security')

                    new_holdings_to_create = []
                    for original_holding in holdings_to_copy:
                        # Create a new holding instance linked to the new portfolio
                        new_holding = CustomerHolding(
                            portfolio=new_portfolio,
                            security=original_holding.security,
                            original_face_amount=original_holding.original_face_amount,
                            settlement_date=original_holding.settlement_date,
                            settlement_price=original_holding.settlement_price,
                            book_price=original_holding.book_price,
                            book_yield=original_holding.book_yield
                            # ticket_id will be auto-generated
                        )
                        new_holdings_to_create.append(new_holding)

                    if new_holdings_to_create:
                        # Bulk create the new holdings for efficiency
                        log.info(f"PortfolioViewSet perform_create - Step 11: Bulk creating {len(new_holdings_to_create)} new holdings...") # Added log
                        created_list = CustomerHolding.objects.bulk_create(new_holdings_to_create)
                        copied_holdings_count = len(created_list)
                        log.info(f"PortfolioViewSet perform_create - Step 12: Successfully copied {copied_holdings_count} holdings into portfolio {new_portfolio.id}.")
                    else:
                        log.info(f"PortfolioViewSet perform_create - Step 11/12: No valid holdings found to copy for portfolio {new_portfolio.id} based on provided IDs: {initial_holding_ids} and owner {owner.id}.")

        except Exception as e:
            # Catch any errors during the transaction
            log.error(f"PortfolioViewSet perform_create - TRANSACTION ERROR: Error during portfolio creation or holding copy transaction for user {user.username}: {e}", exc_info=True)
            # Raise a validation error to signal failure to the client
            raise serializers.ValidationError("An error occurred while creating the portfolio or copying holdings.") from e
        log.info("PortfolioViewSet perform_create - Step 13: Finished.") # Added log


    def perform_destroy(self, instance):
        # ... (implementation as before) ...
        user = self.request.user
        log.info(f"User {user.username} attempting to delete portfolio '{instance.name}' (ID: {instance.id}, Default: {instance.is_default})")
        if not (user.is_staff or user.is_superuser):
            if not user.customers.filter(id=instance.owner_id).exists(): raise PermissionDenied("You do not have permission to delete this portfolio.")
        if instance.is_default: raise serializers.ValidationError({"detail": "Cannot delete the default 'Primary Holdings' portfolio."})
        log.info(f"Proceeding with deletion of portfolio '{instance.name}' (ID: {instance.id}) by user {user.username}.")
        instance.delete()

    @action(detail=True, methods=['post'], url_path='simulate_swap', url_name='simulate-swap', permission_classes=[permissions.IsAuthenticated])
    def simulate_swap(self, request, pk=None):
        # ... (implementation as before) ...
        portfolio = self.get_object(); log.info(f"Simulate swap requested for portfolio {portfolio.id} by user {request.user.username}")
        before_total_face = sum(h.original_face_amount or 0 for h in portfolio.holdings.all())
        add_security_id = request.data.get('add_security_id'); face_amount = float(request.data.get('face_amount') or 0); price = float(request.data.get('price') or 0); remove_holding_id = request.data.get('remove_holding_id')
        add_faces = 0; add_value = 0
        if add_security_id: add_faces = face_amount; add_value = add_faces * price
        remove_faces = 0; remove_value = 0
        if remove_holding_id:
            try: holding_to_remove = CustomerHolding.objects.get(id=remove_holding_id, portfolio=portfolio); remove_faces = float(holding_to_remove.original_face_amount or 0); remove_value = remove_faces * float(holding_to_remove.settlement_price or 0)
            except CustomerHolding.DoesNotExist: log.warning(f"simulate_swap: Holding ID {remove_holding_id} not found in portfolio {portfolio.id}.")
            except (ValueError, TypeError): log.error(f"simulate_swap: Invalid numeric data for holding {remove_holding_id}.", exc_info=True)
        after_total_face = before_total_face + add_faces - remove_faces; delta_net_benefit = add_value - remove_value; delta_wal = 0
        log.info(f"Simulate swap results for portfolio {portfolio.id}: BeforeFace={before_total_face}, AfterFace={after_total_face}, DeltaBenefit={delta_net_benefit}")
        return Response({'before_total_face': before_total_face, 'after_total_face': after_total_face, 'delta_wal': delta_wal, 'delta_net_benefit': delta_net_benefit}, status=status.HTTP_200_OK)

class CustomerHoldingViewSet(viewsets.ModelViewSet):
    """ API endpoint for viewing and editing CustomerHolding instances. """
    serializer_class = CustomerHoldingSerializer
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['portfolio', 'portfolio__owner']
    permission_classes = [permissions.IsAuthenticated]
    def get_queryset(self):
        user = self.request.user
        base_queryset = CustomerHolding.objects.select_related('portfolio__owner', 'security')
        if user.is_staff or user.is_superuser: return base_queryset.all()
        return base_queryset.filter(portfolio__owner__users=user)
    def perform_create(self, serializer):
        user = self.request.user
        portfolio = serializer.validated_data.get('portfolio')
        if not portfolio: raise serializers.ValidationError({"portfolio": "Portfolio is required."})
        if not (user.is_staff or user.is_superuser):
            if not user.customers.filter(id=portfolio.owner_id).exists(): raise PermissionDenied("You do not have permission to add holdings to this portfolio.")
        serializer.save()
        log.info(f"User {user.username} created holding for sec {serializer.instance.security.cusip} in portfolio {portfolio.id}")


class ImportExcelView(GenericAPIView):
    """ API endpoint for Admins to upload Excel files for bulk import. """
    parser_classes = [MultiPartParser, FormParser]
    permission_classes = [permissions.IsAdminUser]
    serializer_class = ExcelUploadSerializer
    def post(self, request, format=None):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        file_obj = serializer.validated_data['file']
        original_filename = file_obj.name
        task_to_run = None; task_name = "Unknown Import"
        # Check for muni offerings first (exact match)
        if original_filename == 'muni_offerings.xlsx':
             task_to_run = import_muni_offerings_from_excel; task_name = "Municipal Offerings Import"
        # Check other types (case-insensitive startswith)
        elif original_filename.lower().startswith('securities') and original_filename.lower().endswith('.xlsx'):
            task_to_run = import_securities_from_excel; task_name = "Securities Import"
        elif original_filename.lower().startswith('customers') and original_filename.lower().endswith('.xlsx'):
            task_to_run = import_customers_from_excel; task_name = "Customers Import"
        elif original_filename.lower().startswith('holdings') and original_filename.lower().endswith('.xlsx'):
            task_to_run = import_holdings_from_excel; task_name = "Holdings Import"
        else:
            log.warning(f"Admin {request.user.username} uploaded file '{file_obj.name}' - no matching import task.")
            return Response({'error': "Filename must be 'muni_offerings.xlsx' or start with 'securities', 'customers', or 'holdings' and end with '.xlsx'."}, status=status.HTTP_400_BAD_REQUEST)
        # Save file securely
        imports_dir = settings.BASE_DIR / 'data' / 'imports' / 'uploads'; imports_dir.mkdir(parents=True, exist_ok=True)
        file_extension = os.path.splitext(file_obj.name)[1]; unique_filename = f"{uuid.uuid4()}{file_extension}"; file_path = imports_dir / unique_filename
        try:
            with open(file_path, 'wb+') as destination:
                for chunk in file_obj.chunks(): destination.write(chunk)
            log.info(f"Admin {request.user.username} uploaded '{file_obj.name}', saved as '{file_path}'.")
        except Exception as e:
            log.error(f"Error saving uploaded file '{file_obj.name}' to '{file_path}': {e}", exc_info=True)
            # --- CORRECTED SYNTAX ---
            if file_path.exists():
                try:
                    os.remove(file_path)
                except OSError:
                    pass # Ignore errors if file cannot be removed
            # ------------------------
            return Response({'error': f'Failed to save uploaded file: {e}'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        # Trigger Celery task
        try:
            task_signature = task_to_run.s(str(file_path)); task_result = task_signature.delay()
            log.info(f"Triggered Celery task {task_to_run.__name__} ID {task_result.id} for file {file_path}")
            return Response({'message': f'File "{file_obj.name}" uploaded. {task_name} task ({task_result.id}) started.', 'task_id': task_result.id}, status=status.HTTP_202_ACCEPTED)
        except Exception as e:
            log.error(f"Error triggering Celery task for file '{file_path}': {e}", exc_info=True)
            if file_path.exists():
                try:
                    os.remove(file_path)
                    log.info(f"Cleaned up '{file_path}' after task trigger failure.")
                except OSError as re:
                    log.error(f"Error removing '{file_path}': {re}")
            return Response({'error': f'File saved, but failed to trigger processing task: {e}'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class EmailSalespersonInterestView(APIView):
    """ API endpoint for users to notify salesperson about SELL interest. """
    permission_classes = [permissions.IsAuthenticated]
    def post(self, request, *args, **kwargs):
        serializer = SalespersonInterestSerializer(data=request.data)
        if not serializer.is_valid():
            log.warning(f"Invalid data for SELL interest email from {request.user.username}: {serializer.errors}")
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        validated_data = serializer.validated_data; customer_id = validated_data['customer_id']; selected_bonds = validated_data['selected_bonds']
        try: customer = Customer.objects.get(id=customer_id)
        except Customer.DoesNotExist:
            log.warning(f"User {request.user.username} requested SELL email for non-existent customer ID: {customer_id}")
            return Response({"error": f"Customer with ID {customer_id} not found."}, status=status.HTTP_404_NOT_FOUND)
        user = request.user; is_admin = user.is_staff or user.is_superuser
        if not (is_admin or user.customers.filter(id=customer.id).exists()):
            log.warning(f"User {user.username} permission denied for SELL email, customer ID: {customer_id}")
            return Response({"error": "Permission denied for this customer."}, status=status.HTTP_403_FORBIDDEN)
        salesperson_email = customer.salesperson_email
        if not salesperson_email:
            log.warning(f"Attempted SELL email for customer {customer.customer_number}, but no salesperson email configured.")
            return Response({"error": "Salesperson email is not configured for this customer."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            task_signature = send_salesperson_interest_email.s(salesperson_email=salesperson_email, salesperson_name=customer.salesperson_name or '', customer_name=customer.name or '', customer_number=customer.customer_number or 'N/A', selected_bonds=selected_bonds)
            task_result = task_signature.delay()
            log.info(f"User {user.username} triggered SELL interest email task {task_result.id} for customer {customer.customer_number} to {salesperson_email}")
            return Response({"message": "Email task queued successfully. The salesperson will be notified."}, status=status.HTTP_200_OK)
        except Exception as e:
            log.error(f"Error triggering Celery task 'send_salesperson_interest_email' for customer {customer.customer_number}: {e}", exc_info=True)
            return Response({"error": "Failed to queue email task. Please try again later."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class MunicipalOfferingViewSet(viewsets.ReadOnlyModelViewSet):
    """ API endpoint that allows municipal offerings to be viewed. """
    queryset = MunicipalOffering.objects.all().order_by('maturity_date', 'cusip')
    serializer_class = MunicipalOfferingSerializer
    permission_classes = [permissions.IsAuthenticated]
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['state', 'moody_rating', 'sp_rating', 'insurance']


# --- NEW VIEW for Muni Buy Interest Email ---
class EmailSalespersonMuniBuyInterestView(APIView):
    """
    API endpoint for users to notify salesperson about BUY interest in municipal offerings.
    """
    permission_classes = [permissions.IsAuthenticated] # Must be logged in

    def post(self, request, *args, **kwargs):
        """ Handles the POST request to send the buy interest email. """
        serializer = MuniBuyInterestSerializer(data=request.data)

        # 1. Validate Input Data
        if not serializer.is_valid():
            log.warning(f"Invalid data for muni BUY interest email from {request.user.username}: {serializer.errors}")
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        validated_data = serializer.validated_data
        customer_id = validated_data['customer_id']
        selected_offerings = validated_data['selected_offerings'] # List of {'cusip': '...', 'description': '...'}

        # 2. Retrieve Customer
        try:
            customer = Customer.objects.get(id=customer_id)
        except Customer.DoesNotExist:
            log.warning(f"User {request.user.username} requested muni BUY email for non-existent customer ID: {customer_id}")
            return Response({"error": f"Customer with ID {customer_id} not found."}, status=status.HTTP_404_NOT_FOUND)

        # 3. Verify User Permission
        user = request.user
        is_admin = user.is_staff or user.is_superuser
        # Check if user is admin OR is associated with this specific customer
        if not (is_admin or user.customers.filter(id=customer.id).exists()):
            log.warning(f"User {user.username} permission denied for muni BUY email, customer ID: {customer_id}")
            return Response({"error": "You do not have permission to perform this action for this customer."}, status=status.HTTP_403_FORBIDDEN)

        # 4. Check for Salesperson Email
        salesperson_email = customer.salesperson_email
        if not salesperson_email:
            log.warning(f"Attempted muni BUY email for customer {customer.customer_number}, but no salesperson email configured.")
            return Response({"error": "Salesperson email is not configured for this customer."}, status=status.HTTP_400_BAD_REQUEST)

        # 5. Trigger Asynchronous Email Task
        try:
            task_signature = send_salesperson_muni_buy_interest_email.s(
                salesperson_email=salesperson_email,
                salesperson_name=customer.salesperson_name or '',
                customer_name=customer.name or '',
                customer_number=customer.customer_number or 'N/A',
                selected_offerings=selected_offerings # Pass the list of dicts
            )
            task_result = task_signature.delay()
            log.info(f"User {user.username} triggered muni BUY interest email task {task_result.id} for customer {customer.customer_number} to {salesperson_email}")

            # Return 200 OK immediately, email is sent in background
            return Response({"message": "Email task queued successfully. The salesperson will be notified of the buy interest."}, status=status.HTTP_200_OK)

        except Exception as e:
            # Handle errors during task queuing (e.g., Celery broker down)
            log.error(f"Error triggering Celery task 'send_salesperson_muni_buy_interest_email' for customer {customer.customer_number}: {e}", exc_info=True)
            return Response({"error": "Failed to queue email task. Please try again later."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

