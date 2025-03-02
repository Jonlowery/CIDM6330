# app/models.py

from pydantic import BaseModel, Field
from typing import Optional

class Customer(BaseModel):
    customer_id: Optional[int] = Field(None, description="Unique identifier for the customer")
    name: str = Field(..., description="Full name of the customer")
    email: str = Field(..., description="Customer email address")
    address: str = Field(..., description="Customer's physical address")
    phone: str = Field(..., description="Customer's phone number")
