# repository.py
import os
import csv
from abc import ABC, abstractmethod
from typing import List, Optional

from sqlmodel import Session, select
from app.database import engine, create_db_and_tables

# Import Pydantic models (for API) and SQLModel models (for database)
from app.models import (
    Customer, Account, RiskAssessment, Transaction, Branch,
    CustomerSQL, AccountSQL, RiskAssessmentSQL, TransactionSQL, BranchSQL
)

# Ensure database tables are created before any SQLModel repository is used
create_db_and_tables()

# ==============================================================================
# --- REPOSITORY INTERFACES ---
# ==============================================================================

class BaseCustomerRepository(ABC):
    @abstractmethod
    def create(self, customer: Customer) -> Customer:
        pass

    @abstractmethod
    def get(self, customer_id: int) -> Optional[Customer]:
        pass

    @abstractmethod
    def update(self, customer_id: int, customer: Customer) -> Customer:
        pass

    @abstractmethod
    def delete(self, customer_id: int) -> bool:
        pass

    @abstractmethod
    def list(self) -> List[Customer]:
        pass

class BaseAccountRepository(ABC):
    @abstractmethod
    def create(self, account: Account) -> Account:
        pass

    @abstractmethod
    def get(self, account_id: int) -> Optional[Account]:
        pass

    @abstractmethod
    def update(self, account_id: int, account: Account) -> Account:
        pass

    @abstractmethod
    def delete(self, account_id: int) -> bool:
        pass

    @abstractmethod
    def list(self) -> List[Account]:
        pass

class BaseRiskAssessmentRepository(ABC):
    @abstractmethod
    def create(self, assessment: RiskAssessment) -> RiskAssessment:
        pass

    @abstractmethod
    def get(self, assessment_id: int) -> Optional[RiskAssessment]:
        pass

    @abstractmethod
    def update(self, assessment_id: int, assessment: RiskAssessment) -> RiskAssessment:
        pass

    @abstractmethod
    def delete(self, assessment_id: int) -> bool:
        pass

    @abstractmethod
    def list(self) -> List[RiskAssessment]:
        pass

class BaseTransactionRepository(ABC):
    @abstractmethod
    def create(self, transaction: Transaction) -> Transaction:
        pass

    @abstractmethod
    def get(self, transaction_id: int) -> Optional[Transaction]:
        pass

    @abstractmethod
    def update(self, transaction_id: int, transaction: Transaction) -> Transaction:
        pass

    @abstractmethod
    def delete(self, transaction_id: int) -> bool:
        pass

    @abstractmethod
    def list(self) -> List[Transaction]:
        pass

class BaseBranchRepository(ABC):
    @abstractmethod
    def create(self, branch: Branch) -> Branch:
        pass

    @abstractmethod
    def get(self, branch_id: int) -> Optional[Branch]:
        pass

    @abstractmethod
    def update(self, branch_id: int, branch: Branch) -> Branch:
        pass

    @abstractmethod
    def delete(self, branch_id: int) -> bool:
        pass

    @abstractmethod
    def list(self) -> List[Branch]:
        pass

# ==============================================================================
# --- CUSTOMER REPOSITORIES ---
# ==============================================================================

## In-Memory Customer Repository
class InMemoryCustomerRepository(BaseCustomerRepository):
    def __init__(self):
        self.customers = {}
        self.next_id = 1

    def create(self, customer: Customer) -> Customer:
        if customer.customer_id is None:
            customer.customer_id = self.next_id
            self.next_id += 1
        if customer.customer_id in self.customers:
            raise ValueError("Customer already exists")
        self.customers[customer.customer_id] = customer
        return customer

    def get(self, customer_id: int) -> Optional[Customer]:
        return self.customers.get(customer_id)

    def update(self, customer_id: int, customer: Customer) -> Customer:
        if customer_id not in self.customers:
            raise ValueError("Customer not found")
        customer.customer_id = customer_id
        self.customers[customer_id] = customer
        return customer

    def delete(self, customer_id: int) -> bool:
        if customer_id in self.customers:
            del self.customers[customer_id]
            return True
        return False

    def list(self) -> List[Customer]:
        return list(self.customers.values())

