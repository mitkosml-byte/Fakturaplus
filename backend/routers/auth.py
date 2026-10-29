"""Module 1 audit finding - extracted from the former monolithic server.py.
Shares server.py's db/models/helpers/services via `from server import *`;
`db` and `AI_FEATURES_ENABLED` are the two globals tests/startup reassign
after module load, so this file always accesses them as `server.db` /
`server.AI_FEATURES_ENABLED` (qualified), never via the star-import, to
stay correct when server.py's test fixture monkeypatches them."""
from fastapi import APIRouter
from server import *
from server import (
    _eik_check_digit,
    _compare_key,
    _similarity,
    _scan_packages_catalogue,
    _require_billing_enabled,
    _month_bounds,
    _compute_month_profit,
    _business_digest_period,
    _business_digest_top_expenses,
    _signal_unpaid_invoices,
    _signal_receivables,
    _signal_scan_credits,
    _signal_budget,
    _signal_price_alerts,
    _signal_reorder,
    _signal_forecast,
    _orthodox_easter,
    _holiday_name_for_date,
    _get_employee_for_company,
    _ym_add,
    _ym_diff,
    _team_channel_id,
)
import server

router = APIRouter(prefix="/api")

@router.get("/auth/me")
async def get_me(current_user: User = Depends(get_current_user)):
    return current_user.dict()

@router.post("/auth/logout")
async def logout(request: Request, response: Response):
    session_token = await get_session_token(request)
    if session_token:
        await server.db.user_sessions.delete_one({"session_token": session_token})
    clear_session_cookies(response)
    return {"message": "Успешно излязохте"}

@router.post("/auth/register")
@limiter.limit("5/minute")
async def register_user(request: Request, user_data: UserRegister, response: Response):
    """Register new user with email/password"""
    # Validate email
    if not validate_email(user_data.email):
        raise HTTPException(status_code=400, detail="Невалиден имейл адрес")
    
    # Validate password
    is_valid, error_msg = validate_password(user_data.password)
    if not is_valid:
        raise HTTPException(status_code=400, detail=error_msg)
    
    # Validate name
    if not user_data.name or len(user_data.name.strip()) < 2:
        raise HTTPException(status_code=400, detail="Името трябва да е поне 2 символа")
    
    # Check if user already exists
    existing_user = await server.db.users.find_one({"email": user_data.email.lower()})
    if existing_user:
        raise HTTPException(status_code=400, detail="Потребител с този имейл вече съществува")
    
    # Create user
    user_id = f"user_{uuid.uuid4().hex[:12]}"
    password_hash = pwd_context.hash(user_data.password)

    # If a valid invitation code was supplied, join that company directly
    # instead of auto-creating one - otherwise the new account would need a
    # separate accept-invitation call afterward, which fails (the fresh
    # account already "has a company", tripping the one-company-per-user
    # rule) since it's not yet a member of anything when this decision is
    # made. An invalid/expired/mismatched code doesn't fail the whole
    # registration - it just falls through to the normal own-company path,
    # with invite_error in the response so the frontend can say why.
    invitation = None
    invite_error = None
    if user_data.invitation_code:
        code = user_data.invitation_code.upper().strip()
        invitation = await server.db.invitations.find_one({"code": code, "status": "pending"})
        if not invitation:
            invite_error = "Невалиден или изтекъл код"
        else:
            expires_at = invitation["expires_at"]
            if expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=timezone.utc)
            if expires_at < datetime.now(timezone.utc):
                await server.db.invitations.update_one({"id": invitation["id"]}, {"$set": {"status": "expired"}})
                invitation = None
                invite_error = "Поканата е изтекла"
            elif invitation.get("email") and invitation["email"].lower() != user_data.email.lower():
                invitation = None
                invite_error = "Тази покана е издадена за друг имейл адрес"

    if invitation:
        company_id = invitation["company_id"]
        role = invitation["role"]
        permissions = invitation.get("permissions") or resolve_permissions(role, None)
    else:
        # Auto-create company for new user
        company_name = user_data.name.split()[0] + " Company" if user_data.name else "My Company"
        new_company = Company(
            name=company_name,
            eik=f"AUTO{uuid.uuid4().hex[:9].upper()}"
        )
        await server.db.companies.insert_one(new_company.dict())
        company_id = new_company.id
        role = "owner"
        permissions = resolve_permissions("owner", None)

    new_user = {
        "user_id": user_id,
        "email": user_data.email.lower(),
        "name": user_data.name.strip(),
        "picture": None,
        "role": role,
        "permissions": permissions,
        "company_id": company_id,
        "password_hash": password_hash,
        "auth_provider": "email",
        "created_at": datetime.now(timezone.utc)
    }
    await server.db.users.insert_one(new_user)

    if invitation:
        await ensure_membership(user_id, company_id, role, permissions)
        await server.db.invitations.update_one({"id": invitation["id"]}, {"$set": {"status": "accepted"}})

    # Create session
    session_token = uuid.uuid4().hex
    expires_at = datetime.now(timezone.utc) + timedelta(days=7)
    session_doc = {
        "user_id": user_id,
        "session_token": session_token,
        "expires_at": expires_at,
        "created_at": datetime.now(timezone.utc)
    }
    await server.db.user_sessions.insert_one(session_doc)

    # Set cookies (session + CSRF double-submit)
    set_session_cookies(response, session_token)

    user_doc = await server.db.users.find_one({"user_id": user_id}, {"_id": 0})
    return {"user": sanitize_user(user_doc), "session_token": session_token, "invite_error": invite_error}

