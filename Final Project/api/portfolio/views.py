# api/portfolio/views.py (Added EmailSalespersonInterestView)

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
from rest_framework.views import APIView # Import APIView
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.response import Response
from rest_framework import serializers # For raising validation errors

# Import Celery tasks for the import view AND the new email task
from .tasks import (
    import_securities_from_excel,
    import_customers_from_excel,
    import_holdings_from_excel,
    send_salesperson_interest_email, # <-- Import the new task
)
# Import models and serializers
from .models import Customer, Security, Portfolio, CustomerHolding
from .serializers import (
    ExcelUploadSerializer,
    CustomerSerializer,
    SecuritySerializer,
    PortfolioSerializer,
    CustomerHoldingSerializer,
    SalespersonInterestSerializer, # <-- Import the new serializer
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
    filter_backends = [DjangoFilterBackend] # Enable filtering
    filterset_fields = ['cusip'] # Allow filtering by CUSIP

class PortfolioViewSet(viewsets.ModelViewSet):
    """
    API endpoint for viewing and editing Portfolio instances.
    Handles filtering based on user's associated customers and
    custom logic for portfolio creation and deletion based on user role.
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

    def perform_create(self, serializer):
        """
        Custom logic to determine and assign the 'owner' when creating a Portfolio.
        If 'initial_holding_ids' are provided and valid, copies those holdings
        into the newly created portfolio.
        """
        user = self.request.user
        # Get the owner instance determined during validation (either from context or data)
        # The serializer's create method now handles setting the owner correctly.
        # We just need to handle the holding copy logic here.
        owner = serializer.validated_data.get('owner') # Get owner set by serializer.create
        if not owner:
            # Fallback check, though serializer should guarantee owner exists here
             owner_from_context = self.get_serializer_context().get('_intended_owner')
             if owner_from_context:
                 owner = owner_from_context
             else:
                 log.error(f"Portfolio perform_create: Could not determine owner for user {user.username}.")
                 # Use a more specific error if possible
                 raise serializers.ValidationError("Failed to determine the portfolio owner during creation.")


        # Get validated initial holding IDs from the original request data
        # Accessing request.data directly here is generally discouraged,
        # it's better if the serializer keeps validated data accessible.
        # Let's assume the serializer's validated_data still holds it,
        # or re-validate if necessary. For simplicity, access from initial request context if needed.
        initial_holding_ids = self.get_serializer_context().get('request').data.get('initial_holding_ids', [])
        # Ensure initial_holding_ids are integers if they exist
        if initial_holding_ids:
            try:
                initial_holding_ids = [int(id_val) for id_val in initial_holding_ids]
            except (ValueError, TypeError):
                 log.warning(f"Invalid format for initial_holding_ids provided by user {user.username}. Expected list of integers.")
                 initial_holding_ids = [] # Reset to empty list if format is wrong


        # --- Create Portfolio and Copy Holdings (if applicable) ---
        new_portfolio = None
        copied_holdings_count = 0
        try:
            # Use a database transaction to ensure atomicity
            with transaction.atomic():
                # 1. Save the new portfolio instance using the serializer
                # The serializer's create method handles owner assignment now.
                new_portfolio = serializer.save() # owner is set within serializer.save() -> serializer.create()
                log.info(f"Portfolio '{new_portfolio.name}' (ID: {new_portfolio.id}) created for owner {new_portfolio.owner.customer_number}.")

                # 2. Copy initial holdings if IDs were provided and validated
                if initial_holding_ids:
                    log.info(f"Copying {len(initial_holding_ids)} initial holdings into new portfolio {new_portfolio.id}...")
                    # Fetch original holdings (validation ensures they belong to the owner)
                    holdings_to_copy = CustomerHolding.objects.filter(
                        id__in=initial_holding_ids,
                        portfolio__owner=owner # Ensure owner matches
                    ).select_related('security') # select_related for efficiency

                    new_holdings_to_create = []
                    for original_holding in holdings_to_copy:
                        # Create a new holding instance, copying relevant fields
                        new_holding = CustomerHolding(
                            portfolio=new_portfolio, # Link to NEW portfolio
                            security=original_holding.security, # Link to SAME security
                            # customer=owner, # Removed redundant FK
                            # customer_number=owner.customer_number, # Removed redundant field
                            # Copy other relevant fields
                            original_face_amount=original_holding.original_face_amount,
                            settlement_date=original_holding.settlement_date,
                            settlement_price=original_holding.settlement_price,
                            book_price=original_holding.book_price,
                            book_yield=original_holding.book_yield,
                            # Copy potentially cached fields from original holding (or its security)?
                            # It's better to rely on the related Security object for these.
                            # wal=original_holding.wal,
                            # coupon=original_holding.coupon,
                            # call_date=original_holding.call_date,
                            # maturity_date=original_holding.maturity_date,
                            # description=original_holding.description,
                        )
                        new_holdings_to_create.append(new_holding)

                    # Bulk create the new holdings
                    if new_holdings_to_create:
                        created_list = CustomerHolding.objects.bulk_create(new_holdings_to_create)
                        copied_holdings_count = len(created_list)
                        log.info(f"Successfully copied {copied_holdings_count} holdings into portfolio {new_portfolio.id}.")
                    else:
                         log.info(f"No valid holdings found to copy for portfolio {new_portfolio.id} based on provided IDs: {initial_holding_ids}.")

        except Exception as e:
            # If portfolio creation succeeded but holding copy failed, the transaction should roll back.
            log.error(f"Error during portfolio creation or holding copy for user {user.username}: {e}", exc_info=True)
            # Raise DRF validation error to provide feedback to the user
            raise serializers.ValidationError("An error occurred while creating the portfolio or copying holdings.") from e


    # --- perform_destroy method ---
    def perform_destroy(self, instance):
        """
        Custom logic executed before deleting a Portfolio instance.
        Prevents deletion of the default portfolio.
        """
        user = self.request.user
        log.info(f"User {user.username} attempting to delete portfolio '{instance.name}' (ID: {instance.id}, Default: {instance.is_default})")

        # 1. Permission Check (Standard DRF permissions handle basic access)
        # Add explicit check for non-admins to ensure they are linked to the owner
        if not (user.is_staff or user.is_superuser):
            if not user.customers.filter(id=instance.owner_id).exists():
                log.warning(f"User {user.username} permission denied attempting to delete portfolio {instance.id} (owner: {instance.owner.customer_number}).")
                raise PermissionDenied("You do not have permission to delete this portfolio.")

        # 2. Prevent Deletion of Default Portfolio
        if instance.is_default:
            log.warning(f"User {user.username} denied deleting default portfolio '{instance.name}' (ID: {instance.id}).")
            # Use PermissionDenied for authorization failure
            # raise PermissionDenied("Cannot delete the default 'Primary Holdings' portfolio.")
            # Use ValidationError for a potentially friendlier message in the UI
            raise serializers.ValidationError({"detail": "Cannot delete the default 'Primary Holdings' portfolio."})


        # 3. Proceed with Deletion if checks pass
        log.info(f"Proceeding with deletion of portfolio '{instance.name}' (ID: {instance.id}) by user {user.username}.")
        # The actual deletion happens here, cascading to holdings
        instance.delete()


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
    # Filter by portfolio ID or by the portfolio's owner ID
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
            'portfolio__owner', 'security' # Fetch owner via portfolio, and security
        )
        if user.is_staff or user.is_superuser:
            # Admins get all holdings
            return base_queryset.all()
        # Non-admins get holdings where the portfolio's owner is one of their associated customers
        return base_queryset.filter(portfolio__owner__users=user)

    def perform_create(self, serializer):
        """
        Custom logic executed when creating a CustomerHolding instance.
        Validates that the user has permission to add to the selected portfolio.
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

        # --- Save the holding ---
        # No need to set customer/customer_number as they are removed from the model
        serializer.save()
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
        task_name = "Unknown"
        if original_filename.startswith('securities') and original_filename.endswith('.xlsx'):
            task_to_run = import_securities_from_excel
            task_name = "Securities Import"
        elif original_filename.startswith('customers') and original_filename.endswith('.xlsx'):
            task_to_run = import_customers_from_excel
            task_name = "Customers Import"
        elif original_filename.startswith('holdings') and original_filename.endswith('.xlsx'):
            task_to_run = import_holdings_from_excel
            task_name = "Holdings Import"
        else:
            # File doesn't match expected naming convention
            log.warning(f"Admin {request.user.username} uploaded file '{file_obj.name}' which does not match expected naming convention.")
            return Response({
                'error': "Filename must start with 'securities', 'customers', or 'holdings' and end with '.xlsx'."
            }, status=status.HTTP_400_BAD_REQUEST)

        # --- Save the uploaded file securely ---
        # Define a subdirectory within BASE_DIR for uploads
        imports_dir = settings.BASE_DIR / 'data' / 'imports' / 'uploads'
        try:
            # Create the directory if it doesn't exist
            imports_dir.mkdir(parents=True, exist_ok=True)
        except OSError as e:
             log.error(f"Error creating upload directory '{imports_dir}': {e}", exc_info=True)
             return Response({'error': 'Server configuration error: Cannot create upload directory.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        # Generate a unique filename to avoid conflicts
        file_extension = os.path.splitext(file_obj.name)[1]
        unique_filename = f"{uuid.uuid4()}{file_extension}"
        file_path = imports_dir / unique_filename

        # Write the uploaded file content
        try:
            with open(file_path, 'wb+') as destination:
                for chunk in file_obj.chunks():
                    destination.write(chunk)
            log.info(f"Admin {request.user.username} uploaded file '{file_obj.name}', saved securely as '{file_path}'.")
        except Exception as e:
            log.error(f"Error saving uploaded file '{file_obj.name}' to '{file_path}': {e}", exc_info=True)
            if file_path.exists(): # Attempt cleanup
                try: os.remove(file_path)
                except OSError: pass
            return Response({'error': f'Failed to save uploaded file: {e}'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        # --- Trigger the appropriate Celery task ---
        try:
            # Pass the absolute path string to the Celery task
            task_signature = task_to_run.s(str(file_path))
            # Queue the task for asynchronous execution
            task_result = task_signature.delay()
            log.info(f"Triggered Celery task {task_to_run.__name__} with ID {task_result.id} for file {file_path}")

            # Return a success response
            return Response({
                'message': f'File "{file_obj.name}" uploaded successfully. {task_name} task ({task_result.id}) started.',
                'task_id': task_result.id # Provide task ID for status tracking
            }, status=status.HTTP_202_ACCEPTED) # 202 Accepted
        except Exception as e:
            # Handle errors during task queuing
            log.error(f"Error triggering Celery task for file '{file_path}': {e}", exc_info=True)
            # Attempt cleanup
            try:
                os.remove(file_path)
                log.info(f"Cleaned up saved file '{file_path}' after task trigger failure.")
            except OSError as remove_error:
                 log.error(f"Error removing file '{file_path}' after task trigger failure: {remove_error}")
            # Return an error response
            return Response({'error': f'File saved, but failed to trigger processing task: {e}'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


# --- NEW VIEW for Emailing Salesperson ---

class EmailSalespersonInterestView(APIView):
    """
    API endpoint for users to notify a customer's salesperson about
    their interest in selling selected bonds.
    """
    permission_classes = [permissions.IsAuthenticated] # Must be logged in

    def post(self, request, *args, **kwargs):
        """ Handles the POST request to send the interest email. """
        serializer = SalespersonInterestSerializer(data=request.data)

        # 1. Validate Input Data
        if not serializer.is_valid():
            log.warning(f"Invalid data received for email salesperson interest from user {request.user.username}. Errors: {serializer.errors}")
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        validated_data = serializer.validated_data
        customer_id = validated_data['customer_id']
        selected_bonds = validated_data['selected_bonds']

        # 2. Retrieve Customer
        try:
            customer = Customer.objects.get(id=customer_id)
        except Customer.DoesNotExist:
            log.warning(f"User {request.user.username} requested email for non-existent customer ID: {customer_id}")
            # Return 404 Not Found if customer doesn't exist
            return Response({"error": f"Customer with ID {customer_id} not found."}, status=status.HTTP_404_NOT_FOUND)

        # 3. Verify User Permission
        user = request.user
        is_admin = user.is_staff or user.is_superuser
        # Check if user is admin OR is associated with this specific customer
        if not (is_admin or user.customers.filter(id=customer.id).exists()):
            log.warning(f"User {user.username} permission denied trying to email salesperson for customer ID: {customer_id}")
            # Return 403 Forbidden if user is not authorized for this customer
            return Response({"error": "You do not have permission to perform this action for this customer."}, status=status.HTTP_403_FORBIDDEN)

        # 4. Check for Salesperson Email
        salesperson_email = customer.salesperson_email
        if not salesperson_email:
            log.warning(f"Attempted to email salesperson for customer {customer.customer_number} ({customer_id}), but no salesperson email is configured.")
            # Return 400 Bad Request if email is missing
            return Response({"error": "Salesperson email is not configured for this customer."}, status=status.HTTP_400_BAD_REQUEST)

        # 5. Trigger Asynchronous Email Task
        try:
            task_signature = send_salesperson_interest_email.s(
                salesperson_email=salesperson_email,
                salesperson_name=customer.salesperson_name or '', # Pass name or empty string
                customer_name=customer.name or '', # Pass name or empty string
                customer_number=customer.customer_number or 'N/A', # Pass number or N/A
                selected_bonds=selected_bonds
            )
            task_result = task_signature.delay()
            log.info(f"User {user.username} triggered salesperson interest email task {task_result.id} for customer {customer.customer_number} to {salesperson_email}")

            # Return 200 OK immediately, email is sent in background
            return Response({"message": "Email task queued successfully. The salesperson will be notified."}, status=status.HTTP_200_OK) # Changed to 200 OK as per requirement

        except Exception as e:
            # Handle errors during task queuing (e.g., Celery broker down)
            log.error(f"Error triggering Celery task 'send_salesperson_interest_email' for customer {customer.customer_number}: {e}", exc_info=True)
            # Return 500 Internal Server Error if task queuing fails
            return Response({"error": "Failed to queue email task. Please try again later."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
