#!/usr/bin/env python3
"""
Backend API Testing for Bulgarian Invoice Management System
Focus: Testing new advanced supplier statistics endpoints
"""

import requests
import json
import os
import sys
from datetime import datetime, timezone
import subprocess

# Get backend URL from frontend .env file
def get_backend_url():
    try:
        with open('/app/frontend/.env', 'r') as f:
            for line in f:
                if line.startswith('EXPO_PUBLIC_BACKEND_URL='):
                    return line.split('=', 1)[1].strip()
    except Exception as e:
        print(f"Error reading frontend .env: {e}")
    return "https://invoicer-25.preview.emergentagent.com"

BASE_URL = get_backend_url()
API_URL = f"{BASE_URL}/api"

print(f"Testing Bulgarian Invoice Management API at: {API_URL}")
print("Focus: Advanced Supplier Statistics Endpoints")
print("=" * 60)

# Global session token for authenticated requests
session_token = None

def register_test_user():
    """Register a test user as specified in review request"""
    print("\n1. REGISTERING TEST USER")
    print("-" * 40)
    
    global session_token
    
    try:
        user_data = {
            "email": "test@test.com",
            "password": "Test1234",
            "name": "Test User"
        }
        
        response = requests.post(f"{API_URL}/auth/register", json=user_data)
        print(f"POST /api/auth/register - Status: {response.status_code}")
        
        if response.status_code == 200:
            result = response.json()
            session_token = result.get('session_token')
            print(f"✅ User registered successfully")
            print(f"Session token: {session_token}")
            return True
        else:
            print(f"❌ User registration failed: {response.text}")
            return False
            
    except Exception as e:
        print(f"❌ User registration error: {e}")
        return False

def create_test_invoice():
    """Create a test invoice to have data for supplier statistics"""
    print("\n2. CREATING TEST INVOICE")
    print("-" * 40)
    
    if not session_token:
        print("❌ No session token available")
        return False
    
    headers = {"Authorization": f"Bearer {session_token}", "Content-Type": "application/json"}
    
    try:
        invoice_data = {
            "supplier": "Test Supplier",
            "invoice_number": "INV001",
            "amount_without_vat": 100,
            "vat_amount": 20,
            "total_amount": 120,
            "date": "2025-02-01T00:00:00Z"
        }
        
        response = requests.post(f"{API_URL}/invoices", headers=headers, json=invoice_data)
        print(f"POST /api/invoices - Status: {response.status_code}")
        
        if response.status_code == 200:
            created_invoice = response.json()
            print(f"✅ Test invoice created: {created_invoice.get('invoice_number')}")
            return True
        else:
            print(f"❌ Invoice creation failed: {response.text}")
            return False
            
    except Exception as e:
        print(f"❌ Invoice creation error: {e}")
        return False

