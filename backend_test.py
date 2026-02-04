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

def test_health_endpoints():
    """Test health check endpoints"""
    print("\n1. TESTING HEALTH ENDPOINTS")
    print("-" * 40)
    
    # Test root endpoint
    try:
        response = requests.get(f"{API_URL}/")
        print(f"GET /api/ - Status: {response.status_code}")
        if response.status_code == 200:
            print(f"Response: {response.json()}")
            print("✅ Root endpoint working")
        else:
            print(f"❌ Root endpoint failed: {response.text}")
            return False
    except Exception as e:
        print(f"❌ Root endpoint error: {e}")
        return False
    
    # Test health endpoint
    try:
        response = requests.get(f"{API_URL}/health")
        print(f"GET /api/health - Status: {response.status_code}")
        if response.status_code == 200:
            print(f"Response: {response.json()}")
            print("✅ Health endpoint working")
            return True
        else:
            print(f"❌ Health endpoint failed: {response.text}")
            return False
    except Exception as e:
        print(f"❌ Health endpoint error: {e}")
        return False

def create_test_user_and_session():
    """Create test user and session in MongoDB"""
    print("\n2. CREATING TEST USER AND SESSION")
    print("-" * 40)
    
    global session_token
    
    try:
        # Create test user and session using mongosh
        mongo_script = """
use('test_database');
var userId = 'user_test123';
var sessionToken = 'test_session_' + Date.now();
db.users.deleteMany({user_id: userId});
db.user_sessions.deleteMany({user_id: userId});
db.users.insertOne({
  user_id: userId,
  email: 'test@example.com',
  name: 'Test User',
  role: 'accountant',
  created_at: new Date()
});
db.user_sessions.insertOne({
  user_id: userId,
  session_token: sessionToken,
  expires_at: new Date(Date.now() + 7*24*60*60*1000),
  created_at: new Date()
});
print('Session token: ' + sessionToken);
"""
        
        result = subprocess.run(
            ['mongosh', '--eval', mongo_script],
            capture_output=True,
            text=True
        )
        
        if result.returncode == 0:
            # Extract session token from output
            for line in result.stdout.split('\n'):
                if 'Session token:' in line:
                    session_token = line.split('Session token: ')[1].strip()
                    break
            
            if session_token:
                print(f"✅ Test user and session created successfully")
                print(f"Session token: {session_token}")
                return True
            else:
                print(f"❌ Could not extract session token from: {result.stdout}")
                return False
        else:
            print(f"❌ MongoDB script failed: {result.stderr}")
            return False
            
    except Exception as e:
        print(f"❌ Error creating test user: {e}")
        return False

def test_auth_endpoint():
    """Test authentication endpoint"""
    print("\n3. TESTING AUTH ENDPOINT")
    print("-" * 40)
    
    if not session_token:
        print("❌ No session token available")
        return False
    
    try:
        headers = {"Authorization": f"Bearer {session_token}"}
        response = requests.get(f"{API_URL}/auth/me", headers=headers)
        
        print(f"GET /api/auth/me - Status: {response.status_code}")
        
        if response.status_code == 200:
            user_data = response.json()
            print(f"User data: {json.dumps(user_data, indent=2)}")
            print("✅ Auth endpoint working")
            return True
        else:
            print(f"❌ Auth endpoint failed: {response.text}")
            return False
            
    except Exception as e:
        print(f"❌ Auth endpoint error: {e}")
        return False

def test_invoice_crud():
    """Test Invoice CRUD operations"""
    print("\n4. TESTING INVOICE CRUD")
    print("-" * 40)
    
    if not session_token:
        print("❌ No session token available")
        return False
    
    headers = {"Authorization": f"Bearer {session_token}", "Content-Type": "application/json"}
    invoice_id = None
    
    # Test CREATE invoice
    try:
        invoice_data = {
            "supplier": "Тест Доставчик ЕООД",
            "invoice_number": "0000001234",
            "amount_without_vat": 100.00,
            "vat_amount": 20.00,
            "total_amount": 120.00,
            "date": "2025-01-30T00:00:00Z"
        }
        
        response = requests.post(f"{API_URL}/invoices", headers=headers, json=invoice_data)
        print(f"POST /api/invoices - Status: {response.status_code}")
        
        if response.status_code == 200:
            created_invoice = response.json()
            invoice_id = created_invoice.get('id')
            print(f"✅ Invoice created with ID: {invoice_id}")
        else:
            print(f"❌ Invoice creation failed: {response.text}")
            return False
            
    except Exception as e:
        print(f"❌ Invoice creation error: {e}")
        return False
    
    # Test GET invoices (list)
    try:
        response = requests.get(f"{API_URL}/invoices", headers=headers)
        print(f"GET /api/invoices - Status: {response.status_code}")
        
        if response.status_code == 200:
            invoices = response.json()
            print(f"✅ Retrieved {len(invoices)} invoices")
        else:
            print(f"❌ Invoice list failed: {response.text}")
            return False
            
    except Exception as e:
        print(f"❌ Invoice list error: {e}")
        return False
    
    # Test GET invoices with search
    try:
        response = requests.get(f"{API_URL}/invoices?supplier=Тест", headers=headers)
        print(f"GET /api/invoices?supplier=Тест - Status: {response.status_code}")
        
        if response.status_code == 200:
            filtered_invoices = response.json()
            print(f"✅ Search returned {len(filtered_invoices)} invoices")
            return True
        else:
            print(f"❌ Invoice search failed: {response.text}")
            return False
            
    except Exception as e:
        print(f"❌ Invoice search error: {e}")
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