## CSV Customer Repository
class CSVCustomerRepository(BaseCustomerRepository):
    def __init__(self, filename: str = "customers.csv"):
        self.filename = filename
        if not os.path.exists(self.filename):
            with open(self.filename, mode="w", newline="") as file:
                writer = csv.writer(file)
                writer.writerow(["customer_id", "name", "email", "address", "phone"])

    def _read_all(self) -> List[Customer]:
        customers = []
        with open(self.filename, mode="r", newline="") as file:
            reader = csv.DictReader(file)
            for row in reader:
                customer = Customer(
                    customer_id=int(row["customer_id"]),
                    name=row["name"],
                    email=row["email"],
                    address=row["address"],
                    phone=row["phone"],
                )
                customers.append(customer)
        return customers

    def _write_all(self, customers: List[Customer]) -> None:
        with open(self.filename, mode="w", newline="") as file:
            writer = csv.writer(file)
            writer.writerow(["customer_id", "name", "email", "address", "phone"])
            for customer in customers:
                writer.writerow([
                    customer.customer_id,
                    customer.name,
                    customer.email,
                    customer.address,
                    customer.phone,
                ])

    def create(self, customer: Customer) -> Customer:
        customers = self._read_all()
        if customer.customer_id is None:
            max_id = max((c.customer_id for c in customers), default=0)
            customer.customer_id = max_id + 1
        if any(c.customer_id == customer.customer_id for c in customers):
            raise ValueError("Customer already exists")
        customers.append(customer)
        self._write_all(customers)
        return customer

    def get(self, customer_id: int) -> Optional[Customer]:
        for customer in self._read_all():
            if customer.customer_id == customer_id:
                return customer
        return None

    def update(self, customer_id: int, customer: Customer) -> Customer:
        customers = self._read_all()
        updated = False
        for idx, c in enumerate(customers):
            if c.customer_id == customer_id:
                customer.customer_id = customer_id
                customers[idx] = customer
                updated = True
                break
        if not updated:
            raise ValueError("Customer not found")
        self._write_all(customers)
        return customer

    def delete(self, customer_id: int) -> bool:
        customers = self._read_all()
        new_customers = [c for c in customers if c.customer_id != customer_id]
        if len(new_customers) == len(customers):
            return False
        self._write_all(new_customers)
        return True

    def list(self) -> List[Customer]:
        return self._read_all()

## SQLModel Customer Repository
class SQLModelCustomerRepository(BaseCustomerRepository):
    def create(self, customer: Customer) -> Customer:
        customer_sql = CustomerSQL(**customer.dict(exclude_unset=True))
        with Session(engine) as session:
            session.add(customer_sql)
            session.commit()
            session.refresh(customer_sql)
        customer.customer_id = customer_sql.customer_id
        return customer

    def get(self, customer_id: int) -> Optional[Customer]:
        with Session(engine) as session:
            customer_sql = session.get(CustomerSQL, customer_id)
            if customer_sql:
                return Customer(**customer_sql.dict())
        return None

    def update(self, customer_id: int, customer: Customer) -> Customer:
        with Session(engine) as session:
            customer_sql = session.get(CustomerSQL, customer_id)
            if not customer_sql:
                raise ValueError("Customer not found")
            for key, value in customer.dict(exclude_unset=True).items():
                setattr(customer_sql, key, value)
            session.add(customer_sql)
            session.commit()
            session.refresh(customer_sql)
        return Customer(**customer_sql.dict())

    def delete(self, customer_id: int) -> bool:
        with Session(engine) as session:
            customer_sql = session.get(CustomerSQL, customer_id)
            if not customer_sql:
                return False
            session.delete(customer_sql)
            session.commit()
            return True

    def list(self) -> List[Customer]:
        with Session(engine) as session:
            results = session.exec(select(CustomerSQL)).all()
            return [Customer(**c.dict()) for c in results]

## Composite Customer Repository
class CompositeCustomerRepository(BaseCustomerRepository):
    def __init__(self):
        self.sql_repo = SQLModelCustomerRepository()
        self.csv_repo = CSVCustomerRepository()
        self.mem_repo = InMemoryCustomerRepository()

    def create(self, customer: Customer) -> Customer:
        # Create in SQLModel first to get the ID
        customer_sql = self.sql_repo.create(customer)
        # Use the assigned ID for CSV and In-Memory
        self.csv_repo.create(customer_sql)
        self.mem_repo.create(customer_sql)
        return customer_sql

    def get(self, customer_id: int) -> Optional[Customer]:
        # Return from SQLModel as the source of truth
        return self.sql_repo.get(customer_id)

    def update(self, customer_id: int, customer: Customer) -> Customer:
        # Update in all repositories
        updated_customer = self.sql_repo.update(customer_id, customer)
        self.csv_repo.update(customer_id, updated_customer)
        self.mem_repo.update(customer_id, updated_customer)
        return updated_customer

    def delete(self, customer_id: int) -> bool:
        # Delete from all repositories
        sql_result = self.sql_repo.delete(customer_id)
        self.csv_repo.delete(customer_id)
        self.mem_repo.delete(customer_id)
        return sql_result

    def list(self) -> List[Customer]:
        # Return from SQLModel
        return self.sql_repo.list()

