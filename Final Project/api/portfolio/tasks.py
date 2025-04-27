# api/portfolio/tasks.py

import os
import logging
import time # Added for retry delay
import openpyxl
from celery import shared_task, chain
from django.db import transaction, IntegrityError, OperationalError
from django.conf import settings
# Removed unused slugify import
# from django.utils.text import slugify

from .models import Security, Customer, Portfolio, CustomerHolding
# Removed old comment about services.py
# from .services import load_securities, load_customers, load_holdings

log = logging.getLogger(__name__)

# --- Helper Functions remain the same ---
def clean_decimal(value, default=None):
    """ Safely convert value to Decimal, return default if conversion fails. """
    from decimal import Decimal, InvalidOperation
    if value is None:
        return default
    try:
        if isinstance(value, str) and '%' in value:
            value = value.replace('%', '').strip()
        return Decimal(value)
    except (InvalidOperation, TypeError, ValueError):
        log.warning(f"Could not convert '{value}' to Decimal, using default '{default}'")
        return default

def clean_date(value, default=None):
    """ Safely convert value to Date, return default if conversion fails. """
    from datetime import datetime
    if value is None:
        return default
    if isinstance(value, datetime): # Excel might return datetime objects
        return value.date()
    try:
        # Add specific parsing logic here if needed:
        # Example: return datetime.strptime(str(value), '%m/%d/%Y').date()
        # For now, rely on openpyxl providing datetime objects or None
        if not isinstance(value, datetime):
             log.warning(f"Value '{value}' is not a datetime object from openpyxl. Attempting direct use, might fail.")
             # Add specific parsing here if you expect strings, e.g.
             # return datetime.strptime(str(value), '%m/%d/%Y').date()
             return default # Return default if no specific parsing is added
        return default
    except (ValueError, TypeError) as e:
        log.warning(f"Could not convert '{value}' to Date: {e}. Using default '{default}'")
        return default

# --- Updated Import Tasks ---

# import_securities_from_excel remains unchanged
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
        wb = openpyxl.load_workbook(filename=file_path, data_only=True, read_only=True)
        ws = wb.active
    except FileNotFoundError:
        log.error(f"Security import file not found: {file_path}")
        # Use Celery's exception handling for task failure
        raise FileNotFoundError(f"Security import file not found: {file_path}")
    except Exception as e:
        log.error(f"Error opening security import file {file_path}: {e}", exc_info=True)
        raise # Reraise unexpected errors

    # Read headers
    headers = [str(cell.value).lower().strip().replace(' ', '_') if cell.value else None for cell in ws[1]]
    headers = [h for h in headers if h]
    log.info(f"Found security headers: {headers}")

    col_map = {header: idx for idx, header in enumerate(headers)}
    if 'cusip' not in col_map:
        log.error("Mandatory header 'cusip' not found in security import file.")
        wb.close()
        raise ValueError("Mandatory header 'cusip' not found in security import file.")

    for row_idx, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        if len(row) < len(headers):
            log.warning(f"Securities Row {row_idx}: Skipping row due to insufficient columns (expected {len(headers)}, got {len(row)})")
            skipped_rows += 1
            continue

        raw_data = dict(zip(headers, row))
        cusip = raw_data.get('cusip')

        if not cusip:
            log.warning(f"Securities Row {row_idx}: Skipping row due to missing CUSIP.")
            skipped_rows += 1
            continue
        cusip = str(cusip).strip()

        data_defaults = {
            'description': raw_data.get('description', ''),
            'issue_date': clean_date(raw_data.get('issue_date')),
            'maturity_date': clean_date(raw_data.get('maturity_date')),
            'call_date': clean_date(raw_data.get('call_date')),
            'coupon': clean_decimal(raw_data.get('coupon')),
            'wal': clean_decimal(raw_data.get('wal')),
            'payment_frequency': int(clean_decimal(raw_data.get('payment_frequency'))) if raw_data.get('payment_frequency') else Security.PAYMENT_FREQ_CHOICES[1][0], # Default Semiannual
            'day_count': raw_data.get('day_count', Security.DAY_COUNT_CHOICES[0][0]), # Default 30/360
            'factor': clean_decimal(raw_data.get('factor'), default=1.0),
        }
        data_defaults = {k: v for k, v in data_defaults.items() if v is not None}

        retries = 0
        success = False
        while retries < max_retries_per_row and not success:
            try:
                with transaction.atomic():
                    security, created = Security.objects.update_or_create(
                        cusip=cusip,
                        defaults=data_defaults
                    )
                success = True
                if created: created_count += 1; log.debug(f"Sec Row {row_idx}: Created Security: {cusip}")
                else: updated_count += 1; log.debug(f"Sec Row {row_idx}: Updated Security: {cusip}")
            except OperationalError as e:
                if 'database is locked' in str(e) and retries < max_retries_per_row - 1:
                    retries += 1
                    log.warning(f"Sec Row {row_idx}: DB locked for security {cusip}. Retrying ({retries}/{max_retries_per_row-1})...")
                    time.sleep(retry_delay * (2**retries))
                else:
                    log.error(f"Sec Row {row_idx}: OperationalError importing security {cusip} after {retries} retries: {e}")
                    skipped_rows += 1; break
            except IntegrityError as e:
                log.error(f"Sec Row {row_idx}: IntegrityError importing security {cusip}: {e}")
                skipped_rows += 1; break
            except Exception as e:
                log.error(f"Sec Row {row_idx}: Unexpected error importing security {cusip}: {e}", exc_info=True)
                skipped_rows += 1; break

    wb.close()
    result_message = f"Imported/Updated securities from {os.path.basename(file_path)}. Created: {created_count}, Updated: {updated_count}, Skipped: {skipped_rows}."
    log.info(result_message)
    return result_message


