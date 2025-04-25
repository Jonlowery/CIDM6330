import os
from celery import Celery
from celery.schedules import crontab
from django.conf import settings

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'bondsystem.settings')

app = Celery('bondsystem')
app.config_from_object('django.conf:settings', namespace='CELERY')
app.autodiscover_tasks()

app.conf.beat_schedule = {
    'import-all-every-10-minutes': {
        'task': 'portfolio.tasks.import_all_from_excel',
        'schedule': crontab(minute='*/10'),
    },
}

@app.on_after_configure.connect
def kick_off_imports(sender, **kwargs):
    # run once immediately on startup
    sender.send_task('portfolio.tasks.import_all_from_excel')
