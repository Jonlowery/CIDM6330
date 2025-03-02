# app/main.py

from fastapi import FastAPI
from app import routes

app = FastAPI(title="FastAPI Project")

# Include the router from routes.py
app.include_router(routes.router)

@app.get("/")
def read_root():
    return {"message": "Hello, welcome to my API!"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
