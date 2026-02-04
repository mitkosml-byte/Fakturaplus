#!/usr/bin/env python3
"""
Comprehensive AI Item Merging API Tests for Bulgarian Invoice Management App
Tests all AI Item Merging endpoints and error conditions
"""

import asyncio
import aiohttp
import json
import sys
from datetime import datetime, timezone
import os

# Backend URL from environment
BACKEND_URL = "https://invtrack-43.preview.emergentagent.com/api"

class ComprehensiveAIMergeTester:
    def __init__(self):
        self.session = None
        self.auth_token = None
        self.test_user_email = "comprehensive_aimerge@test.com"
        self.test_user_password = "Test1234"
        self.test_user_name = "Comprehensive AI Merge Tester"
        self.test_results = []
        
    async def setup_session(self):
        """Initialize HTTP session"""
        self.session = aiohttp.ClientSession()
        
    async def cleanup_session(self):
        """Cleanup HTTP session"""
        if self.session:
            await self.session.close()
            
    def log_result(self, test_name, success, details="", error=""):
        """Log test result"""
        result = {
            "test": test_name,
            "success": success,
            "details": details,
            "error": error,
            "timestamp": datetime.now().isoformat()
        }
        self.test_results.append(result)
        
        status = "✅ PASS" if success else "❌ FAIL"
        print(f"{status} {test_name}")
        if details:
            print(f"   Details: {details}")
        if error:
            print(f"   Error: {error}")
            
    async def register_test_user(self):
        """Register test user for authentication"""
        print("🔐 Setting up authentication...")
        
        register_data = {
            "email": self.test_user_email,
            "password": self.test_user_password,
            "name": self.test_user_name
        }
        
        try:
            async with self.session.post(
                f"{BACKEND_URL}/auth/register",
                json=register_data,
                headers={"Content-Type": "application/json"}
            ) as response:
                if response.status == 200:
                    data = await response.json()
                    self.auth_token = data.get("session_token")
                    self.log_result("User Registration", True, f"Token: {self.auth_token[:20]}...")
                    return True
                elif response.status == 400:
                    # User might already exist, try login
                    return await self.login_test_user()
                else:
                    error_text = await response.text()
                    self.log_result("User Registration", False, error=f"{response.status} - {error_text}")
                    return False
        except Exception as e:
            self.log_result("User Registration", False, error=str(e))
            return False
            
    async def login_test_user(self):
        """Login test user"""
        login_data = {
            "email": self.test_user_email,
            "password": self.test_user_password
        }
        
        try:
            async with self.session.post(
                f"{BACKEND_URL}/auth/login",
                json=login_data,
                headers={"Content-Type": "application/json"}
            ) as response:
                if response.status == 200:
                    data = await response.json()
                    self.auth_token = data.get("session_token")
                    self.log_result("User Login", True, f"Token: {self.auth_token[:20]}...")
                    return True
                else:
                    error_text = await response.text()
                    self.log_result("User Login", False, error=f"{response.status} - {error_text}")
                    return False
        except Exception as e:
            self.log_result("User Login", False, error=str(e))
            return False
            
    def get_auth_headers(self):
        """Get authorization headers"""
        return {
            "Authorization": f"Bearer {self.auth_token}",
            "Content-Type": "application/json"
        }
        
    async def create_test_invoices_with_similar_items(self):
        """Create test invoices with similar item names for AI merging"""
        print("\n📄 Creating test data with similar Bulgarian product names...")
        
        # More comprehensive test data with clearly similar items
        test_invoices = [
            {
                "supplier": "Магазин Олио ЕООД",
                "invoice_number": "MERGE-001",
                "amount_without_vat": 10.00,
                "vat_amount": 2.00,
                "total_amount": 12.00,
                "date": "2024-01-15",
                "items": [
                    {
                        "name": "Олио слънчогледово",
                        "quantity": 1,
                        "unit": "л.",
                        "unit_price": 8.50,
                        "total_price": 8.50
                    }
                ]
            },
            {
                "supplier": "Супермаркет БГ",
                "invoice_number": "MERGE-002", 
                "amount_without_vat": 15.00,
                "vat_amount": 3.00,
                "total_amount": 18.00,
                "date": "2024-01-16",
                "items": [
                    {
                        "name": "олио слънчогледово",  # Same but lowercase
                        "quantity": 2,
                        "unit": "л.",
                        "unit_price": 7.25,
                        "total_price": 14.50
                    }
                ]
            },
            {
                "supplier": "Хранителни стоки ООД",
                "invoice_number": "MERGE-003",
                "amount_without_vat": 20.00,
                "vat_amount": 4.00,
                "total_amount": 24.00,
                "date": "2024-01-17",
                "items": [
                    {
                        "name": "ОЛИО СЛЪНЧОГЛЕДОВО",  # Same but uppercase
                        "quantity": 1,
                        "unit": "л.",
                        "unit_price": 9.00,
                        "total_price": 9.00
                    }
                ]
            },
            {
                "supplier": "Продукти и храни АД",
                "invoice_number": "MERGE-004",
                "amount_without_vat": 25.00,
                "vat_amount": 5.00,
                "total_amount": 30.00,
                "date": "2024-01-18",
                "items": [
                    {
                        "name": "Захар кристална",
                        "quantity": 2,
                        "unit": "кг.",
                        "unit_price": 2.50,
                        "total_price": 5.00
                    }
                ]
            },
            {
                "supplier": "Сладки продукти ЕООД",
                "invoice_number": "MERGE-005",
                "amount_without_vat": 12.00,
                "vat_amount": 2.40,
                "total_amount": 14.40,
                "date": "2024-01-19",
                "items": [
                    {
                        "name": "захар кристална",  # Same but lowercase
                        "quantity": 3,
                        "unit": "кг.",
                        "unit_price": 2.30,
                        "total_price": 6.90
                    }
                ]
            }
        ]
        
        created_count = 0
        for invoice_data in test_invoices:
            try:
                async with self.session.post(
                    f"{BACKEND_URL}/invoices",
                    json=invoice_data,
                    headers=self.get_auth_headers()
                ) as response:
                    if response.status == 200:
                        created_count += 1
                        print(f"   ✅ Created {invoice_data['invoice_number']}: {[item['name'] for item in invoice_data['items']]}")
                    else:
                        error_text = await response.text()
                        print(f"   ⚠️ Failed {invoice_data['invoice_number']}: {response.status} - {error_text}")
            except Exception as e:
                print(f"   ❌ Error {invoice_data['invoice_number']}: {str(e)}")
                
        self.log_result("Test Data Creation", created_count > 0, f"Created {created_count}/5 invoices")
        return created_count > 0
        
    async def test_merge_mappings_endpoints(self):
        """Test all merge mappings endpoints"""
        print("\n🧪 Testing Merge Mappings Endpoints...")
        
        # Test 1: GET initial mappings
        try:
            async with self.session.get(
                f"{BACKEND_URL}/items/merge-mappings",
                headers=self.get_auth_headers()
            ) as response:
                if response.status == 200:
                    data = await response.json()
                    mappings = data.get("mappings", [])
                    self.log_result("GET /api/items/merge-mappings", True, f"Found {len(mappings)} initial mappings")
                    return mappings
                else:
                    error_text = await response.text()
                    self.log_result("GET /api/items/merge-mappings", False, error=f"{response.status} - {error_text}")
                    return []
        except Exception as e:
            self.log_result("GET /api/items/merge-mappings", False, error=str(e))
            return []
            
    async def test_ai_merge_endpoint(self):
        """Test AI merge endpoint and check for errors"""
        print("\n🤖 Testing AI Merge Endpoint...")
        
        try:
            async with self.session.post(
                f"{BACKEND_URL}/items/ai-merge",
                headers=self.get_auth_headers()
            ) as response:
                if response.status == 200:
                    data = await response.json()
                    merged_groups = data.get("merged_groups", [])
                    total_merged = data.get("total_merged", 0)
                    message = data.get("message", "")
                    error = data.get("error", "")
                    
                    if error:
                        self.log_result("POST /api/items/ai-merge", False, 
                                      f"API returned error: {error}")
                        return False, data
                    else:
                        self.log_result("POST /api/items/ai-merge", True, 
                                      f"Found {len(merged_groups)} groups, {total_merged} items merged. Message: {message}")
                        return True, data
                else:
                    error_text = await response.text()
                    self.log_result("POST /api/items/ai-merge", False, error=f"{response.status} - {error_text}")
                    return False, {}
        except Exception as e:
            self.log_result("POST /api/items/ai-merge", False, error=str(e))
            return False, {}
            
    async def test_merged_statistics_endpoint(self):
        """Test merged statistics endpoint with various parameters"""
        print("\n📈 Testing Merged Statistics Endpoint...")
        
        test_cases = [
            ("No parameters", {}),
            ("With top_n", {"top_n": "5"}),
            ("With date range", {"start_date": "2024-01-01", "end_date": "2024-01-31"}),
            ("Full parameters", {"start_date": "2024-01-01", "end_date": "2024-01-31", "top_n": "10"})
        ]
        
        all_passed = True
        for test_name, params in test_cases:
            try:
                async with self.session.get(
                    f"{BACKEND_URL}/statistics/items/merged",
                    params=params,
                    headers=self.get_auth_headers()
                ) as response:
                    if response.status == 200:
                        data = await response.json()
                        totals = data.get("totals", {})
                        merge_applied = data.get("merge_applied", False)
                        top_by_quantity = data.get("top_by_quantity", [])
                        top_by_value = data.get("top_by_value", [])
                        
                        details = f"Totals: {totals}, Merge applied: {merge_applied}, Items: {len(top_by_quantity)}"
                        self.log_result(f"GET /api/statistics/items/merged ({test_name})", True, details)
                    else:
                        error_text = await response.text()
                        self.log_result(f"GET /api/statistics/items/merged ({test_name})", False, 
                                      error=f"{response.status} - {error_text}")
                        all_passed = False
            except Exception as e:
                self.log_result(f"GET /api/statistics/items/merged ({test_name})", False, error=str(e))
                all_passed = False
                
        return all_passed
        
    async def test_delete_merge_mapping_endpoint(self, mappings):
        """Test delete merge mapping endpoint"""
        print("\n🗑️ Testing Delete Merge Mapping Endpoint...")
        
        if not mappings:
            self.log_result("DELETE /api/items/merge-mappings/{name}", True, "No mappings to delete (expected)")
            return True
            
        # Try to delete the first mapping
        first_mapping = mappings[0]
        canonical_name = first_mapping.get("canonical_name", "")
        
        if not canonical_name:
            self.log_result("DELETE /api/items/merge-mappings/{name}", False, error="No canonical name found")
            return False
            
        try:
            from urllib.parse import quote
            encoded_name = quote(canonical_name)
            
            async with self.session.delete(
                f"{BACKEND_URL}/items/merge-mappings/{encoded_name}",
                headers=self.get_auth_headers()
            ) as response:
                if response.status == 200:
                    data = await response.json()
                    message = data.get("message", "")
                    self.log_result("DELETE /api/items/merge-mappings/{name}", True, 
                                  f"Deleted '{canonical_name}': {message}")
                    return True
                else:
                    error_text = await response.text()
                    self.log_result("DELETE /api/items/merge-mappings/{name}", False, 
                                  error=f"{response.status} - {error_text}")
                    return False
        except Exception as e:
            self.log_result("DELETE /api/items/merge-mappings/{name}", False, error=str(e))
            return False
            
    async def test_authentication_required(self):
        """Test that endpoints require authentication"""
        print("\n🔒 Testing Authentication Requirements...")
        
        endpoints = [
            ("GET", "/items/merge-mappings"),
            ("POST", "/items/ai-merge"),
            ("GET", "/statistics/items/merged"),
            ("DELETE", "/items/merge-mappings/test")
        ]
        
        all_passed = True
        for method, endpoint in endpoints:
            try:
                if method == "GET":
                    async with self.session.get(f"{BACKEND_URL}{endpoint}") as response:
                        auth_required = response.status == 401
                elif method == "POST":
                    async with self.session.post(f"{BACKEND_URL}{endpoint}") as response:
                        auth_required = response.status == 401
                elif method == "DELETE":
                    async with self.session.delete(f"{BACKEND_URL}{endpoint}") as response:
                        auth_required = response.status == 401
                        
                if auth_required:
                    self.log_result(f"Auth Required: {method} {endpoint}", True, "Returns 401 without auth")
                else:
                    self.log_result(f"Auth Required: {method} {endpoint}", False, 
                                  f"Expected 401, got {response.status}")
                    all_passed = False
                    
            except Exception as e:
                self.log_result(f"Auth Required: {method} {endpoint}", False, error=str(e))
                all_passed = False
                
        return all_passed
        
    async def run_comprehensive_tests(self):
        """Run all comprehensive AI Item Merging tests"""
        print("🚀 Starting Comprehensive AI Item Merging API Tests")
        print("=" * 70)
        
        await self.setup_session()
        
        try:
            # Test 1: Authentication
            if not await self.register_test_user():
                print("❌ Authentication failed - cannot continue tests")
                return False
                
            # Test 2: Authentication requirements
            await self.test_authentication_required()
            
            # Test 3: Create test data
            if not await self.create_test_invoices_with_similar_items():
                print("❌ Test data creation failed - cannot continue tests")
                return False
                
            # Test 4: Initial merge mappings
            initial_mappings = await self.test_merge_mappings_endpoints()
            
            # Test 5: AI merge analysis
            ai_success, ai_result = await self.test_ai_merge_endpoint()
            
            # Test 6: Merge mappings after AI
            final_mappings = await self.test_merge_mappings_endpoints()
            
            # Test 7: Merged statistics
            await self.test_merged_statistics_endpoint()
            
            # Test 8: Delete merge mapping
            await self.test_delete_merge_mapping_endpoint(final_mappings)
            
            # Summary
            print("\n" + "=" * 70)
            print("📋 COMPREHENSIVE TEST SUMMARY")
            print("=" * 70)
            
            passed = sum(1 for result in self.test_results if result["success"])
            total = len(self.test_results)
            
            print(f"🎯 Results: {passed}/{total} tests passed ({passed/total*100:.1f}%)")
            
            # Show failed tests
            failed_tests = [r for r in self.test_results if not r["success"]]
            if failed_tests:
                print("\n❌ FAILED TESTS:")
                for test in failed_tests:
                    print(f"   • {test['test']}: {test['error']}")
                    
            # Critical issues
            critical_issues = []
            if not ai_success:
                ai_error = ai_result.get("error", "Unknown error")
                if "LlmChat.__init__() got an unexpected keyword argument 'model'" in ai_error:
                    critical_issues.append("AI Merge endpoint has LlmChat initialization bug - 'model' parameter should not be passed to constructor")
                else:
                    critical_issues.append(f"AI Merge endpoint error: {ai_error}")
                    
            if critical_issues:
                print("\n🚨 CRITICAL ISSUES FOUND:")
                for issue in critical_issues:
                    print(f"   • {issue}")
                    
            return len(critical_issues) == 0 and passed >= total * 0.8  # 80% pass rate
                
        finally:
            await self.cleanup_session()

async def main():
    """Main test runner"""
    tester = ComprehensiveAIMergeTester()
    success = await tester.run_comprehensive_tests()
    sys.exit(0 if success else 1)

if __name__ == "__main__":
    asyncio.run(main())