# ==============================================================================
# --- ACCOUNT REPOSITORIES ---
# ==============================================================================

## In-Memory Account Repository
class InMemoryAccountRepository(BaseAccountRepository):
    def __init__(self):
        self.accounts = {}
        self.next_id = 1

    def create(self, account: Account) -> Account:
        if account.account_id is None:
            account.account_id = self.next_id
            self.next_id += 1
        if account.account_id in self.accounts:
            raise ValueError("Account already exists")
        self.accounts[account.account_id] = account
        return account

    def get(self, account_id: int) -> Optional[Account]:
        return self.accounts.get(account_id)

    def update(self, account_id: int, account: Account) -> Account:
        if account_id not in self.accounts:
            raise ValueError("Account not found")
        account.account_id = account_id
        self.accounts[account_id] = account
        return account

    def delete(self, account_id: int) -> bool:
        if account_id in self.accounts:
            del self.accounts[account_id]
            return True
        return False

    def list(self) -> List[Account]:
        return list(self.accounts.values())

## CSV Account Repository
class CSVAccountRepository(BaseAccountRepository):
    def __init__(self, filename: str = "accounts.csv"):
        self.filename = filename
        if not os.path.exists(self.filename):
            with open(self.filename, mode="w", newline="") as file:
                writer = csv.writer(file)
                writer.writerow(["account_id", "customer_id", "account_type", "balance", "open_date", "branch_id"])

    def _read_all(self) -> List[Account]:
        accounts = []
        with open(self.filename, mode="r", newline="") as file:
            reader = csv.DictReader(file)
            for row in reader:
                account = Account(
                    account_id=int(row["account_id"]),
                    customer_id=int(row["customer_id"]),
                    account_type=row["account_type"],
                    balance=float(row["balance"]),
                    open_date=row["open_date"],
                    branch_id=int(row["branch_id"]),
                )
                accounts.append(account)
        return accounts

    def _write_all(self, accounts: List[Account]) -> None:
        with open(self.filename, mode="w", newline="") as file:
            writer = csv.writer(file)
            writer.writerow(["account_id", "customer_id", "account_type", "balance", "open_date", "branch_id"])
            for account in accounts:
                writer.writerow([
                    account.account_id,
                    account.customer_id,
                    account.account_type,
                    account.balance,
                    account.open_date,
                    account.branch_id,
                ])

    def create(self, account: Account) -> Account:
        accounts = self._read_all()
        if account.account_id is None:
            max_id = max((a.account_id for a in accounts), default=0)
            account.account_id = max_id + 1
        if any(a.account_id == account.account_id for a in accounts):
            raise ValueError("Account already exists")
        accounts.append(account)
        self._write_all(accounts)
        return account

    def get(self, account_id: int) -> Optional[Account]:
        for account in self._read_all():
            if account.account_id == account_id:
                return account
        return None

    def update(self, account_id: int, account: Account) -> Account:
        accounts = self._read_all()
        updated = False
        for idx, a in enumerate(accounts):
            if a.account_id == account_id:
                account.account_id = account_id
                accounts[idx] = account
                updated = True
                break
        if not updated:
            raise ValueError("Account not found")
        self._write_all(accounts)
        return account

    def delete(self, account_id: int) -> bool:
        accounts = self._read_all()
        new_accounts = [a for a in accounts if a.account_id != account_id]
        if len(new_accounts) == len(accounts):
            return False
        self._write_all(new_accounts)
        return True

    def list(self) -> List[Account]:
        return self._read_all()

