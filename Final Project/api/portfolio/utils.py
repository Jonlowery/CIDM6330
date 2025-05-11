# portfolio/utils.py

import QuantLib as ql
from decimal import Decimal, ROUND_HALF_UP, InvalidOperation
from datetime import date
import logging
import math

# Import models from the current app
# Ensure models are imported correctly.
# It's good practice to handle potential circular imports if utils are also imported by models.py,
# but for now, direct import is fine if that's not the case.
from .models import CustomerHolding, Security, CustomerHolding # Added CustomerHolding again just in case it was missed in original

log = logging.getLogger(__name__)

def get_quantlib_frequency(payments_per_year):
    """Maps payments per year to QuantLib Frequency."""
    if payments_per_year is None: 
        log.warning(f"payments_per_year is None. Defaulting to Annual.")
        return ql.Annual
    if not isinstance(payments_per_year, int) or payments_per_year <= 0:
        log.warning(f"Invalid or non-positive payments_per_year: {payments_per_year}. Defaulting frequency to Annual.")
        return ql.Annual
    if payments_per_year == 1: return ql.Annual
    elif payments_per_year == 2: return ql.Semiannual
    elif payments_per_year == 4: return ql.Quarterly
    elif payments_per_year == 12: return ql.Monthly
    else:
        log.warning(f"Unsupported payments_per_year: {payments_per_year}. Defaulting to Annual.")
        return ql.Annual

def get_quantlib_day_counter(interest_calc_code):
    """Maps interest calculation code to QuantLib DayCounter."""
    if interest_calc_code == 'c': return ql.Thirty360(ql.Thirty360.BondBasis)
    elif interest_calc_code == 'a': return ql.ActualActual(ql.ActualActual.ISMA)
    elif interest_calc_code == 'h': return ql.Actual365Fixed()
    else:
        log.warning(f"Unsupported interest_calc_code: {interest_calc_code}. Defaulting to Actual/Actual (ISMA).")
        return ql.ActualActual(ql.ActualActual.ISMA)

