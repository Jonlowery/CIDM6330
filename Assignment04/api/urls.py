from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    CustomerViewSet, 
    AccountViewSet, 
    RiskAssessmentViewSet, 
    TransactionViewSet, 
    BranchViewSet
)

router = DefaultRouter()
router.register(r'customers', CustomerViewSet)
router.register(r'accounts', AccountViewSet)
router.register(r'risk-assessments', RiskAssessmentViewSet)
router.register(r'transactions', TransactionViewSet)
router.register(r'branches', BranchViewSet)

urlpatterns = [
    path('', include(router.urls)),
]
