# api/portfolio/views.py (Added Holding Copy Logic)

import os
import logging
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
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.response import Response
from rest_framework import serializers # For raising validation errors

# Import Celery tasks for the import view
from .tasks import (
    import_securities_from_excel,
    import_customers_from_excel,
    import_holdings_from_excel,
)
# Import models and serializers
from .models import Customer, Security, Portfolio, CustomerHolding
from .serializers import (
    ExcelUploadSerializer,
    CustomerSerializer,
    SecuritySerializer,
    PortfolioSerializer,
    CustomerHoldingSerializer,
)

# Setup logging
log = logging.getLogger(__name__)

# --- View to serve the main index.html page ---
@login_required # Ensures only logged-in users can access this view
def portfolio_analyzer_view(request):
    """
    Serves the main index.html template which contains the frontend application.
    Passes the user's staff status to the template context for frontend logic.
    """
    context = {
        # Pass boolean indicating if user is admin/staff to the template
        'is_admin': request.user.is_staff or request.user.is_superuser
    }
    # Render the main HTML file (ensure it's in template directories)
    return render(request, 'index.html', context)

# --- API ViewSets ---

class CustomerViewSet(viewsets.ModelViewSet):
    """
    API endpoint for viewing and editing Customer instances.
    Permissions ensure users only see customers they are associated with,
    unless they are admin/staff.
    """
    serializer_class = CustomerSerializer
    permission_classes = [permissions.IsAuthenticated] # Must be logged in

    def get_queryset(self):
        """
        Filter the queryset based on the requesting user.
        Admins see all customers. Non-admins see only their associated customers.
        """
        user = self.request.user
        if user.is_staff or user.is_superuser:
            # Admins get all customers
            return Customer.objects.all()
        # Non-admins get only customers linked via the 'users' ManyToManyField
        return Customer.objects.filter(users=user).distinct()

class SecurityViewSet(viewsets.ModelViewSet):
    """
    API endpoint for viewing and editing Security instances.
    Currently allows any authenticated user to view/edit all securities.
    Permissions could be tightened if needed.
    """
    queryset = Security.objects.all() # All securities are available
    serializer_class = SecuritySerializer
    permission_classes = [permissions.IsAuthenticated] # Must be logged in