def generate_quantlib_cashflows(holding: CustomerHolding, evaluation_date: date):
    """
    Generates lists of QuantLib CashFlow objects for a holding.
    Interest calculation now correctly uses the full coupon period,
    assuming holder receives full payment if settled before payment date.
    Evaluation date only filters which future flows are shown.
    """
    log.info(f"--- generate_quantlib_cashflows START ---")
    
    if not holding:
        log.error("generate_quantlib_cashflows called with missing holding.")
        log.info(f"--- generate_quantlib_cashflows END (Error: Missing Holding) ---")
        return [], [], None, "Missing holding or security data."

    try:
        # Attempt to access holding.security. This might raise RelatedObjectDoesNotExist
        # if the holding is unsaved and security is None, or if security_id is not set.
        security = holding.security
        if not security: # Handles case where security is None even if RelatedObjectDoesNotExist is not raised
            raise AttributeError("Security attribute is None.")
    except (CustomerHolding.security.RelatedObjectDoesNotExist, AttributeError) as e:
        log.error(f"generate_quantlib_cashflows: Missing or unlinked security for holding {holding.external_ticket if hasattr(holding, 'external_ticket') else 'Unknown Ticket'}. Exception: {e}")
        log.info(f"--- generate_quantlib_cashflows END (Error: Missing Security) ---")
        return [], [], None, "Missing holding or security data."

    original_face = holding.original_face_amount
    
    log.info(f"  Holding ExtTicket: {holding.external_ticket}, CUSIP: {security.cusip}, SettlementDate: {holding.settlement_date.isoformat() if holding.settlement_date else 'N/A'}")
    log.info(f"  Evaluation Date (Filters future flows): {evaluation_date.isoformat()}")
    log.info(f"  Security Details - PPY: {security.payments_per_year}, AllowsPaydown: {security.allows_paydown}, CPR: {security.cpr}, Factor: {security.factor}, Coupon: {security.coupon}")

    if original_face is None or original_face <= 0:
        log.error(f"generate_quantlib_cashflows: Invalid original_face_amount ({original_face}) for holding {holding.external_ticket}.")
        log.info(f"--- generate_quantlib_cashflows END (Error: Invalid Original Face) ---") 
        return [], [], None, f"Invalid original_face_amount for holding {holding.external_ticket}."
    if not security.maturity_date or not security.issue_date or security.maturity_date <= security.issue_date:
        log.error(f"generate_quantlib_cashflows: Invalid dates for CUSIP {security.cusip} (Holding ExtTicket: {holding.external_ticket}). Maturity: {security.maturity_date}, Issue: {security.issue_date}")
        log.info(f"--- generate_quantlib_cashflows END (Error: Invalid Dates) ---") 
        return [], [], None, f"Invalid dates for CUSIP {security.cusip} (Holding ExtTicket: {holding.external_ticket})."
    if security.payments_per_year is None: 
         log.error(f"generate_quantlib_cashflows: Missing payments_per_year for CUSIP {security.cusip} (Holding ExtTicket: {holding.external_ticket}).")
         log.info(f"--- generate_quantlib_cashflows END (Error: Missing PPY) ---") 
         return [], [], None, f"Missing payments_per_year for CUSIP {security.cusip} (Holding ExtTicket: {holding.external_ticket})."
    if holding.settlement_date is None:
        log.error(f"generate_quantlib_cashflows: Missing settlement_date for holding {holding.external_ticket}.")
        log.info(f"--- generate_quantlib_cashflows END (Error: Missing Holding Settlement Date) ---")
        return [], [], None, f"Missing settlement_date for holding {holding.external_ticket}."

    coupon_rate_decimal = security.coupon if security.coupon is not None else Decimal("0.0")

    try:
        ql_evaluation_date = ql.Date.from_date(evaluation_date)
        ql_holding_settlement_date = ql.Date.from_date(holding.settlement_date)
        ql_issue_date = ql.Date.from_date(security.issue_date)
        ql_maturity_date = ql.Date.from_date(security.maturity_date)
        
        ql_settlement_date_for_projection = ql_evaluation_date 
        
        if ql_evaluation_date < ql_issue_date:
            log.warning(f"CUSIP {security.cusip} (ExtTicket: {holding.external_ticket}): Evaluation date {evaluation_date.isoformat()} is before issue date {security.issue_date.isoformat()}. Adjusting projection start to issue date.")
            ql_settlement_date_for_projection = ql_issue_date
        if ql_evaluation_date > ql_maturity_date:
            log.warning(f"CUSIP {security.cusip} (ExtTicket: {holding.external_ticket}): Evaluation date {evaluation_date.isoformat()} is after maturity date {security.maturity_date.isoformat()}. No future cash flows expected.")
            log.info(f"--- generate_quantlib_cashflows END (Matured) ---") 
            return [], [], ql_evaluation_date, None 
            
        calendar = ql.UnitedStates(ql.UnitedStates.GovernmentBond) 
        convention = ql.Unadjusted 
        termination_convention = ql.Unadjusted 
        date_generation = ql.DateGeneration.Backward 
        if security.payments_per_year == 0 and coupon_rate_decimal == 0:
             log.debug(f"CUSIP {security.cusip} (ExtTicket: {holding.external_ticket}): Zero coupon bond (ppy=0). Using minimal schedule.")
             temp_frequency_for_schedule = ql.Annual 
        elif security.payments_per_year <= 0 and coupon_rate_decimal > 0:
            log.error(f"generate_quantlib_cashflows: CUSIP {security.cusip} (ExtTicket: {holding.external_ticket}): Invalid payments_per_year ({security.payments_per_year}) for a coupon-bearing bond.")
            log.info(f"--- generate_quantlib_cashflows END (Error: Invalid PPY for Coupon Bond) ---") 
            return [],[], None, f"Invalid payments_per_year ({security.payments_per_year}) for coupon bond {security.cusip}"
        elif security.payments_per_year < 0: 
             log.error(f"generate_quantlib_cashflows: CUSIP {security.cusip} (ExtTicket: {holding.external_ticket}): Negative payments_per_year ({security.payments_per_year}).")
             log.info(f"--- generate_quantlib_cashflows END (Error: Negative PPY) ---") 
             return [], [], None, f"Negative payments_per_year ({security.payments_per_year}) for {security.cusip}"
        else: 
            temp_frequency_for_schedule = get_quantlib_frequency(security.payments_per_year)
        day_counter = get_quantlib_day_counter(security.interest_calc_code)
        coupon_rate_float = float(coupon_rate_decimal / 100) 
        schedule = ql.Schedule(
            ql_issue_date, ql_maturity_date, ql.Period(temp_frequency_for_schedule), calendar,
            convention, termination_convention, date_generation, False 
        )
        log.debug(f"QuantLib Schedule created for {security.cusip} (ExtTicket: {holding.external_ticket}): {len(schedule)} payment dates using frequency derived from PPY: {security.payments_per_year}.")

        initial_factor = security.factor if security.factor is not None else Decimal("1.0")
        if not isinstance(initial_factor, Decimal):
            try: initial_factor = Decimal(str(initial_factor))
            except (InvalidOperation, TypeError, ValueError):
                log.warning(f"CUSIP {security.cusip} (ExtTicket: {holding.external_ticket}): Could not convert factor '{security.factor}' to Decimal. Using 1.0.")
                initial_factor = Decimal("1.0")
        current_principal_outstanding = float(original_face * initial_factor)
        log.debug(f"CUSIP {security.cusip} (ExtTicket: {holding.external_ticket}): Initial Factor={initial_factor}, Original Face={original_face}, Starting Principal Outstanding={current_principal_outstanding:.2f}")
        allows_paydown = security.allows_paydown
        cpr_annual_rate = 0.0
        periodic_prepayment_rate = 0.0
        log.info(f"  CPR Check - Allows Paydown: {allows_paydown}, CPR Value: {security.cpr}, PPY: {security.payments_per_year}")
        if allows_paydown and security.cpr is not None and security.cpr > 0:
            cpr_annual_rate = float(security.cpr / 100) 
            if security.payments_per_year is None or security.payments_per_year <= 0:
                periodic_prepayment_rate = 0.0
                log.warning(f"CUSIP {security.cusip} (ExtTicket: {holding.external_ticket}): Invalid payments_per_year ({security.payments_per_year}) for CPR calculation. Cannot calculate periodic prepayment rate. Setting to 0.")
            else:
                try: periodic_prepayment_rate = 1.0 - math.pow(1.0 - cpr_annual_rate, 1.0 / float(security.payments_per_year))
                except ValueError as e: 
                    log.error(f"CUSIP {security.cusip} (ExtTicket: {holding.external_ticket}): Math error calculating periodic prepayment rate (CPR={cpr_annual_rate*100:.2f}%). Setting rate to 0. Error: {e}")
                    periodic_prepayment_rate = 0.0
            log.info(f"  Calculated Periodic Prepayment Rate: {periodic_prepayment_rate*100:.6f}% (from Annual CPR: {cpr_annual_rate*100:.2f}%)")
        elif allows_paydown: log.debug(f"CUSIP {security.cusip} (ExtTicket: {holding.external_ticket}): Paydown allowed but CPR not provided or zero. No prepayments will be calculated based on CPR.")
        else: log.debug(f"CUSIP {security.cusip} (ExtTicket: {holding.external_ticket}): Not a paydown security. Principal at maturity (unless factor < 1 implies prior amortization).")

        combined_flows = [] 
        detailed_flows = [] 
        schedule_dates = list(schedule) 
        tolerance = 1e-6 
        first_interest_period_logged = False 

        for i in range(len(schedule_dates)):
            payment_date_ql = schedule_dates[i]
            if payment_date_ql <= ql_settlement_date_for_projection: 
                continue 
            if current_principal_outstanding < tolerance and payment_date_ql != ql_maturity_date : 
                 log.debug(f"CUSIP {security.cusip} (ExtTicket: {holding.external_ticket}): Principal outstanding is near zero ({current_principal_outstanding:.8f}) before maturity. Stopping flow generation for payment date {payment_date_ql.ISO()}.")
                 break
            period_start_date_for_interest = schedule_dates[i-1] if i > 0 else ql_issue_date
            period_start_date_for_interest = max(period_start_date_for_interest, ql_issue_date) 
            interest_amount_for_period = 0.0
            if coupon_rate_float > 0 and current_principal_outstanding > tolerance: 
                if period_start_date_for_interest < payment_date_ql : 
                    try:
                        year_fraction = day_counter.yearFraction(period_start_date_for_interest, payment_date_ql)
                        if not first_interest_period_logged:
                            log.info(f"  First Displayed Interest Calc Details - PeriodStart: {period_start_date_for_interest.ISO()}, PaymentDate: {payment_date_ql.ISO()}, DayCounter: {type(day_counter).__name__}, YearFraction: {year_fraction:.8f}")
                            first_interest_period_logged = True
                        interest_amount_for_period = current_principal_outstanding * coupon_rate_float * year_fraction
                        log.debug(f"  Interest Calc: Date {payment_date_ql.ISO()}, PeriodStart {period_start_date_for_interest.ISO()}, Principal {current_principal_outstanding:.2f}, Rate {coupon_rate_float:.4f}, YF {year_fraction:.8f}, Full Period Interest {interest_amount_for_period:.2f}")
                    except Exception as int_calc_e:
                        log.error(f"CUSIP {security.cusip} (ExtTicket: {holding.external_ticket}): Error calculating year fraction or interest for period {period_start_date_for_interest.ISO()} to {payment_date_ql.ISO()}. Error: {int_calc_e}")
                        interest_amount_for_period = 0.0
            principal_payment_for_period = 0.0 
            prepayment_for_period = 0.0       
            scheduled_principal_this_period = 0.0 
            if allows_paydown and periodic_prepayment_rate > 0 and current_principal_outstanding > tolerance:
                prepayment_for_period = current_principal_outstanding * periodic_prepayment_rate
                prepayment_for_period = min(prepayment_for_period, current_principal_outstanding) 
                principal_payment_for_period += prepayment_for_period
            if payment_date_ql == ql_maturity_date:
                principal_outstanding_after_prepayment = current_principal_outstanding - prepayment_for_period
                scheduled_maturity_principal = max(0.0, principal_outstanding_after_prepayment) 
                if scheduled_maturity_principal > tolerance:
                    principal_payment_for_period += scheduled_maturity_principal
                    scheduled_principal_this_period = scheduled_maturity_principal 
                elif current_principal_outstanding > tolerance: 
                     principal_payment_for_period = current_principal_outstanding 
                     scheduled_principal_this_period = max(0.0, principal_payment_for_period - prepayment_for_period)
            if abs(interest_amount_for_period) > tolerance:
                 detailed_flows.append(
                     (ql.SimpleCashFlow(interest_amount_for_period, payment_date_ql), 'Interest')
                 )
            if abs(principal_payment_for_period) > tolerance:
                detailed_flows.append(
                    (ql.SimpleCashFlow(principal_payment_for_period, payment_date_ql), 'Principal') 
                )
                log.debug(f"  Stored Principal Flow: Date {payment_date_ql.ISO()}, Total P {principal_payment_for_period:.2f} (Prepayment part: {prepayment_for_period:.2f}, Scheduled part: {scheduled_principal_this_period:.2f})")
            total_flow_amount_for_period = interest_amount_for_period + principal_payment_for_period
            if abs(total_flow_amount_for_period) > tolerance:
                combined_flows.append(ql.SimpleCashFlow(total_flow_amount_for_period, payment_date_ql))
            principal_paid_this_period_final = min(principal_payment_for_period, current_principal_outstanding)
            current_principal_outstanding -= principal_paid_this_period_final
            current_principal_outstanding = max(current_principal_outstanding, 0.0) 
            if current_principal_outstanding < tolerance and payment_date_ql >= ql_maturity_date: 
                log.debug(f"CUSIP {security.cusip} (ExtTicket: {holding.external_ticket}): Principal paid off at or after maturity ({payment_date_ql.ISO()}). Ending flow generation.")
                break
            elif current_principal_outstanding < tolerance and payment_date_ql < ql_maturity_date: 
                 log.debug(f"CUSIP {security.cusip} (ExtTicket: {holding.external_ticket}): Principal paid off before maturity ({payment_date_ql.ISO()}). Continuing to maturity date for any potential zero flows if schedule extends further.")
        log.info(f"  Generated {len(detailed_flows)} detailed flows ({len(combined_flows)} combined).")
        log.info(f"--- generate_quantlib_cashflows END ---")
        return combined_flows, detailed_flows, ql_settlement_date_for_projection, None 
    except Exception as e:
        # Ensure security object exists before trying to access security.cusip
        cusip_for_log = security.cusip if security else "Unknown CUSIP"
        ticket_for_log = holding.external_ticket if hasattr(holding, 'external_ticket') else "Unknown Ticket"
        log.exception(f"QuantLib Error generating cashflows for CUSIP {cusip_for_log} (Holding ExtTicket: {ticket_for_log}): {e}") 
        log.info(f"--- generate_quantlib_cashflows END (Error) ---") 
        return [], [], None, f"Error during cashflow generation: {e}" 

