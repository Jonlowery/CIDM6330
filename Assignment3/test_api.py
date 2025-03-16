from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

# ---- CUSTOMER TESTS ----
def test_customer_crud():
    # Create a customer
    customer_payload = {
        "customer_id": None,
        "name": "Test Customer",
        "email": "test@example.com",
        "address": "123 Test Street",
        "phone": "555-1234"
    }
    response = client.post("/customers/", json=customer_payload)
    assert response.status_code == 200
    customer = response.json()
    customer_id = customer["customer_id"]
    assert customer["name"] == "Test Customer"

    # Get the created customer
    response = client.get(f"/customers/{customer_id}")
    assert response.status_code == 200
    customer = response.json()
    assert customer["email"] == "test@example.com"

    # List customers and check that the created one is in the list
    response = client.get("/customers/")
    assert response.status_code == 200
    customers = response.json()
    assert any(c["customer_id"] == customer_id for c in customers)

    # Update the customer
    update_payload = {
        "customer_id": customer_id,
        "name": "Updated Customer",
        "email": "updated@example.com",
        "address": "456 Updated Ave",
        "phone": "555-5678"
    }
    response = client.put(f"/customers/{customer_id}", json=update_payload)
    assert response.status_code == 200
    updated_customer = response.json()
    assert updated_customer["name"] == "Updated Customer"

    # Delete the customer
    response = client.delete(f"/customers/{customer_id}")
    assert response.status_code == 200

    # Verify deletion
    response = client.get(f"/customers/{customer_id}")
    assert response.status_code == 404

# ---- ACCOUNT TESTS ----
def test_account_crud():
    # For account endpoints, we need an existing customer and branch.
    # Create a customer
    customer_payload = {
        "customer_id": None,
        "name": "Account Owner",
        "email": "owner@example.com",
        "address": "789 Owner Road",
        "phone": "555-0000"
    }
    cust_response = client.post("/customers/", json=customer_payload)
    assert cust_response.status_code == 200
    customer = cust_response.json()
    customer_id = customer["customer_id"]

    # Create a branch
    branch_payload = {
        "branch_id": None,
        "name": "Test Branch",
        "address": "101 Branch Ave",
        "manager": "Branch Manager"
    }
    branch_response = client.post("/branches/", json=branch_payload)
    assert branch_response.status_code == 200
    branch = branch_response.json()
    branch_id = branch["branch_id"]

    # Create an account
    account_payload = {
        "account_id": None,
        "customer_id": customer_id,
        "account_type": "Checking",
        "balance": 1000.0,
        "open_date": "2025-03-16",
        "branch_id": branch_id
    }
    response = client.post("/accounts/", json=account_payload)
    assert response.status_code == 200
    account = response.json()
    account_id = account["account_id"]
    assert account["balance"] == 1000.0

    # Get the account
    response = client.get(f"/accounts/{account_id}")
    assert response.status_code == 200
    account = response.json()
    assert account["account_type"] == "Checking"

    # List accounts
    response = client.get("/accounts/")
    assert response.status_code == 200
    accounts = response.json()
    assert any(a["account_id"] == account_id for a in accounts)

    # Update the account
    update_payload = {
        "account_id": account_id,
        "customer_id": customer_id,
        "account_type": "Savings",
        "balance": 2000.0,
        "open_date": "2025-03-16",
        "branch_id": branch_id
    }
    response = client.put(f"/accounts/{account_id}", json=update_payload)
    assert response.status_code == 200
    updated_account = response.json()
    assert updated_account["account_type"] == "Savings"

    # Delete the account
    response = client.delete(f"/accounts/{account_id}")
    assert response.status_code == 200