## SQLModel Account Repository
class SQLModelAccountRepository(BaseAccountRepository):
    def create(self, account: Account) -> Account:
        account_sql = AccountSQL(**account.dict(exclude_unset=True))
        with Session(engine) as session:
            session.add(account_sql)
            session.commit()
            session.refresh(account_sql)
        account.account_id = account_sql.account_id
        return account

    def get(self, account_id: int) -> Optional[Account]:
        with Session(engine) as session:
            account_sql = session.get(AccountSQL, account_id)
            if account_sql:
                return Account(**account_sql.dict())
        return None

    def update(self, account_id: int, account: Account) -> Account:
        with Session(engine) as session:
            account_sql = session.get(AccountSQL, account_id)
            if not account_sql:
                raise ValueError("Account not found")
            for key, value in account.dict(exclude_unset=True).items():
                setattr(account_sql, key, value)
            session.add(account_sql)
            session.commit()
            session.refresh(account_sql)
        return Account(**account_sql.dict())

    def delete(self, account_id: int) -> bool:
        with Session(engine) as session:
            account_sql = session.get(AccountSQL, account_id)
            if not account_sql:
                return False
            session.delete(account_sql)
            session.commit()
            return True

    def list(self) -> List[Account]:
        with Session(engine) as session:
            results = session.exec(select(AccountSQL)).all()
            return [Account(**a.dict()) for a in results]

## Composite Account Repository
class CompositeAccountRepository(BaseAccountRepository):
    def __init__(self):
        self.sql_repo = SQLModelAccountRepository()
        self.csv_repo = CSVAccountRepository()
        self.mem_repo = InMemoryAccountRepository()

    def create(self, account: Account) -> Account:
        account_sql = self.sql_repo.create(account)
        self.csv_repo.create(account_sql)
        self.mem_repo.create(account_sql)
        return account_sql

    def get(self, account_id: int) -> Optional[Account]:
        return self.sql_repo.get(account_id)

    def update(self, account_id: int, account: Account) -> Account:
        updated_account = self.sql_repo.update(account_id, account)
        self.csv_repo.update(account_id, updated_account)
        self.mem_repo.update(account_id, updated_account)
        return updated_account

    def delete(self, account_id: int) -> bool:
        sql_result = self.sql_repo.delete(account_id)
        self.csv_repo.delete(account_id)
        self.mem_repo.delete(account_id)
        return sql_result

    def list(self) -> List[Account]:
        return self.sql_repo.list()

# ==============================================================================
# --- RISK ASSESSMENT REPOSITORIES ---
# ==============================================================================

## In-Memory RiskAssessment Repository
class InMemoryRiskAssessmentRepository(BaseRiskAssessmentRepository):
    def __init__(self):
        self.assessments = {}
        self.next_id = 1

    def create(self, assessment: RiskAssessment) -> RiskAssessment:
        if assessment.assessment_id is None:
            assessment.assessment_id = self.next_id
            self.next_id += 1
        if assessment.assessment_id in self.assessments:
            raise ValueError("RiskAssessment already exists")
        self.assessments[assessment.assessment_id] = assessment
        return assessment

    def get(self, assessment_id: int) -> Optional[RiskAssessment]:
        return self.assessments.get(assessment_id)

    def update(self, assessment_id: int, assessment: RiskAssessment) -> RiskAssessment:
        if assessment_id not in self.assessments:
            raise ValueError("RiskAssessment not found")
        assessment.assessment_id = assessment_id
        self.assessments[assessment_id] = assessment
        return assessment

    def delete(self, assessment_id: int) -> bool:
        if assessment_id in self.assessments:
            del self.assessments[assessment_id]
            return True
        return False

    def list(self) -> List[RiskAssessment]:
        return list(self.assessments.values())

