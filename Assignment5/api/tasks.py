from celery import shared_task

@shared_task
def process_event(event):
    return f"Processed: {event}"

@shared_task
def assess_risk_for_customer(customer_id):
    """
    Dummy risk‐assessment: creates a RiskAssessment record
    for the given customer with a placeholder score.
    """
    from api.models import RiskAssessment
    # In a real app you’d compute this dynamically.
    score = 7  
    RiskAssessment.objects.create(customer_id=customer_id, risk_score=score)
    return f"Created risk assessment for customer {customer_id} with score {score}"

@shared_task(bind=True)
def transfer_funds(self, source_id, target_id, amount_str):
    """
    Moves `amount` from source account to target account.
    Raises ValueError on insufficient funds or missing account.
    Returns a dict with updated balances.
    """
    from decimal import Decimal
    from django.core.exceptions import ObjectDoesNotExist
    from .models import Account

    amount = Decimal(amount_str)
    try:
        source = Account.objects.get(id=source_id)
        target = Account.objects.get(id=target_id)
    except ObjectDoesNotExist as e:
        # retry up to 3 times if accounts not found
        raise self.retry(exc=e, countdown=5, max_retries=3)

    if source.balance < amount:
        raise ValueError("Insufficient funds")

    source.balance -= amount
    target.balance += amount
    source.save()
    target.save()

    return {
        "source_balance": str(source.balance),
        "target_balance": str(target.balance),
    }

@shared_task
def create_risk_assessment(customer_id, risk_score):
    """
    Create a RiskAssessment record in the background.
    """
    from .models import RiskAssessment
    ra = RiskAssessment.objects.create(
        customer_id=customer_id,
        risk_score=risk_score
    )
    return {
        "id": ra.id,
        "customer": ra.customer_id,
        "risk_score": ra.risk_score,
    }

