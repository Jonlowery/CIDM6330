# api/portfolio/tasks.py (Added email task)

import os
import logging
import time # Added for retry delay
import openpyxl
from celery import shared_task, chain
# Import necessary Django components
from django.db import transaction, IntegrityError, OperationalError
from django.conf import settings
from django.core.mail import send_mail # For sending email
# Import models from the current app
from .models import Security, Customer, Portfolio, CustomerHolding
# Import Decimal for data cleaning
from decimal import Decimal, InvalidOperation

# Setup logging
log = logging.getLogger(__name__)

# --- Helper Functions ---
def clean_decimal(value, default=None):
    """ Safely convert value to Decimal, return default if conversion fails. """
    if value is None:
        return default
    try:
        # Handle potential percentage strings if needed
        if isinstance(value, str) and '%' in value:
            value = value.replace('%', '').strip()
        return Decimal(value)
    except (InvalidOperation, TypeError, ValueError):
        log.warning(f"Could not convert '{value}' to Decimal, using default '{default}'")
        return default

def clean_date(value, default=None):
    """ Safely convert value to Date, return default if conversion fails. """
    from datetime import datetime # Import datetime locally for clarity
    if value is None:
        return default
    # Handle cases where openpyxl might return datetime objects
    if isinstance(value, datetime):
        return value.date()
    try:
        # Add specific parsing logic here if Excel dates are strings in known formats
        # Example: return datetime.strptime(str(value), '%m/%d/%Y').date()
        # If relying solely on openpyxl's conversion to datetime:
        if not isinstance(value, datetime):
             # Log if the value isn't a datetime object as expected from data_only=True
             log.warning(f"Value '{value}' is not a datetime object from openpyxl. Attempting direct use, might fail.")
             # If parsing is needed, add it here, otherwise return default
             # For now, assume openpyxl handles it or return default
             return default # Or attempt specific parsing if a format is known
        # This part might not be reached if openpyxl handles conversion correctly
        return value.date() # If it IS a datetime object, return its date part
    except (ValueError, TypeError) as e:
        log.warning(f"Could not convert '{value}' to Date: {e}. Using default '{default}'")
        return default

# --- Import Tasks ---