@router.post("/auth/login")
@limiter.limit("10/minute")
async def login_user(request: Request, user_data: UserLogin, response: Response):
    """Login with email/password"""
    # Find user. The same generic error is used whether the email doesn't
    # exist, has no password (Google-only account), or the password is
    # wrong - a distinct message for any one of these would let an
    # unauthenticated caller enumerate which emails have registered
    # accounts and how they authenticate.
    generic_error = HTTPException(status_code=401, detail="Невалиден имейл или парола")
    user = await server.db.users.find_one({"email": user_data.email.lower()})
    if not user:
        raise generic_error

    if not user.get("password_hash"):
        raise generic_error

    # Verify password
    if not pwd_context.verify(user_data.password, user["password_hash"]):
        raise generic_error
    
    # Create session
    session_token = uuid.uuid4().hex
    expires_at = datetime.now(timezone.utc) + timedelta(days=7)
    session_doc = {
        "user_id": user["user_id"],
        "session_token": session_token,
        "expires_at": expires_at,
        "created_at": datetime.now(timezone.utc)
    }
    await server.db.user_sessions.insert_one(session_doc)
    
    # Set cookies (session + CSRF double-submit)
    set_session_cookies(response, session_token)
    
    user_doc = await server.db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
    return {"user": sanitize_user(user_doc), "session_token": session_token}

@router.put("/auth/change-password")
async def change_password(data: ChangePassword, current_user: User = Depends(get_current_user)):
    """Смяна на парола. Ако акаунтът (напр. Google вход) все още няма парола, я задава за пръв път."""
    user = await server.db.users.find_one({"user_id": current_user.user_id})
    if not user:
        raise HTTPException(status_code=401, detail="Потребителят не е намерен")

    existing_hash = user.get("password_hash")
    if existing_hash:
        if not data.current_password:
            raise HTTPException(status_code=400, detail="Въведете текущата парола")
        if not pwd_context.verify(data.current_password, existing_hash):
            raise HTTPException(status_code=401, detail="Грешна текуща парола")

    is_valid, error_msg = validate_password(data.new_password)
    if not is_valid:
        raise HTTPException(status_code=400, detail=error_msg)

    new_hash = pwd_context.hash(data.new_password)
    await server.db.users.update_one(
        {"user_id": current_user.user_id},
        {"$set": {"password_hash": new_hash}}
    )
    return {"message": "Паролата е сменена успешно"}

