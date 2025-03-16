# models.py
from pydantic import BaseModel
from sqlmodel import SQLModel, Field
from typing import Optional

# --- CUSTOMER ---
class Customer(BaseModel):
    customer_id: Optional[int] = None
    name: str
    email: str
    address: str
    phone: str

class CustomerSQL(SQLModel, table=True):
    customer_id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    email: str
    address: str
    phone: str

# --- ACCOUNT ---
class Account(BaseModel):
    account_id: Optional[int] = None
    customer_id: int
    account_type: str
    balance: float
    open_date: str
    branch_id: int

class AccountSQL(SQLModel, table=True):
    account_id: Optional[int] = Field(default=None, primary_key=True)
    customer_id: int
    account_type: str
    balance: float
    open_date: str
    branch_id: int

# --- RISK ASSESSMENT ---
class RiskAssessment(BaseModel):
    assessment_id: Optional[int] = None
    customer_id: int
    score: float
    assessment_date: str
    comments: Optional[str] = None

class RiskAssessmentSQL(SQLModel, table=True):
    assessment_id: Optional[int] = Field(default=None, primary_key=True)
    customer_id: int
    score: float
    assessment_date: str
    comments: Optional[str] = None

# --- TRANSACTION ---
class Transaction(BaseModel):
    transaction_id: Optional[int] = None
    account_id: int
    amount: float
    transaction_type: str
    timestamp: str

class TransactionSQL(SQLModel, table=True):
    transaction_id: Optional[int] = Field(default=None, primary_key=True)
    account_id: int
    amount: float
    transaction_type: str
    timestamp: str

# --- BRANCH ---
class Branch(BaseModel):
    branch_id: Optional[int] = None
    name: str
    address: str
    manager: str

class BranchSQL(SQLModel, table=True):
    branch_id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    address: str
    manager: str