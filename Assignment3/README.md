# Assignment 3: Extended API with Multiple Entities and Data Retention

## Overview
In this assignment, I developed an extended FastAPI application that builds on my previous work by implementing a complete API with persistence for multiple entities. The project supports CRUD (Create, Read, Update, Delete) operations for five entities: **Customer**, **Account**, **RiskAssessment**, **Transaction**, and **Branch**. It introduces three repository patterns—**In-Memory**, **CSV**, and **SQLModel (SQLite)**—to demonstrate flexible data retention. This serves as a foundation for a trading application, inspired by the SQLModel "Heroes" FastAPI/Pydantic tutorial.

## Project Structure
The project is organized as follows:

- **app**: Contains the FastAPI application code.
  - **main.py**: The entry point for the API.
  - **models.py**: Contains the Pydantic and SQLModel definitions for all entities.
  - **routes.py**: Implements the CRUD endpoints for all entities.
  - **repository.py**: Defines the In-Memory, CSV, and SQLModel repository implementations.
  - **database.py**: Sets up the SQLite database and engine for SQLModel.
- **requirements.txt**: Lists all Python packages required for the project.
- **ERD.pdf**: The Entity Relationship Diagram for the project.
- **README.md**: This file, which explains the project details.

## FastAPI Application Details

### Overview
This FastAPI application is built with Python and leverages Pydantic for data validation and SQLModel for database integration. It provides endpoints for CRUD operations across multiple entities, with configurable persistence options.

### Key Endpoints
- `GET /`: Returns a welcome message.
- `POST /{entity}/`: Creates a new entity (e.g., `/customers/`, `/accounts/`).
- `GET /{entity}/`: Retrieves all entities (e.g., `/customers/`, `/accounts/`).
- `GET /{entity}/{id}`: Retrieves a specific entity by ID (e.g., `/customers/1`).
- `PUT /{entity}/{id}`: Updates an existing entity (e.g., `/customers/1`).
- `DELETE /{entity}/{id}`: Deletes an entity (e.g., `/customers/1`).

Entities supported: `customers`, `accounts`, `riskassessments`, `transactions`, `branches`.

### Persistence Options
The application supports three repository types, defined in `repository.py`:

- **In-Memory**: Temporary storage during runtime.
- **CSV**: File-based storage in CSV files.
- **SQLModel**: Persistent storage in an SQLite database (configured in `database.py`).

For customers, set the `REPOSITORY_TYPE` environment variable (e.g., `set REPOSITORY_TYPE=sqlmodel` on Windows) to choose the repository.

## How to Run the Application

### 1. Set Up and Activate a Virtual Environment

**Windows:** Open Command Prompt and navigate to your project folder:

```shell
cd C:\Users\Owner\OneDrive\Documents\GitHub\CIDM6330\Assignment3
python -m venv venv
venv\Scripts\activate
```

(You should see `(venv)` at the beginning of your prompt.)

### 2. Install Dependencies
With the virtual environment activated, run:

```shell
pip install -r requirements.txt
```

### 3. Run the Server
Start the FastAPI server by running:

```shell
uvicorn app.main:app --reload
```

The server will be accessible at `http://127.0.0.1:8000`.

### 4. Test the API
Open your browser and navigate to `http://127.0.0.1:8000/docs` to access the interactive API documentation provided by FastAPI.

## Code Snippets

### database.py

```python
from sqlmodel import create_engine, SQLModel

sqlite_file_name = "database.db"
sqlite_url = f"sqlite:///{sqlite_file_name}"
engine = create_engine(sqlite_url)

def create_db_and_tables():
    SQLModel.metadata.create_all(engine)
```

## Dependencies
Specified in `requirements.txt`:

## Conclusion
This project expanded my initial API into a robust FastAPI application, providing flexible persistence and CRUD operations across multiple entities. It serves as a scalable foundation for future expansion of the trading application.