class PortfolioViewSet(viewsets.ModelViewSet):
    """
    API endpoint for viewing and editing Portfolio instances.
    Handles filtering based on user's associated customers and
    custom logic for portfolio creation based on user role, including
    copying initial holdings if requested.
    """
    serializer_class = PortfolioSerializer
    permission_classes = [permissions.IsAuthenticated] # Must be logged in

    def get_queryset(self):
        """
        Filter portfolios based on the requesting user.
        Admins see all portfolios. Non-admins see only portfolios owned by
        customers they are associated with.
        """
        user = self.request.user
        # Optimize database queries by prefetching related objects needed by serializer
        base_queryset = Portfolio.objects.select_related('owner').prefetch_related('holdings__security')
        if user.is_staff or user.is_superuser:
            # Admins get all portfolios
            return base_queryset.all()
        # Non-admins get portfolios where the owner is in their associated customers list
        return base_queryset.filter(owner__users=user).distinct()

    def get_serializer_context(self):
        """
        Pass the request context to the serializer.
        This is needed for the serializer's validation logic to access the user.
        """
        context = super().get_serializer_context()
        context['request'] = self.request
        return context

    # --- UPDATED perform_create with Holding Copy Logic ---
    def perform_create(self, serializer):
        """
        Custom logic to determine and assign the 'owner' when creating a Portfolio.
        If 'initial_holding_ids' are provided and valid, copies those holdings
        into the newly created portfolio.
        """
        user = self.request.user
        customer_to_assign = None
        # Get validated data before saving, as save() triggers create() which pops fields
        validated_data = serializer.validated_data
        initial_holding_ids = validated_data.get('initial_holding_ids') # Get validated IDs

        # --- Determine Owner (same logic as before) ---
        is_admin = user.is_staff or user.is_superuser
        if is_admin:
            customer_number = validated_data.get('customer_number_input')
            try:
                customer_to_assign = Customer.objects.get(customer_number=customer_number)
                log.info(f"Admin {user.username} creating portfolio '{validated_data.get('name')}' for customer {customer_number}")
            except ObjectDoesNotExist:
                 log.error(f"CRITICAL: Admin {user.username} - Customer {customer_number} passed validation but not found in perform_create.")
                 raise serializers.ValidationError({"internal_error": "Failed to find validated customer."})
        else: # Regular user
            user_customers = user.customers.all()
            customer_count = user_customers.count()
            if customer_count == 0:
                log.warning(f"User {user.username} attempted portfolio creation with no associated customers.")
                raise PermissionDenied("You are not associated with any customer and cannot create portfolios.")
            elif customer_count == 1:
                customer_to_assign = user_customers.first()
                log.info(f"User {user.username} creating portfolio '{validated_data.get('name')}' for single associated customer {customer_to_assign.customer_number}")
            else: # Multi-customer user
                owner_instance = validated_data.get('owner') # Get owner instance set by owner_customer_id
                if owner_instance is None:
                    log.error(f"User {user.username} with multiple customers - 'owner' instance missing in validated_data.")
                    raise serializers.ValidationError({"owner_customer_id": "Validated owner information is missing."})
                # Ensure the owner is one the user is associated with (redundant check if validation is robust)
                if owner_instance in user_customers:
                     customer_to_assign = owner_instance
                     log.info(f"User {user.username} creating portfolio '{validated_data.get('name')}' for specified customer ID {customer_to_assign.id}")
                else:
                     log.error(f"User {user.username} - Validated owner ID {owner_instance.id} is not in user's associated customers.")
                     raise PermissionDenied("Invalid customer specified for portfolio ownership.")

        if not customer_to_assign:
             # This indicates a logic error if no owner was assigned.
             log.error(f"Portfolio creation failed for user {user.username}: Could not determine owner in perform_create.")
             raise serializers.ValidationError("Failed to determine the portfolio owner during creation.")

        # --- Create Portfolio and Copy Holdings (if applicable) ---
        new_portfolio = None
        copied_holdings_count = 0
        try:
            # Use a database transaction to ensure portfolio creation and holding copy succeed or fail together
            with transaction.atomic():
                # 1. Save the new portfolio instance, passing the determined owner
                # serializer.save() calls serializer.create(), which removes write-only fields
                new_portfolio = serializer.save(owner=customer_to_assign)
                log.info(f"Portfolio '{new_portfolio.name}' (ID: {new_portfolio.id}) created for owner {customer_to_assign.customer_number}.")

                # 2. Copy initial holdings if IDs were provided and validated
                if initial_holding_ids:
                    log.info(f"Copying {len(initial_holding_ids)} initial holdings into new portfolio {new_portfolio.id}...")
                    # Fetch the original holdings to copy (already validated in serializer)
                    # Ensure we only fetch holdings belonging to the correct owner again for safety
                    holdings_to_copy = CustomerHolding.objects.filter(
                        id__in=initial_holding_ids,
                        portfolio__owner=customer_to_assign
                    ).select_related('security') # Select related security for efficiency

                    new_holdings_to_create = []
                    for original_holding in holdings_to_copy:
                        # Create a new holding instance, copying relevant fields
                        new_holding = CustomerHolding(
                            # Link to the NEW portfolio
                            portfolio=new_portfolio,
                            # Link to the SAME security
                            security=original_holding.security,
                            # Set the customer fields based on the new portfolio's owner
                            customer=customer_to_assign,
                            customer_number=customer_to_assign.customer_number,
                            # Copy other relevant fields
                            original_face_amount=original_holding.original_face_amount,
                            settlement_date=original_holding.settlement_date,
                            settlement_price=original_holding.settlement_price,
                            book_price=original_holding.book_price,
                            book_yield=original_holding.book_yield,
                            # Note: Do NOT copy 'id' or 'ticket_id', let them be generated
                            # Copy derived fields from original holding's security (or re-fetch if needed)
                            # These might be slightly out of date if security changed, but simplest approach
                            wal=original_holding.security.wal,
                            coupon=original_holding.security.coupon,
                            call_date=original_holding.security.call_date,
                            maturity_date=original_holding.security.maturity_date,
                            description=original_holding.security.description,
                        )
                        new_holdings_to_create.append(new_holding)

                    # Bulk create the new holdings for efficiency
                    if new_holdings_to_create:
                        created_list = CustomerHolding.objects.bulk_create(new_holdings_to_create)
                        copied_holdings_count = len(created_list)
                        log.info(f"Successfully copied {copied_holdings_count} holdings into portfolio {new_portfolio.id}.")
                    else:
                         log.info(f"No valid holdings found to copy for portfolio {new_portfolio.id} despite initial IDs being provided.")

        except Exception as e:
            # Catch any error during the transaction (portfolio save or holding copy)
            log.error(f"Error during portfolio creation or holding copy for user {user.username}: {e}", exc_info=True)
            # Raise a generic error to the user
            # If new_portfolio was created but copy failed, the transaction rollback handles cleanup
            raise serializers.ValidationError("An error occurred while creating the portfolio or copying holdings.") from e

        # Note: The serializer instance (`serializer`) still refers to the Portfolio being created.
        # Its `data` attribute will be used for the response, which should now reflect the created portfolio.
        # The copied holdings won't be in the immediate response unless the serializer is configured to show them deeply.


    @action(
        detail=True, methods=['post'], url_path='simulate_swap',
        url_name='simulate-swap', permission_classes=[permissions.IsAuthenticated]
    )
    def simulate_swap(self, request, pk=None):
        """ Placeholder action for simulating a bond swap within a portfolio. """
        portfolio = self.get_object() # Gets the portfolio instance, checks permissions implicitly
        log.info(f"Simulate swap requested for portfolio {portfolio.id} by user {request.user.username}")
        original_holdings = portfolio.holdings.all()
        # Calculate initial total face value
        before_total_face = sum(h.original_face_amount or 0 for h in original_holdings)

        # Get data from request payload
        add_security_id = request.data.get('add_security_id')
        face_amount = float(request.data.get('face_amount') or 0) # Amount to add
        price = float(request.data.get('price') or 0) # Price for added security
        remove_holding_id = request.data.get('remove_holding_id') # Holding to remove

        add_faces = 0
        add_value = 0
        if add_security_id:
            # In a real scenario, you'd validate add_security_id exists
            add_faces = face_amount
            add_value = add_faces * price # Simplified value calculation

        remove_faces = 0
        remove_value = 0
        if remove_holding_id:
            try:
                # Ensure the holding being removed actually belongs to this portfolio
                holding_to_remove = CustomerHolding.objects.get(id=remove_holding_id, portfolio=portfolio)
                remove_faces = float(holding_to_remove.original_face_amount or 0)
                # Use settlement_price for removed holding's value calculation (or book_price?)
                remove_value = remove_faces * float(holding_to_remove.settlement_price or 0)
            except CustomerHolding.DoesNotExist:
                 log.warning(f"simulate_swap: Holding ID {remove_holding_id} not found in portfolio {portfolio.id}.")
            except (ValueError, TypeError):
                 log.error(f"simulate_swap: Invalid numeric data for holding {remove_holding_id} in portfolio {portfolio.id}.", exc_info=True)

        # Calculate results
        after_total_face = before_total_face + add_faces - remove_faces
        delta_net_benefit = add_value - remove_value # Simple cash difference
        delta_wal = 0 # Placeholder - WAL calculation requires more complex logic

        log.info(f"Simulate swap results for portfolio {portfolio.id}: BeforeFace={before_total_face}, AfterFace={after_total_face}, DeltaBenefit={delta_net_benefit}")
        return Response({
            'before_total_face': before_total_face,
            'after_total_face': after_total_face,
            'delta_wal': delta_wal,
            'delta_net_benefit': delta_net_benefit,
         }, status=status.HTTP_200_OK)

