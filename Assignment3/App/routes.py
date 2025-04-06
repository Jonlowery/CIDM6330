# routes.py
from fastapi import FastAPI, Depends, HTTPException
from typing import List

# Import Pydantic models for request/response validation
from app.models import Customer, Account, RiskAssessment, Transaction, Branch

# Import repository interfaces and composite implementations
from app.repository import (
    # Customer
    BaseCustomerRepository,
    CompositeCustomerRepository,
    # Account
    BaseAccountRepository,
    CompositeAccountRepository,
    # RiskAssessment
    BaseRiskAssessmentRepository,
    CompositeRiskAssessmentRepository,
    # Transaction
    BaseTransactionRepository,
    CompositeTransactionRepository,
    # Branch
    BaseBranchRepository,
    CompositeBranchRepository,
)

# Create a router instance
router = FastAPI().router

# Dependency injection functions using composite repositories
def get_customer_repo() -> BaseCustomerRepository:
    return CompositeCustomerRepository()

def get_account_repo() -> BaseAccountRepository:
    return CompositeAccountRepository()

def get_risk_assessment_repo() -> BaseRiskAssessmentRepository:
    return CompositeRiskAssessmentRepository()

def get_transaction_repo() -> BaseTransactionRepository:
    return CompositeTransactionRepository()

def get_branch_repo() -> BaseBranchRepository:
    return CompositeBranchRepository()

# ==============================================================================
# --- CUSTOMER ENDPOINTS ---
# ==============================================================================

@router.post("/customers/", response_model=Customer)
def create_customer(customer: Customer, repo: BaseCustomerRepository = Depends(get_customer_repo)):
    try:
        return repo.create(customer)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/customers/", response_model=List[Customer])
def list_customers(repo: BaseCustomerRepository = Depends(get_customer_repo)):
    return repo.list()

