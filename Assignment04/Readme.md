# CIDM6330 Assignment 04: Migrate to Django

## Overview

This assignment involves migrating an existing FastAPI project to Django using the Django REST Framework. The project leverages Django's ORM for data persistence and provides API endpoints for managing various entities such as Customer, Account, RiskAssessment, Transaction, and Branch.

## Project Structure

CIDM6330/
├── Assignment01/
├── Assignment2/
├── Assignment3/
└── Assignment04/
    ├── manage.py
    ├── trade_project/
    │   ├── settings.py
    │   ├── urls.py
    │   └── ...
    ├── api/
    │   ├── models.py
    │   ├── serializers.py
    │   ├── views.py
    │   └── urls.py
    ├── venv/
    └── README.md

## Setup Instructions

### Clone the Repository


git clone https://github.com/Jonlowery/CIDM6330.git


### Navigate to the Assignment04 Directory


cd CIDM6330/Assignment04


### Activate the Virtual Environment

  venv\Scripts\activate

### Run Migrations

python manage.py makemigrations
python manage.py migrate

### Run the Development Server

python manage.py runserver

### Access the API

Open your browser and navigate to [http://127.0.0.1:8000/api/](http://127.0.0.1:8000/api/) to interact with the API endpoints.

## Features

- **Customer Management:** Create, read, update, and delete customer records.
- **Account Management:** Manage accounts linked to customers.
- **Risk Assessments:** Track and manage risk assessments.
- **Transactions:** Log transactions for accounts.
- **Branch Information:** Store and manage branch data.

## Future Enhancements

- Add filtering and pagination for API endpoints.
- Enhance business logic and event-driven paradigms.