@shared_task
def import_securities_from_excel(file_path):
    """
    Imports or updates securities from an Excel file based on CUSIP.
    Does NOT delete existing securities. Includes basic retry for DB locks.
    """
    log.info(f"Starting security import/update from {file_path}")
    updated_count = 0
    created_count = 0
    skipped_rows = 0
    max_retries_per_row = 3
    retry_delay = 0.5 # seconds

    try:
        # Load workbook in read-only mode and get data values directly
        wb = openpyxl.load_workbook(filename=file_path, data_only=True, read_only=True)
        ws = wb.active
    except FileNotFoundError:
        log.error(f"Security import file not found: {file_path}")
        # Raise error to mark task as failed in Celery
        raise FileNotFoundError(f"Security import file not found: {file_path}")
    except Exception as e:
        log.error(f"Error opening security import file {file_path}: {e}", exc_info=True)
        raise # Reraise unexpected errors

    # Read headers from the first row
    headers = [str(cell.value).lower().strip().replace(' ', '_') if cell.value else None for cell in ws[1]]
    headers = [h for h in headers if h] # Remove None values from empty header cells
    log.info(f"Found security headers: {headers}")

    # Create a map of header names to column indices for easy access
    col_map = {header: idx for idx, header in enumerate(headers)}
    # Ensure mandatory 'cusip' header exists
    if 'cusip' not in col_map:
        log.error("Mandatory header 'cusip' not found in security import file.")
        wb.close()
        raise ValueError("Mandatory header 'cusip' not found in security import file.")

    # Iterate through rows, starting from the second row
    for row_idx, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        # Basic row validation: check if row has enough columns
        if len(row) < len(headers):
            log.warning(f"Securities Row {row_idx}: Skipping row due to insufficient columns (expected {len(headers)}, got {len(row)})")
            skipped_rows += 1
            continue

        # Create dictionary from headers and row data
        raw_data = dict(zip(headers, row))
        cusip = raw_data.get('cusip')

        # Skip row if CUSIP is missing
        if not cusip:
            log.warning(f"Securities Row {row_idx}: Skipping row due to missing CUSIP.")
            skipped_rows += 1
            continue
        cusip = str(cusip).strip() # Clean CUSIP

        # Prepare data dictionary for update_or_create defaults
        data_defaults = {
            'description': raw_data.get('description', ''),
            'issue_date': clean_date(raw_data.get('issue_date')),
            'maturity_date': clean_date(raw_data.get('maturity_date')),
            'call_date': clean_date(raw_data.get('call_date')), # Assuming call_date might exist
            'coupon': clean_decimal(raw_data.get('coupon')),
            'wal': clean_decimal(raw_data.get('wal')),
            # Safely get payment frequency, default to Semiannual (2)
            'payment_frequency': int(clean_decimal(raw_data.get('payment_frequency'))) if raw_data.get('payment_frequency') else 2,
            # Safely get day count, default to 30/360
            'day_count': raw_data.get('day_count', '30/360'),
            # Safely get factor, default to 1.0
            'factor': clean_decimal(raw_data.get('factor'), default=Decimal('1.0')),
        }
        # Remove None values from defaults to avoid overwriting existing data with None during update
        data_defaults = {k: v for k, v in data_defaults.items() if v is not None}

        # --- Retry logic for database lock ---
        retries = 0
        success = False
        while retries < max_retries_per_row and not success:
            try:
                # Use transaction.atomic for atomic update or create
                with transaction.atomic():
                    security, created = Security.objects.update_or_create(
                        cusip=cusip,      # Match based on CUSIP
                        defaults=data_defaults # Apply cleaned data
                    )
                success = True # Mark as successful if transaction completes
                if created:
                    created_count += 1
                    log.debug(f"Sec Row {row_idx}: Created Security: {cusip}")
                else:
                    updated_count += 1
                    log.debug(f"Sec Row {row_idx}: Updated Security: {cusip}")
            except OperationalError as e:
                # Handle database lock errors specifically for retrying
                # Check if 'database is locked' is in the error message (case-insensitive)
                if 'database is locked' in str(e).lower() and retries < max_retries_per_row - 1:
                    retries += 1
                    wait_time = retry_delay * (2**retries) # Exponential backoff
                    log.warning(f"Sec Row {row_idx}: DB locked for security {cusip}. Retrying ({retries}/{max_retries_per_row-1}) in {wait_time:.2f}s...")
                    time.sleep(wait_time)
                else:
                    # Persistent lock or other OperationalError
                    log.error(f"Sec Row {row_idx}: OperationalError importing security {cusip} after {retries} retries: {e}")
                    skipped_rows += 1
                    break # Exit retry loop for this row
            except IntegrityError as e:
                # Handle potential integrity errors (e.g., unique constraints if model changes)
                log.error(f"Sec Row {row_idx}: IntegrityError importing security {cusip}: {e}")
                skipped_rows += 1
                break # Exit retry loop for this row
            except Exception as e:
                # Catch any other unexpected errors
                log.error(f"Sec Row {row_idx}: Unexpected error importing security {cusip}: {e}", exc_info=True) # Log traceback
                skipped_rows += 1
                break # Exit retry loop for this row

    wb.close() # Close the workbook to release resources
    result_message = f"Imported/Updated securities from {os.path.basename(file_path)}. Created: {created_count}, Updated: {updated_count}, Skipped: {skipped_rows}."
    log.info(result_message)
    return result_message