def calculate_bond_analytics(holding: CustomerHolding):
    results = { 'ytm': None, 'duration_modified': None, 'duration_macaulay': None, 'convexity': None, 'cash_flows': [], 'error': None }
    
    if not holding: 
        results['error'] = "Missing holding data."
        log.error("calculate_bond_analytics: Missing holding data.")
        log.debug(f"--- Finished analytics calculation (Error: Missing Holding) ---")
        return results

    log.debug(f"--- Starting analytics calculation for holding {holding.external_ticket if hasattr(holding, 'external_ticket') else 'Unknown Ticket'} ---")

    try:
        # Attempt to access holding.security. This might raise RelatedObjectDoesNotExist
        # if the holding is unsaved and security is None, or if security_id is not set.
        security = holding.security
        if not security: # Handles case where security is None even if RelatedObjectDoesNotExist is not raised
             raise AttributeError("Security attribute is None.")
    except (CustomerHolding.security.RelatedObjectDoesNotExist, AttributeError) as e:
        ticket_id = holding.external_ticket if hasattr(holding, 'external_ticket') else 'Unknown Ticket'
        results['error'] = f"Missing security data for holding {ticket_id}."
        log.error(f"calculate_bond_analytics: Missing security data for holding {ticket_id}. Exception: {e}")
        log.debug(f"--- Finished analytics calculation for holding {ticket_id} (Error: Missing Security) ---")
        return results
        
    log.debug(f"Holding Input - ExtTicket: {holding.external_ticket}, Original Face: {holding.original_face_amount}, Market Price: {holding.market_price}, Market Date: {holding.market_date}")
    log.debug(f"Security Input - CUSIP: {security.cusip}, Coupon: {security.coupon}, PPY: {security.payments_per_year}, IntCalcCode: {security.interest_calc_code}, Allows Paydown: {security.allows_paydown}, CPR: {security.cpr}, Factor: {security.factor}")

    if holding.market_price is None or holding.market_price <= 0: 
        results['error'] = "Missing or invalid market price for calculation."
        log.warning(f"calculate_bond_analytics: Holding {holding.external_ticket}: Missing or invalid market price ({holding.market_price}).")
        log.debug(f"--- Finished analytics calculation for holding {holding.external_ticket} (Error: Invalid Market Price) ---")
        return results
    if holding.original_face_amount is None or holding.original_face_amount <= 0: 
        results['error'] = f"Missing or invalid original_face_amount for holding {holding.external_ticket}."
        log.error(f"calculate_bond_analytics: Holding {holding.external_ticket}: Missing or invalid original_face_amount ({holding.original_face_amount}).")
        log.debug(f"--- Finished analytics calculation for holding {holding.external_ticket} (Error: Invalid Original Face) ---")
        return results

    market_price_per_100_original = float(holding.market_price)
    market_price_for_calc = market_price_per_100_original 
    log.debug(f"Holding {holding.external_ticket}: Clean Market Price (per 100 original face) used for Calc={market_price_for_calc}")
    
    evaluation_date_for_analytics = holding.market_date if holding.market_date else date.today()
    try: 
        ql_evaluation_date_for_analytics = ql.Date.from_date(evaluation_date_for_analytics)
    except Exception as date_conv_e: 
        log.error(f"Invalid market_date {holding.market_date} for holding {holding.external_ticket}. Error: {date_conv_e}. Using today for analytics.")
        evaluation_date_for_analytics = date.today()
        ql_evaluation_date_for_analytics = ql.Date.from_date(evaluation_date_for_analytics)
    
    log.debug(f"Holding {holding.external_ticket}: Analytics Evaluation/Settlement Date (tentative, see Point 6): {evaluation_date_for_analytics.isoformat()}")
    log.debug(f"Holding {holding.external_ticket}: Generating cash flows for analytics using evaluation date: {evaluation_date_for_analytics.isoformat()}...")
    
    ql_combined_flows_actual, ql_detailed_flows, ql_analytics_settlement_date, cf_error = generate_quantlib_cashflows(holding, evaluation_date_for_analytics)
    
    if cf_error: 
        results['error'] = f"Cash flow generation failed for analytics: {cf_error}"
        log.warning(f"Analytics calculation aborted for {holding.external_ticket}: Cash flow generation failed during analytics prep. Error: {cf_error}")
        log.debug(f"--- Finished analytics calculation for holding {holding.external_ticket} (Error: CF Generation) ---")
        return results
    if not ql_combined_flows_actual: 
        results['error'] = "No future cash flows generated for analytics (bond might have matured or other issue)."
        log.warning(f"Analytics calculation aborted for {holding.external_ticket}: No future cash flows generated for analytics evaluation date {evaluation_date_for_analytics.isoformat()}.")
        log.debug(f"--- Finished analytics calculation for holding {holding.external_ticket} (Error: No CFs) ---")
        return results
        
    log.debug(f"Holding {holding.external_ticket}: Generated {len(ql_combined_flows_actual)} actual combined flows for analytics. Analytics Settlement Date from CF gen: {ql_analytics_settlement_date.ISO()}")
    
    try:
        results['cash_flows'] = [ {"date": f[0].date().to_date().isoformat(), "amount": str(Decimal(str(f[0].amount())).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)), "type": f[1]} for f in ql_detailed_flows ]
    except Exception as fmt_e: 
        log.error(f"Error formatting cash flows for holding {holding.external_ticket}: {fmt_e}", exc_info=True)
        results['cash_flows'] = [] 
        # Optionally, you might want to set results['error'] here too if formatting is critical
        # results['error'] = "Error formatting cash flow results."
        # return results # If formatting error should halt further calculation

    try:
        face_value_scale_factor_for_analytics = float(holding.original_face_amount / Decimal("100.0"))
        if abs(face_value_scale_factor_for_analytics) < 1e-9: 
            raise ValueError("Cannot scale flows for analytics, original face amount is zero or too small.")
        ql_combined_flows_scaled_for_analytics = [ ql.SimpleCashFlow(cf.amount() / face_value_scale_factor_for_analytics, cf.date()) for cf in ql_combined_flows_actual ]
        log.debug(f"Scaled {len(ql_combined_flows_actual)} actual combined flows by factor {face_value_scale_factor_for_analytics} for analytics.")
    except Exception as scale_e: 
        results['error'] = f"Error scaling cash flows for analytics: {scale_e}"
        log.error(f"Analytics calculation aborted for {holding.external_ticket}: Error scaling cash flows for analytics.", exc_info=True)
        log.debug(f"--- Finished analytics calculation for holding {holding.external_ticket} (Error: Scaling CFs) ---")
        return results
        
    try:
        ql.Settings.instance().evaluationDate = ql_analytics_settlement_date 
        day_counter_for_analytics = get_quantlib_day_counter(security.interest_calc_code)
        compounding_for_analytics = ql.Compounded 
        
        if security.payments_per_year is None or security.payments_per_year <= 0: 
            log.warning(f"CUSIP {security.cusip} (ExtTicket: {holding.external_ticket}): Invalid payments_per_year ({security.payments_per_year}) for YTM frequency. Defaulting to Annual compounding.")
            frequency_for_analytics = ql.Annual 
        else: 
            frequency_for_analytics = get_quantlib_frequency(security.payments_per_year)
            
        accuracy = 1.0e-10
        max_iterations = 500 
        coupon_rate_for_guess = security.coupon if security.coupon is not None else Decimal("5.0") 
        guess_yield = float(coupon_rate_for_guess / 100)
        if abs(guess_yield) < 1e-9: guess_yield = 0.02 
        
        log.critical(f"CRITICAL ACCURACY WARNING for YTM - Holding {holding.external_ticket} (CUSIP: {security.cusip}): ql.CashFlows.yieldRate is being called with market_price_for_calc='{market_price_for_calc}' (assumed CLEAN price). This function typically expects a DIRTY PRICE (Clean Price + Accrued Interest) when its 'includeSettlementDateFlows' argument is False. The calculated YTM, Duration, and Convexity WILL BE INACCURATE. ACTION REQUIRED: Review consultant feedback point 7. Implement accrued interest calculation for a dirty price, OR refactor to use QuantLib bond instrument objects (e.g., ql.FixedRateBond) for correct analytics from a clean price.")
        
        ytm_rate = ql.CashFlows.yieldRate( ql_combined_flows_scaled_for_analytics, market_price_for_calc, day_counter_for_analytics, compounding_for_analytics, frequency_for_analytics, False, ql_analytics_settlement_date, ql_analytics_settlement_date, accuracy, max_iterations, guess_yield )
        
        min_reasonable_ytm = -0.99; max_reasonable_ytm = 2.00  
        if not math.isfinite(ytm_rate) or not (min_reasonable_ytm <= ytm_rate <= max_reasonable_ytm):
            log.warning(f"YTM calculation resulted in invalid or unreasonable value ({ytm_rate:.8f}) for holding {holding.external_ticket}. Price: {market_price_for_calc}, Guess: {guess_yield}. This could be due to the clean price issue or extreme cash flows.")
            results['error'] = f"YTM calculation failed (resulted in invalid or unreasonable value: {ytm_rate:.6f}). Check price, cash flows, and CRITICAL clean/dirty price warning."
            log.debug(f"--- Finished analytics calculation for holding {holding.external_ticket} (Error: Invalid YTM) ---")
            return results 
            
        results['ytm'] = Decimal(str(ytm_rate * 100)).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
        log.info(f"Holding {holding.external_ticket}: YTM Calculation (WITH POTENTIAL INACCURACY DUE TO CLEAN PRICE - SEE CRITICAL WARNING): {results['ytm']}%")
        
        interest_rate_for_duration = ql.InterestRate(ytm_rate, day_counter_for_analytics, compounding_for_analytics, frequency_for_analytics)
        log.debug(f"Calculating Modified Duration with potentially inaccurate YTM={ytm_rate} using settlement date {ql_analytics_settlement_date.ISO()}...")
        results['duration_modified'] = Decimal(str(ql.CashFlows.duration( ql_combined_flows_scaled_for_analytics, interest_rate_for_duration, ql.Duration.Modified, False, ql_analytics_settlement_date ))).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
        log.debug(f"Calculating Macaulay Duration with potentially inaccurate YTM={ytm_rate} using settlement date {ql_analytics_settlement_date.ISO()}...")
        results['duration_macaulay'] = Decimal(str(ql.CashFlows.duration( ql_combined_flows_scaled_for_analytics, interest_rate_for_duration, ql.Duration.Macaulay, False, ql_analytics_settlement_date ))).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
        log.debug(f"Calculating Convexity with potentially inaccurate YTM={ytm_rate} using settlement date {ql_analytics_settlement_date.ISO()}...")
        results['convexity'] = Decimal(str(ql.CashFlows.convexity( ql_combined_flows_scaled_for_analytics, interest_rate_for_duration, False, ql_analytics_settlement_date ))).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
        log.info(f"Successfully calculated analytics for holding {holding.external_ticket} (YTM, Duration, Convexity ACCURACY DEPENDS ON CORRECT DIRTY PRICE - SEE CRITICAL WARNING).")
    
    except RuntimeError as ql_runtime_error:
         error_msg = f"QuantLib calculation error for holding {holding.external_ticket} (Price: {market_price_for_calc}, Guess: {guess_yield}): {ql_runtime_error}"
         log.error(error_msg, exc_info=False) 
         if "root not bracketed" in str(ql_runtime_error).lower(): 
             results['error'] = "Calculation error: Yield solver could not bracket the root. Check market price vs scaled cash flows. (Review clean/dirty price warning)."
         elif "convergence not reached" in str(ql_runtime_error).lower() or \
              "max number of iterations reached" in str(ql_runtime_error).lower() or \
              "maximum evaluations exceeded" in str(ql_runtime_error).lower() : 
             results['error'] = "Calculation error: Yield solver did not converge. (Review clean/dirty price warning)."
         else: 
             results['error'] = f"QuantLib calculation error: {ql_runtime_error}. (Review clean/dirty price warning)."
    except Exception as e:
        error_msg = f"Unexpected Python error during analytics calculation for holding {holding.external_ticket}: {e}"
        log.exception(error_msg) 
        results['error'] = "An unexpected error occurred during calculation."
    
    log.debug(f"--- Finished analytics calculation for holding {holding.external_ticket} ---")
    return results