def test_supplier_statistics():
    """Test GET /api/statistics/suppliers endpoint"""
    print("\n3. TESTING SUPPLIER STATISTICS ENDPOINT")
    print("-" * 40)
    
    if not session_token:
        print("❌ No session token available")
        return False
    
    headers = {"Authorization": f"Bearer {session_token}"}
    
    try:
        response = requests.get(f"{API_URL}/statistics/suppliers", headers=headers)
        print(f"GET /api/statistics/suppliers - Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            print(f"✅ Supplier statistics retrieved successfully")
            
            # Verify expected response structure
            expected_keys = [
                "period", "executive_summary", "totals", 
                "top_by_amount", "top_by_frequency", "top_by_avg",
                "inactive_suppliers", "high_dependency_alerts"
            ]
            
            missing_keys = [key for key in expected_keys if key not in data]
            if missing_keys:
                print(f"⚠️ Missing expected keys: {missing_keys}")
                return False
            
            # Verify executive_summary structure
            exec_summary = data.get("executive_summary", {})
            exec_keys = [
                "top_3_concentration", "top_5_concentration", "total_suppliers",
                "active_suppliers", "inactive_suppliers", "high_dependency_count",
                "largest_supplier", "largest_amount"
            ]
            
            missing_exec_keys = [key for key in exec_keys if key not in exec_summary]
            if missing_exec_keys:
                print(f"⚠️ Missing executive_summary keys: {missing_exec_keys}")
                return False
            
            print(f"✅ Response structure is correct")
            print(f"Total suppliers: {exec_summary.get('total_suppliers', 0)}")
            print(f"Active suppliers: {exec_summary.get('active_suppliers', 0)}")
            return True
        else:
            print(f"❌ Supplier statistics failed: {response.text}")
            return False
            
    except Exception as e:
        print(f"❌ Supplier statistics error: {e}")
        return False

def test_detailed_supplier_stats():
    """Test GET /api/statistics/supplier/{supplier_name}/detailed endpoint"""
    print("\n4. TESTING DETAILED SUPPLIER STATISTICS")
    print("-" * 40)
    
    if not session_token:
        print("❌ No session token available")
        return False
    
    headers = {"Authorization": f"Bearer {session_token}"}
    supplier_name = "Test Supplier"  # Using the supplier from our test invoice
    
    try:
        response = requests.get(f"{API_URL}/statistics/supplier/{supplier_name}/detailed", headers=headers)
        print(f"GET /api/statistics/supplier/{supplier_name}/detailed - Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            print(f"✅ Detailed supplier statistics retrieved successfully")
            
            # Verify response structure
            if data.get("found"):
                expected_keys = ["supplier", "found", "overview", "monthly_trend", "anomalies", "recent_invoices"]
                missing_keys = [key for key in expected_keys if key not in data]
                if missing_keys:
                    print(f"⚠️ Missing expected keys: {missing_keys}")
                    return False
                
                overview = data.get("overview", {})
                overview_keys = [
                    "total_amount", "total_vat", "total_net", "invoice_count",
                    "avg_invoice", "first_delivery", "last_delivery", "is_active", "days_inactive"
                ]
                missing_overview_keys = [key for key in overview_keys if key not in overview]
                if missing_overview_keys:
                    print(f"⚠️ Missing overview keys: {missing_overview_keys}")
                    return False
                
                print(f"✅ Detailed response structure is correct")
                print(f"Supplier: {data.get('supplier')}")
                print(f"Invoice count: {overview.get('invoice_count', 0)}")
                print(f"Total amount: {overview.get('total_amount', 0)}")
                return True
            else:
                print(f"✅ Supplier not found response is correct")
                return True
        else:
            print(f"❌ Detailed supplier statistics failed: {response.text}")
            return False
            
    except Exception as e:
        print(f"❌ Detailed supplier statistics error: {e}")
        return False

def test_daily_revenue():
    """Test Daily Revenue endpoint"""
    print("\n5. TESTING DAILY REVENUE")
    print("-" * 40)
    
    if not session_token:
        print("❌ No session token available")
        return False
    
    headers = {"Authorization": f"Bearer {session_token}", "Content-Type": "application/json"}
    
    try:
        revenue_data = {
            "date": "2025-01-30",
            "fiscal_revenue": 500.00,
            "pocket_money": 100.00
        }
        
        response = requests.post(f"{API_URL}/daily-revenue", headers=headers, json=revenue_data)
        print(f"POST /api/daily-revenue - Status: {response.status_code}")
        
        if response.status_code == 200:
            created_revenue = response.json()
            print(f"✅ Daily revenue created: {json.dumps(created_revenue, indent=2)}")
            return True
        else:
            print(f"❌ Daily revenue creation failed: {response.text}")
            return False
            
    except Exception as e:
        print(f"❌ Daily revenue error: {e}")
        return False

def test_expenses():
    """Test Expenses (В канала) endpoint"""
    print("\n6. TESTING EXPENSES")
    print("-" * 40)
    
    if not session_token:
        print("❌ No session token available")
        return False
    
    headers = {"Authorization": f"Bearer {session_token}", "Content-Type": "application/json"}
    
    try:
        expense_data = {
            "description": "Гориво за кола",
            "amount": 80.00,
            "date": "2025-01-30"
        }
        
        response = requests.post(f"{API_URL}/expenses", headers=headers, json=expense_data)
        print(f"POST /api/expenses - Status: {response.status_code}")
        
        if response.status_code == 200:
            created_expense = response.json()
            print(f"✅ Expense created: {json.dumps(created_expense, indent=2)}")
            return True
        else:
            print(f"❌ Expense creation failed: {response.text}")
            return False
            
    except Exception as e:
        print(f"❌ Expense error: {e}")
        return False

def test_statistics():
    """Test Statistics endpoints"""
    print("\n7. TESTING STATISTICS")
    print("-" * 40)
    
    if not session_token:
        print("❌ No session token available")
        return False
    
    headers = {"Authorization": f"Bearer {session_token}"}
    
    # Test summary statistics
    try:
        response = requests.get(f"{API_URL}/statistics/summary", headers=headers)
        print(f"GET /api/statistics/summary - Status: {response.status_code}")
        
        if response.status_code == 200:
            summary = response.json()
            print(f"✅ Statistics summary: {json.dumps(summary, indent=2)}")
        else:
            print(f"❌ Statistics summary failed: {response.text}")
            return False
            
    except Exception as e:
        print(f"❌ Statistics summary error: {e}")
        return False
    
    # Test chart data
    try:
        response = requests.get(f"{API_URL}/statistics/chart-data?period=week", headers=headers)
        print(f"GET /api/statistics/chart-data?period=week - Status: {response.status_code}")
        
        if response.status_code == 200:
            chart_data = response.json()
            print(f"✅ Chart data retrieved: {len(chart_data)} data points")
            return True
        else:
            print(f"❌ Chart data failed: {response.text}")
            return False
            
    except Exception as e:
        print(f"❌ Chart data error: {e}")
        return False

def test_export():
    """Test Export endpoints"""
    print("\n8. TESTING EXPORT")
    print("-" * 40)
    
    if not session_token:
        print("❌ No session token available")
        return False
    
    headers = {"Authorization": f"Bearer {session_token}"}
    
    # Test Excel export
    try:
        response = requests.get(f"{API_URL}/export/excel", headers=headers)
        print(f"GET /api/export/excel - Status: {response.status_code}")
        
        if response.status_code == 200:
            content_type = response.headers.get('content-type', '')
            if 'spreadsheet' in content_type or 'excel' in content_type:
                print(f"✅ Excel export working - Content-Type: {content_type}")
            else:
                print(f"⚠️ Excel export returned unexpected content type: {content_type}")
        else:
            print(f"❌ Excel export failed: {response.text}")
            return False
            
    except Exception as e:
        print(f"❌ Excel export error: {e}")
        return False
    
    # Test PDF export
    try:
        response = requests.get(f"{API_URL}/export/pdf", headers=headers)
        print(f"GET /api/export/pdf - Status: {response.status_code}")
        
        if response.status_code == 200:
            content_type = response.headers.get('content-type', '')
            if 'pdf' in content_type:
                print(f"✅ PDF export working - Content-Type: {content_type}")
                return True
            else:
                print(f"⚠️ PDF export returned unexpected content type: {content_type}")
                return True
        else:
            print(f"❌ PDF export failed: {response.text}")
            return False
            
    except Exception as e:
        print(f"❌ PDF export error: {e}")
        return False

def main():
    """Run all tests"""
    print("BULGARIAN INVOICE MANAGEMENT BACKEND API TESTS")
    print("=" * 60)
    
    test_results = {}
    
    # Run all tests
    test_results['health'] = test_health_endpoints()
    test_results['user_session'] = create_test_user_and_session()
    test_results['auth'] = test_auth_endpoint()
    test_results['invoice_crud'] = test_invoice_crud()
    test_results['daily_revenue'] = test_daily_revenue()
    test_results['expenses'] = test_expenses()
    test_results['statistics'] = test_statistics()
    test_results['export'] = test_export()
    
    # Summary
    print("\n" + "=" * 60)
    print("TEST SUMMARY")
    print("=" * 60)
    
    passed = 0
    total = len(test_results)
    
    for test_name, result in test_results.items():
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"{test_name.upper().replace('_', ' ')}: {status}")
        if result:
            passed += 1
    
    print(f"\nOverall: {passed}/{total} tests passed")
    
    if passed == total:
        print("🎉 All backend tests PASSED!")
        return True
    else:
        print("⚠️ Some backend tests FAILED!")
        return False

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)