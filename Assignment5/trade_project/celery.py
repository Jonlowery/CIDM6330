import os
from celery import Celery

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'trade_project.settings')

app = Celery('trade_project')
app.config_from_object('django.conf:settings', namespace='CELERY')
app.autodiscover_tasks()

# Ensure eager mode settings are applied at the Celery app level
app.conf.update(
    task_always_eager=True,
    task_eager_propagates=True,
)
