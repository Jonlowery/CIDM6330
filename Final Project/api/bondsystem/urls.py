# bondsystem/urls.py (Corrected muni buy interest URL)

from django.contrib import admin
from django.urls import path, include
# Remove or comment out this import if it's not used elsewhere
# from django.views.generic import RedirectView
from rest_framework.authtoken.views import obtain_auth_token

# Import the view needed for the root path and other views
from portfolio.views import (
    portfolio_analyzer_view, # Root view serving index.html
    ImportExcelView,         # View for Excel imports
    CustomerViewSet,
    SecurityViewSet,
    PortfolioViewSet,
    CustomerHoldingViewSet,
    EmailSalespersonInterestView, # Sell interest email view
    MunicipalOfferingViewSet,
    EmailSalespersonMuniBuyInterestView, # Buy interest email view
)
from rest_framework import routers

# Setup the default router
router = routers.DefaultRouter()
# Register ViewSets with the router
router.register(r'customers', CustomerViewSet, basename='customer')
router.register(r'securities', SecurityViewSet, basename='security')
router.register(r'portfolios', PortfolioViewSet, basename='portfolio')
router.register(r'holdings', CustomerHoldingViewSet, basename='customerholding')
router.register(r'muni-offerings', MunicipalOfferingViewSet, basename='munioffering')

# Define URL patterns
urlpatterns = [
    # Root URL serving the main frontend application view
    path("", portfolio_analyzer_view, name="portfolio-analyzer"),

    # Admin site URL
    path('admin/', admin.site.urls),

    # DRF authentication URLs (login/logout views for browsable API)
    path('api-auth/', include('rest_framework.urls', namespace='rest_framework')),

    # API endpoint for token authentication (optional, if used)
    path('api-token-auth/', obtain_auth_token, name='api-token-auth'),

    # API endpoint for Excel file imports (admin only)
    path('api/imports/upload_excel/', ImportExcelView.as_view(), name='import-excel'),

    # API endpoint for emailing salesperson about SELL interest
    path('api/email-salesperson-interest/', EmailSalespersonInterestView.as_view(), name='email-salesperson-interest'),

    # --- CORRECTED URL for emailing salesperson about BUY interest ---
    path('api/email-buy-muni-interest/', EmailSalespersonMuniBuyInterestView.as_view(), name='email-buy-muni-interest'), # Changed path

    # Include URLs registered with the DRF router (for ViewSets)
    # This should generally come after more specific paths like imports/email
    path('api/', include(router.urls)), # Includes /api/muni-offerings/ etc.
]
