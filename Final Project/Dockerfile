# Use an official Python runtime as a parent image
# Changed from buster to bullseye to get a newer SQLite version (>=3.31 required by Django 5.2)
FROM python:3.10-slim-bullseye

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE 1
ENV PYTHONUNBUFFERED 1

# Set work directory to /app, which will align with the volume mount
WORKDIR /app

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
# Assuming requirements.txt is at the root of your build context (same level as Dockerfile)
COPY ./requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy the Django project code (contents of ./api directory) into the container's /app directory
# The trailing slash on ./api/ is important to copy the contents.
COPY ./api/ /app/

# Expose the port the Django app runs on (defined in docker-compose.yml command)
EXPOSE 8000

# The command to run the application will be specified in the docker-compose.yml file.
