"""AI Forecasting service for expense/revenue predictions"""
from datetime import datetime, timedelta, timezone
from typing import List, Dict, Optional
from collections import defaultdict
import statistics

class ForecastService:
    def __init__(self, db):
        self.db = db
    
    async def get_expense_forecast(
        self,
        company_id: str,
        months_ahead: int = 3
    ) -> Dict:
        """Predict future expenses based on historical data"""
        # Get historical data (last 6 months)
        six_months_ago = datetime.now(timezone.utc) - timedelta(days=180)
        
        # Get invoice expenses
        invoices = await self.db.invoices.find(
            {"company_id": company_id, "date": {"$gte": six_months_ago}},
            {"_id": 0, "date": 1, "total_amount": 1}
        ).to_list(10000)
        
        # Get non-invoice expenses
        expenses = await self.db.non_invoice_expenses.find(
            {"company_id": company_id, "date": {"$gte": six_months_ago}},
            {"_id": 0, "date": 1, "amount": 1}
        ).to_list(10000)
        
        # Aggregate by month
        monthly_totals = defaultdict(float)
        
        for inv in invoices:
            date = inv.get("date")
            if isinstance(date, datetime):
                month_key = date.strftime("%Y-%m")
                monthly_totals[month_key] += float(inv.get("total_amount", 0))
        
        for exp in expenses:
            date = exp.get("date")
            if isinstance(date, datetime):
                month_key = date.strftime("%Y-%m")
                monthly_totals[month_key] += float(exp.get("amount", 0))
        
        if not monthly_totals:
            return {
                "historical": [],
                "forecast": [],
                "avg_monthly": 0,
                "trend": "stable",
                "confidence": 0
            }
        
        # Sort by month
        sorted_months = sorted(monthly_totals.keys())
        historical = [{"month": m, "amount": monthly_totals[m]} for m in sorted_months]
        
        # Calculate statistics
        amounts = list(monthly_totals.values())
        avg_monthly = statistics.mean(amounts) if amounts else 0
        std_dev = statistics.stdev(amounts) if len(amounts) > 1 else 0
        
        # Simple linear trend
        if len(amounts) >= 3:
            first_half = statistics.mean(amounts[:len(amounts)//2])
            second_half = statistics.mean(amounts[len(amounts)//2:])
            trend_percent = ((second_half - first_half) / first_half * 100) if first_half > 0 else 0
            
            if trend_percent > 10:
                trend = "increasing"
            elif trend_percent < -10:
                trend = "decreasing"
            else:
                trend = "stable"
        else:
            trend = "stable"
            trend_percent = 0
        
        # Generate forecast
        forecast = []
        current_date = datetime.now(timezone.utc)
        monthly_growth = 1 + (trend_percent / 100 / 12) if trend != "stable" else 1
        
        for i in range(1, months_ahead + 1):
            future_date = current_date + timedelta(days=30 * i)
            month_key = future_date.strftime("%Y-%m")
            predicted = avg_monthly * (monthly_growth ** i)
            
            forecast.append({
                "month": month_key,
                "predicted_amount": round(predicted, 2),
                "lower_bound": round(max(0, predicted - std_dev), 2),
                "upper_bound": round(predicted + std_dev, 2)
            })
        
        # Confidence based on data quality
        confidence = min(0.9, len(amounts) / 6)  # More months = higher confidence
        
        return {
            "historical": historical,
            "forecast": forecast,
            "avg_monthly": round(avg_monthly, 2),
            "trend": trend,
            "trend_percent": round(trend_percent, 1),
            "confidence": round(confidence, 2)
        }
    
    async def get_revenue_forecast(
        self,
        company_id: str,
        months_ahead: int = 3
    ) -> Dict:
        """Predict future revenue based on historical data"""
        six_months_ago = datetime.now(timezone.utc) - timedelta(days=180)
        
        revenues = await self.db.daily_revenues.find(
            {"company_id": company_id, "date": {"$gte": six_months_ago}},
            {"_id": 0, "date": 1, "fiscal_revenue": 1}
        ).to_list(10000)
        
        # Aggregate by month
        monthly_totals = defaultdict(float)
        
        for rev in revenues:
            date = rev.get("date")
            if isinstance(date, datetime):
                month_key = date.strftime("%Y-%m")
                monthly_totals[month_key] += float(rev.get("fiscal_revenue", 0))
        
        if not monthly_totals:
            return {
                "historical": [],
                "forecast": [],
                "avg_monthly": 0,
                "trend": "stable",
                "confidence": 0
            }
        
        sorted_months = sorted(monthly_totals.keys())
        historical = [{"month": m, "amount": monthly_totals[m]} for m in sorted_months]
        
        amounts = list(monthly_totals.values())
        avg_monthly = statistics.mean(amounts) if amounts else 0
        std_dev = statistics.stdev(amounts) if len(amounts) > 1 else 0
        
        # Trend analysis
        if len(amounts) >= 3:
            first_half = statistics.mean(amounts[:len(amounts)//2])
            second_half = statistics.mean(amounts[len(amounts)//2:])
            trend_percent = ((second_half - first_half) / first_half * 100) if first_half > 0 else 0
            
            if trend_percent > 10:
                trend = "increasing"
            elif trend_percent < -10:
                trend = "decreasing"
            else:
                trend = "stable"
        else:
            trend = "stable"
            trend_percent = 0
        
        # Generate forecast
        forecast = []
        current_date = datetime.now(timezone.utc)
        monthly_growth = 1 + (trend_percent / 100 / 12) if trend != "stable" else 1
        
        for i in range(1, months_ahead + 1):
            future_date = current_date + timedelta(days=30 * i)
            month_key = future_date.strftime("%Y-%m")
            predicted = avg_monthly * (monthly_growth ** i)
            
            forecast.append({
                "month": month_key,
                "predicted_amount": round(predicted, 2),
                "lower_bound": round(max(0, predicted - std_dev), 2),
                "upper_bound": round(predicted + std_dev, 2)
            })
        
        confidence = min(0.9, len(amounts) / 6)
        
        return {
            "historical": historical,
            "forecast": forecast,
            "avg_monthly": round(avg_monthly, 2),
            "trend": trend,
            "trend_percent": round(trend_percent, 1),
            "confidence": round(confidence, 2)
        }
