# bondsystem/celery.py

import os
from celery import Celery
# from celery.schedules import crontab # No longer needed here as schedule is in settings.py
# Django settings are not strictly needed here if only discovering tasks
# from django.conf import settings

# Set the default Django settings module for the 'celery' program.
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'bondsystem.settings')

app = Celery('bondsystem')

# Using a string here means the worker doesn't have to serialize
# the configuration object to child processes.
# - namespace='CELERY' means all celery-related configuration keys
#   should have a `CELERY_` prefix.
app.config_from_object('django.conf:settings', namespace='CELERY')

# Load task modules from all registered Django app configs.
app.autodiscover_tasks()

# The beat_schedule is now defined in settings.py as CELERY_BEAT_SCHEDULE
# and will be loaded by django-celery-beat's DatabaseScheduler.
# So, the following lines are removed:
# app.conf.beat_schedule = {
#     'import-all-every-10-minutes': {
#         'task': 'portfolio.tasks.import_all_from_excel',
#         'schedule': crontab(minute='*/10'),
#     },
# }

# The on_after_configure hook for initial import was also removed previously.

@app.task(bind=True, ignore_result=True)
def debug_task(self):
    print(f'Request: {self.request!r}')
