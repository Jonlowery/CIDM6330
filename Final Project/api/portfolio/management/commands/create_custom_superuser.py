# In: portfolio/management/commands/create_custom_superuser.py

import os
from django.core.management.base import BaseCommand
from django.contrib.auth import get_user_model

class Command(BaseCommand):
    help = 'Creates a superuser non-interactively, if it does not already exist.'

    def handle(self, *args, **options):
        User = get_user_model()
        # Get username, email, and password from environment variables
        # or use defaults if not provided.
        # IMPORTANT: For production, always use environment variables for credentials.
        username = os.environ.get('DJANGO_SUPERUSER_USERNAME', 'owner')
        email = os.environ.get('DJANGO_SUPERUSER_EMAIL', 'owner@example.com') # Optional, can be blank
        password = os.environ.get('DJANGO_SUPERUSER_PASSWORD', 'test123!')

        if not User.objects.filter(username=username).exists():
            self.stdout.write(self.style.SUCCESS(f'Creating superuser: {username}'))
            User.objects.create_superuser(username=username, email=email, password=password)
            self.stdout.write(self.style.SUCCESS(f'Superuser "{username}" created successfully.'))
        else:
            self.stdout.write(self.style.WARNING(f'Superuser "{username}" already exists. Skipping creation.'))

