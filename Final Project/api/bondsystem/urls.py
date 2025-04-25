# bondsystem/urls.py

from django.contrib import admin
from django.urls import path, include
from django.views.generic import RedirectView
from portfolio.views import ImportExcelView
from rest_framework import routers
from portfolio.views import (
    CustomerViewSet,
    SecurityViewSet,
    PortfolioViewSet,
    CustomerHoldingViewSet,
)

router = routers.DefaultRouter()
router.register(r'customers', CustomerViewSet)
router.register(r'securities', SecurityViewSet)
router.register(r'portfolios', PortfolioViewSet)
router.register(r'holdings', CustomerHoldingViewSet)

urlpatterns = [
    path("", RedirectView.as_view(url="/static/index.html", permanent=False)),
    path('admin/', admin.site.urls),
    path('api-auth/', include('rest_framework.urls', namespace='rest_framework')),
    path('api/imports/upload_excel/', ImportExcelView.as_view(), name='import-excel'),
    path('api/', include(router.urls)),
]