## CSV RiskAssessment Repository
class CSVRiskAssessmentRepository(BaseRiskAssessmentRepository):
    def __init__(self, filename: str = "risk_assessments.csv"):
        self.filename = filename
        if not os.path.exists(self.filename):
            with open(self.filename, mode="w", newline="") as file:
                writer = csv.writer(file)
                writer.writerow(["assessment_id", "customer_id", "score", "assessment_date", "comments"])

    def _read_all(self) -> List[RiskAssessment]:
        assessments = []
        with open(self.filename, mode="r", newline="") as file:
            reader = csv.DictReader(file)
            for row in reader:
                assessment = RiskAssessment(
                    assessment_id=int(row["assessment_id"]),
                    customer_id=int(row["customer_id"]),
                    score=float(row["score"]),
                    assessment_date=row["assessment_date"],
                    comments=row["comments"] if row["comments"] else None,
                )
                assessments.append(assessment)
        return assessments

    def _write_all(self, assessments: List[RiskAssessment]) -> None:
        with open(self.filename, mode="w", newline="") as file:
            writer = csv.writer(file)
            writer.writerow(["assessment_id", "customer_id", "score", "assessment_date", "comments"])
            for assessment in assessments:
                writer.writerow([
                    assessment.assessment_id,
                    assessment.customer_id,
                    assessment.score,
                    assessment.assessment_date,
                    assessment.comments,
                ])

    def create(self, assessment: RiskAssessment) -> RiskAssessment:
        assessments = self._read_all()
        if assessment.assessment_id is None:
            max_id = max((a.assessment_id for a in assessments), default=0)
            assessment.assessment_id = max_id + 1
        if any(a.assessment_id == assessment.assessment_id for a in assessments):
            raise ValueError("RiskAssessment already exists")
        assessments.append(assessment)
        self._write_all(assessments)
        return assessment

    def get(self, assessment_id: int) -> Optional[RiskAssessment]:
        for assessment in self._read_all():
            if assessment.assessment_id == assessment_id:
                return assessment
        return None

    def update(self, assessment_id: int, assessment: RiskAssessment) -> RiskAssessment:
        assessments = self._read_all()
        updated = False
        for idx, a in enumerate(assessments):
            if a.assessment_id == assessment_id:
                assessment.assessment_id = assessment_id
                assessments[idx] = assessment
                updated = True
                break
        if not updated:
            raise ValueError("RiskAssessment not found")
        self._write_all(assessments)
        return assessment

    def delete(self, assessment_id: int) -> bool:
        assessments = self._read_all()
        new_assessments = [a for a in assessments if a.assessment_id != assessment_id]
        if len(new_assessments) == len(assessments):
            return False
        self._write_all(new_assessments)
        return True

    def list(self) -> List[RiskAssessment]:
        return self._read_all()

## SQLModel RiskAssessment Repository
class SQLModelRiskAssessmentRepository(BaseRiskAssessmentRepository):
    def create(self, assessment: RiskAssessment) -> RiskAssessment:
        assessment_sql = RiskAssessmentSQL(**assessment.dict(exclude_unset=True))
        with Session(engine) as session:
            session.add(assessment_sql)
            session.commit()
            session.refresh(assessment_sql)
        assessment.assessment_id = assessment_sql.assessment_id
        return assessment

    def get(self, assessment_id: int) -> Optional[RiskAssessment]:
        with Session(engine) as session:
            assessment_sql = session.get(RiskAssessmentSQL, assessment_id)
            if assessment_sql:
                return RiskAssessment(**assessment_sql.dict())
        return None

    def update(self, assessment_id: int, assessment: RiskAssessment) -> RiskAssessment:
        with Session(engine) as session:
            assessment_sql = session.get(RiskAssessmentSQL, assessment_id)
            if not assessment_sql:
                raise ValueError("RiskAssessment not found")
            for key, value in assessment.dict(exclude_unset=True).items():
                setattr(assessment_sql, key, value)
            session.add(assessment_sql)
            session.commit()
            session.refresh(assessment_sql)
        return RiskAssessment(**assessment_sql.dict())

    def delete(self, assessment_id: int) -> bool:
        with Session(engine) as session:
            assessment_sql = session.get(RiskAssessmentSQL, assessment_id)
            if not assessment_sql:
                return False
            session.delete(assessment_sql)
            session.commit()
            return True

    def list(self) -> List[RiskAssessment]:
        with Session(engine) as session:
            results = session.exec(select(RiskAssessmentSQL)).all()
            return [RiskAssessment(**a.dict()) for a in results]

## Composite RiskAssessment Repository
class CompositeRiskAssessmentRepository(BaseRiskAssessmentRepository):
    def __init__(self):
        self.sql_repo = SQLModelRiskAssessmentRepository()
        self.csv_repo = CSVRiskAssessmentRepository()
        self.mem_repo = InMemoryRiskAssessmentRepository()

    def create(self, assessment: RiskAssessment) -> RiskAssessment:
        assessment_sql = self.sql_repo.create(assessment)
        self.csv_repo.create(assessment_sql)
        self.mem_repo.create(assessment_sql)
        return assessment_sql

    def get(self, assessment_id: int) -> Optional[RiskAssessment]:
        return self.sql_repo.get(assessment_id)

    def update(self, assessment_id: int, assessment: RiskAssessment) -> RiskAssessment:
        updated_assessment = self.sql_repo.update(assessment_id, assessment)
        self.csv_repo.update(assessment_id, updated_assessment)
        self.mem_repo.update(assessment_id, updated_assessment)
        return updated_assessment

    def delete(self, assessment_id: int) -> bool:
        sql_result = self.sql_repo.delete(assessment_id)
        self.csv_repo.delete(assessment_id)
        self.mem_repo.delete(assessment_id)
        return sql_result

    def list(self) -> List[RiskAssessment]:
        return self.sql_repo.list()