# --- UPDATED import_customers_from_excel ---
@shared_task
def import_customers_from_excel(file_path):
    """
    Imports or updates customers from an Excel file based on customer_number.
    Optionally updates salesperson_name and salesperson_email if columns exist.
    Ensures a default "Primary Holdings" portfolio exists for each customer
    and marks it with is_default=True.
    Includes basic retry for DB locks.
    """
    log.info(f"Starting customer import/update from {file_path}")
    updated_count = 0
    created_count = 0
    portfolio_created_count = 0
    portfolio_marked_default_count = 0
    skipped_rows = 0
    max_retries_per_row = 3
    retry_delay = 0.5 # seconds

    try:
        wb = openpyxl.load_workbook(filename=file_path, data_only=True, read_only=True)
        ws = wb.active
    except FileNotFoundError:
        log.error(f"Customer import file not found: {file_path}")
        raise FileNotFoundError(f"Customer import file not found: {file_path}")
    except Exception as e:
        log.error(f"Error opening customer import file {file_path}: {e}", exc_info=True)
        raise

    # Read headers and normalize them (lowercase, underscore spaces)
    headers = [str(cell.value).lower().strip().replace(' ', '_') if cell.value else None for cell in ws[1]]
    headers = [h for h in headers if h]
    log.info(f"Found customer headers: {headers}")

    # Check for mandatory header
    if 'customer_number' not in headers:
        log.error("Mandatory header 'customer_number' not found in customer import file.")
        wb.close()
        raise ValueError("Mandatory header 'customer_number' not found in customer import file.")

    # Iterate through data rows
    for row_idx, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        if len(row) < len(headers):
            log.warning(f"Customers Row {row_idx}: Skipping row due to insufficient columns (expected {len(headers)}, got {len(row)})")
            skipped_rows += 1
            continue

        # Create dictionary from headers and row data
        raw_data = dict(zip(headers, row))
        customer_number = raw_data.get('customer_number')

        if not customer_number:
            log.warning(f"Customers Row {row_idx}: Skipping row due to missing customer_number.")
            skipped_rows += 1
            continue
        customer_number = str(customer_number).strip() # Clean customer number

        # Prepare customer data defaults dictionary
        customer_defaults = {}
        # Map standard fields if they exist in headers
        if 'name' in headers: customer_defaults['name'] = raw_data.get('name')
        if 'address' in headers: customer_defaults['address'] = raw_data.get('address')
        if 'city' in headers: customer_defaults['city'] = raw_data.get('city')
        if 'state' in headers: customer_defaults['state'] = raw_data.get('state')
        if 'zip_code' in headers: customer_defaults['zip_code'] = raw_data.get('zip_code')

        # --- ADDED: Map salesperson fields if they exist in headers ---
        if 'salesperson_name' in headers:
            customer_defaults['salesperson_name'] = raw_data.get('salesperson_name')
        if 'salesperson_email' in headers:
            # Basic check if email looks valid, otherwise set to None or skip
            email = raw_data.get('salesperson_email')
            if email and '@' in str(email): # Simple validation
                 customer_defaults['salesperson_email'] = str(email).strip()
            else:
                 log.warning(f"Customers Row {row_idx}: Invalid or missing salesperson_email '{email}' for customer {customer_number}. Skipping email update.")
                 # Optionally set to None if you want to clear existing invalid emails:
                 # customer_defaults['salesperson_email'] = None
        # -------------------------------------------------------------

        # Only include fields that were actually present in the row and are not None
        customer_defaults = {k: v for k, v in customer_defaults.items() if v is not None}

        # --- Retry logic for database lock ---
        retries = 0
        success = False
        customer = None
        customer_created = False
        portfolio = None
        portfolio_created = False
        portfolio_updated = False # Track if existing default portfolio was updated

        while retries < max_retries_per_row and not success:
            try:
                # Use a single transaction for customer and default portfolio operations
                with transaction.atomic():
                    # Update or create the customer
                    customer, customer_created = Customer.objects.update_or_create(
                        customer_number=customer_number,
                        defaults=customer_defaults # Apply collected defaults
                    )

                    # Define the standard name for the default portfolio
                    # Use customer name if available, otherwise fallback to customer number
                    portfolio_owner_name = customer.name if customer.name else f"Customer {customer.customer_number}"
                    portfolio_name = f"{portfolio_owner_name} - Primary Holdings"


                    # --- Ensure default portfolio exists AND is marked as default ---
                    # Define the defaults for get_or_create, including is_default=True
                    portfolio_defaults = {'is_default': True, 'name': portfolio_name} # Include name in defaults
                    # Try to get or create based on owner and is_default=True
                    try:
                        portfolio, portfolio_created = Portfolio.objects.get_or_create(
                            owner=customer,
                            is_default=True, # Match based on owner and default status
                            defaults=portfolio_defaults # Apply defaults ONLY if creating
                        )
                    except IntegrityError as ie:
                        # This might happen if a default portfolio exists but with a different name
                        # and the unique constraint is on (owner, is_default)
                        log.warning(f"Cust Row {row_idx}: IntegrityError finding/creating default portfolio for {customer_number}. Attempting lookup by name. Error: {ie}")
                        # Fallback: try finding by name if get_or_create failed
                        portfolio, portfolio_created = Portfolio.objects.get_or_create(
                            owner=customer,
                            name=portfolio_name, # Match based on owner and name
                            defaults=portfolio_defaults # Apply defaults ONLY if creating
                        )
                        # If found by name, ensure is_default is True
                        if not portfolio_created and not portfolio.is_default:
                            portfolio.is_default = True
                            portfolio.save(update_fields=['is_default'])
                            portfolio_updated = True


                    # If the portfolio was NOT created (it already existed),
                    # ensure its is_default flag is True and name matches convention.
                    if not portfolio_created:
                        updated_fields = []
                        if not portfolio.is_default:
                            portfolio.is_default = True
                            updated_fields.append('is_default')
                        if portfolio.name != portfolio_name: # Check if name needs update
                            portfolio.name = portfolio_name
                            updated_fields.append('name')

                        if updated_fields:
                            portfolio.save(update_fields=updated_fields) # Efficiently update only the flag/name
                            portfolio_updated = True # Mark that we updated the flag/name

                success = True # Mark transaction as successful

            except OperationalError as e:
                 if 'database is locked' in str(e).lower() and retries < max_retries_per_row -1:
                    retries += 1
                    wait_time = retry_delay * (2**retries)
                    log.warning(f"Cust Row {row_idx}: DB locked for customer {customer_number}. Retrying ({retries}/{max_retries_per_row-1}) in {wait_time:.2f}s...")
                    time.sleep(wait_time)
                 else:
                    log.error(f"Cust Row {row_idx}: OperationalError importing customer {customer_number} after {retries} retries: {e}")
                    skipped_rows += 1
                    break # Exit retry loop
            except IntegrityError as e:
                # Could be unique constraint on portfolio (owner, is_default=True) or customer_number
                log.error(f"Cust Row {row_idx}: IntegrityError importing customer {customer_number} or default portfolio: {e}", exc_info=True)
                skipped_rows += 1
                break # Exit retry loop
            except Exception as e:
                log.error(f"Cust Row {row_idx}: Unexpected error importing customer {customer_number}: {e}", exc_info=True)
                skipped_rows += 1
                break # Exit retry loop

        # Log results outside the retry loop if successful
        if success:
            if customer_created:
                created_count += 1
                log.debug(f"Cust Row {row_idx}: Created Customer: {customer_number}")
            else:
                updated_count += 1
                log.debug(f"Cust Row {row_idx}: Updated Customer: {customer_number}")
            if portfolio_created:
                portfolio_created_count += 1
                log.debug(f"Cust Row {row_idx}: Created default Portfolio '{portfolio.name}' for Customer: {customer_number}")
            elif portfolio_updated:
                portfolio_marked_default_count += 1
                log.debug(f"Cust Row {row_idx}: Marked existing Portfolio '{portfolio.name}' as default (or updated name) for Customer: {customer_number}")

    wb.close()
    result_message = (
        f"Imported/Updated customers from {os.path.basename(file_path)}. "
        f"Customers Created: {created_count}, Updated: {updated_count}. "
        f"Default Portfolios Created: {portfolio_created_count}, "
        f"Existing Portfolios Marked Default/Updated: {portfolio_marked_default_count}, "
        f"Skipped Rows: {skipped_rows}."
    )
    log.info(result_message)
    return result_message


