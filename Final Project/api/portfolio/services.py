# api/portfolio/services.py

import uuid
from django.contrib.auth import get_user_model
from .models import Customer, Security, Portfolio, CustomerHolding

def load_securities(data: dict):
    """
    Upsert a Security from a dict of values.
    Expects keys: cusip, description, issue_date, maturity_date,
                  coupon, wal, payment_frequency, day_count, factor
    """
    security, _ = Security.objects.update_or_create(
        cusip=data['cusip'],
        defaults={
            'description':       data['description'],
            'issue_date':        data['issue_date'],
            'maturity_date':     data['maturity_date'],
            'coupon':            data['coupon'],
            'wal':               data['wal'],
            'payment_frequency': data['payment_frequency'],
            'day_count':         data['day_count'],
            'factor':            data['factor'],
        }
    )
    return security

def load_customers(data: dict):
    """
    Upsert a Customer (by customer_number) and associate to users.
    Expects keys: customer_number, name, address, city, state, zip_code, users (list of IDs)
    """
    User = get_user_model()
    external_no = data.get('customer_number')
    users = User.objects.filter(id__in=data.pop('users', []))

    # Build lookup by external number if provided, else by name
    lookup = {}
    if external_no:
        lookup['customer_number'] = external_no
    else:
        lookup['name'] = data['name']

    customer, created = Customer.objects.update_or_create(
        **lookup,
        defaults={
            'customer_number': external_no,
            'name':            data['name'],
            'address':         data['address'],
            'city':            data['city'],
            'state':           data['state'],
            'zip_code':        data['zip_code'],
        }
    )
    # Associate users
    customer.users.set(users)

    # Ensure default portfolio exists
    if created or not customer.portfolios.exists():
        Portfolio.objects.create(owner=customer, name=f"Default Portfolio {customer.id}")

    return customer

def load_holdings(data: dict):
    """
    Upsert a CustomerHolding.
    Always assigns to the customer’s default portfolio (create if missing).
    Expects keys: customer (ID), security (ID), original_face_amount,
                  settlement_date, settlement_price, book_price, book_yield.
    """
    # Lookup the customer
    customer_id = data.get('customer')
    try:
        customer = Customer.objects.get(id=customer_id)
    except Customer.DoesNotExist:
        # Skip if customer not found
        return None

    # Get or create the default portfolio for this customer
    default_portfolio, _ = Portfolio.objects.get_or_create(
        owner=customer,
        defaults={'name': f"Default Portfolio {customer.id}"}
    )

    # Build lookup for update_or_create:
    #   If ticket_id provided, match on that; otherwise match on customer+security
    lookup = {}
    if data.get('ticket_id'):
        lookup['ticket_id'] = data['ticket_id']
    else:
        lookup['customer_id'] = customer.id
        lookup['security_id'] = data['security']

    # Build defaults for the rest of the fields
    defaults = {
        'customer_id':          customer.id,
        'portfolio_id':         default_portfolio.id,
        'security_id':          data['security'],
        'original_face_amount': data.get('original_face_amount'),
        'settlement_date':       data.get('settlement_date'),
        'settlement_price':      data.get('settlement_price'),
        'book_price':            data.get('book_price'),
        'book_yield':            data.get('book_yield'),
    }

    holding, created = CustomerHolding.objects.update_or_create(
        **lookup,
        defaults=defaults
    )
    return holding