# import_customers_from_excel remains unchanged
@shared_task
def import_customers_from_excel(file_path):
    """
    Imports or updates customers from an Excel file based on customer_number.
    Creates a default "Primary Holdings" portfolio for each customer if it doesn't exist.
    Does NOT delete existing customers or portfolios. Includes basic retry for DB locks.
    """
    log.info(f"Starting customer import/update from {file_path}")
    updated_count = 0
    created_count = 0
    portfolio_created_count = 0
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

    headers = [str(cell.value).lower().strip().replace(' ', '_') if cell.value else None for cell in ws[1]]
    headers = [h for h in headers if h]
    log.info(f"Found customer headers: {headers}")

    if 'customer_number' not in headers:
        log.error("Mandatory header 'customer_number' not found in customer import file.")
        wb.close()
        raise ValueError("Mandatory header 'customer_number' not found in customer import file.")

    for row_idx, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        if len(row) < len(headers):
            log.warning(f"Customers Row {row_idx}: Skipping row due to insufficient columns (expected {len(headers)}, got {len(row)})")
            skipped_rows += 1
            continue

        raw_data = dict(zip(headers, row))
        customer_number = raw_data.get('customer_number')

        if not customer_number:
            log.warning(f"Customers Row {row_idx}: Skipping row due to missing customer_number.")
            skipped_rows += 1
            continue
        customer_number = str(customer_number).strip()

        customer_defaults = {}
        if 'name' in raw_data: customer_defaults['name'] = raw_data['name']
        if 'address' in raw_data: customer_defaults['address'] = raw_data['address']
        if 'city' in raw_data: customer_defaults['city'] = raw_data['city']
        if 'state' in raw_data: customer_defaults['state'] = raw_data['state']
        if 'zip_code' in raw_data: customer_defaults['zip_code'] = raw_data['zip_code']
        customer_defaults = {k: v for k, v in customer_defaults.items() if v is not None}

        retries = 0
        success = False
        customer = None
        created = False
        portfolio_created = False
        while retries < max_retries_per_row and not success:
            try:
                with transaction.atomic():
                    customer, created = Customer.objects.update_or_create(
                        customer_number=customer_number,
                        defaults=customer_defaults
                    )
                    # Standardized default portfolio name
                    portfolio_name = f"{customer.name or customer_number} - Primary Holdings"
                    portfolio, portfolio_created = Portfolio.objects.get_or_create(
                        owner=customer,
                        name=portfolio_name
                    )
                success = True
            except OperationalError as e:
                 if 'database is locked' in str(e) and retries < max_retries_per_row -1:
                    retries += 1
                    log.warning(f"Cust Row {row_idx}: DB locked for customer {customer_number}. Retrying ({retries}/{max_retries_per_row-1})...")
                    time.sleep(retry_delay * (2**retries))
                 else:
                    log.error(f"Cust Row {row_idx}: OperationalError importing customer {customer_number} after {retries} retries: {e}")
                    skipped_rows += 1; break
            except IntegrityError as e:
                log.error(f"Cust Row {row_idx}: IntegrityError importing customer {customer_number}: {e}")
                skipped_rows += 1; break
            except Exception as e:
                log.error(f"Cust Row {row_idx}: Unexpected error importing customer {customer_number}: {e}", exc_info=True)
                skipped_rows += 1; break

        if success:
            if created: created_count += 1; log.debug(f"Cust Row {row_idx}: Created Customer: {customer_number}")
            else: updated_count += 1; log.debug(f"Cust Row {row_idx}: Updated Customer: {customer_number}")
            if portfolio_created: portfolio_created_count += 1; log.debug(f"Cust Row {row_idx}: Created default Portfolio for Customer: {customer_number}")

    wb.close()
    result_message = (f"Imported/Updated customers from {os.path.basename(file_path)}. "
                      f"Created: {created_count}, Updated: {updated_count}. "
                      f"Default Portfolios Created: {portfolio_created_count}, Skipped: {skipped_rows}.")
    log.info(result_message)
    return result_message


