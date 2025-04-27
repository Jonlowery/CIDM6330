# api/portfolio/serializers.py

from rest_framework import serializers
from .models import Customer, Security, Portfolio, CustomerHolding

class CustomerSerializer(serializers.ModelSerializer):
    class Meta:
        model = Customer
        fields = [
            'id',
            'unique_id',
            'customer_number',
            'users',
            'name',
            'address',
            'city',
            'state',
            'zip_code',
        ]
        read_only_fields = ['id', 'unique_id']

class SecuritySerializer(serializers.ModelSerializer):
    class Meta:
        model = Security
        fields = [
            'id',
            'cusip',
            'description',
            'issue_date',
            'maturity_date',
            'call_date',
            'coupon',
            'wal',
            'payment_frequency',
            'day_count',
            'factor',
        ]
        read_only_fields = ['id']

class CustomerHoldingSerializer(serializers.ModelSerializer):
    # show the CUSIP instead of object id
    security_cusip = serializers.SlugRelatedField(
        source='security',
        slug_field='cusip',
        read_only=True
    )
    # show external customer number
    customer_number = serializers.CharField(
        source='customer.customer_number',
        read_only=True
    )
    # computed “current par” = face × factor, rounded to 2 decimals
    par = serializers.SerializerMethodField()
    # pull these four fields from the related Security
    maturity_date = serializers.DateField(source='security.maturity_date', read_only=True)
    wal           = serializers.FloatField(source='security.wal',           read_only=True)
    coupon        = serializers.FloatField(source='security.coupon',        read_only=True)
    call_date     = serializers.DateField(source='security.call_date',      read_only=True)
    description   = serializers.CharField( source='security.description',  read_only=True)

    class Meta:
        model = CustomerHolding
        fields = [
            'id',
            'ticket_id',
            'customer',
            'customer_number',
            'security',
            'security_cusip',
            'par',
            'maturity_date',
            'settlement_price',
            'book_yield',
            'wal',
            'coupon',
            'call_date',
            'description',
        ]
        read_only_fields = [
            'id',
            'ticket_id',
            'customer_number',
            'security_cusip',
            'par',
            'maturity_date',
            'wal',
            'coupon',
            'call_date',
            'description',
        ]

    def get_par(self, obj):
        return round(obj.original_face_amount * obj.security.factor, 2)

class PortfolioSerializer(serializers.ModelSerializer):
    # display the external customer_number rather than PK
    owner = serializers.SlugRelatedField(
        read_only=True,
        slug_field='customer_number'
    )
    holdings = CustomerHoldingSerializer(many=True, read_only=True)

    class Meta:
        model = Portfolio
        fields = [
            'id',
            'owner',
            'name',
            'created_at',
            'holdings',
        ]
        read_only_fields = ['id', 'created_at']

class ExcelUploadSerializer(serializers.Serializer):
    file = serializers.FileField()
