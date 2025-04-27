# bondsystem/urls.py

from django.contrib import admin
from django.urls import path, include
# Remove or comment out this import if it's not used elsewhere
# from django.views.generic import RedirectView
from rest_framework.authtoken.views import obtain_auth_token

# Import the view needed for the root path and other views
from portfolio.views import (
    portfolio_analyzer_view, # <-- Ensure this is imported
    ImportExcelView,
    CustomerViewSet,
    SecurityViewSet,
    PortfolioViewSet,
    CustomerHoldingViewSet,
)
from rest_framework import routers

router = routers.DefaultRouter()
# Ensure basenames are set for viewsets using get_queryset
router.register(r'customers', CustomerViewSet, basename='customer')
router.register(r'securities', SecurityViewSet)
router.register(r'portfolios', PortfolioViewSet, basename='portfolio')
router.register(r'holdings', CustomerHoldingViewSet, basename='customerholding')

urlpatterns = [
    # Remove the old redirect for the root path:
    # path("", RedirectView.as_view(url="/static/index.html", permanent=False)),

    # Add the new path for the root URL pointing to the protected view:
    path("", portfolio_analyzer_view, name="portfolio-analyzer"), # <-- ADD THIS LINE

    # --- Keep other paths ---
    path('api-token-auth/', obtain_auth_token, name='api-token-auth'),
    path('admin/', admin.site.urls),
    path('api-auth/', include('rest_framework.urls', namespace='rest_framework')), # Needed for login page
    path('api/imports/upload_excel/', ImportExcelView.as_view(), name='import-excel'),
    path('api/', include(router.urls)),
]