# --- MODIFIED import_holdings_from_excel ---
@shared_task(bind=True, autoretry_for=(OperationalError,), retry_backoff=5, max_retries=3) # Retry on OperationalError (lock)
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
    # Stores (customer_id, security_id) tuples processed from the file FOR THE DEFAULT PORTFOLIO
    processed_holding_keys_in_default_portfolio = {} # Dict: {customer_id: set(security_id)}

    max_retries_per_row = 3 # Reduced retries per row as main retry is on task level
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
            skipped_rows += 1
            continue

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
            except Exception as e: # Catch potential errors during lookup
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

        # --- Get Default Portfolio (use cache) ---
        default_portfolio = default_portfolio_cache.get(customer.id)
        if customer.id not in default_portfolio_cache: # Check cache first before querying
            portfolio_name = f"{customer.name or cust_no} - Primary Holdings"
            try:
                 # Only get, do not create here. Assume it exists from customer import.
                default_portfolio = Portfolio.objects.get(owner=customer, name=portfolio_name)
                default_portfolio_cache[customer.id] = default_portfolio
            except Portfolio.DoesNotExist:
                 log.warning(f"Holdings Row {row_idx}: Default portfolio '{portfolio_name}' not found for customer {cust_no}. Skipping holding.")
                 default_portfolio_cache[customer.id] = None # Cache None to avoid requery
                 skipped_rows += 1; continue
            except Exception as e:
                 log.error(f"Holdings Row {row_idx}: Error fetching default portfolio for customer {cust_no}: {e}")
                 default_portfolio_cache[customer.id] = None
                 skipped_rows += 1; continue

        # If default portfolio doesn't exist (cached as None), skip
        if default_portfolio is None:
             skipped_rows += 1; continue

        # --- Prepare holding data defaults ---
        holding_defaults = {
            'original_face_amount': clean_decimal(raw_data.get('original_face_amount')),
            'settlement_date': clean_date(raw_data.get('settlement_date')),
            'settlement_price': clean_decimal(raw_data.get('settlement_price')),
            'book_price': clean_decimal(raw_data.get('book_price')),
            'book_yield': clean_decimal(raw_data.get('book_yield')),
            'customer': customer, # Redundant field
            'customer_number': cust_no # Redundant field
        }
        # Use Decimal('NaN') or similar if you need to explicitly null out fields
        # For now, filter out None to only update provided fields
        holding_defaults = {k: v for k, v in holding_defaults.items() if v is not None}

        # --- Perform update_or_create within the DEFAULT portfolio ---
        retries = 0
        success = False
        while retries < max_retries_per_row and not success:
            try:
                # Use transaction.atomic for safety on update_or_create
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
                 # Let celery handle retry for OperationalError based on task decorator
                 if retries < max_retries_per_row -1 : # Log intermediate retries
                    log.warning(f"Hold Row {row_idx}: DB locked for holding P:{default_portfolio.id}/S:{security.id}. Celery will retry...")
                 retries += 1
                 time.sleep(retry_delay * (2**retries)) # Manual backoff if needed before Celery retry
                 # If it persists, Celery's autoretry_for should catch it. If max retries exceed, task fails.
                 if retries >= max_retries_per_row :
                      log.error(f"Hold Row {row_idx}: DB lock persisted for holding P:{default_portfolio.id}/S:{security.id}. Raising error.")
                      raise # Raise error to let Celery handle final failure state
            except IntegrityError as e:
                log.error(f"Hold Row {row_idx}: IntegrityError on holding P:{default_portfolio.id}, S:{security.cusip}: {e}")
                skipped_rows += 1; break # Break retry loop for this row
            except Exception as e:
                log.error(f"Hold Row {row_idx}: Unexpected error on holding P:{default_portfolio.id}, S:{security.cusip}: {e}", exc_info=True)
                skipped_rows += 1; break # Break retry loop for this row

    # --- Second Pass: Delete obsolete holdings from relevant DEFAULT portfolios ---
    log.info("Holdings Pass 2: Deleting obsolete holdings from default portfolios...")

    # Iterate through customers whose default portfolios were processed
    for customer_id, processed_security_ids in processed_holding_keys_in_default_portfolio.items():
        # Get the default portfolio instance again (should be cached)
        default_portfolio = default_portfolio_cache.get(customer_id)
        if not default_portfolio:
            log.warning(f"Holdings Deletion: Could not find default portfolio for customer ID {customer_id} during deletion phase. Skipping.")
            continue

        log.info(f"Holdings Deletion: Checking default portfolio '{default_portfolio.name}' (ID: {default_portfolio.id}) for obsolete holdings.")

        try:
            # Find all holdings currently in the DB for this specific default portfolio
            holdings_in_db = CustomerHolding.objects.filter(portfolio=default_portfolio)
            obsolete_holding_ids = []

            for holding in holdings_in_db:
                # Check if the security ID of this DB holding was found in the file *for this customer*
                if holding.security_id not in processed_security_ids:
                    obsolete_holding_ids.append(holding.id)
                    log.debug(f"Holdings Deletion: Marking holding ID {holding.id} (Sec ID: {holding.security_id}) in portfolio {default_portfolio.id} for deletion.")

            if obsolete_holding_ids:
                log.info(f"Holdings Deletion: Attempting to delete {len(obsolete_holding_ids)} obsolete holdings from portfolio {default_portfolio.id}.")
                # Perform deletion within a transaction and handle potential locks
                retries = 0
                success = False
                deleted_batch_count = 0
                while retries < max_retries_per_row and not success:
                    try:
                        with transaction.atomic():
                            deleted_batch_count, _ = CustomerHolding.objects.filter(id__in=obsolete_holding_ids).delete()
                        success = True
                        deleted_count += deleted_batch_count # Add to total deleted count
                        log.info(f"Holdings Deletion: Successfully deleted {deleted_batch_count} holdings from portfolio '{default_portfolio.name}'.")
                    except OperationalError as e:
                        if 'database is locked' in str(e) and retries < max_retries_per_row -1:
                            retries += 1
                            log.warning(f"Holdings Deletion: DB locked deleting holdings for portfolio {default_portfolio.id}. Retrying ({retries}/{max_retries_per_row-1})...")
                            time.sleep(retry_delay * (2**retries))
                        else:
                            log.error(f"Holdings Deletion: OperationalError deleting holdings for portfolio {default_portfolio.id} after {retries} retries: {e}")
                            # If deletion fails, don't stop the whole task, just log and move on
                            break # Exit retry loop for this portfolio's deletion
                    except Exception as e:
                         log.error(f"Holdings Deletion: Error deleting obsolete holdings for portfolio '{default_portfolio.name}': {e}", exc_info=True)
                         break # Exit retry loop for this portfolio's deletion
            else:
                log.info(f"Holdings Deletion: No obsolete holdings found in portfolio '{default_portfolio.name}'.")

        except Exception as e:
             # Catch errors fetching holdings or other unexpected issues during deletion phase
             log.error(f"Holdings Deletion: Unexpected error processing portfolio ID {default_portfolio.id}: {e}", exc_info=True)


    wb.close() # Close the workbook
    result_message = (f"Processed holdings (Primary Portfolio Only) from {os.path.basename(file_path)}. "
                      f"Created: {created_count}, Updated: {updated_count}, Deleted: {deleted_count}, Skipped Rows: {skipped_rows}.")
    log.info(result_message)
    return result_message


