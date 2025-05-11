# settings.py (Enable DEBUG Logging for 'portfolio' app and Add Celery Test Config)

from pathlib import Path
import os
import sys # Import sys to check for 'test' in command line arguments

# Build paths inside the project like this: BASE_DIR / 'subdir'.
BASE_DIR = Path(__file__).resolve().parent.parent

# SECURITY WARNING: keep the secret key used in production secret!
SECRET_KEY = os.environ.get('DJANGO_SECRET_KEY', 'django-insecure-wsyq6c+zf2#=k7!%y+%6)*2-h13xog2k&z_lg0h=c$kkpge0kh')

# SECURITY WARNING: don't run with debug turned on in production!
DEBUG = os.environ.get('DJANGO_DEBUG', 'True') == 'True'

ALLOWED_HOSTS = []
# Example: ALLOWED_HOSTS = os.environ.get('DJANGO_ALLOWED_HOSTS', 'localhost,127.0.0.1').split(',')


# Application definition

INSTALLED_APPS = [
    'whitenoise.runserver_nostatic',
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'rest_framework',
    'rest_framework.authtoken',
    'corsheaders',
    'django_filters',
    'portfolio.apps.PortfolioConfig', # Your app
    'django_celery_beat',
    'django_celery_results', # You have this installed, so 'django-db' is an option for results
]

MIDDLEWARE = [
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.security.SecurityMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'bondsystem.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [BASE_DIR / 'frontend'],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'bondsystem.wsgi.application'


# Database
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': BASE_DIR / 'db.sqlite3',
    }
}


# Password validation
AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator',},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator',},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator',},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator',},
]


# Internationalization
LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'UTC'
USE_I18N = True
USE_TZ = True


# Static files (CSS, JavaScript, Images)
STATIC_URL = '/static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'
STATICFILES_DIRS = [
    BASE_DIR / 'frontend',
]
STATICFILES_STORAGE = 'whitenoise.storage.CompressedManifestStaticFilesStorage'


# Session Settings
SESSION_EXPIRE_AT_BROWSER_CLOSE = True
SESSION_COOKIE_AGE = 900 # 15 minutes
SESSION_SAVE_EVERY_REQUEST = True


# Django REST Framework configuration
REST_FRAMEWORK = {
  'DEFAULT_AUTHENTICATION_CLASSES': [
    'rest_framework.authentication.TokenAuthentication',
    'rest_framework.authentication.SessionAuthentication',
  ],
  'DEFAULT_PERMISSION_CLASSES': [
    'rest_framework.permissions.IsAuthenticated',
  ],
   'DEFAULT_FILTER_BACKENDS': [
       'django_filters.rest_framework.DjangoFilterBackend'
    ],
   'DEFAULT_PAGINATION_CLASS': 'rest_framework.pagination.PageNumberPagination',
   'PAGE_SIZE': 25
}


# CORS
CORS_ALLOW_ALL_ORIGINS = True # Be more restrictive in production


# Celery configuration
CELERY_BROKER_URL = os.environ.get('CELERY_BROKER_URL', 'redis://redis:6379/0')
CELERY_RESULT_BACKEND = os.environ.get('CELERY_RESULT_BACKEND', 'redis://redis:6379/0')
CELERY_ACCEPT_CONTENT = ['json']
CELERY_TASK_SERIALIZER = 'json'
CELERY_RESULT_SERIALIZER = 'json'
CELERY_TIMEZONE = TIME_ZONE
CELERY_BEAT_SCHEDULER = 'django_celery_beat.schedulers:DatabaseScheduler'

# --- Celery Test Configuration ---
# This block checks if Django is running in test mode.
# If so, it overrides Celery settings to run tasks synchronously and locally.
TESTING_MODE = 'test' in sys.argv or 'pytest' in sys.modules

if TESTING_MODE:
    print("Applying Celery EAGER settings for testing.")
    CELERY_TASK_ALWAYS_EAGER = True  # Tasks will be executed locally, synchronously.
    CELERY_TASK_EAGER_PROPAGATES = True  # Exceptions from eager tasks will be raised.
    
    # Override the result backend for tests to prevent Redis connections
    # Setting to None means results won't be stored, which is often fine for tests.
    CELERY_RESULT_BACKEND = None # Or 'django-db' if you use django-celery-results and need to test results
    print(f"Celery Result Backend for testing: {CELERY_RESULT_BACKEND}")

    # Override the broker URL for tests to prevent Redis connections
    # 'memory://' makes Celery use an in-memory broker, suitable for testing.
    CELERY_BROKER_URL = 'memory://'
    print(f"Celery Broker URL for testing: {CELERY_BROKER_URL}")


# Email Settings Fake Email address made for school project. In production, will use env variable file
EMAIL_BACKEND = 'django.core.mail.backends.smtp.EmailBackend'
EMAIL_HOST = 'smtp.gmail.com'
EMAIL_PORT = 587
EMAIL_USE_TLS = True
EMAIL_HOST_USER = 'avionhwow@gmail.com' 
EMAIL_HOST_PASSWORD = 'jhvm vgog vwdv zlui' 
DEFAULT_FROM_EMAIL = EMAIL_HOST_USER


# Login/Logout URLs
LOGIN_URL = '/api-auth/login/'
LOGIN_REDIRECT_URL = '/'
LOGOUT_REDIRECT_URL = '/api-auth/login/'


# Default primary key field type
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'


# --- LOGGING CONFIGURATION ---
LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    # Formatters define how log messages look
    'formatters': {
        'verbose': {
            'format': '{levelname} {asctime} {name} {module} {process:d} {thread:d} {message}',
            'style': '{',
        },
        'simple': {
            'format': '{levelname} {asctime} {name}: {message}',
            'style': '{',
        },
    },
    # Handlers define where logs go (e.g., console, file)
    'handlers': {
        'console': {
            'class': 'logging.StreamHandler',
            'formatter': 'simple', # Use the simple formatter for console
        },
        # Optional: Add a file handler
        # 'file': {
        #     'level': 'DEBUG',
        #     'class': 'logging.FileHandler',
        #     'filename': BASE_DIR / 'logs' / 'debug.log', # Ensure logs directory exists
        #     'formatter': 'verbose',
        # },
    },
    # Root logger catches everything not caught by specific loggers
    'root': {
        'handlers': ['console'], # Add 'file' here if using file handler
        'level': 'INFO', # Keep root at INFO generally
    },
    # Loggers define settings for specific parts of Django or your apps
    'loggers': {
        'django': {
            'handlers': ['console'],
            'level': os.getenv('DJANGO_LOG_LEVEL', 'INFO'),
            'propagate': False,
        },
        'django.request': { # Capture detailed request logging if needed
            'handlers': ['console'],
            'level': 'WARNING', # Set to DEBUG for very verbose request logs
            'propagate': False,
        },
         # *** Logger for your portfolio app ***
        'portfolio': { # Make sure this matches the name used in logging.getLogger() in your app
            'handlers': ['console'], # Send logs to console
            'level': 'DEBUG',       # <<< Set level to DEBUG
            'propagate': False,      # Optional: Set to False if you don't want portfolio logs appearing twice (via root)
        },
        'celery': { # Add logger for Celery itself if needed
            'handlers': ['console'],
            'level': 'INFO', # Or DEBUG for more verbose Celery logs
            'propagate': False,
        },
    },
}

# Ensure logs directory exists if file handler is used
# LOGS_DIR = BASE_DIR / 'logs'
# LOGS_DIR.mkdir(exist_ok=True)
# --- END LOGGING CONFIGURATION ---
