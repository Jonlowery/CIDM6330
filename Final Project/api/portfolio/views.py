# portfolio/views.py

import os
from django.conf import settings
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import viewsets, status, permissions
from rest_framework.decorators import action
from rest_framework.generics import GenericAPIView
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.response import Response

from .tasks import import_securities_from_excel
from .models import Customer, Security, Portfolio, CustomerHolding
from .serializers import (
    ExcelUploadSerializer,
    CustomerSerializer,
    SecuritySerializer,
    PortfolioSerializer,
    CustomerHoldingSerializer,
)


class CustomerViewSet(viewsets.ModelViewSet):
    queryset = Customer.objects.all()
    serializer_class = CustomerSerializer


class SecurityViewSet(viewsets.ModelViewSet):
    queryset = Security.objects.all()
    serializer_class = SecuritySerializer


class PortfolioViewSet(viewsets.ModelViewSet):
    """
    Standard CRUD + `POST /api/portfolios/{pk}/simulate_swap/`
    """
    queryset = Portfolio.objects.all()
    serializer_class = PortfolioSerializer

    @action(
        detail=True,
        methods=['post'],
        url_path='simulate_swap',
        url_name='simulate-swap',
        permission_classes=[permissions.IsAuthenticated]
    )
    def simulate_swap(self, request, pk=None):
        """
        Run a “what-if” swap simulation.  Request body can include:
          - add_security_id, face_amount, price
          - remove_holding_id
        Returns before_total_face, after_total_face, delta_wal, delta_net_benefit.
        """
        portfolio = self.get_object()

        # 1. Sum up current face amount
        original_holdings = portfolio.holdings.all()
        before_total_face = sum(h.original_face_amount or 0 for h in original_holdings)

        # 2. Parse “add” inputs
        add_security_id = request.data.get('add_security_id')
        face_amount = float(request.data.get('face_amount') or 0)
        price = float(request.data.get('price') or 0)
        if add_security_id:
            add_faces = face_amount
            add_value = face_amount * price
        else:
            add_faces = 0
            add_value = 0

        # 3. Parse “remove” inputs
        remove_holding_id = request.data.get('remove_holding_id')
        remove_faces = 0
        remove_value = 0
        if remove_holding_id:
            try:
                h = CustomerHolding.objects.get(id=remove_holding_id)
                remove_faces = float(h.original_face_amount or 0)
                remove_value = remove_faces * float(h.settlement_price or 0)
            except CustomerHolding.DoesNotExist:
                pass  # skip if invalid

        # 4. Compute post-swap totals and deltas
        after_total_face = before_total_face + add_faces - remove_faces
        delta_net_benefit = add_value - remove_value
        delta_wal = 0  # placeholder until WAL logic is added

        return Response({
            'before_total_face': before_total_face,
            'after_total_face': after_total_face,
            'delta_wal': delta_wal,
            'delta_net_benefit': delta_net_benefit,
        }, status=status.HTTP_200_OK)


class CustomerHoldingViewSet(viewsets.ModelViewSet):
    """
    CRUD for holdings, support filtering by ?portfolio=<id>
    """
    queryset = CustomerHolding.objects.all()
    serializer_class = CustomerHoldingSerializer

    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['portfolio']


class ImportExcelView(GenericAPIView):
    """
    POST an Excel file and kick off the securities-import Celery task.
    """
    parser_classes = [MultiPartParser, FormParser]
    permission_classes = [permissions.IsAdminUser]
    serializer_class = ExcelUploadSerializer

    def post(self, request, format=None):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        file_obj = serializer.validated_data['file']

        imports_dir = os.path.join(settings.BASE_DIR, 'data', 'imports')
        os.makedirs(imports_dir, exist_ok=True)

        file_path = os.path.join(imports_dir, file_obj.name)
        with open(file_path, 'wb+') as dest:
            for chunk in file_obj.chunks():
                dest.write(chunk)

        task = import_securities_from_excel.delay(file_path)
        return Response({'task_id': task.id}, status=status.HTTP_202_ACCEPTED)