# import_holdings_from_excel remains unchanged (operates on default portfolio)
@shared_task(bind=True, autoretry_for=(OperationalError,), retry_backoff=5, max_retries=3)
def import_holdings_from_excel(self, file_path):
    """
    Imports or updates holdings from an Excel file ONLY into the default
    "Primary Holdings" portfolio for each customer. Deletes holdings from
    that default portfolio if they are no longer present in the file for that customer.
    Other portfolios are NOT affected. Includes retry for DB locks.
    """
    log.info(f"Starting holding import/update (Primary Portfolio Only) from {file_path}")
    updated_count = 0
    created_count = 0
    deleted_count = 0
    skipped_rows = 0
    # Stores {customer_id: set(security_id)} processed from the file FOR THE DEFAULT PORTFOLIO
    processed_holding_keys_in_default_portfolio = {}

    max_retries_per_row = 3
    retry_delay = 0.5 # seconds

    try:
        wb = openpyxl.load_workbook(filename=file_path, data_only=True, read_only=True)
        ws = wb.active
    except FileNotFoundError:
        log.error(f"Holding import file not found: {file_path}")
        raise FileNotFoundError(f"Holding import file not found: {file_path}")
    except Exception as e:
        log.error(f"Error opening holding import file {file_path}: {e}", exc_info=True)
        raise

    headers = [str(cell.value).lower().strip().replace(' ', '_') if cell.value else None for cell in ws[1]]
    headers = [h for h in headers if h]
    log.info(f"Found holding headers: {headers}")

    if 'customer_number' not in headers or 'cusip' not in headers:
        log.error("Mandatory headers 'customer_number' and 'cusip' not found in holding import file.")
        wb.close()
        raise ValueError("Mandatory headers 'customer_number' and 'cusip' not found.")

    # --- First Pass: Process rows, update/create holdings in DEFAULT portfolio ---
    log.info("Holdings Pass 1: Updating/Creating holdings in default portfolios...")
    customer_cache = {} # Cache customers to reduce DB hits
    security_cache = {} # Cache securities
    default_portfolio_cache = {} # Cache default portfolios {customer_id: portfolio_instance_or_None}

    for row_idx, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        if len(row) < len(headers):
            log.warning(f"Holdings Row {row_idx}: Skipping row due to insufficient columns (expected {len(headers)}, got {len(row)})")
            skipped_rows += 1; continue

        raw_data = dict(zip(headers, row))
        cust_no = raw_data.get('customer_number')
        cusip = raw_data.get('cusip')

        if not cust_no or not cusip:
            log.warning(f"Holdings Row {row_idx}: Skipping row due to missing customer_number ({cust_no}) or cusip ({cusip}).")
            skipped_rows += 1; continue

        cust_no = str(cust_no).strip()
        cusip = str(cusip).strip()

        # --- Get Customer (use cache) ---
        customer = customer_cache.get(cust_no)
        if not customer:
            try:
                customer = Customer.objects.get(customer_number=cust_no)
                customer_cache[cust_no] = customer
            except Customer.DoesNotExist:
                log.warning(f"Holdings Row {row_idx}: Skipping holding for unknown customer_number {cust_no}")
                skipped_rows += 1; continue
            except Exception as e:
                 log.error(f"Holdings Row {row_idx}: Error fetching customer {cust_no}: {e}")
                 skipped_rows += 1; continue

        # --- Get Security (use cache) ---
        security = security_cache.get(cusip)
        if not security:
            try:
                security = Security.objects.get(cusip=cusip)
                security_cache[cusip] = security
            except Security.DoesNotExist:
                log.warning(f"Holdings Row {row_idx}: Skipping holding for unknown cusip {cusip} (Customer: {cust_no})")
                skipped_rows += 1; continue
            except Exception as e:
                 log.error(f"Holdings Row {row_idx}: Error fetching security {cusip}: {e}")
                 skipped_rows += 1; continue

        # --- Get Default Portfolio (use cache, ensure it's marked default) ---
        default_portfolio = default_portfolio_cache.get(customer.id)
        if customer.id not in default_portfolio_cache: # Check cache first
            try:
                 # Find the portfolio marked as default for this owner
                default_portfolio = Portfolio.objects.get(owner=customer, is_default=True)
                default_portfolio_cache[customer.id] = default_portfolio
            except Portfolio.DoesNotExist:
                 # This should ideally not happen if customer import ran correctly
                 log.warning(f"Holdings Row {row_idx}: Default portfolio not found for customer {cust_no}. Skipping holding. Run customer import first.")
                 default_portfolio_cache[customer.id] = None # Cache None
                 skipped_rows += 1; continue
            except Portfolio.MultipleObjectsReturned:
                 # This indicates a data integrity issue (more than one default portfolio)
                 log.error(f"Holdings Row {row_idx}: CRITICAL - Multiple default portfolios found for customer {cust_no}. Skipping holding.")
                 default_portfolio_cache[customer.id] = None # Cache None
                 skipped_rows += 1; continue
            except Exception as e:
                 log.error(f"Holdings Row {row_idx}: Error fetching default portfolio for customer {cust_no}: {e}")
                 default_portfolio_cache[customer.id] = None
                 skipped_rows += 1; continue

        # If default portfolio doesn't exist (cached as None), skip
        if default_portfolio is None:
             skipped_rows += 1; continue

        # --- Prepare holding data defaults ---
        # Note: We are removing the direct 'customer' and 'customer_number' FKs from Holding model
        # They are derived from the portfolio owner.
        holding_defaults = {
            'original_face_amount': clean_decimal(raw_data.get('original_face_amount')),
            'settlement_date': clean_date(raw_data.get('settlement_date')),
            'settlement_price': clean_decimal(raw_data.get('settlement_price')),
            'book_price': clean_decimal(raw_data.get('book_price')),
            'book_yield': clean_decimal(raw_data.get('book_yield')),
            # Copy potentially cached fields from security at time of import?
            # Or rely on fetching from Security model always? Let's rely on Security model.
        }
        holding_defaults = {k: v for k, v in holding_defaults.items() if v is not None}

        # --- Perform update_or_create within the DEFAULT portfolio ---
        retries = 0
        success = False
        while retries < max_retries_per_row and not success:
            try:
                with transaction.atomic():
                    holding, created = CustomerHolding.objects.update_or_create(
                        portfolio=default_portfolio, # Target specific default portfolio
                        security=security,
                        defaults=holding_defaults
                    )
                success = True
                # Track processed security IDs *for this customer's default portfolio*
                if customer.id not in processed_holding_keys_in_default_portfolio:
                     processed_holding_keys_in_default_portfolio[customer.id] = set()
                processed_holding_keys_in_default_portfolio[customer.id].add(security.id)

                if created: created_count += 1; log.debug(f"Hold Row {row_idx}: Created Holding in '{default_portfolio.name}', Sec: {security.cusip}")
                else: updated_count += 1; log.debug(f"Hold Row {row_idx}: Updated Holding in '{default_portfolio.name}', Sec: {security.cusip}")

            except OperationalError as e:
                 # Let celery handle retry based on task decorator
                 if retries < max_retries_per_row -1 :
                    log.warning(f"Hold Row {row_idx}: DB locked for holding P:{default_portfolio.id}/S:{security.id}. Celery will retry...")
                 retries += 1
                 time.sleep(retry_delay * (2**retries)) # Optional manual backoff
                 if retries >= max_retries_per_row :
                      log.error(f"Hold Row {row_idx}: DB lock persisted for holding P:{default_portfolio.id}/S:{security.id}. Raising error.")
                      raise # Raise error to let Celery handle final failure
            except IntegrityError as e:
                log.error(f"Hold Row {row_idx}: IntegrityError on holding P:{default_portfolio.id}, S:{security.cusip}: {e}", exc_info=True)
                skipped_rows += 1; break
            except Exception as e:
                log.error(f"Hold Row {row_idx}: Unexpected error on holding P:{default_portfolio.id}, S:{security.cusip}: {e}", exc_info=True)
                skipped_rows += 1; break

    # --- Second Pass: Delete obsolete holdings from relevant DEFAULT portfolios ---
    log.info("Holdings Pass 2: Deleting obsolete holdings from default portfolios...")

    for customer_id, processed_security_ids in processed_holding_keys_in_default_portfolio.items():
        default_portfolio = default_portfolio_cache.get(customer_id)
        if not default_portfolio:
            log.warning(f"Holdings Deletion: Could not find default portfolio for customer ID {customer_id} during deletion phase. Skipping.")
            continue

        log.info(f"Holdings Deletion: Checking default portfolio '{default_portfolio.name}' (ID: {default_portfolio.id}) for obsolete holdings.")
        try:
            # Find holdings in the DB for this specific default portfolio NOT present in the file
            obsolete_holdings_qs = CustomerHolding.objects.filter(portfolio=default_portfolio).exclude(security_id__in=processed_security_ids)
            # Execute the query to get the count
            obsolete_count = obsolete_holdings_qs.count()


            if obsolete_count > 0:
                log.info(f"Holdings Deletion: Attempting to delete {obsolete_count} obsolete holdings from portfolio {default_portfolio.id}.")
                # Perform deletion within a transaction
                retries = 0
                success = False
                deleted_batch_count = 0
                while retries < max_retries_per_row and not success:
                    try:
                        with transaction.atomic():
                            # Use the queryset's delete method
                            # Re-fetch the queryset inside the transaction if needed,
                            # or ensure the original queryset is still valid.
                            deleted_batch_count, _ = obsolete_holdings_qs.delete()
                        success = True
                        deleted_count += deleted_batch_count
                        log.info(f"Holdings Deletion: Successfully deleted {deleted_batch_count} holdings from portfolio '{default_portfolio.name}'.")
                    except OperationalError as e:
                        if 'database is locked' in str(e).lower() and retries < max_retries_per_row -1:
                            retries += 1
                            wait_time = retry_delay * (2**retries)
                            log.warning(f"Holdings Deletion: DB locked deleting holdings for portfolio {default_portfolio.id}. Retrying ({retries}/{max_retries_per_row-1}) in {wait_time:.2f}s...")
                            time.sleep(wait_time)
                        else:
                            log.error(f"Holdings Deletion: OperationalError deleting holdings for portfolio {default_portfolio.id} after {retries} retries: {e}")
                            break # Exit retry loop for this portfolio's deletion
                    except Exception as e:
                         log.error(f"Holdings Deletion: Error deleting obsolete holdings for portfolio '{default_portfolio.name}': {e}", exc_info=True)
                         break # Exit retry loop
            else:
                log.info(f"Holdings Deletion: No obsolete holdings found in portfolio '{default_portfolio.name}'.")
        except Exception as e:
             log.error(f"Holdings Deletion: Unexpected error processing portfolio ID {default_portfolio.id}: {e}", exc_info=True)

    wb.close()
    result_message = (f"Processed holdings (Primary Portfolio Only) from {os.path.basename(file_path)}. "
                      f"Created: {created_count}, Updated: {updated_count}, Deleted: {deleted_count}, Skipped Rows: {skipped_rows}.")
    log.info(result_message)
    return result_message


