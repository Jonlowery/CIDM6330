# run_all_imports_sync.py

import os
import django
import sys
from pathlib import Path # Use pathlib for consistency

print("--- Setting up environment and imports ---")

# Determine the project root directory (where manage.py is)
# Assuming this script (run_all_imports_sync.py) is in the same directory as manage.py
project_root = Path(__file__).resolve().parent
# If the script was inside an app like 'portfolio', you'd use:
# project_root = Path(__file__).resolve().parent.parent

# Add the project root to the Python path if it's not already there
# (Usually needed if the script is inside an app directory)
# if str(project_root) not in sys.path:
#     sys.path.append(str(project_root))

# Set the DJANGO_SETTINGS_MODULE environment variable
# Replace 'bondsystem' with the actual name of your project directory
# (the one containing settings.py) if it's different.
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'bondsystem.settings')

# Setup Django
try:
    django.setup()
    print("--- Django setup complete ---")
except Exception as e:
    print(f"Error during Django setup: {e}")
    sys.exit(1) # Exit if setup fails

# --- NOW you can safely import your Django models and other project code ---
from django.conf import settings # Now you can import settings
# Import your task functions or define the logic here
from portfolio.tasks import (
    import_salespersons_from_excel,
    import_security_types_from_excel,
    import_interest_schedules_from_excel,
    import_securities_from_excel,
    import_customers_from_excel,
    import_holdings_from_excel,
    import_muni_offerings_from_excel
)

# --- Define the main execution logic ---
def run_imports():
    """
    Runs the import tasks synchronously.
    Uses hardcoded paths relative to BASE_DIR defined in settings.
    """
    print("Starting synchronous imports...")
    # Access BASE_DIR *after* django.setup()
    base_import_path = settings.BASE_DIR / 'data' / 'imports'
    print(f"Using base import path: {base_import_path}")

    # Define expected filenames
    filenames = {
        'salesperson': base_import_path / 'Salesperson.xlsx',
        'security_type': base_import_path / 'SecurityType.xlsx',
        'interest_schedule': base_import_path / 'InterestSchedule.xlsx',
        'security': base_import_path / 'Security.xlsx',
        'customer': base_import_path / 'Customer.xlsx',
        'holding': base_import_path / 'Holdings.xlsx',
        'muni_offering': base_import_path / 'muni_offerings.xlsx',
    }

    # Define the desired import order
    import_order = [
        ('Salespersons', import_salespersons_from_excel, filenames['salesperson']),
        ('Security Types', import_security_types_from_excel, filenames['security_type']),
        ('Interest Schedules', import_interest_schedules_from_excel, filenames['interest_schedule']),
        ('Securities', import_securities_from_excel, filenames['security']),
        ('Customers', import_customers_from_excel, filenames['customer']),
        ('Holdings', import_holdings_from_excel, filenames['holding']),
        ('Municipal Offerings', import_muni_offerings_from_excel, filenames['muni_offering']),
    ]

    # Run imports sequentially
    for name, task_func, file_path in import_order:
        print(f"\n--- Running Import: {name} ---")
        if file_path.exists():
            try:
                print(f"Processing file: {file_path}...")
                # Call the function directly, passing the file path as a string
                result = task_func(str(file_path))
                print(f"Result for {name}: {result}")
            except Exception as e:
                print(f"ERROR during {name} import from {file_path}: {e}")
                # Decide if you want to stop or continue on error
                # break # Uncomment to stop on first error
        else:
            print(f"SKIPPING {name}: File not found at {file_path}")

    print("\n--- Finished synchronous imports ---")

# Make sure the script calls the main function when run directly
if __name__ == "__main__":
    run_imports()

