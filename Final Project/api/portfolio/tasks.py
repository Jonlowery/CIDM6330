# api/portfolio/tasks.py

import os
import logging
import openpyxl
from celery import shared_task, chain
from django.db import IntegrityError
from django.conf import settings

from .models import Security, Customer, Portfolio, CustomerHolding
from .services import load_securities, load_customers, load_holdings

log = logging.getLogger(__name__)

@shared_task
def import_securities_from_excel(file_path):
    log.info("Clearing existing securities")
    Security.objects.all().delete()

    wb = openpyxl.load_workbook(filename=file_path, data_only=True)
    ws = wb.active

    for row in ws.iter_rows(min_row=2, values_only=True):
        log.info("Row data for security import: %r", row)
        cusip, desc, issue_date, maturity_date, coupon, wal, pay_freq, day_count, factor = row
        data = {
            'cusip': cusip,
            'description': desc,
            'issue_date': issue_date,
            'maturity_date': maturity_date,
            'coupon': coupon,
            'wal': wal,
            'payment_frequency': pay_freq,
            'day_count': day_count,
            'factor': factor,
        }
        load_securities(data)

    return f"Imported securities from {os.path.basename(file_path)}"

@shared_task
def import_customers_from_excel(file_path):
    log.info("Clearing existing customers, portfolios & holdings")
    CustomerHolding.objects.all().delete()
    Portfolio.objects.all().delete()
    Customer.objects.all().delete()

    wb = openpyxl.load_workbook(filename=file_path, data_only=True)
    ws = wb.active
    headers = [cell.value for cell in ws[1]]

    for row in ws.iter_rows(min_row=2, values_only=True):
        log.info("Row data for customer import: %r", row)
        data = dict(zip(headers, row))
        if data.get('users'):
            data['users'] = [int(u) for u in str(data['users']).split(',')]
        load_customers(data)

    return f"Imported customers from {os.path.basename(file_path)}"

@shared_task(bind=True, autoretry_for=(IntegrityError,), retry_backoff=5, max_retries=3)
def import_holdings_from_excel(self, file_path):
    log.info("Clearing existing holdings")
    CustomerHolding.objects.all().delete()

    wb = openpyxl.load_workbook(filename=file_path, data_only=True)
    ws = wb.active
    headers = [cell.value for cell in ws[1]]

    for row in ws.iter_rows(min_row=2, values_only=True):
        raw = dict(zip(headers, row))
        log.info("Row data for holding import: %r", raw)

        cust_no = raw.pop('customer_number', None)
        if cust_no:
            cust = Customer.objects.filter(customer_number=str(cust_no)).first()
            if not cust:
                log.warning("  → skipping, unknown customer_number %r", cust_no)
                continue
            raw['customer'] = cust.id

        cusip = raw.pop('cusip', None)
        if cusip:
            sec = Security.objects.filter(cusip=str(cusip)).first()
            if not sec:
                log.warning("  → skipping, unknown cusip %r", cusip)
                continue
            raw['security'] = sec.id

        log.info("  → calling load_holdings with: %r", raw)
        try:
            load_holdings(raw)
        except IntegrityError as exc:
            log.error("  → IntegrityError, retrying: %s", exc)
            raise self.retry(exc=exc)

    return f"Imported holdings from {os.path.basename(file_path)}"

@shared_task
def import_all_from_excel():
    """
    Orchestrate the three imports in sequence:
      1) securities
      2) customers
      3) holdings
    """
    base = settings.BASE_DIR / 'data' / 'imports'
    sec = str(base / 'sample_securities.xlsx')
    cust = str(base / 'customers.xlsx')
    hold = str(base / 'holdings.xlsx')

    chain(
        import_securities_from_excel.s(sec),
        import_customers_from_excel.si(cust),   # ← use .si here
        import_holdings_from_excel.si(hold),     # ← and here
    ).apply_async()

    return "Scheduled chained import of securities → customers → holdings"