@router.post("/auth/forgot-password")
@limiter.limit("3/minute")
async def forgot_password(request: Request, data: ForgotPasswordRequest):
    """Изпраща код за възстановяване на паролата по имейл. Винаги връща
    същия отговор, независимо дали имейлът съществува, има парола, или
    не - иначе би издало кои имейли са регистрирани в системата."""
    if not EMAIL_FEATURES_ENABLED:
        raise HTTPException(status_code=503, detail="Възстановяването на парола временно не е налично. Моля, свържете се с администратора.")

    generic_response = {"message": "Ако имейлът съществува в системата, изпратихме код за възстановяване на паролата."}

    user = await server.db.users.find_one({"email": data.email.lower()})
    if not user or not user.get("password_hash"):
        # Doesn't exist, or is a Google-only account with no password to reset.
        return generic_response

    reset_code = PasswordResetCode(user_id=user["user_id"])
    await server.db.password_reset_codes.insert_one(reset_code.dict())

    await send_email(
        to_email=user["email"],
        subject="Код за възстановяване на паролата - Фактура+",
        html_body=(
            f"<p>Здравейте, {user.get('name', '')}!</p>"
            f"<p>Получихме заявка за възстановяване на паролата на вашия акаунт във Фактура+.</p>"
            f"<p>Вашият код за възстановяване е:</p>"
            f"<h2 style=\"letter-spacing:4px;\">{reset_code.code}</h2>"
            f"<p>Кодът е валиден 30 минути. Ако не сте заявили това, просто игнорирайте този имейл.</p>"
        ),
    )
    return generic_response

@router.post("/auth/reset-password")
@limiter.limit("10/minute")
async def reset_password(request: Request, data: ResetPasswordRequest):
    """Задава нова парола с код, изпратен по имейл от /auth/forgot-password."""
    is_valid, error_msg = validate_password(data.new_password)
    if not is_valid:
        raise HTTPException(status_code=400, detail=error_msg)

    # Same generic error whether the email doesn't exist or the code is
    # wrong/expired/already used - same enumeration concern as login.
    generic_error = HTTPException(status_code=400, detail="Невалиден или изтекъл код")

    user = await server.db.users.find_one({"email": data.email.lower()})
    if not user:
        raise generic_error

    code = data.code.upper().strip()
    reset_doc = await server.db.password_reset_codes.find_one({
        "user_id": user["user_id"], "code": code, "used": False
    })
    if not reset_doc:
        raise generic_error

    expires_at = reset_doc["expires_at"]
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < datetime.now(timezone.utc):
        raise generic_error

    new_hash = pwd_context.hash(data.new_password)
    await server.db.users.update_one({"user_id": user["user_id"]}, {"$set": {"password_hash": new_hash}})
    await server.db.password_reset_codes.update_one({"id": reset_doc["id"]}, {"$set": {"used": True}})

    # A password reset proves account ownership via email, but doesn't
    # prove every existing session is still trustworthy - if the reset was
    # triggered because a session got hijacked, that session shouldn't
    # survive the reset.
    await server.db.user_sessions.delete_many({"user_id": user["user_id"]})

    return {"message": "Паролата е сменена успешно. Моля, влезте отново."}