# import_all_from_excel remains unchanged - NOTE: This task still uses hardcoded paths
# and might not be the primary way imports are triggered anymore if using the View.
@shared_task
def import_all_from_excel():
    """
    Orchestrate the three non-destructive imports in sequence using hardcoded paths:
      1) securities (update/create)
      2) customers (update/create) + ensure default portfolio
      3) holdings (update/create/delete within default portfolios) - uses the modified logic

    Ensure the file paths point to the correct Excel files.
    Uses immutable signatures (.si) for chained tasks.
    Consider if this task is still needed given the View-based trigger.
    """
    log.info("Scheduling chained non-destructive import from hardcoded paths...")
    base = settings.BASE_DIR / 'data' / 'imports' # Use Path object directly
    sec_file = base / 'sample_securities.xlsx' # Adjust filename if needed
    cust_file = base / 'customers.xlsx'       # Adjust filename if needed
    hold_file = base / 'holdings.xlsx'        # Adjust filename if needed

    # Check if files exist before chaining
    files_ok = True
    if not sec_file.exists():
        log.error(f"Chained Import: Security file not found: {sec_file}")
        files_ok = False
    if not cust_file.exists():
        log.error(f"Chained Import: Customer file not found: {cust_file}")
        files_ok = False
    if not hold_file.exists():
        log.error(f"Chained Import: Holdings file not found: {hold_file}")
        files_ok = False

    if not files_ok:
         return "Error: One or more import files not found for chained import."

    # Use .s() for the first task. Use .si() for subsequent tasks
    # to prevent the result of the previous task being passed as an argument.
    import_chain = chain(
        import_securities_from_excel.s(str(sec_file)),
        import_customers_from_excel.si(str(cust_file)), # Use .si()
        import_holdings_from_excel.si(str(hold_file)),   # Use .si()
    )
    import_chain.apply_async()

    result_message = "Scheduled chained non-destructive import of securities -> customers -> holdings from hardcoded paths."
    log.info(result_message)
    return result_message