#!/usr/bin/env python3
"""
Backend API Testing Script for Bulgarian Invoice Management App
Tests invitation endpoints and authentication flow
"""

import asyncio
import httpx
import json
import os
from datetime import datetime

# Get backend URL from frontend .env
BACKEND_URL = "https://invoicemaster-62.preview.emergentagent.com/api"

class BackendTester:
    def __init__(self):
        self.client = httpx.AsyncClient(timeout=30.0)
        self.session_token = None
        self.user_data = None
        self.company_id = None
        
    async def __aenter__(self):
        return self
        
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.client.aclose()

    async def register_test_user(self):
        """Register a test user for testing"""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        test_email = f"test_owner_{timestamp}@example.com"
        
        register_data = {
            "email": test_email,
            "password": "TestPass123!",
            "name": f"Test Owner {timestamp}"
        }
        
        print(f"🔐 Registering test user: {test_email}")
        
        response = await self.client.post(
            f"{BACKEND_URL}/auth/register",
            json=register_data
        )
        
        if response.status_code == 200:
            data = response.json()
            self.session_token = data.get("session_token")
            self.user_data = data.get("user")
            self.company_id = self.user_data.get("company_id")
            print(f"✅ User registered successfully: {self.user_data['name']}")
            print(f"   Company ID: {self.company_id}")
            return True
        else:
            print(f"❌ Registration failed: {response.status_code} - {response.text}")
            return False

    async def get_auth_headers(self):
        """Get authorization headers"""
        if not self.session_token:
            raise Exception("No session token available")
        return {"Authorization": f"Bearer {self.session_token}"}

    async def test_get_roles(self):
        """Test GET /api/roles endpoint"""
        print("\n📋 Testing GET /api/roles")
        
        try:
            headers = await self.get_auth_headers()
            response = await self.client.get(
                f"{BACKEND_URL}/roles",
                headers=headers
            )
            
            if response.status_code == 200:
                data = response.json()
                roles = data.get("roles", [])
                print(f"✅ GET /api/roles successful")
                print(f"   Found {len(roles)} roles:")
                
                expected_roles = ["manager", "accountant", "staff", "viewer"]
                found_roles = [role["id"] for role in roles]
                
                for role in roles:
                    print(f"   - {role['id']}: {role['name_bg']} ({role['name_en']})")
                
                # Check if all expected roles are present
                missing_roles = [r for r in expected_roles if r not in found_roles]
                if missing_roles:
                    print(f"⚠️  Missing expected roles: {missing_roles}")
                    return False
                
                # Check that owner is not in the list (should not be invitable)
                if "owner" in found_roles:
                    print(f"❌ Owner role should not be in invitable roles list")
                    return False
                    
                return True
            else:
                print(f"❌ GET /api/roles failed: {response.status_code} - {response.text}")
                return False
                
        except Exception as e:
            print(f"❌ GET /api/roles error: {str(e)}")
            return False

    async def test_create_invitation(self):
        """Test POST /api/invitations endpoint"""
        print("\n📨 Testing POST /api/invitations")
        
        try:
            headers = await self.get_auth_headers()
            
            # Test creating invitation with staff role
            invitation_data = {
                "role": "staff",
                "email": "invited_staff@example.com"
            }
            
            response = await self.client.post(
                f"{BACKEND_URL}/invitations",
                headers=headers,
                json=invitation_data
            )
            
            if response.status_code == 200:
                data = response.json()
                invitation = data.get("invitation", {})
                
                print(f"✅ POST /api/invitations successful")
                print(f"   Invitation ID: {invitation.get('id')}")
                print(f"   Code: {invitation.get('code')}")
                print(f"   Invite Token: {invitation.get('invite_token')}")
                print(f"   Role: {invitation.get('role')}")
                print(f"   Company Name: {invitation.get('company_name')}")
                print(f"   Expires At: {invitation.get('expires_at')}")
                
                # Validate required fields
                required_fields = ["id", "code", "invite_token", "role", "company_name"]
                missing_fields = [field for field in required_fields if not invitation.get(field)]
                
                if missing_fields:
                    print(f"❌ Missing required fields in response: {missing_fields}")
                    return False, None
                
                # Validate role
                if invitation.get("role") != "staff":
                    print(f"❌ Expected role 'staff', got '{invitation.get('role')}'")
                    return False, None
                
                # Store invite_token for verification test
                return True, invitation.get("invite_token")
                
            else:
                print(f"❌ POST /api/invitations failed: {response.status_code} - {response.text}")
                return False, None
                
        except Exception as e:
            print(f"❌ POST /api/invitations error: {str(e)}")
            return False, None

    async def test_create_invitation_different_roles(self):
        """Test creating invitations with different roles"""
        print("\n📨 Testing POST /api/invitations with different roles")
        
        roles_to_test = ["manager", "accountant", "viewer"]
        results = {}
        
        for role in roles_to_test:
            try:
                headers = await self.get_auth_headers()
                invitation_data = {
                    "role": role,
                    "email": f"invited_{role}@example.com"
                }
                
                response = await self.client.post(
                    f"{BACKEND_URL}/invitations",
                    headers=headers,
                    json=invitation_data
                )
                
                if response.status_code == 200:
                    data = response.json()
                    invitation = data.get("invitation", {})
                    print(f"✅ Created invitation for role '{role}': {invitation.get('code')}")
                    results[role] = True
                else:
                    print(f"❌ Failed to create invitation for role '{role}': {response.status_code}")
                    results[role] = False
                    
            except Exception as e:
                print(f"❌ Error creating invitation for role '{role}': {str(e)}")
                results[role] = False
        
        success_count = sum(1 for success in results.values() if success)
        print(f"   Successfully created {success_count}/{len(roles_to_test)} invitations")
        
        return success_count == len(roles_to_test)

    async def test_verify_invitation_token(self, invite_token):
        """Test GET /api/invitations/verify/{token} endpoint"""
        print(f"\n🔍 Testing GET /api/invitations/verify/{invite_token}")
        
        try:
            # This is a public endpoint, no auth required
            response = await self.client.get(
                f"{BACKEND_URL}/invitations/verify/{invite_token}"
            )
            
            if response.status_code == 200:
                data = response.json()
                print(f"✅ GET /api/invitations/verify/{invite_token} successful")
                print(f"   Valid: {data.get('valid')}")
                print(f"   Company Name: {data.get('company_name')}")
                print(f"   Role: {data.get('role')}")
                print(f"   Role Name (BG): {data.get('role_name_bg')}")
                print(f"   Role Name (EN): {data.get('role_name_en')}")
                print(f"   Expires At: {data.get('expires_at')}")
                
                # Validate required fields
                required_fields = ["valid", "company_name", "role", "expires_at"]
                missing_fields = [field for field in required_fields if field not in data]
                
                if missing_fields:
                    print(f"❌ Missing required fields in response: {missing_fields}")
                    return False
                
                if not data.get("valid"):
                    print(f"❌ Token should be valid but returned valid=false")
                    return False
                
                return True
                
            else:
                print(f"❌ GET /api/invitations/verify/{invite_token} failed: {response.status_code} - {response.text}")
                return False
                
        except Exception as e:
            print(f"❌ GET /api/invitations/verify error: {str(e)}")
            return False

    async def test_verify_invalid_token(self):
        """Test verification with invalid token"""
        print(f"\n🔍 Testing GET /api/invitations/verify with invalid token")
        
        try:
            invalid_token = "invalid_token_12345"
            response = await self.client.get(
                f"{BACKEND_URL}/invitations/verify/{invalid_token}"
            )
            
            if response.status_code == 404:
                print(f"✅ Invalid token correctly rejected with 404")
                return True
            else:
                print(f"❌ Expected 404 for invalid token, got: {response.status_code}")
                return False
                
        except Exception as e:
            print(f"❌ Invalid token test error: {str(e)}")
            return False

    async def test_accept_invitation_by_token(self, invite_token):
        """Test POST /api/invitations/accept-by-token endpoint"""
        print(f"\n✅ Testing POST /api/invitations/accept-by-token")
        
        # First, create a new user to accept the invitation
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        test_email = f"test_invitee_{timestamp}@example.com"
        
        register_data = {
            "email": test_email,
            "password": "TestPass123!",
            "name": f"Test Invitee {timestamp}"
        }
        
        print(f"   Creating new user to accept invitation: {test_email}")
        
        # Register new user
        response = await self.client.post(
            f"{BACKEND_URL}/auth/register",
            json=register_data
        )
        
        if response.status_code != 200:
            print(f"❌ Failed to create invitee user: {response.status_code}")
            return False
        
        invitee_data = response.json()
        invitee_token = invitee_data.get("session_token")
        
        # Remove company_id from new user (they shouldn't have one to accept invitation)
        # This simulates a user without a company
        
        try:
            headers = {"Authorization": f"Bearer {invitee_token}"}
            
            # Try to accept invitation
            accept_data = {"token": invite_token}
            
            response = await self.client.post(
                f"{BACKEND_URL}/invitations/accept-by-token",
                headers=headers,
                json=accept_data
            )
            
            if response.status_code == 200:
                data = response.json()
                print(f"✅ POST /api/invitations/accept-by-token successful")
                print(f"   Message: {data.get('message')}")
                print(f"   Company: {data.get('company', {}).get('name')}")
                
                # Verify the user now has the company
                me_response = await self.client.get(
                    f"{BACKEND_URL}/auth/me",
                    headers=headers
                )
                
                if me_response.status_code == 200:
                    user_info = me_response.json()
                    if user_info.get("company_id") and user_info.get("role") == "staff":
                        print(f"   ✅ User successfully joined company with role: {user_info.get('role')}")
                        return True
                    else:
                        print(f"❌ User didn't get company_id or correct role after accepting invitation")
                        return False
                else:
                    print(f"❌ Failed to verify user after invitation acceptance")
                    return False
                
            else:
                print(f"❌ POST /api/invitations/accept-by-token failed: {response.status_code} - {response.text}")
                return False
                
        except Exception as e:
            print(f"❌ Accept invitation error: {str(e)}")
            return False

    async def run_all_tests(self):
        """Run all invitation API tests"""
        print("🚀 Starting Bulgarian Invoice Management Backend API Tests")
        print("=" * 60)
        
        results = {}
        
        # 1. Register test user (owner)
        results["user_registration"] = await self.register_test_user()
        if not results["user_registration"]:
            print("❌ Cannot continue without user registration")
            return results
        
        # 2. Test GET /api/roles
        results["get_roles"] = await self.test_get_roles()
        
        # 3. Test POST /api/invitations (staff role)
        create_result, invite_token = await self.test_create_invitation()
        results["create_invitation"] = create_result
        
        # 4. Test creating invitations with different roles
        results["create_different_roles"] = await self.test_create_invitation_different_roles()
        
        # 5. Test GET /api/invitations/verify/{token}
        if invite_token:
            results["verify_token"] = await self.test_verify_invitation_token(invite_token)
            
            # 6. Test invalid token verification
            results["verify_invalid_token"] = await self.test_verify_invalid_token()
            
            # 7. Test POST /api/invitations/accept-by-token
            results["accept_invitation"] = await self.test_accept_invitation_by_token(invite_token)
        else:
            results["verify_token"] = False
            results["verify_invalid_token"] = False
            results["accept_invitation"] = False
            print("⚠️  Skipping token verification tests - no token available")
        
        return results

async def main():
    """Main test function"""
    async with BackendTester() as tester:
        results = await tester.run_all_tests()
        
        print("\n" + "=" * 60)
        print("📊 TEST RESULTS SUMMARY")
        print("=" * 60)
        
        passed = 0
        total = len(results)
        
        for test_name, success in results.items():
            status = "✅ PASS" if success else "❌ FAIL"
            print(f"{test_name:25} {status}")
            if success:
                passed += 1
        
        print(f"\nOverall: {passed}/{total} tests passed")
        
        if passed == total:
            print("🎉 All invitation API tests passed!")
        else:
            print("⚠️  Some tests failed - check logs above")
        
        return passed == total

if __name__ == "__main__":
    success = asyncio.run(main())
    exit(0 if success else 1)