@router.put("/auth/role/{user_id}")
async def update_user_role(user_id: str, request: Request, current_user: User = Depends(get_current_user)):
    body = await request.json()
    role = body.get("role")
    # None here means "no explicit checklist edit" - resolve_permissions
    # then falls back to the role's default set, same as at invite time.
    requested_permissions = body.get("permissions")

    if current_user.role != "owner":
        raise HTTPException(status_code=403, detail="Само титулярят може да променя роли")

    if role not in ["owner", "manager", "staff", "accountant"]:
        raise HTTPException(status_code=400, detail="Невалидна роля. Допустими: owner, manager, staff, accountant")

    # Get target user
    target_user = await server.db.users.find_one({"user_id": user_id}, {"_id": 0})
    if not target_user:
        raise HTTPException(status_code=404, detail="Потребителят не е намерен")

    # Ensure same company
    if target_user.get("company_id") != current_user.company_id:
        raise HTTPException(status_code=403, detail="Потребителят не е от вашата фирма")

    # Cannot change own role if owner
    if user_id == current_user.user_id and current_user.role == "owner":
        raise HTTPException(status_code=400, detail="Не можете да променяте собствената си роля на собственик")

    # Demoting a co-owner strips their owner powers just as surely as
    # removing them would - it needs the same unanimous sign-off from the
    # other owners, not a single owner's unilateral edit. Promoting someone
    # TO owner, or changing role among non-owners, stays immediate.
    if target_user.get("role") == "owner" and role != "owner":
        pending_action = await request_owner_status_change(current_user.company_id, target_user, current_user, role)
        return {
            "status": "pending_approval",
            "message": "Промяната засяга собственик и изисква одобрение от другите собственици, преди да влезе в сила.",
            "action": pending_action,
        }

    permissions = resolve_permissions(role, requested_permissions)

    # Stamps this account as having gone through a real checklist save on
    # the current permissions schema - see sanitize_user's docstring for
    # why this stamp (not the resulting permission list) is what tells a
    # never-migrated legacy account apart from one that deliberately
    # unticked every sensitive-data toggle.
    result = await server.db.users.update_one(
        {"user_id": user_id},
        {"$set": {"role": role, "permissions": permissions, "permissions_schema_version": PERMISSIONS_SCHEMA_VERSION}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Потребителят не е намерен")

    # Keep the membership record (used by the accountant company switcher)
    # in sync, in case this user held accountant-level access here.
    await ensure_membership(user_id, current_user.company_id, role, permissions)

    # Role/permission changes are the single most sensitive action a company
    # owner can take - this is the one place GET /audit-logs must be able to
    # answer "who changed whose access, and to what" from.
    await audit_service.log_action(
        user_id=current_user.user_id,
        user_name=current_user.name,
        action="update_role",
        entity_type="user",
        entity_id=user_id,
        company_id=current_user.company_id,
        details={
            "target_name": target_user.get("name"),
            "old_role": target_user.get("role"),
            "new_role": role,
            "old_permissions": target_user.get("permissions", []),
            "new_permissions": permissions,
        },
    )

    return {"status": "executed", "message": "Ролята е обновена"}

@router.get("/auth/users")
async def get_all_users(current_user: User = Depends(get_current_user)):
    if current_user.role not in ["owner", "manager"]:
        raise HTTPException(status_code=403, detail="Нямате права за тази операция")
    
    if not current_user.company_id:
        return []
    
    users = await server.db.users.find(
        {"company_id": current_user.company_id},
        {"_id": 0, "user_id": 1, "email": 1, "name": 1, "role": 1, "permissions": 1, "picture": 1, "created_at": 1}
    ).to_list(1000)
    for u in users:
        if not u.get("permissions"):
            u["permissions"] = resolve_permissions(u.get("role", "staff"), None)

    # An accountant with access to this company might currently be
    # switched into a DIFFERENT client's data, so their live users.company_id
    # (and users.permissions, which follows the ACTIVE company) won't match
    # here - pull them in separately via their membership record, which
    # holds the role/permissions specific to THIS company.
    existing_ids = {u["user_id"] for u in users}
    accountant_memberships = await server.db.company_memberships.find(
        {"company_id": current_user.company_id, "role": "accountant"},
        {"_id": 0, "user_id": 1, "permissions": 1}
    ).to_list(1000)
    membership_permissions = {
        m["user_id"]: m.get("permissions") or resolve_permissions("accountant", None)
        for m in accountant_memberships
    }
    extra_ids = [uid for uid in membership_permissions if uid not in existing_ids]
    if extra_ids:
        extra_users = await server.db.users.find(
            {"user_id": {"$in": extra_ids}},
            {"_id": 0, "user_id": 1, "email": 1, "name": 1, "picture": 1, "created_at": 1}
        ).to_list(1000)
        for u in extra_users:
            u["role"] = "accountant"  # overrides whatever company they're currently active in
            u["permissions"] = membership_permissions[u["user_id"]]
        users.extend(extra_users)

    return users

@router.delete("/auth/users/{user_id}")
async def remove_user_from_company(user_id: str, current_user: User = Depends(get_current_user)):
    """Премахва потребител от фирмата (само Owner)"""
    if current_user.role != "owner":
        raise HTTPException(status_code=403, detail="Само титулярят може да премахва потребители")
    
    if user_id == current_user.user_id:
        raise HTTPException(status_code=400, detail="Не можете да премахнете себе си")
    
    target_user = await server.db.users.find_one({"user_id": user_id}, {"_id": 0})
    if not target_user:
        raise HTTPException(status_code=404, detail="Потребителят не е намерен")

    # A co-owner can never be unilaterally kicked out - see
    # request_owner_status_change's docstring for the full reasoning.
    if target_user.get("role") == "owner":
        if target_user.get("company_id") != current_user.company_id:
            raise HTTPException(status_code=403, detail="Потребителят не е от вашата фирма")
        pending_action = await request_owner_status_change(current_user.company_id, target_user, current_user, "remove")
        return {
            "status": "pending_approval",
            "message": "Премахването на собственик изисква одобрение от другите собственици, преди да влезе в сила.",
            "action": pending_action,
        }

    # An accountant's membership may exist here even while they're
    # currently switched into a different client's data, so check
    # company_memberships first rather than requiring an exact
    # company_id match.
    accountant_membership = await server.db.company_memberships.find_one({
        "user_id": user_id,
        "company_id": current_user.company_id,
        "role": "accountant",
    })
    if accountant_membership:
        await server.db.company_memberships.delete_one({
            "user_id": user_id,
            "company_id": current_user.company_id,
        })
        # If they're currently looking at this exact company, switch them
        # back to another membership of theirs (or clear it entirely).
        if target_user.get("company_id") == current_user.company_id:
            fallback = await server.db.company_memberships.find_one({"user_id": user_id}, {"_id": 0})
            if fallback:
                fallback_permissions = fallback.get("permissions") or resolve_permissions(fallback["role"], None)
                await server.db.users.update_one(
                    {"user_id": user_id},
                    {"$set": {"company_id": fallback["company_id"], "role": fallback["role"], "permissions": fallback_permissions}}
                )
            else:
                await server.db.users.update_one(
                    {"user_id": user_id},
                    {"$unset": {"company_id": ""}, "$set": {"role": "staff", "permissions": resolve_permissions("staff", None)}}
                )
        return {"status": "executed", "message": "Достъпът на счетоводителя е премахнат"}

    if target_user.get("company_id") != current_user.company_id:
        raise HTTPException(status_code=403, detail="Потребителят не е от вашата фирма")

    # Remove company_id from user (don't delete user) - also reset their
    # permissions to the forced staff role's defaults, otherwise a removed
    # manager/staff member keeps their old permissions array (sanitize_user
    # only backfills when it's empty, so a stale non-empty list survives
    # the role downgrade and would still be honored by require_permission
    # if they're later re-added to a company without an explicit re-invite).
    await server.db.users.update_one(
        {"user_id": user_id},
        {"$unset": {"company_id": ""}, "$set": {"role": "staff", "permissions": resolve_permissions("staff", None)}}
    )

    return {"status": "executed", "message": "Потребителят е премахнат от фирмата"}
