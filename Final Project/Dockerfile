# api/Dockerfile

FROM python:3.10-slim

WORKDIR /app

# install Python deps
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# copy your Django app in
COPY api/ /app

# copy your frontend static files
COPY frontend/ /app/frontend

# collect all static into STATIC_ROOT (staticfiles/)
RUN python manage.py collectstatic --noinput

EXPOSE 8000

# for dev; later swap to gunicorn for prod
CMD ["python", "manage.py", "runserver", "0.0.0.0:8000"]