# ==============================================================================
# --- TRANSACTION REPOSITORIES ---
# ==============================================================================

## In-Memory Transaction Repository
class InMemoryTransactionRepository(BaseTransactionRepository):
    def __init__(self):
        self.transactions = {}
        self.next_id = 1

    def create(self, transaction: Transaction) -> Transaction:
        if transaction.transaction_id is None:
            transaction.transaction_id = self.next_id
            self.next_id += 1
        if transaction.transaction_id in self.transactions:
            raise ValueError("Transaction already exists")
        self.transactions[transaction.transaction_id] = transaction
        return transaction

    def get(self, transaction_id: int) -> Optional[Transaction]:
        return self.transactions.get(transaction_id)

    def update(self, transaction_id: int, transaction: Transaction) -> Transaction:
        if transaction_id not in self.transactions:
            raise ValueError("Transaction not found")
        transaction.transaction_id = transaction_id
        self.transactions[transaction_id] = transaction
        return transaction

    def delete(self, transaction_id: int) -> bool:
        if transaction_id in self.transactions:
            del self.transactions[transaction_id]
            return True
        return False

    def list(self) -> List[Transaction]:
        return list(self.transactions.values())

## CSV Transaction Repository
class CSVTransactionRepository(BaseTransactionRepository):
    def __init__(self, filename: str = "transactions.csv"):
        self.filename = filename
        if not os.path.exists(self.filename):
            with open(self.filename, mode="w", newline="") as file:
                writer = csv.writer(file)
                writer.writerow(["transaction_id", "account_id", "amount", "transaction_type", "timestamp"])

    def _read_all(self) -> List[Transaction]:
        transactions = []
        with open(self.filename, mode="r", newline="") as file:
            reader = csv.DictReader(file)
            for row in reader:
                transaction = Transaction(
                    transaction_id=int(row["transaction_id"]),
                    account_id=int(row["account_id"]),
                    amount=float(row["amount"]),
                    transaction_type=row["transaction_type"],
                    timestamp=row["timestamp"],
                )
                transactions.append(transaction)
        return transactions

    def _write_all(self, transactions: List[Transaction]) -> None:
        with open(self.filename, mode="w", newline="") as file:
            writer = csv.writer(file)
            writer.writerow(["transaction_id", "account_id", "amount", "transaction_type", "timestamp"])
            for transaction in transactions:
                writer.writerow([
                    transaction.transaction_id,
                    transaction.account_id,
                    transaction.amount,
                    transaction.transaction_type,
                    transaction.timestamp,
                ])

    def create(self, transaction: Transaction) -> Transaction:
        transactions = self._read_all()
        if transaction.transaction_id is None:
            max_id = max((t.transaction_id for t in transactions), default=0)
            transaction.transaction_id = max_id + 1
        if any(t.transaction_id == transaction.transaction_id for t in transactions):
            raise ValueError("Transaction already exists")
        transactions.append(transaction)
        self._write_all(transactions)
        return transaction

    def get(self, transaction_id: int) -> Optional[Transaction]:
        for transaction in self._read_all():
            if transaction.transaction_id == transaction_id:
                return transaction
        return None

    def update(self, transaction_id: int, transaction: Transaction) -> Transaction:
        transactions = self._read_all()
        updated = False
        for idx, t in enumerate(transactions):
            if t.transaction_id == transaction_id:
                transaction.transaction_id = transaction_id
                transactions[idx] = transaction
                updated = True
                break
        if not updated:
            raise ValueError("Transaction not found")
        self._write_all(transactions)
        return transaction

    def delete(self, transaction_id: int) -> bool:
        transactions = self._read_all()
        new_transactions = [t for t in transactions if t.transaction_id != transaction_id]
        if len(new_transactions) == len(transactions):
            return False
        self._write_all(new_transactions)
        return True

    def list(self) -> List[Transaction]:
        return self._read_all()

