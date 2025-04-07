# CIDM6330 Assignment 04: Migrate to Django

## Overview

This assignment involves migrating an existing FastAPI project to Django using the Django REST Framework. The project leverages Django's ORM for data persistence and provides API endpoints for managing various entities such as Customer, Account, RiskAssessment, Transaction, and Branch.

## Setup Instructions

### Clone the Repository

```bash
git clone https://github.com/Jonlowery/CIDM6330.git
```

### Navigate to the Assignment04 Directory

```bash
cd CIDM6330/Assignment04
```

### Activate the Virtual Environment

  ```bash
  venv\Scripts\activate
  ```

### Install Dependencies

After activating your virtual environment, install the required packages using:

  ```bash
 pip install -r requirements.txt
  ```

### Run Migrations

```bash
python manage.py makemigrations
python manage.py migrate
```

### Run the Development Server

```bash
python manage.py runserver
```

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
```
