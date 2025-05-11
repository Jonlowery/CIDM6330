# In: portfolio/management/commands/trigger_initial_import.py

from django.core.management.base import BaseCommand
import logging
# Ensure the path to your tasks module is correct
from portfolio.tasks import import_all_from_excel

# Get an instance of a logger
log = logging.getLogger(__name__)

class Command(BaseCommand):
    """
    Django management command to trigger the initial data import Celery task.
    This allows the import to be called specifically after migrations
    and only once during the startup process.
    """
    help = 'Triggers the initial data import Celery task (import_all_from_excel).'

    def handle(self, *args, **options):
        """
        Handles the execution of the command.
        Sends the import_all_from_excel task to the Celery queue.
        """
        self.stdout.write(self.style.SUCCESS('Attempting to trigger initial data import Celery task...'))
        try:
            # Send the main import task to the Celery queue.
            # .delay() is a shortcut for .send_task().
            import_all_from_excel.delay()
            self.stdout.write(self.style.SUCCESS(
                'Initial data import task (import_all_from_excel) has been successfully sent to Celery.'
            ))
            log.info("Initial data import task (import_all_from_excel) successfully sent to Celery via management command.")
        except Exception as e:
            # Log any exception that occurs during task sending.
            self.stderr.write(self.style.ERROR(f'Failed to send initial data import task: {e}'))
            log.error(f"Failed to send initial data import task (import_all_from_excel) via management command: {e}", exc_info=True)

