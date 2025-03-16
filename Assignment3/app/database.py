# database.py
from sqlmodel import create_engine, SQLModel
from app.models import CustomerSQL, AccountSQL, RiskAssessmentSQL, TransactionSQL, BranchSQL

DATABASE_URL = "sqlite:///database.db"
engine = create_engine(DATABASE_URL)

def create_db_and_tables():
    SQLModel.metadata.create_all(engine)