@router.get("/customers/{customer_id}", response_model=Customer)
def get_customer(customer_id: int, repo: BaseCustomerRepository = Depends(get_customer_repo)):
    customer = repo.get(customer_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    return customer

@router.put("/customers/{customer_id}", response_model=Customer)
def update_customer(customer_id: int, customer: Customer, repo: BaseCustomerRepository = Depends(get_customer_repo)):
    try:
        return repo.update(customer_id, customer)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

@router.delete("/customers/{customer_id}")
def delete_customer(customer_id: int, repo: BaseCustomerRepository = Depends(get_customer_repo)):
    if not repo.delete(customer_id):
        raise HTTPException(status_code=404, detail="Customer not found")
    return {"message": "Customer deleted successfully"}

# ==============================================================================
# --- ACCOUNT ENDPOINTS ---
# ==============================================================================

@router.post("/accounts/", response_model=Account)
def create_account(account: Account, repo: BaseAccountRepository = Depends(get_account_repo)):
    try:
        return repo.create(account)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/accounts/", response_model=List[Account])
def list_accounts(repo: BaseAccountRepository = Depends(get_account_repo)):
    return repo.list()

@router.get("/accounts/{account_id}", response_model=Account)
def get_account(account_id: int, repo: BaseAccountRepository = Depends(get_account_repo)):
    account = repo.get(account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    return account

@router.put("/accounts/{account_id}", response_model=Account)
def update_account(account_id: int, account: Account, repo: BaseAccountRepository = Depends(get_account_repo)):
    try:
        return repo.update(account_id, account)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

@router.delete("/accounts/{account_id}")
def delete_account(account_id: int, repo: BaseAccountRepository = Depends(get_account_repo)):
    if not repo.delete(account_id):
        raise HTTPException(status_code=404, detail="Account not found")
    return {"message": "Account deleted successfully"}

# ==============================================================================
# --- RISK ASSESSMENT ENDPOINTS ---
# ==============================================================================

@router.post("/risk-assessments/", response_model=RiskAssessment)
def create_risk_assessment(assessment: RiskAssessment, repo: BaseRiskAssessmentRepository = Depends(get_risk_assessment_repo)):
    try:
        return repo.create(assessment)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/risk-assessments/", response_model=List[RiskAssessment])
def list_risk_assessments(repo: BaseRiskAssessmentRepository = Depends(get_risk_assessment_repo)):
    return repo.list()

@router.get("/risk-assessments/{assessment_id}", response_model=RiskAssessment)
def get_risk_assessment(assessment_id: int, repo: BaseRiskAssessmentRepository = Depends(get_risk_assessment_repo)):
    assessment = repo.get(assessment_id)
    if not assessment:
        raise HTTPException(status_code=404, detail="Risk Assessment not found")
    return assessment

@router.put("/risk-assessments/{assessment_id}", response_model=RiskAssessment)
def update_risk_assessment(assessment_id: int, assessment: RiskAssessment, repo: BaseRiskAssessmentRepository = Depends(get_risk_assessment_repo)):
    try:
        return repo.update(assessment_id, assessment)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

@router.delete("/risk-assessments/{assessment_id}")
def delete_risk_assessment(assessment_id: int, repo: BaseRiskAssessmentRepository = Depends(get_risk_assessment_repo)):
    if not repo.delete(assessment_id):
        raise HTTPException(status_code=404, detail="Risk Assessment not found")
    return {"message": "Risk Assessment deleted successfully"}

# ==============================================================================
# --- TRANSACTION ENDPOINTS ---
# ==============================================================================

@router.post("/transactions/", response_model=Transaction)
def create_transaction(transaction: Transaction, repo: BaseTransactionRepository = Depends(get_transaction_repo)):
    try:
        return repo.create(transaction)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/transactions/", response_model=List[Transaction])
def list_transactions(repo: BaseTransactionRepository = Depends(get_transaction_repo)):
    return repo.list()

@router.get("/transactions/{transaction_id}", response_model=Transaction)
def get_transaction(transaction_id: int, repo: BaseTransactionRepository = Depends(get_transaction_repo)):
    transaction = repo.get(transaction_id)
    if not transaction:
        raise HTTPException(status_code=404, detail="Transaction not found")
    return transaction

@router.put("/transactions/{transaction_id}", response_model=Transaction)
def update_transaction(transaction_id: int, transaction: Transaction, repo: BaseTransactionRepository = Depends(get_transaction_repo)):
    try:
        return repo.update(transaction_id, transaction)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

@router.delete("/transactions/{transaction_id}")
def delete_transaction(transaction_id: int, repo: BaseTransactionRepository = Depends(get_transaction_repo)):
    if not repo.delete(transaction_id):
        raise HTTPException(status_code=404, detail="Transaction not found")
    return {"message": "Transaction deleted successfully"}

# ==============================================================================
# --- BRANCH ENDPOINTS ---
# ==============================================================================

@router.post("/branches/", response_model=Branch)
def create_branch(branch: Branch, repo: BaseBranchRepository = Depends(get_branch_repo)):
    try:
        return repo.create(branch)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/branches/", response_model=List[Branch])
def list_branches(repo: BaseBranchRepository = Depends(get_branch_repo)):
    return repo.list()

@router.get("/branches/{branch_id}", response_model=Branch)
def get_branch(branch_id: int, repo: BaseBranchRepository = Depends(get_branch_repo)):
    branch = repo.get(branch_id)
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")
    return branch

@router.put("/branches/{branch_id}", response_model=Branch)
def update_branch(branch_id: int, branch: Branch, repo: BaseBranchRepository = Depends(get_branch_repo)):
    try:
        return repo.update(branch_id, branch)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

@router.delete("/branches/{branch_id}")
def delete_branch(branch_id: int, repo: BaseBranchRepository = Depends(get_branch_repo)):
    if not repo.delete(branch_id):
        raise HTTPException(status_code=404, detail="Branch not found")
    return {"message": "Branch deleted successfully"}