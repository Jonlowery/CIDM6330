# portfolio/filters.py (Expanded for more fields, including portfolio filter)

import django_filters
from .models import CustomerHolding, Security, SecurityType, MunicipalOffering, Portfolio # Ensure Portfolio is imported

class CustomerHoldingFilterSet(django_filters.FilterSet):
    """
    FilterSet for CustomerHolding model to allow filtering based on
    holding attributes and related security attributes.
    """
    # --- Direct Holding Fields ---
    intention_code = django_filters.ChoiceFilter(
        choices=CustomerHolding._meta.get_field('intention_code').choices
    )
    settlement_date = django_filters.DateFromToRangeFilter()

    # --- Filter by Portfolio ID ---
    # This allows filtering by `?portfolio=<portfolio_id>`
    portfolio = django_filters.NumberFilter(field_name='portfolio_id')

    # --- Related Security Fields ---
    security_cusip = django_filters.CharFilter(field_name='security__cusip', lookup_expr='icontains')
    security_cusip_exact = django_filters.CharFilter(field_name='security__cusip', lookup_expr='exact')
    security_description = django_filters.CharFilter(field_name='security__description', lookup_expr='icontains')
    security_type = django_filters.NumberFilter(field_name='security__security_type__type_id')
    security_type_name = django_filters.CharFilter(field_name='security__security_type__name', lookup_expr='icontains')
    security_tax_code = django_filters.ChoiceFilter(
        field_name='security__tax_code',
        choices=Security._meta.get_field('tax_code').choices
    )
    security_allows_paydown = django_filters.BooleanFilter(field_name='security__allows_paydown')
    security_maturity_date = django_filters.DateFromToRangeFilter(field_name='security__maturity_date')
    security_sector = django_filters.CharFilter(field_name='security__sector', lookup_expr='icontains')
    security_state_of_issuer = django_filters.CharFilter(field_name='security__state_of_issuer', lookup_expr='exact')

    # --- Filters for CustomerHolding Numeric Fields ---
    book_price = django_filters.NumberFilter(field_name='book_price', lookup_expr='exact')
    book_price_range = django_filters.RangeFilter(field_name='book_price') # For book_price_min & book_price_max

    book_yield = django_filters.RangeFilter(field_name='book_yield') # Allows book_yield_min=...&book_yield_max=...

    market_price = django_filters.NumberFilter(field_name='market_price', lookup_expr='exact')
    market_price_range = django_filters.RangeFilter(field_name='market_price') # For market_price_min & market_price_max

    market_yield = django_filters.RangeFilter(field_name='market_yield') # Allows market_yield_min=...&market_yield_max=...

    # For 'wal', which maps to holding_average_life
    holding_average_life = django_filters.RangeFilter(field_name='holding_average_life')
    # For 'duration'
    holding_duration = django_filters.RangeFilter(field_name='holding_duration')

    # Filter for security's WAL (Weighted Average Life)
    security_wal = django_filters.RangeFilter(field_name='security__wal')
    # Filter for security's CPR (Conditional Prepayment Rate)
    security_cpr = django_filters.RangeFilter(field_name='security__cpr')


    class Meta:
        model = CustomerHolding
        # Rely only on explicitly defined filters above
        fields = []
        # Example of explicitly listing ALL filter names if preferred for clarity:
        # fields = [
        # 'portfolio', # Added portfolio filter
        # 'intention_code', 'settlement_date',
        # 'security_cusip', 'security_cusip_exact', 'security_description',
        # 'security_type', 'security_type_name', 'security_tax_code',
        # 'security_allows_paydown', 'security_maturity_date',
        # 'security_sector', 'security_state_of_issuer',
        # 'book_price', 'book_price_range', 'book_yield',
        # 'market_price', 'market_price_range', 'market_yield',
        # 'holding_average_life', 'holding_duration',
        # 'security_wal', 'security_cpr',
        # ]

class MuniOfferingFilterSet(django_filters.FilterSet):
    """
    FilterSet for MunicipalOffering model.
    """
    cusip = django_filters.CharFilter(field_name='cusip', lookup_expr='icontains')
    description = django_filters.CharFilter(field_name='description', lookup_expr='icontains')
    state = django_filters.CharFilter(field_name='state', lookup_expr='exact')
    moody_rating = django_filters.CharFilter(field_name='moody_rating', lookup_expr='exact')
    sp_rating = django_filters.CharFilter(field_name='sp_rating', lookup_expr='exact')
    insurance = django_filters.CharFilter(field_name='insurance', lookup_expr='icontains')

    # Range and DateRange filters
    amount = django_filters.RangeFilter(field_name='amount')
    coupon = django_filters.RangeFilter(field_name='coupon')
    maturity_date = django_filters.DateFromToRangeFilter(field_name='maturity_date')
    yield_rate = django_filters.RangeFilter(field_name='yield_rate') # Often referred to as 'yield' in frontend
    price = django_filters.RangeFilter(field_name='price')
    call_date = django_filters.DateFromToRangeFilter(field_name='call_date')
    call_price = django_filters.RangeFilter(field_name='call_price')


    class Meta:
        model = MunicipalOffering
        fields = [ # List all fields that can be filtered, even if also defined above for more control
            'cusip', 'description', 'state', 'moody_rating', 'sp_rating', 'insurance',
            'amount', 'coupon', 'maturity_date', 'yield_rate', 'price', 'call_date', 'call_price',
        ]