# import_all_from_excel remains unchanged
@shared_task
def import_all_from_excel():
    """
    Orchestrates the three imports in sequence using hardcoded paths.
    Now correctly marks default portfolios during customer import.
    Consider if this task is still needed given the View-based trigger.
    """
    log.info("Scheduling chained non-destructive import from hardcoded paths...")
    base = settings.BASE_DIR / 'data' / 'imports'
    sec_file = base / 'sample_securities.xlsx'
    cust_file = base / 'customers.xlsx'
    hold_file = base / 'holdings.xlsx'

    files_ok = True
    if not sec_file.exists(): log.error(f"Chained Import: Security file not found: {sec_file}"); files_ok = False
    if not cust_file.exists(): log.error(f"Chained Import: Customer file not found: {cust_file}"); files_ok = False
    if not hold_file.exists(): log.error(f"Chained Import: Holdings file not found: {hold_file}"); files_ok = False

    if not files_ok: return "Error: One or more import files not found for chained import."

    # Use .si() to pass arguments immutably if the task doesn't modify them
    # Use .s() if the task might modify the argument (like a mutable object)
    # or if you prefer the standard signature behavior.
    import_chain = chain(
        import_securities_from_excel.s(str(sec_file)),
        import_customers_from_excel.s(str(cust_file)), # Using .s() is generally safer
        import_holdings_from_excel.s(str(hold_file)),   # Using .s()
    )
    import_chain.apply_async()

    result_message = "Scheduled chained non-destructive import of securities -> customers -> holdings from hardcoded paths."
    log.info(result_message)
    return result_message