class CustomerHoldingViewSet(viewsets.ModelViewSet):
    """
    API endpoint for viewing and editing CustomerHolding instances.
    Filters holdings based on user's associated customers.
    Ensures holdings are created only within accessible portfolios.
    """
    serializer_class = CustomerHoldingSerializer
    # Enable filtering using django-filter backend
    filter_backends = [DjangoFilterBackend]
    # Define fields available for filtering via query parameters (e.g., /api/holdings/?portfolio=1)
    filterset_fields = ['portfolio', 'portfolio__owner']
    permission_classes = [permissions.IsAuthenticated] # Must be logged in

    def get_queryset(self):
        """
        Filter holdings based on the requesting user.
        Admins see all holdings. Non-admins see only holdings within portfolios
        owned by customers they are associated with.
        """
        user = self.request.user
        # Optimize query by prefetching related objects needed by the serializer
        base_queryset = CustomerHolding.objects.select_related(
            'portfolio', 'security', 'customer', 'portfolio__owner'
        )
        if user.is_staff or user.is_superuser:
            # Admins get all holdings
            return base_queryset.all()
        # Non-admins get holdings where the portfolio's owner is one of their associated customers
        return base_queryset.filter(portfolio__owner__users=user)

    def perform_create(self, serializer):
        """
        Custom logic executed when creating a CustomerHolding instance.
        Validates that the user has permission to add to the selected portfolio
        and automatically sets the redundant 'customer' and 'customer_number' fields.
        """
        user = self.request.user
        # Get the Portfolio instance from the validated data (set via portfolio PK in request)
        portfolio = serializer.validated_data.get('portfolio')
        if not portfolio:
             # This should typically be caught by serializer validation if 'portfolio' is required
             raise serializers.ValidationError({"portfolio": "Portfolio is required."})

        # --- Permission Check for Non-Admins ---
        if not (user.is_staff or user.is_superuser):
            # Check if the owner of the target portfolio is one of the user's associated customers
            # This prevents users from adding holdings to portfolios they shouldn't access
            if not user.customers.filter(id=portfolio.owner_id).exists():
                 log.warning(f"User {user.username} permission denied adding holding to portfolio {portfolio.id} (owner: {portfolio.owner.customer_number}).")
                 # Raise PermissionDenied for unauthorized access attempt
                 raise PermissionDenied("You do not have permission to add holdings to this portfolio.")

        # --- Auto-set Customer Fields ---
        # Set the redundant 'customer' foreign key and 'customer_number' field
        # based on the owner of the portfolio where the holding is being added.
        serializer.save(
            customer=portfolio.owner,
            customer_number=portfolio.owner.customer_number
        )
        log.info(f"User {user.username} created holding for security {serializer.instance.security.cusip} in portfolio {portfolio.id}")


