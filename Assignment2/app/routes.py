# app/routes.py

from fastapi import APIRouter, HTTPException
from typing import List
from app.models import Customer

router = APIRouter()

customers_db = {}

# Create a Customer (POST)
@router.post("/customers/", response_model=Customer)
def create_customer(customer: Customer):
    if customer.customer_id is None:
        # Simple simulation of auto-generated IDs 
        customer.customer_id = len(customers_db) + 1
    if customer.customer_id in customers_db:
        raise HTTPException(status_code=400, detail="Customer already exists")
    customers_db[customer.customer_id] = customer
    return customer

# Get All Customers (GET)
@router.get("/customers/", response_model=List[Customer])
def read_customers():
    return list(customers_db.values())

# Get a Specific Customer (GET)
@router.get("/customers/{customer_id}", response_model=Customer)
def read_customer(customer_id: int):
    customer = customers_db.get(customer_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    return customer

# Update a Customer (PUT)
@router.put("/customers/{customer_id}", response_model=Customer)
def update_customer(customer_id: int, customer: Customer):
    if customer_id not in customers_db:
        raise HTTPException(status_code=404, detail="Customer not found")
    customers_db[customer_id] = customer
    return customer

# Delete a Customer (DELETE)
@router.delete("/customers/{customer_id}")
def delete_customer(customer_id: int):
    if customer_id not in customers_db:
        raise HTTPException(status_code=404, detail="Customer not found")
    del customers_db[customer_id]
    return {"detail": "Customer deleted"}
