# main.py
from fastapi import FastAPI
from app import routes
from app.database import create_db_and_tables

app = FastAPI(title="Extended API with Multiple Entities")

# Include the router from routes.py
app.include_router(routes.router)

@app.on_event("startup")
def on_startup():
    create_db_and_tables()

@app.get("/")
def read_root():
    return {"message": "Hello, welcome to my API!"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)