class ImportExcelView(GenericAPIView):
    """
    API endpoint for Admins to upload Excel files for bulk import.
    Handles saving the file and triggering the appropriate Celery background task.
    """
    # Define parsers for handling file uploads
    parser_classes = [MultiPartParser, FormParser]
    # Restrict access to Admin users only
    permission_classes = [permissions.IsAdminUser]
    # Use the simple serializer that just expects a 'file' field
    serializer_class = ExcelUploadSerializer

    def post(self, request, format=None):
        """ Handles the POST request for file upload. """
        serializer = self.get_serializer(data=request.data)
        # Validate the request data (checks if 'file' field is present)
        serializer.is_valid(raise_exception=True)
        # Get the uploaded file object
        file_obj = serializer.validated_data['file']
        original_filename = file_obj.name.lower() # Use lowercase for consistent checking

        # --- Determine which import task to run based on filename ---
        task_to_run = None
        if original_filename.startswith('securities') and original_filename.endswith('.xlsx'):
            task_to_run = import_securities_from_excel
        elif original_filename.startswith('customers') and original_filename.endswith('.xlsx'):
            task_to_run = import_customers_from_excel
        elif original_filename.startswith('holdings') and original_filename.endswith('.xlsx'):
            task_to_run = import_holdings_from_excel
        else:
            # File doesn't match expected naming convention
            log.warning(f"Admin {request.user.username} uploaded file '{file_obj.name}' which does not match expected naming convention.")
            return Response({
                'error': "Filename must start with 'securities', 'customers', or 'holdings' and end with '.xlsx'."
            }, status=status.HTTP_400_BAD_REQUEST)

        # --- Save the uploaded file securely ---
        # Define a subdirectory within MEDIA_ROOT or a specific BASE_DIR path for uploads
        # Ensure this path is secure and ideally outside the main codebase directory
        imports_dir = settings.BASE_DIR / 'data' / 'imports' / 'uploads'
        try:
            # Create the directory if it doesn't exist
            imports_dir.mkdir(parents=True, exist_ok=True)
        except OSError as e:
             log.error(f"Error creating upload directory '{imports_dir}': {e}", exc_info=True)
             return Response({'error': 'Server configuration error: Cannot create upload directory.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        # Generate a unique filename to prevent overwrites and potential path traversal issues
        file_extension = os.path.splitext(file_obj.name)[1]
        unique_filename = f"{uuid.uuid4()}{file_extension}"
        file_path = imports_dir / unique_filename

        # Write the uploaded file content to the unique path
        try:
            with open(file_path, 'wb+') as destination:
                for chunk in file_obj.chunks():
                    destination.write(chunk)
            log.info(f"Admin {request.user.username} uploaded file '{file_obj.name}', saved securely as '{file_path}'.")
        except Exception as e:
            log.error(f"Error saving uploaded file '{file_obj.name}' to '{file_path}': {e}", exc_info=True)
            # Attempt to clean up partially saved file if error occurs
            if file_path.exists():
                try: os.remove(file_path)
                except OSError: pass
            return Response({'error': f'Failed to save uploaded file: {e}'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        # --- Trigger the appropriate Celery task ---
        try:
            # Pass the absolute path of the saved file (as a string) to the task
            task_signature = task_to_run.s(str(file_path))
            # Queue the task for asynchronous execution by a Celery worker
            task_result = task_signature.delay()
            log.info(f"Triggered Celery task {task_to_run.__name__} with ID {task_result.id} for file {file_path}")

            # Return a success response indicating the task has been queued
            return Response({
                'message': f'File "{file_obj.name}" uploaded successfully. Import task "{task_to_run.__name__}" started.',
                'task_id': task_result.id # Provide task ID for potential status tracking
            }, status=status.HTTP_202_ACCEPTED) # 202 Accepted indicates processing started
        except Exception as e:
            # Handle errors during task queuing (e.g., Celery broker connection issue)
            log.error(f"Error triggering Celery task for file '{file_path}': {e}", exc_info=True)
            # Attempt to clean up the saved file if task triggering fails
            try:
                os.remove(file_path)
                log.info(f"Cleaned up saved file '{file_path}' after task trigger failure.")
            except OSError as remove_error:
                 log.error(f"Error removing file '{file_path}' after task trigger failure: {remove_error}")
            # Return an error response
            return Response({'error': f'File saved, but failed to trigger processing task: {e}'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

