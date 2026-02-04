#!/usr/bin/env python3
"""
AI Item Merging API Tests for Bulgarian Invoice Management App
Tests the new AI Item Merging API endpoints
"""

import asyncio
import aiohttp
import json
import sys
from datetime import datetime, timezone
import os

# Backend URL from environment
BACKEND_URL = "https://invtrack-43.preview.emergentagent.com/api"

class AIItemMergingTester:
    def __init__(self):
        self.session = None
        self.auth_token = None
        self.test_user_email = "aimerge_test@test.com"
        self.test_user_password = "Test1234"
        self.test_user_name = "AI Merge Tester"
        
    async def setup_session(self):
        """Initialize HTTP session"""
        self.session = aiohttp.ClientSession()
        
    async def cleanup_session(self):
        """Cleanup HTTP session"""
        if self.session:
            await self.session.close()
            
    async def register_test_user(self):
        """Register test user for authentication"""
        print("🔐 Registering test user...")
        
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
                    print(f"✅ User registered successfully. Token: {self.auth_token[:20]}...")
                    return True
                elif response.status == 400:
                    # User might already exist, try login
                    print("ℹ️ User already exists, trying login...")
                    return await self.login_test_user()
                else:
                    error_text = await response.text()
                    print(f"❌ Registration failed: {response.status} - {error_text}")
                    return False
        except Exception as e:
            print(f"❌ Registration error: {str(e)}")
            return False
            
    async def login_test_user(self):
        """Login test user"""
        print("🔐 Logging in test user...")
        
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
                    print(f"✅ Login successful. Token: {self.auth_token[:20]}...")
                    return True
                else:
                    error_text = await response.text()
                    print(f"❌ Login failed: {response.status} - {error_text}")
                    return False
        except Exception as e:
            print(f"❌ Login error: {str(e)}")
            return False
            
    def get_auth_headers(self):
        """Get authorization headers"""
        return {
            "Authorization": f"Bearer {self.auth_token}",
            "Content-Type": "application/json"
        }
        
    async def create_test_invoices_with_similar_items(self):
        """Create test invoices with similar item names for AI merging"""
        print("📄 Creating test invoices with similar item names...")
        
        # Test invoices with similar Bulgarian product names
        test_invoices = [
            {
                "supplier": "Магазин Олио ЕООД",
                "invoice_number": "INV-001",
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
                "invoice_number": "INV-002", 
                "amount_without_vat": 15.00,
                "vat_amount": 3.00,
                "total_amount": 18.00,
                "date": "2024-01-16",
                "items": [
                    {
                        "name": "олио екстра",
                        "quantity": 2,
                        "unit": "л.",
                        "unit_price": 7.25,
                        "total_price": 14.50
                    }
                ]
            },
            {
                "supplier": "Хранителни стоки ООД",
                "invoice_number": "INV-003",
                "amount_without_vat": 20.00,
                "vat_amount": 4.00,
                "total_amount": 24.00,
                "date": "2024-01-17",
                "items": [
                    {
                        "name": "ОЛИО",
                        "quantity": 1,
                        "unit": "л.",
                        "unit_price": 9.00,
                        "total_price": 9.00
                    }
                ]
            },
            {
                "supplier": "Продукти и храни АД",
                "invoice_number": "INV-004",
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
                "invoice_number": "INV-005",
                "amount_without_vat": 12.00,
                "vat_amount": 2.40,
                "total_amount": 14.40,
                "date": "2024-01-19",
                "items": [
                    {
                        "name": "захар",
                        "quantity": 3,
                        "unit": "кг.",
                        "unit_price": 2.30,
                        "total_price": 6.90
                    }
                ]
            }
        ]
        
        created_invoices = []
        for invoice_data in test_invoices:
            try:
                async with self.session.post(
                    f"{BACKEND_URL}/invoices",
                    json=invoice_data,
                    headers=self.get_auth_headers()
                ) as response:
                    if response.status == 200:
                        invoice = await response.json()
                        created_invoices.append(invoice)
                        print(f"✅ Created invoice {invoice_data['invoice_number']} with items: {[item['name'] for item in invoice_data['items']]}")
                    else:
                        error_text = await response.text()
                        print(f"⚠️ Failed to create invoice {invoice_data['invoice_number']}: {response.status} - {error_text}")
            except Exception as e:
                print(f"❌ Error creating invoice {invoice_data['invoice_number']}: {str(e)}")
                
        print(f"📊 Created {len(created_invoices)} test invoices")
        return created_invoices
        
    async def test_get_merge_mappings_initial(self):
        """Test GET /api/items/merge-mappings - should be empty initially"""
        print("\n🧪 Testing GET /api/items/merge-mappings (initial state)...")
        
        try:
            async with self.session.get(
                f"{BACKEND_URL}/items/merge-mappings",
                headers=self.get_auth_headers()
            ) as response:
                if response.status == 200:
                    data = await response.json()
                    mappings = data.get("mappings", [])
                    print(f"✅ GET /api/items/merge-mappings successful")
                    print(f"📊 Initial mappings count: {len(mappings)}")
                    if mappings:
                        print(f"📋 Existing mappings: {mappings}")
                    return True, mappings
                else:
                    error_text = await response.text()
                    print(f"❌ GET /api/items/merge-mappings failed: {response.status} - {error_text}")
                    return False, []
        except Exception as e:
            print(f"❌ Error testing merge mappings: {str(e)}")
            return False, []
            
    async def test_ai_merge_items(self):
        """Test POST /api/items/ai-merge - triggers AI analysis"""
        print("\n🤖 Testing POST /api/items/ai-merge (AI analysis)...")
        
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
                    
                    print(f"✅ POST /api/items/ai-merge successful")
                    print(f"🔍 AI found {len(merged_groups)} merge groups")
                    print(f"📊 Total items merged: {total_merged}")
                    print(f"💬 Message: {message}")
                    
                    if merged_groups:
                        print("🎯 Merge groups found:")
                        for i, group in enumerate(merged_groups, 1):
                            canonical = group.get("canonical_name", "")
                            variants = group.get("variants", [])
                            print(f"   {i}. '{canonical}' ← {variants}")
                    
                    return True, data
                else:
                    error_text = await response.text()
                    print(f"❌ POST /api/items/ai-merge failed: {response.status} - {error_text}")
                    return False, {}
        except Exception as e:
            print(f"❌ Error testing AI merge: {str(e)}")
            return False, {}
            
    async def test_get_merge_mappings_after_ai(self):
        """Test GET /api/items/merge-mappings after AI analysis"""
        print("\n🧪 Testing GET /api/items/merge-mappings (after AI analysis)...")
        
        try:
            async with self.session.get(
                f"{BACKEND_URL}/items/merge-mappings",
                headers=self.get_auth_headers()
            ) as response:
                if response.status == 200:
                    data = await response.json()
                    mappings = data.get("mappings", [])
                    print(f"✅ GET /api/items/merge-mappings successful")
                    print(f"📊 Mappings count after AI: {len(mappings)}")
                    
                    if mappings:
                        print("📋 Current mappings:")
                        for i, mapping in enumerate(mappings, 1):
                            canonical = mapping.get("canonical_name", "")
                            display = mapping.get("display_name", "")
                            variants = mapping.get("variants", [])
                            print(f"   {i}. '{display}' ({canonical}) ← {variants}")
                    
                    return True, mappings
                else:
                    error_text = await response.text()
                    print(f"❌ GET /api/items/merge-mappings failed: {response.status} - {error_text}")
                    return False, []
        except Exception as e:
            print(f"❌ Error testing merge mappings: {str(e)}")
            return False, []
            
    async def test_merged_statistics(self):
        """Test GET /api/statistics/items/merged"""
        print("\n📈 Testing GET /api/statistics/items/merged...")
        
        try:
            # Test with different parameters
            test_params = [
                {},  # No parameters
                {"top_n": "5"},  # Limit results
                {"start_date": "2024-01-01", "end_date": "2024-01-31", "top_n": "10"}  # Date range
            ]
            
            for i, params in enumerate(test_params, 1):
                print(f"\n   Test {i}: {params if params else 'No parameters'}")
                
                async with self.session.get(
                    f"{BACKEND_URL}/statistics/items/merged",
                    params=params,
                    headers=self.get_auth_headers()
                ) as response:
                    if response.status == 200:
                        data = await response.json()
                        totals = data.get("totals", {})
                        top_by_quantity = data.get("top_by_quantity", [])
                        top_by_value = data.get("top_by_value", [])
                        merge_applied = data.get("merge_applied", False)
                        merge_groups_count = data.get("merge_groups_count", 0)
                        
                        print(f"   ✅ GET /api/statistics/items/merged successful")
                        print(f"   📊 Totals: {totals}")
                        print(f"   🔄 Merge applied: {merge_applied}")
                        print(f"   🎯 Merge groups: {merge_groups_count}")
                        print(f"   📈 Top by quantity: {len(top_by_quantity)} items")
                        print(f"   💰 Top by value: {len(top_by_value)} items")
                        
                        if top_by_quantity:
                            print("   🏆 Top items by quantity:")
                            for item in top_by_quantity[:3]:
                                name = item.get("name", "")
                                qty = item.get("total_quantity", 0)
                                value = item.get("total_value", 0)
                                original_names = item.get("original_names", [])
                                print(f"      • {name}: {qty} units, {value} лв (variants: {original_names})")
                    else:
                        error_text = await response.text()
                        print(f"   ❌ Test {i} failed: {response.status} - {error_text}")
                        
            return True
        except Exception as e:
            print(f"❌ Error testing merged statistics: {str(e)}")
            return False
            
    async def test_delete_merge_mapping(self, mappings):
        """Test DELETE /api/items/merge-mappings/{canonical_name}"""
        print("\n🗑️ Testing DELETE /api/items/merge-mappings/{canonical_name}...")
        
        if not mappings:
            print("⚠️ No mappings to delete")
            return True
            
        # Try to delete the first mapping
        first_mapping = mappings[0]
        canonical_name = first_mapping.get("canonical_name", "")
        display_name = first_mapping.get("display_name", "")
        
        if not canonical_name:
            print("⚠️ No canonical name found in mapping")
            return False
            
        print(f"🎯 Attempting to delete mapping: '{display_name}' ({canonical_name})")
        
        try:
            # URL encode the canonical name
            from urllib.parse import quote
            encoded_name = quote(canonical_name)
            
            async with self.session.delete(
                f"{BACKEND_URL}/items/merge-mappings/{encoded_name}",
                headers=self.get_auth_headers()
            ) as response:
                if response.status == 200:
                    data = await response.json()
                    message = data.get("message", "")
                    print(f"✅ DELETE /api/items/merge-mappings/{canonical_name} successful")
                    print(f"💬 Message: {message}")
                    
                    # Verify deletion by checking mappings again
                    print("🔍 Verifying deletion...")
                    success, updated_mappings = await self.test_get_merge_mappings_after_ai()
                    if success:
                        print(f"📊 Mappings count after deletion: {len(updated_mappings)}")
                        if len(updated_mappings) < len(mappings):
                            print("✅ Mapping successfully deleted")
                        else:
                            print("⚠️ Mapping count unchanged - deletion may have failed")
                    
                    return True
                else:
                    error_text = await response.text()
                    print(f"❌ DELETE /api/items/merge-mappings/{canonical_name} failed: {response.status} - {error_text}")
                    return False
        except Exception as e:
            print(f"❌ Error testing delete mapping: {str(e)}")
            return False
            
    async def run_all_tests(self):
        """Run all AI Item Merging tests"""
        print("🚀 Starting AI Item Merging API Tests")
        print("=" * 60)
        
        # Setup
        await self.setup_session()
        
        try:
            # Authentication
            if not await self.register_test_user():
                print("❌ Authentication failed - cannot continue tests")
                return False
                
            # Create test data
            await self.create_test_invoices_with_similar_items()
            
            # Test 1: Initial merge mappings (should be empty)
            success1, initial_mappings = await self.test_get_merge_mappings_initial()
            
            # Test 2: AI merge analysis
            success2, merge_result = await self.test_ai_merge_items()
            
            # Test 3: Merge mappings after AI (should have data)
            success3, final_mappings = await self.test_get_merge_mappings_after_ai()
            
            # Test 4: Merged statistics
            success4 = await self.test_merged_statistics()
            
            # Test 5: Delete merge mapping
            success5 = await self.test_delete_merge_mapping(final_mappings)
            
            # Summary
            print("\n" + "=" * 60)
            print("📋 TEST SUMMARY")
            print("=" * 60)
            
            tests = [
                ("GET /api/items/merge-mappings (initial)", success1),
                ("POST /api/items/ai-merge", success2),
                ("GET /api/items/merge-mappings (after AI)", success3),
                ("GET /api/statistics/items/merged", success4),
                ("DELETE /api/items/merge-mappings/{name}", success5)
            ]
            
            passed = sum(1 for _, success in tests if success)
            total = len(tests)
            
            for test_name, success in tests:
                status = "✅ PASS" if success else "❌ FAIL"
                print(f"{status} {test_name}")
                
            print(f"\n🎯 Results: {passed}/{total} tests passed")
            
            if passed == total:
                print("🎉 All AI Item Merging tests PASSED!")
                return True
            else:
                print("⚠️ Some tests FAILED - check logs above")
                return False
                
        finally:
            await self.cleanup_session()

async def main():
    """Main test runner"""
    tester = AIItemMergingTester()
    success = await tester.run_all_tests()
    sys.exit(0 if success else 1)

if __name__ == "__main__":
    asyncio.run(main())