# --- NEW TASK for Sending Salesperson Email ---
@shared_task(bind=True, autoretry_for=(Exception,), retry_backoff=True, max_retries=3)
def send_salesperson_interest_email(self, salesperson_email, salesperson_name, customer_name, customer_number, selected_bonds):
    """
    Sends an email notification to the salesperson about customer's selling interest.

    Args:
        salesperson_email (str): Recipient email address.
        salesperson_name (str): Salesperson's name (for greeting).
        customer_name (str): Customer's name.
        customer_number (str): Customer's number.
        selected_bonds (list): List of dicts [{'cusip': str, 'par': str}, ...].
    """
    log.info(f"Task send_salesperson_interest_email started for salesperson: {salesperson_email}, customer: {customer_number}")

    # Format subject
    subject = f"Interest in Selling Bonds - Customer {customer_name} ({customer_number})"

    # Format body
    greeting_name = salesperson_name if salesperson_name else "Salesperson"
    customer_display = f"{customer_name} ({customer_number})" if customer_name else f"Customer {customer_number}"

    bond_lines = []
    for bond in selected_bonds:
        # Format par amount nicely if possible, otherwise use the string as is
        try:
            par_decimal = Decimal(bond['par'])
            par_formatted = f"{par_decimal:,.2f}" # Add commas and 2 decimal places
        except (InvalidOperation, TypeError, ValueError):
            par_formatted = bond['par'] # Fallback to the original string
        bond_lines.append(f"  - CUSIP: {bond['cusip']}, Par: {par_formatted}")

    bonds_list_str = "\n".join(bond_lines)

    body = f"""Dear {greeting_name},

Our client, {customer_display}, has indicated interest in selling the following bonds held in their portfolio:

{bonds_list_str}

Please follow up with them regarding this interest.

Thanks,
Portfolio Analyzer System
"""

    try:
        send_mail(
            subject,
            body,
            settings.DEFAULT_FROM_EMAIL, # Sender email address (configure in settings.py)
            [salesperson_email],         # List of recipients
            fail_silently=False,         # Raise exceptions on failure
        )
        log.info(f"Successfully sent interest email to {salesperson_email} for customer {customer_number}")
        return f"Email sent successfully to {salesperson_email}"
    except Exception as e:
        log.error(f"Failed to send interest email to {salesperson_email} for customer {customer_number}. Error: {e}", exc_info=True)
        # Celery will retry based on task decorator settings
        # You might want to raise the exception again if you want the task to be marked as failed after retries
        raise self.retry(exc=e, countdown=60) # Retry after 60 seconds
