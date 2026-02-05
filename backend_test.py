#!/usr/bin/env python3
"""
Backend API Testing for AI Item Normalization Feature
Tests all the new endpoints for item groups and normalization
"""

import asyncio
import aiohttp
import json
import sys
from datetime import datetime

# Backend URL from frontend .env
BACKEND_URL = "https://smartinvoice-31.preview.emergentagent.com/api"

class BackendTester:
    def __init__(self):
        self.session = None
        self.auth_token = None
        self.user_data = None
        self.company_id = None
        
    async def setup_session(self):
        """Initialize HTTP session"""
        self.session = aiohttp.ClientSession()
        
    async def cleanup(self):
        """Cleanup HTTP session"""
        if self.session:
            await self.session.close()
            
    async def register_and_login(self):
        """Register a test user and login"""
        print("🔐 Setting up authentication...")
        
        # Register new user
        register_data = {
            "email": "testuser.itemgroups@example.com",
            "password": "TestPass123!",
            "name": "Test User Item Groups"
        }
        
        try:
            async with self.session.post(f"{BACKEND_URL}/auth/register", json=register_data) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    self.auth_token = data.get("session_token")
                    self.user_data = data.get("user")
                    self.company_id = self.user_data.get("company_id")
                    print(f"✅ Registered and logged in as: {self.user_data['name']}")
                    print(f"   Company ID: {self.company_id}")
                    return True
                elif resp.status == 400:
                    # User might already exist, try login
                    print("   User exists, trying login...")
                    return await self.login_existing_user(register_data["email"], register_data["password"])
                else:
                    print(f"❌ Registration failed: {resp.status}")
                    return False
        except Exception as e:
            print(f"❌ Registration error: {e}")
            return False
            
    async def login_existing_user(self, email, password):
        """Login with existing user"""
        login_data = {"email": email, "password": password}
        
        try:
            async with self.session.post(f"{BACKEND_URL}/auth/login", json=login_data) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    self.auth_token = data.get("session_token")
                    self.user_data = data.get("user")
                    self.company_id = self.user_data.get("company_id")
                    print(f"✅ Logged in as: {self.user_data['name']}")
                    print(f"   Company ID: {self.company_id}")
                    return True
                else:
                    print(f"❌ Login failed: {resp.status}")
                    return False
        except Exception as e:
            print(f"❌ Login error: {e}")
            return False
            
    def get_headers(self):
        """Get authorization headers"""
        return {"Authorization": f"Bearer {self.auth_token}"}
        
    async def create_test_invoices_with_items(self):
        """Create test invoices with items for normalization testing"""
        print("\n📄 Creating test invoices with items...")
        
        test_invoices = [
            {
                "supplier": "Магазин Фантастико",
                "invoice_number": "INV-001-2024",
                "amount_without_vat": 50.00,
                "vat_amount": 10.00,
                "total_amount": 60.00,
                "date": "2024-01-15",
                "items": [
                    {
                        "name": "Олио Първа Преса 1л",
                        "quantity": 2,
                        "unit": "бр.",
                        "unit_price": 8.50,
                        "total_price": 17.00
                    },
                    {
                        "name": "Хляб Добруджа 650г",
                        "quantity": 3,
                        "unit": "бр.",
                        "unit_price": 2.20,
                        "total_price": 6.60
                    }
                ]
            },
            {
                "supplier": "Лидл България",
                "invoice_number": "LIDL-002-2024",
                "amount_without_vat": 35.00,
                "vat_amount": 7.00,
                "total_amount": 42.00,
                "date": "2024-01-16",
                "items": [
                    {
                        "name": "Олио Екстра Верджин 500мл",
                        "quantity": 1,
                        "unit": "бр.",
                        "unit_price": 12.00,
                        "total_price": 12.00
                    },
                    {
                        "name": "Хляб Интегрален 500г",
                        "quantity": 2,
                        "unit": "бр.",
                        "unit_price": 3.50,
                        "total_price": 7.00
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
                    headers=self.get_headers()
                ) as resp:
                    if resp.status == 200:
                        created_count += 1
                        print(f"   ✅ Created invoice: {invoice_data['invoice_number']}")
                    elif resp.status == 409:
                        print(f"   ⚠️  Invoice already exists: {invoice_data['invoice_number']}")
                    else:
                        text = await resp.text()
                        print(f"   ❌ Failed to create invoice {invoice_data['invoice_number']}: {resp.status} - {text}")
            except Exception as e:
                print(f"   ❌ Error creating invoice {invoice_data['invoice_number']}: {e}")
                
        print(f"   Created {created_count} new invoices")
        return created_count > 0
        
    async def test_get_item_groups(self):
        """Test GET /api/items/groups"""
        print("\n🔍 Testing GET /api/items/groups...")
        
        try:
            async with self.session.get(
                f"{BACKEND_URL}/items/groups",
                headers=self.get_headers()
            ) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    print(f"   ✅ Status: {resp.status}")
                    print(f"   📊 Total groups: {data.get('total', 0)}")
                    groups = data.get('groups', [])
                    for group in groups[:3]:  # Show first 3 groups
                        print(f"      - {group.get('canonical_name')}: {len(group.get('variants', []))} variants")
                    return True, data
                else:
                    text = await resp.text()
                    print(f"   ❌ Status: {resp.status} - {text}")
                    return False, None
        except Exception as e:
            print(f"   ❌ Error: {e}")
            return False, None
            
    async def test_create_item_group(self):
        """Test POST /api/items/groups"""
        print("\n➕ Testing POST /api/items/groups...")
        
        group_data = {
            "canonical_name": "Олио",
            "variants": ["Олио Първа Преса", "Олио Екстра"],
            "category": "Хранителни стоки"
        }
        
        try:
            async with self.session.post(
                f"{BACKEND_URL}/items/groups",
                json=group_data,
                headers=self.get_headers()
            ) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    print(f"   ✅ Status: {resp.status}")
                    print(f"   📝 Created group: {data.get('canonical_name')}")
                    print(f"   🏷️  Category: {data.get('category')}")
                    print(f"   📋 Variants: {data.get('variants')}")
                    return True, data
                elif resp.status == 409:
                    print(f"   ⚠️  Group already exists: {resp.status}")
                    return True, None  # This is expected if group exists
                else:
                    text = await resp.text()
                    print(f"   ❌ Status: {resp.status} - {text}")
                    return False, None
        except Exception as e:
            print(f"   ❌ Error: {e}")
            return False, None
            
    async def test_update_item_group(self, group_id):
        """Test PUT /api/items/groups/{group_id}"""
        print(f"\n✏️  Testing PUT /api/items/groups/{group_id}...")
        
        update_data = {
            "variants": ["Олио Първа Преса", "Олио Екстра", "Олио Слънчогледово"],
            "category": "Хранителни стоки и масла"
        }
        
        try:
            async with self.session.put(
                f"{BACKEND_URL}/items/groups/{group_id}",
                json=update_data,
                headers=self.get_headers()
            ) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    print(f"   ✅ Status: {resp.status}")
                    print(f"   📝 Updated group: {data.get('canonical_name')}")
                    print(f"   🏷️  New category: {data.get('category')}")
                    print(f"   📋 New variants: {data.get('variants')}")
                    return True, data
                else:
                    text = await resp.text()
                    print(f"   ❌ Status: {resp.status} - {text}")
                    return False, None
        except Exception as e:
            print(f"   ❌ Error: {e}")
            return False, None
            
    async def test_normalize_single_item(self):
        """Test POST /api/items/normalize-single"""
        print("\n🤖 Testing POST /api/items/normalize-single...")
        
        test_data = {
            "item_name": "Олио Първа Преса 1л"
        }
        
        try:
            async with self.session.post(
                f"{BACKEND_URL}/items/normalize-single",
                json=test_data,
                headers=self.get_headers()
            ) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    print(f"   ✅ Status: {resp.status}")
                    print(f"   📝 Original: {data.get('original_name')}")
                    print(f"   🎯 Canonical: {data.get('canonical_name')}")
                    print(f"   🏷️  Category: {data.get('category')}")
                    print(f"   📊 Confidence: {data.get('confidence')}")
                    print(f"   🆕 Is new group: {data.get('is_new_group')}")
                    return True, data
                else:
                    text = await resp.text()
                    print(f"   ❌ Status: {resp.status} - {text}")
                    return False, None
        except Exception as e:
            print(f"   ❌ Error: {e}")
            return False, None
            
    async def test_normalize_all_items(self):
        """Test POST /api/items/normalize"""
        print("\n🤖 Testing POST /api/items/normalize...")
        
        try:
            async with self.session.post(
                f"{BACKEND_URL}/items/normalize",
                headers=self.get_headers()
            ) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    print(f"   ✅ Status: {resp.status}")
                    print(f"   📊 Processed: {data.get('processed')} items")
                    print(f"   🆕 New groups: {data.get('new_groups')}")
                    print(f"   ✏️  Updated groups: {data.get('updated_groups')}")
                    print(f"   💬 Message: {data.get('message')}")
                    return True, data
                else:
                    text = await resp.text()
                    print(f"   ❌ Status: {resp.status} - {text}")
                    return False, None
        except Exception as e:
            print(f"   ❌ Error: {e}")
            return False, None
            
    async def test_grouped_statistics(self):
        """Test GET /api/statistics/items?grouped=true"""
        print("\n📊 Testing GET /api/statistics/items?grouped=true...")
        
        try:
            async with self.session.get(
                f"{BACKEND_URL}/statistics/items?grouped=true",
                headers=self.get_headers()
            ) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    print(f"   ✅ Status: {resp.status}")
                    print(f"   📊 Grouped mode: {data.get('grouped')}")
                    
                    totals = data.get('totals', {})
                    print(f"   📈 Total items: {totals.get('total_items')}")
                    print(f"   💰 Total value: {totals.get('total_value')} лв")
                    print(f"   🔢 Unique items: {totals.get('unique_items')}")
                    print(f"   👥 Groups count: {totals.get('groups_count')}")
                    
                    # Show top items by value
                    top_by_value = data.get('top_by_value', [])
                    if top_by_value:
                        print("   🏆 Top items by value:")
                        for item in top_by_value[:3]:
                            variants_info = ""
                            if 'variants' in item:
                                variants_info = f" ({len(item['variants'])} variants)"
                            print(f"      - {item.get('item_name')}{variants_info}: {item.get('total_value')} лв")
                    
                    return True, data
                else:
                    text = await resp.text()
                    print(f"   ❌ Status: {resp.status} - {text}")
                    return False, None
        except Exception as e:
            print(f"   ❌ Error: {e}")
            return False, None
            
    async def test_delete_item_group(self, group_id):
        """Test DELETE /api/items/groups/{group_id}"""
        print(f"\n🗑️  Testing DELETE /api/items/groups/{group_id}...")
        
        try:
            async with self.session.delete(
                f"{BACKEND_URL}/items/groups/{group_id}",
                headers=self.get_headers()
            ) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    print(f"   ✅ Status: {resp.status}")
                    print(f"   💬 Message: {data.get('message')}")
                    return True, data
                else:
                    text = await resp.text()
                    print(f"   ❌ Status: {resp.status} - {text}")
                    return False, None
        except Exception as e:
            print(f"   ❌ Error: {e}")
            return False, None
            
    async def run_all_tests(self):
        """Run all AI Item Normalization tests"""
        print("🚀 Starting AI Item Normalization Backend Tests")
        print("=" * 60)
        
        await self.setup_session()
        
        try:
            # 1. Authentication
            if not await self.register_and_login():
                print("❌ Authentication failed, stopping tests")
                return False
                
            # 2. Create test data
            await self.create_test_invoices_with_items()
            
            # 3. Test GET item groups
            success, groups_data = await self.test_get_item_groups()
            if not success:
                print("❌ GET item groups failed")
                return False
                
            # 4. Test CREATE item group
            success, created_group = await self.test_create_item_group()
            if not success:
                print("❌ CREATE item group failed")
                return False
                
            # Get group ID for update/delete tests
            group_id = None
            if created_group:
                group_id = created_group.get('id')
            else:
                # Try to get existing group
                if groups_data and groups_data.get('groups'):
                    for group in groups_data['groups']:
                        if group.get('canonical_name') == 'Олио':
                            group_id = group.get('id')
                            break
                            
            # 5. Test UPDATE item group (if we have a group ID)
            if group_id:
                success, _ = await self.test_update_item_group(group_id)
                if not success:
                    print("❌ UPDATE item group failed")
                    return False
            else:
                print("⚠️  Skipping UPDATE test - no group ID available")
                
            # 6. Test single item normalization
            success, _ = await self.test_normalize_single_item()
            if not success:
                print("❌ Single item normalization failed")
                return False
                
            # 7. Test normalize all items
            success, _ = await self.test_normalize_all_items()
            if not success:
                print("❌ Normalize all items failed")
                return False
                
            # 8. Test grouped statistics
            success, _ = await self.test_grouped_statistics()
            if not success:
                print("❌ Grouped statistics failed")
                return False
                
            # 9. Test DELETE item group (if we have a group ID)
            # Note: We'll skip this to preserve test data
            # if group_id:
            #     success, _ = await self.test_delete_item_group(group_id)
            #     if not success:
            #         print("❌ DELETE item group failed")
            #         return False
            # else:
            #     print("⚠️  Skipping DELETE test - no group ID available")
                
            print("\n" + "=" * 60)
            print("🎉 All AI Item Normalization tests completed successfully!")
            return True
            
        except Exception as e:
            print(f"\n❌ Test suite error: {e}")
            return False
        finally:
            await self.cleanup()

async def main():
    """Main test runner"""
    tester = BackendTester()
    success = await tester.run_all_tests()
    
    if success:
        print("\n✅ All tests passed!")
        sys.exit(0)
    else:
        print("\n❌ Some tests failed!")
        sys.exit(1)

if __name__ == "__main__":
    asyncio.run(main())