## SQLModel Transaction Repository
class SQLModelTransactionRepository(BaseTransactionRepository):
    def create(self, transaction: Transaction) -> Transaction:
        transaction_sql = TransactionSQL(**transaction.dict(exclude_unset=True))
        with Session(engine) as session:
            session.add(transaction_sql)
            session.commit()
            session.refresh(transaction_sql)
        transaction.transaction_id = transaction_sql.transaction_id
        return transaction

    def get(self, transaction_id: int) -> Optional[Transaction]:
        with Session(engine) as session:
            transaction_sql = session.get(TransactionSQL, transaction_id)
            if transaction_sql:
                return Transaction(**transaction_sql.dict())
        return None

    def update(self, transaction_id: int, transaction: Transaction) -> Transaction:
        with Session(engine) as session:
            transaction_sql = session.get(TransactionSQL, transaction_id)
            if not transaction_sql:
                raise ValueError("Transaction not found")
            for key, value in transaction.dict(exclude_unset=True).items():
                setattr(transaction_sql, key, value)
            session.add(transaction_sql)
            session.commit()
            session.refresh(transaction_sql)
        return Transaction(**transaction_sql.dict())

    def delete(self, transaction_id: int) -> bool:
        with Session(engine) as session:
            transaction_sql = session.get(TransactionSQL, transaction_id)
            if not transaction_sql:
                return False
            session.delete(transaction_sql)
            session.commit()
            return True

    def list(self) -> List[Transaction]:
        with Session(engine) as session:
            results = session.exec(select(TransactionSQL)).all()
            return [Transaction(**t.dict()) for t in results]

## Composite Transaction Repository
class CompositeTransactionRepository(BaseTransactionRepository):
    def __init__(self):
        self.sql_repo = SQLModelTransactionRepository()
        self.csv_repo = CSVTransactionRepository()
        self.mem_repo = InMemoryTransactionRepository()

    def create(self, transaction: Transaction) -> Transaction:
        transaction_sql = self.sql_repo.create(transaction)
        self.csv_repo.create(transaction_sql)
        self.mem_repo.create(transaction_sql)
        return transaction_sql

    def get(self, transaction_id: int) -> Optional[Transaction]:
        return self.sql_repo.get(transaction_id)

    def update(self, transaction_id: int, transaction: Transaction) -> Transaction:
        updated_transaction = self.sql_repo.update(transaction_id, transaction)
        self.csv_repo.update(transaction_id, updated_transaction)
        self.mem_repo.update(transaction_id, updated_transaction)
        return updated_transaction

    def delete(self, transaction_id: int) -> bool:
        sql_result = self.sql_repo.delete(transaction_id)
        self.csv_repo.delete(transaction_id)
        self.mem_repo.delete(transaction_id)
        return sql_result

    def list(self) -> List[Transaction]:
        return self.sql_repo.list()

# ==============================================================================
# --- BRANCH REPOSITORIES ---
# ==============================================================================

## In-Memory Branch Repository
class InMemoryBranchRepository(BaseBranchRepository):
    def __init__(self):
        self.branches = {}
        self.next_id = 1

    def create(self, branch: Branch) -> Branch:
        if branch.branch_id is None:
            branch.branch_id = self.next_id
            self.next_id += 1
        if branch.branch_id in self.branches:
            raise ValueError("Branch already exists")
        self.branches[branch.branch_id] = branch
        return branch

    def get(self, branch_id: int) -> Optional[Branch]:
        return self.branches.get(branch_id)

    def update(self, branch_id: int, branch: Branch) -> Branch:
        if branch_id not in self.branches:
            raise ValueError("Branch not found")
        branch.branch_id = branch_id
        self.branches[branch_id] = branch
        return branch

    def delete(self, branch_id: int) -> bool:
        if branch_id in self.branches:
            del self.branches[branch_id]
            return True
        return False

    def list(self) -> List[Branch]:
        return list(self.branches.values())