# ---- RISK ASSESSMENT TESTS ----
def test_risk_assessment_crud():
    # Create a customer for risk assessments
    customer_payload = {
        "customer_id": None,
        "name": "Risk Customer",
        "email": "risk@example.com",
        "address": "202 Risk Blvd",
        "phone": "555-9999"
    }
    cust_response = client.post("/customers/", json=customer_payload)
    assert cust_response.status_code == 200
    customer = cust_response.json()
    customer_id = customer["customer_id"]

    # Create a risk assessment
    risk_payload = {
        "assessment_id": None,
        "customer_id": customer_id,
        "score": 7.5,
        "assessment_date": "2025-03-16",
        "comments": "Moderate risk"
    }
    response = client.post("/risk-assessments/", json=risk_payload)
    assert response.status_code == 200
    assessment = response.json()
    assessment_id = assessment["assessment_id"]
    assert assessment["score"] == 7.5

    # Get the risk assessment
    response = client.get(f"/risk-assessments/{assessment_id}")
    assert response.status_code == 200
    assessment = response.json()
    assert assessment["comments"] == "Moderate risk"

    # Update the risk assessment
    update_payload = {
        "assessment_id": assessment_id,
        "customer_id": customer_id,
        "score": 5.0,
        "assessment_date": "2025-03-16",
        "comments": "Low risk after review"
    }
    response = client.put(f"/risk-assessments/{assessment_id}", json=update_payload)
    assert response.status_code == 200
    updated_assessment = response.json()
    assert updated_assessment["score"] == 5.0

    # Delete the risk assessment
    response = client.delete(f"/risk-assessments/{assessment_id}")
    assert response.status_code == 200

# ---- TRANSACTION TESTS ----
def test_transaction_crud():
    # Create a customer and an account first for a transaction
    customer_payload = {
        "customer_id": None,
        "name": "Transaction Customer",
        "email": "trans@example.com",
        "address": "303 Trans Ln",
        "phone": "555-1111"
    }
    cust_response = client.post("/customers/", json=customer_payload)
    assert cust_response.status_code == 200
    customer = cust_response.json()
    customer_id = customer["customer_id"]

    branch_payload = {
        "branch_id": None,
        "name": "Transaction Branch",
        "address": "404 Branch St",
        "manager": "Manager Trans"
    }
    branch_response = client.post("/branches/", json=branch_payload)
    assert branch_response.status_code == 200
    branch = branch_response.json()
    branch_id = branch["branch_id"]

    account_payload = {
        "account_id": None,
        "customer_id": customer_id,
        "account_type": "Checking",
        "balance": 500.0,
        "open_date": "2025-03-16",
        "branch_id": branch_id
    }
    account_response = client.post("/accounts/", json=account_payload)
    assert account_response.status_code == 200
    account = account_response.json()
    account_id = account["account_id"]

    # Create a transaction
    transaction_payload = {
        "transaction_id": None,
        "account_id": account_id,
        "amount": 250.0,
        "transaction_type": "deposit",
        "timestamp": "2025-03-16T12:00:00"
    }
    response = client.post("/transactions/", json=transaction_payload)
    assert response.status_code == 200
    transaction = response.json()
    transaction_id = transaction["transaction_id"]
    assert transaction["amount"] == 250.0

    # Get the transaction
    response = client.get(f"/transactions/{transaction_id}")
    assert response.status_code == 200
    transaction = response.json()
    assert transaction["transaction_type"] == "deposit"

    # Update the transaction
    update_payload = {
        "transaction_id": transaction_id,
        "account_id": account_id,
        "amount": 300.0,
        "transaction_type": "deposit",
        "timestamp": "2025-03-16T12:30:00"
    }
    response = client.put(f"/transactions/{transaction_id}", json=update_payload)
    assert response.status_code == 200
    updated_transaction = response.json()
    assert updated_transaction["amount"] == 300.0

    # Delete the transaction
    response = client.delete(f"/transactions/{transaction_id}")
    assert response.status_code == 200

# ---- BRANCH TESTS ----
def test_branch_crud():
    # Create a branch
    branch_payload = {
        "branch_id": None,
        "name": "Test Branch",
        "address": "505 Branch Blvd",
        "manager": "Branch Manager"
    }
    response = client.post("/branches/", json=branch_payload)
    assert response.status_code == 200
    branch = response.json()
    branch_id = branch["branch_id"]
    assert branch["name"] == "Test Branch"

    # Get the branch
    response = client.get(f"/branches/{branch_id}")
    assert response.status_code == 200
    branch = response.json()
    assert branch["manager"] == "Branch Manager"

    # List branches
    response = client.get("/branches/")
    assert response.status_code == 200
    branches = response.json()
    assert any(b["branch_id"] == branch_id for b in branches)

    # Update the branch
    update_payload = {
        "branch_id": branch_id,
        "name": "Updated Branch",
        "address": "606 New Blvd",
        "manager": "New Manager"
    }
    response = client.put(f"/branches/{branch_id}", json=update_payload)
    assert response.status_code == 200
    updated_branch = response.json()
    assert updated_branch["name"] == "Updated Branch"

    # Delete the branch
    response = client.delete(f"/branches/{branch_id}")
    assert response.status_code == 200
