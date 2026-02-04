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

def test_compare_suppliers():
    """Test GET /api/statistics/suppliers/compare endpoint"""
    print("\n5. TESTING SUPPLIER COMPARISON")
    print("-" * 40)
    
    if not session_token:
        print("❌ No session token available")
        return False
    
    headers = {"Authorization": f"Bearer {session_token}"}
    
    # First create another test invoice with different supplier
    try:
        invoice_data = {
            "supplier": "Another Supplier Ltd",
            "invoice_number": "INV002",
            "amount_without_vat": 200,
            "vat_amount": 40,
            "total_amount": 240,
            "date": "2025-02-01T00:00:00Z"
        }
        
        response = requests.post(f"{API_URL}/invoices", headers=headers, json=invoice_data)
        if response.status_code != 200:
            print(f"⚠️ Could not create second test invoice: {response.text}")
    except Exception as e:
        print(f"⚠️ Error creating second test invoice: {e}")
    
    # Test comparison with multiple suppliers
    try:
        suppliers = "Test Supplier,Another Supplier Ltd"
        response = requests.get(f"{API_URL}/statistics/suppliers/compare?suppliers={suppliers}", headers=headers)
        print(f"GET /api/statistics/suppliers/compare?suppliers={suppliers} - Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            print(f"✅ Supplier comparison retrieved successfully")
            
            # Verify response structure
            expected_keys = ["period", "comparison", "summary"]
            missing_keys = [key for key in expected_keys if key not in data]
            if missing_keys:
                print(f"⚠️ Missing expected keys: {missing_keys}")
                return False
            
            comparison = data.get("comparison", [])
            if comparison:
                # Check first supplier structure
                first_supplier = comparison[0]
                supplier_keys = [
                    "supplier", "total_amount", "invoice_count", "avg_invoice",
                    "first_delivery", "last_delivery", "is_active"
                ]
                missing_supplier_keys = [key for key in supplier_keys if key not in first_supplier]
                if missing_supplier_keys:
                    print(f"⚠️ Missing supplier keys: {missing_supplier_keys}")
                    return False
            
            print(f"✅ Comparison response structure is correct")
            print(f"Compared suppliers: {len(comparison)}")
            return True
        else:
            print(f"❌ Supplier comparison failed: {response.text}")
            return False
            
    except Exception as e:
        print(f"❌ Supplier comparison error: {e}")
        return False

def main():
    """Run supplier statistics tests"""
    print("BULGARIAN INVOICE MANAGEMENT - SUPPLIER STATISTICS TESTS")
    print("=" * 60)
    
    test_results = {}
    
    # Run tests in sequence
    test_results['register_user'] = register_test_user()
    test_results['create_invoice'] = create_test_invoice()
    test_results['supplier_stats'] = test_supplier_statistics()
    test_results['detailed_stats'] = test_detailed_supplier_stats()
    test_results['compare_suppliers'] = test_compare_suppliers()
    
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
        print("🎉 All supplier statistics tests PASSED!")
        return True
    else:
        print("⚠️ Some supplier statistics tests FAILED!")
        return False

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)