## CSV Branch Repository
class CSVBranchRepository(BaseBranchRepository):
    def __init__(self, filename: str = "branches.csv"):
        self.filename = filename
        if not os.path.exists(self.filename):
            with open(self.filename, mode="w", newline="") as file:
                writer = csv.writer(file)
                writer.writerow(["branch_id", "name", "address", "manager"])

    def _read_all(self) -> List[Branch]:
        branches = []
        with open(self.filename, mode="r", newline="") as file:
            reader = csv.DictReader(file)
            for row in reader:
                branch = Branch(
                    branch_id=int(row["branch_id"]),
                    name=row["name"],
                    address=row["address"],
                    manager=row["manager"],
                )
                branches.append(branch)
        return branches

    def _write_all(self, branches: List[Branch]) -> None:
        with open(self.filename, mode="w", newline="") as file:
            writer = csv.writer(file)
            writer.writerow(["branch_id", "name", "address", "manager"])
            for branch in branches:
                writer.writerow([
                    branch.branch_id,
                    branch.name,
                    branch.address,
                    branch.manager,
                ])

    def create(self, branch: Branch) -> Branch:
        branches = self._read_all()
        if branch.branch_id is None:
            max_id = max((b.branch_id for b in branches), default=0)
            branch.branch_id = max_id + 1
        if any(b.branch_id == branch.branch_id for b in branches):
            raise ValueError("Branch already exists")
        branches.append(branch)
        self._write_all(branches)
        return branch

    def get(self, branch_id: int) -> Optional[Branch]:
        for branch in self._read_all():
            if branch.branch_id == branch_id:
                return branch
        return None

    def update(self, branch_id: int, branch: Branch) -> Branch:
        branches = self._read_all()
        updated = False
        for idx, b in enumerate(branches):
            if b.branch_id == branch_id:
                branch.branch_id = branch_id
                branches[idx] = branch
                updated = True
                break
        if not updated:
            raise ValueError("Branch not found")
        self._write_all(branches)
        return branch

    def delete(self, branch_id: int) -> bool:
        branches = self._read_all()
        new_branches = [b for b in branches if b.branch_id != branch_id]
        if len(new_branches) == len(branches):
            return False
        self._write_all(new_branches)
        return True

    def list(self) -> List[Branch]:
        return self._read_all()

## SQLModel Branch Repository
class SQLModelBranchRepository(BaseBranchRepository):
    def create(self, branch: Branch) -> Branch:
        branch_sql = BranchSQL(**branch.dict(exclude_unset=True))
        with Session(engine) as session:
            session.add(branch_sql)
            session.commit()
            session.refresh(branch_sql)
        branch.branch_id = branch_sql.branch_id
        return branch

    def get(self, branch_id: int) -> Optional[Branch]:
        with Session(engine) as session:
            branch_sql = session.get(BranchSQL, branch_id)
            if branch_sql:
                return Branch(**branch_sql.dict())
        return None

    def update(self, branch_id: int, branch: Branch) -> Branch:
        with Session(engine) as session:
            branch_sql = session.get(BranchSQL, branch_id)
            if not branch_sql:
                raise ValueError("Branch not found")
            for key, value in branch.dict(exclude_unset=True).items():
                setattr(branch_sql, key, value)
            session.add(branch_sql)
            session.commit()
            session.refresh(branch_sql)
        return Branch(**branch_sql.dict())

    def delete(self, branch_id: int) -> bool:
        with Session(engine) as session:
            branch_sql = session.get(BranchSQL, branch_id)
            if not branch_sql:
                return False
            session.delete(branch_sql)
            session.commit()
            return True

    def list(self) -> List[Branch]:
        with Session(engine) as session:
            results = session.exec(select(BranchSQL)).all()
            return [Branch(**b.dict()) for b in results]

## Composite Branch Repository
class CompositeBranchRepository(BaseBranchRepository):
    def __init__(self):
        self.sql_repo = SQLModelBranchRepository()
        self.csv_repo = CSVBranchRepository()
        self.mem_repo = InMemoryBranchRepository()

    def create(self, branch: Branch) -> Branch:
        branch_sql = self.sql_repo.create(branch)
        self.csv_repo.create(branch_sql)
        self.mem_repo.create(branch_sql)
        return branch_sql

    def get(self, branch_id: int) -> Optional[Branch]:
        return self.sql_repo.get(branch_id)

    def update(self, branch_id: int, branch: Branch) -> Branch:
        updated_branch = self.sql_repo.update(branch_id, branch)
        self.csv_repo.update(branch_id, updated_branch)
        self.mem_repo.update(branch_id, updated_branch)
        return updated_branch

    def delete(self, branch_id: int) -> bool:
        sql_result = self.sql_repo.delete(branch_id)
        self.csv_repo.delete(branch_id)
        self.mem_repo.delete(branch_id)
        return sql_result

    def list(self) -> List[Branch]:
        return self.sql_repo.list()