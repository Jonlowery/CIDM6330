# Use an official Python runtime as a parent image
# Changed from buster to bullseye to get a newer SQLite version (>=3.31 required by Django 5.2)
FROM python:3.10-slim-bullseye

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE 1
ENV PYTHONUNBUFFERED 1

# Set work directory
WORKDIR /usr/src/app

# Install system dependencies
# build-essential: for C/C++ compilers (needed for QuantLib if built from source by pip)
# libpq-dev: for PostgreSQL client libraries (good practice if you might use PostgreSQL later)
# swig: for generating Python bindings for C/C++ code (needed for QuantLib-Python)
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    swig \
    # Add any other system libraries your project might need.
    # For example, if you were using specific XML/XSLT libraries with openpyxl:
    # libxml2-dev libxslt1-dev
    && apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Install Python dependencies
# Copy requirements.txt first to leverage Docker cache if requirements haven't changed
COPY ./requirements.txt /usr/src/app/requirements.txt
# Pip will attempt to install QuantLib (C++) and QuantLib-Python.
# The presence of build-essential and swig should allow pip to compile them if they are
# fetched as source distributions from PyPI.
RUN pip install --no-cache-dir -r requirements.txt

# Copy the Django project code into the container
# This assumes your Django project (manage.py, project folder 'bondsystem', app folder 'portfolio', etc.)
# is located in a subdirectory named 'api' in the same directory as this Dockerfile.
COPY ./api /usr/src/app/

# Expose the port the Django app runs on (defined in docker-compose.yml command)
EXPOSE 8000

# The command to run the application (e.g., runserver, gunicorn, celery commands)
# will be specified in the docker-compose.yml file for each service.
