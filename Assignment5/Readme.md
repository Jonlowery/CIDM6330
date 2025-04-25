# CIDM6330 Assignment 5: Django Celery Redis Banking API

**Course:** CIDM6330 - Software Architecture 
**Assignment:** 05 – Messaging and Events with Celery/Redis

## Overview

This project implements a banking API using Django and Django REST Framework, with background task processing via Celery and Redis. It supports customer and account management, transactions, and risk assessments.

## Features

- **Django Models & ORM** for Customers, Accounts, Transactions, Branches, and RiskAssessments  
- **Django REST Framework** API endpoints for CRUD operations and custom actions  
- **Celery & Redis** for asynchronous background tasks:  
  - `process_event` (generic event processing)  
  - `assess_risk_for_customer` (automated risk assessment)  
  - `transfer_funds` (account transfer)  
  - `create_risk_assessment` (manual risk assessment via API)  
- **Comprehensive Tests**:  
  - Model unit tests  
  - API unit tests  
  - Celery task unit tests  
  - Mock-based API tests for task enqueuing  
  - Integration tests in eager mode

## Prerequisites

- Python 3.10+  
- Redis server  
- (Optional) Docker & Docker Compose  

## Local Setup

1. **Clone the repository**  
   ```bash
   git clone <https://github.com/Jonlowery/CIDM6330/tree/main/Assignment5>
   ```

2. **Python virtual environment**  
   ```bash
   python -m venv venv
   venv\Scripts\activate   # Windows
   ```

3. **Install dependencies**  
   ```bash
   pip install -r requirements.txt
   ```

4. **Configure Redis**  
   Ensure Redis is running on `localhost:6379`.  

5. **Database migrations**  
   ```bash
   python manage.py migrate
   ```

## Running Locally

1. **Start the Celery worker**  
   ```bash
   celery -A trade_project worker --loglevel=info -P solo
   ```

2. **Start the Django development server**  
   ```bash
   python manage.py runserver
   ```

3. **Access the API**  
   - Browsable API: http://127.0.0.1:8000/api/  

## Docker Setup (Optional)

Use Docker Compose to run the app and Redis:

```yaml
version: '3'
services:
  redis:
    image: redis:7
    ports:
      - '6379:6379'
  web:
    build: .
    command: bash -c "python manage.py migrate && celery -A trade_project worker --loglevel=info -P solo & python manage.py runserver 0.0.0.0:8000"
    volumes:
      - .:/code
    ports:
      - '8000:8000'
    depends_on:
      - redis
```

Run:

```bash
docker-compose up --build
```

## API Endpoints

### Customers
- `GET /api/customers/`
- `POST /api/customers/`
- `GET /api/customers/{id}/`
- `PUT /api/customers/{id}/`
- `DELETE /api/customers/{id}/`
- `POST /api/customers/{id}/assess_risk/` (enqueues automated risk assessment)

### Accounts
- `GET /api/accounts/`
- `POST /api/accounts/`
- `GET /api/accounts/{id}/`
- `PUT /api/accounts/{id}/`
- `DELETE /api/accounts/{id}/`
- `POST /api/accounts/{id}/transfer/` (enqueues transfer task)

### Risk Assessments
- `GET /api/risk-assessments/`
- `POST /api/risk-assessments/` (enqueues manual risk assessment via Celery)
- `GET /api/risk-assessments/{id}/`
- `PUT /api/risk-assessments/{id}/`
- `DELETE /api/risk-assessments/{id}/`

### Transactions & Branches
- Standard CRUD endpoints at `/api/transactions/` and `/api/branches/`

## Testing

Run the full test suite:

```bash
python manage.py test
```

Tests cover models, API views, Celery tasks, and integration flows.


