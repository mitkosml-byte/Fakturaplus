"""Module 1 audit finding - extracted from the former monolithic server.py.
Shares server.py's db/models/helpers/services via `from server import *`;
`db` and `AI_FEATURES_ENABLED` are the two globals tests/startup reassign
after module load, so this file always accesses them as `server.db` /
`server.AI_FEATURES_ENABLED` (qualified), never via the star-import, to
stay correct when server.py's test fixture monkeypatches them."""
from fastapi import APIRouter
from server import *
import server

router = APIRouter(prefix="/api")

@router.get("/utils/validate-eik")
async def check_eik(eik: str, current_user: User = Depends(get_current_user)):
    """Format + checksum check for a Bulgarian ЕИК/Булстат, used by the UI
    for live feedback while entering or reviewing a supplier's tax ID."""
    return validate_eik(eik)

@router.get("/company/owner-actions")
async def list_owner_actions(current_user: User = Depends(get_current_user)):
    """Чакащи заявки за премахване/понижаване на собственик - видими за
    всички собственици на фирмата, включително целта на заявката (пълна
    прозрачност е самата защита срещу злоупотреба)."""
    if current_user.role != "owner":
        raise HTTPException(status_code=403, detail="Само собственик може да вижда тези заявки")
    if not current_user.company_id:
        return []
    return await server.db.owner_actions.find(
        {"company_id": current_user.company_id, "status": "pending"}, {"_id": 0}
    ).sort("created_at", -1).to_list(100)

@router.post("/company/owner-actions/{action_id}/approve")
async def approve_owner_action(action_id: str, current_user: User = Depends(get_current_user)):
    if current_user.role != "owner":
        raise HTTPException(status_code=403, detail="Само собственик може да одобрява")
    action = await server.db.owner_actions.find_one({"id": action_id, "company_id": current_user.company_id}, {"_id": 0})
    if not action or action["status"] != "pending":
        raise HTTPException(status_code=404, detail="Заявката не е намерена")
    if current_user.user_id not in action["required_approver_ids"]:
        raise HTTPException(status_code=403, detail="Не сте сред собствениците, чието одобрение се изисква за тази заявка")

    approved_by = sorted(set(action.get("approved_by", [])) | {current_user.user_id})
    all_approved = set(action["required_approver_ids"]).issubset(set(approved_by))
    update = {"approved_by": approved_by}
    if all_approved:
        await execute_owner_action(action, executed_by=current_user)
        update["status"] = "executed"
        update["resolved_at"] = datetime.now(timezone.utc)
    await server.db.owner_actions.update_one({"id": action_id}, {"$set": update})
    return {"message": "Одобрено", "status": update.get("status", "pending")}

@router.post("/company/owner-actions/{action_id}/reject")
async def reject_owner_action(action_id: str, current_user: User = Depends(get_current_user)):
    if current_user.role != "owner":
        raise HTTPException(status_code=403, detail="Само собственик може да отхвърля")
    action = await server.db.owner_actions.find_one({"id": action_id, "company_id": current_user.company_id}, {"_id": 0})
    if not action or action["status"] != "pending":
        raise HTTPException(status_code=404, detail="Заявката не е намерена")
    # The target can always object to their own removal (extra protection
    # on top of the required-approvers rule), same as any required approver
    # or the person who requested it in the first place (their own withdrawal).
    allowed = current_user.user_id in (action["required_approver_ids"] + [action["target_user_id"], action["requested_by"]])
    if not allowed:
        raise HTTPException(status_code=403, detail="Нямате право да отхвърлите тази заявка")
    await server.db.owner_actions.update_one(
        {"id": action_id},
        {"$set": {"status": "rejected", "resolved_at": datetime.now(timezone.utc)}}
    )
    return {"message": "Заявката е отхвърлена"}

@router.post("/invitations")
async def create_invitation(invitation_data: InvitationCreate, current_user: User = Depends(get_current_user)):
    """Създава покана за нов потребител (само Owner)"""
    if current_user.role != "owner":
        raise HTTPException(status_code=403, detail="Само титулярят може да изпраща покани")

    if not current_user.company_id:
        raise HTTPException(status_code=400, detail="Нямате фирма")

    if not invitation_data.email and not invitation_data.phone:
        raise HTTPException(status_code=400, detail="Въведете имейл или телефон")

    if invitation_data.role not in ["manager", "staff", "accountant", "owner"]:
        raise HTTPException(status_code=400, detail="Невалидна роля за покана")
    
    # Check if user with this email already exists in the company
    if invitation_data.email:
        existing_user = await server.db.users.find_one({
            "email": invitation_data.email,
            "company_id": current_user.company_id
        })
        if existing_user:
            raise HTTPException(status_code=400, detail="Потребител с този имейл вече е член на фирмата")
    
    # Check for pending invitation - only match on whichever contact method
    # was actually provided; a bare {"phone": None}/{"email": None} clause
    # for the one NOT provided would otherwise match every other pending
    # invitation that also omitted it, flagging unrelated invites as
    # duplicates.
    contact_clauses = []
    if invitation_data.email:
        contact_clauses.append({"email": invitation_data.email})
    if invitation_data.phone:
        contact_clauses.append({"phone": invitation_data.phone})

    pending = await server.db.invitations.find_one({
        "company_id": current_user.company_id,
        "$or": contact_clauses,
        "status": "pending"
    })
    if pending:
        raise HTTPException(status_code=400, detail="Вече има активна покана за този контакт")
    
    invitation = Invitation(
        company_id=current_user.company_id,
        invited_by=current_user.user_id,
        email=invitation_data.email,
        phone=invitation_data.phone,
        role=invitation_data.role,
        permissions=resolve_permissions(invitation_data.role, invitation_data.permissions),
    )
    
    await server.db.invitations.insert_one(invitation.dict())
    
    # Get company name for response
    company = await server.db.companies.find_one({"id": current_user.company_id}, {"name": 1})
    company_name = company.get("name", "Unknown") if company else "Unknown"
    
    return {
        "message": "Поканата е създадена",
        "invitation": {
            "id": invitation.id,
            "code": invitation.code,
            "expires_at": invitation.expires_at.isoformat(),
            "company_name": company_name
        }
    }

@router.get("/invitations")
async def get_invitations(current_user: User = Depends(get_current_user)):
    """Връща всички покани за фирмата (само Owner)"""
    if current_user.role != "owner":
        raise HTTPException(status_code=403, detail="Само титулярят може да вижда покани")
    
    if not current_user.company_id:
        return []
    
    invitations = await server.db.invitations.find(
        {"company_id": current_user.company_id},
        {"_id": 0}
    ).sort("created_at", -1).to_list(100)
    
    return invitations

@router.delete("/invitations/{invitation_id}")
async def cancel_invitation(invitation_id: str, current_user: User = Depends(get_current_user)):
    """Отменя покана (само Owner)"""
    if current_user.role != "owner":
        raise HTTPException(status_code=403, detail="Само титулярят може да отменя покани")
    
    invitation = await server.db.invitations.find_one({
        "id": invitation_id,
        "company_id": current_user.company_id
    })
    
    if not invitation:
        raise HTTPException(status_code=404, detail="Поканата не е намерена")
    
    if invitation["status"] != "pending":
        raise HTTPException(status_code=400, detail="Поканата вече не е активна")
    
    await server.db.invitations.update_one(
        {"id": invitation_id},
        {"$set": {"status": "cancelled"}}
    )
    
    return {"message": "Поканата е отменена"}

@router.post("/invitations/accept")
@limiter.limit("10/minute")
async def accept_invitation(request: Request, current_user: User = Depends(get_current_user)):
    """Приема покана по код"""
    body = await request.json()
    code = body.get("code", "").upper().strip()

    if not code:
        raise HTTPException(status_code=400, detail="Въведете код на поканата")

    # Find valid invitation
    invitation = await server.db.invitations.find_one({
        "code": code,
        "status": "pending"
    })

    if not invitation:
        raise HTTPException(status_code=404, detail="Невалиден или изтекъл код")

    # Check expiry
    expires_at = invitation["expires_at"]
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)

    if expires_at < datetime.now(timezone.utc):
        await server.db.invitations.update_one(
            {"id": invitation["id"]},
            {"$set": {"status": "expired"}}
        )
        raise HTTPException(status_code=400, detail="Поканата е изтекла")

    # If the invitation was issued to a specific email, only that account may accept it
    if invitation.get("email") and invitation["email"].lower() != current_user.email.lower():
        raise HTTPException(status_code=403, detail="Тази покана е издадена за друг имейл адрес")

    # Accountant AND owner invitations don't require leaving your current
    # company first - a счетоводител can hold access to several client
    # companies at once (see /companies/switch), and someone becoming a
    # co-owner here very plausibly already owns a different business
    # elsewhere. Every other role keeps the one-company rule, UNLESS the
    # current company would be left with no one in it anyway (e.g. the
    # throwaway company that registration auto-creates for someone who
    # wasn't invited yet) - in that case there's no one to strand, so let
    # them switch straight over.
    if invitation["role"] not in ("accountant", "owner") and current_user.company_id:
        if await company_has_other_members(current_user.company_id, current_user.user_id):
            raise HTTPException(status_code=400, detail="Вече сте член на фирма. Първо напуснете текущата фирма.")

    invitation_permissions = invitation.get("permissions") or resolve_permissions(invitation["role"], None)

    # Preserve whatever company/role the user is switching away from as a
    # membership, so they can switch back to it later.
    if current_user.company_id:
        await ensure_membership(current_user.user_id, current_user.company_id, current_user.role, current_user.permissions)
    await ensure_membership(current_user.user_id, invitation["company_id"], invitation["role"], invitation_permissions)

    # Accept invitation - link user to company (this becomes their new
    # active company/role; for a счетоводител accepting a 2nd+ invitation
    # this switches them into the newly-joined company)
    await server.db.users.update_one(
        {"user_id": current_user.user_id},
        {"$set": {
            "company_id": invitation["company_id"],
            "role": invitation["role"],
            "permissions": invitation_permissions,
        }}
    )

    # Mark invitation as accepted
    await server.db.invitations.update_one(
        {"id": invitation["id"]},
        {"$set": {"status": "accepted"}}
    )
    
    # Get company info
    company = await server.db.companies.find_one({"id": invitation["company_id"]}, {"_id": 0})
    
    return {
        "message": f"Успешно се присъединихте към {company['name'] if company else 'фирмата'}",
        "company": company
    }

@router.get("/companies/memberships")
async def get_company_memberships(current_user: User = Depends(get_current_user)):
    """Списък с всички фирми, до които потребителят има достъп (за
    счетоводители с достъп до няколко фирми клиенти) - използва се за
    менюто за превключване на активната фирма."""
    memberships = await server.db.company_memberships.find(
        {"user_id": current_user.user_id}, {"_id": 0}
    ).to_list(100)

    # Backfill: make sure the currently-active company is always
    # represented, even for users who never went through /companies/switch
    if current_user.company_id and not any(m["company_id"] == current_user.company_id for m in memberships):
        await ensure_membership(current_user.user_id, current_user.company_id, current_user.role, current_user.permissions)
        memberships.append({"company_id": current_user.company_id, "role": current_user.role})

    company_ids = [m["company_id"] for m in memberships]
    companies = await server.db.companies.find(
        {"id": {"$in": company_ids}}, {"_id": 0, "id": 1, "name": 1}
    ).to_list(1000)
    company_names = {c["id"]: c["name"] for c in companies}

    result = []
    for m in memberships:
        result.append({
            "company_id": m["company_id"],
            "company_name": company_names.get(m["company_id"], "—"),
            "role": m["role"],
            "is_active": m["company_id"] == current_user.company_id,
        })

    result.sort(key=lambda m: (not m["is_active"], m["company_name"]))
    return result

@router.post("/companies/switch")
async def switch_active_company(request: Request, current_user: User = Depends(get_current_user)):
    """Превключва коя фирма е активна за потребителя. Работи само за фирми,
    за които вече има запис в company_memberships (собствена фирма или
    приета покана като счетоводител)."""
    body = await request.json()
    target_company_id = body.get("company_id")
    if not target_company_id:
        raise HTTPException(status_code=400, detail="Липсва company_id")

    if target_company_id == current_user.company_id:
        user_doc = await server.db.users.find_one({"user_id": current_user.user_id}, {"_id": 0})
        return sanitize_user(user_doc)

    membership = await server.db.company_memberships.find_one({
        "user_id": current_user.user_id,
        "company_id": target_company_id,
    })
    if not membership:
        raise HTTPException(status_code=403, detail="Нямате достъп до тази фирма")

    # Preserve the company/role we're switching away from as a membership
    if current_user.company_id:
        await ensure_membership(current_user.user_id, current_user.company_id, current_user.role, current_user.permissions)

    target_permissions = membership.get("permissions") or resolve_permissions(membership["role"], None)
    await server.db.users.update_one(
        {"user_id": current_user.user_id},
        {"$set": {"company_id": target_company_id, "role": membership["role"], "permissions": target_permissions}}
    )

    user_doc = await server.db.users.find_one({"user_id": current_user.user_id}, {"_id": 0})
    return sanitize_user(user_doc)

@router.post("/company/leave")
async def leave_company(current_user: User = Depends(get_current_user)):
    """Напускане на фирма (не може Owner)"""
    if not current_user.company_id:
        raise HTTPException(status_code=400, detail="Не сте член на фирма")

    if current_user.role == "accountant":
        # Just drop this one client relationship - switch back to another
        # membership (typically their own home company) if they have one.
        await server.db.company_memberships.delete_one({
            "user_id": current_user.user_id,
            "company_id": current_user.company_id,
        })
        fallback = await server.db.company_memberships.find_one({"user_id": current_user.user_id}, {"_id": 0})
        if fallback:
            fallback_permissions = fallback.get("permissions") or resolve_permissions(fallback["role"], None)
            await server.db.users.update_one(
                {"user_id": current_user.user_id},
                {"$set": {"company_id": fallback["company_id"], "role": fallback["role"], "permissions": fallback_permissions}}
            )
        else:
            await server.db.users.update_one(
                {"user_id": current_user.user_id},
                {"$unset": {"company_id": ""}, "$set": {"role": "staff", "permissions": resolve_permissions("staff", None)}}
            )
        return {"message": "Успешно напуснахте фирмата"}

    if current_user.role == "owner":
        # Leaving is fine as long as at least one OTHER owner remains to
        # keep the company running - with a co-owner still in place, other
        # (non-owner) teammates aren't being stranded either. Only a truly
        # sole owner of a company that has other people in it is blocked,
        # since there'd be no one left with owner authority at all.
        other_owners = await server.db.users.count_documents({
            "company_id": current_user.company_id, "role": "owner", "user_id": {"$ne": current_user.user_id}
        })
        if other_owners == 0 and await company_has_other_members(current_user.company_id, current_user.user_id):
            raise HTTPException(status_code=400, detail="Вие сте единственият собственик на фирма с други членове. Добавете друг собственик, преди да напуснете.")

    await server.db.users.update_one(
        {"user_id": current_user.user_id},
        {"$unset": {"company_id": ""}, "$set": {"role": "staff", "permissions": resolve_permissions("staff", None)}}
    )

    return {"message": "Успешно напуснахте фирмата"}

@router.get("/notifications/settings", response_model=NotificationSettings)
async def get_notification_settings(current_user: User = Depends(get_current_user)):
    settings = await server.db.notification_settings.find_one({"user_id": current_user.user_id}, {"_id": 0})
    if not settings:
        # Create default settings
        default_settings = NotificationSettings(user_id=current_user.user_id)
        await server.db.notification_settings.insert_one(default_settings.dict())
        return default_settings
    return NotificationSettings(**settings)

@router.put("/notifications/settings", response_model=NotificationSettings)
async def update_notification_settings(
    settings_update: NotificationSettingsUpdate,
    current_user: User = Depends(get_current_user)
):
    update_data = {k: v for k, v in settings_update.dict().items() if v is not None}
    update_data["updated_at"] = datetime.now(timezone.utc)

    existing = await server.db.notification_settings.find_one({"user_id": current_user.user_id}, {"_id": 0})

    # A raised/changed threshold deserves a fresh evaluation, not silence
    # until the OLD threshold's single already-sent alert would have fired
    # again under a completely different number - same convention as
    # budgets' alert_sent/exceeded_sent reset in create_budget.
    if existing and "vat_threshold_amount" in update_data and update_data["vat_threshold_amount"] != existing.get("vat_threshold_amount"):
        update_data["vat_threshold_sent_at"] = None

    if not existing:
        # Create new settings
        new_settings = NotificationSettings(user_id=current_user.user_id, **update_data)
        await server.db.notification_settings.insert_one(new_settings.dict())
        return new_settings
    
    await server.db.notification_settings.update_one(
        {"user_id": current_user.user_id},
        {"$set": update_data}
    )
    
    updated = await server.db.notification_settings.find_one({"user_id": current_user.user_id}, {"_id": 0})
    return NotificationSettings(**updated)

@router.post("/company", response_model=Company)
async def create_or_update_company(company_data: CompanyCreate, current_user: User = Depends(get_current_user)):
    """Създава нова фирма или обновява съществуваща (само Owner може да редактира)"""
    
    # Check if user already has a company
    user_doc = await server.db.users.find_one({"user_id": current_user.user_id}, {"_id": 0})
    
    if user_doc and user_doc.get("company_id"):
        # User has a company - only owner can edit
        if user_doc.get("role") != "owner":
            raise HTTPException(status_code=403, detail="Само титулярят може да редактира данните на фирмата")
        
        # Update existing company
        update_data = {k: v for k, v in company_data.dict().items() if v is not None}
        update_data["updated_at"] = datetime.now(timezone.utc)
        
        # Don't allow EIK change if company has other users
        other_users = await server.db.users.count_documents({
            "company_id": user_doc["company_id"],
            "user_id": {"$ne": current_user.user_id}
        })
        if other_users > 0 and "eik" in update_data:
            existing = await server.db.companies.find_one({"id": user_doc["company_id"]})
            if existing and existing.get("eik") != update_data["eik"]:
                raise HTTPException(status_code=400, detail="Не може да се промени ЕИК на фирма с други потребители")
        
        await server.db.companies.update_one(
            {"id": user_doc["company_id"]},
            {"$set": update_data}
        )
        
        updated_company = await server.db.companies.find_one({"id": user_doc["company_id"]}, {"_id": 0})
        return Company(**updated_company)
    else:
        # Check if company with this EIK already exists
        existing_company = await server.db.companies.find_one({"eik": company_data.eik}, {"_id": 0})
        
        if existing_company:
            raise HTTPException(status_code=400, detail="Фирма с този ЕИК вече съществува. Използвайте код за присъединяване.")
        
        # Create new company
        company = Company(**company_data.dict())
        await server.db.companies.insert_one(company.dict())
        
        # Link current user to this company as owner
        await server.db.users.update_one(
            {"user_id": current_user.user_id},
            {"$set": {"company_id": company.id, "role": "owner", "permissions": resolve_permissions("owner", None)}}
        )
        
        return company

@router.post("/companies", response_model=Company)
async def create_additional_company(company_data: CompanyCreate, current_user: User = Depends(get_current_user)):
    """Създава ДОПЪЛНИТЕЛНА фирма за потребител, който вече притежава (или
    членува в) поне една - за собственик на няколко отделни фирми/ООД-та.
    За разлика от POST /company (което създава само ако потребителят
    изобщо няма фирма, иначе редактира текущата), този endpoint винаги
    създава нова фирма, запазва достъпа до старата чрез company_memberships
    (същият механизъм, по който счетоводител държи няколко клиента) и
    превключва потребителя в новата - той може да се върне към старата по
    всяко време през превключвателя на фирми."""
    existing_company = await server.db.companies.find_one({"eik": company_data.eik}, {"_id": 0})
    if existing_company:
        raise HTTPException(status_code=400, detail="Фирма с този ЕИК вече съществува. Използвайте код за присъединяване.")

    company = Company(**company_data.dict())
    await server.db.companies.insert_one(company.dict())

    if current_user.company_id:
        await ensure_membership(current_user.user_id, current_user.company_id, current_user.role, current_user.permissions)
    permissions = resolve_permissions("owner", None)
    await ensure_membership(current_user.user_id, company.id, "owner", permissions)

    await server.db.users.update_one(
        {"user_id": current_user.user_id},
        {"$set": {"company_id": company.id, "role": "owner", "permissions": permissions}}
    )
    return company

@router.get("/company", response_model=Optional[Company])
async def get_my_company(current_user: User = Depends(get_current_user)):
    """Връща фирмата на текущия потребител"""
    user_doc = await server.db.users.find_one({"user_id": current_user.user_id}, {"_id": 0})
    
    if not user_doc or not user_doc.get("company_id"):
        return None
    
    company = await server.db.companies.find_one({"id": user_doc["company_id"]}, {"_id": 0})
    if not company:
        return None
    
    return Company(**company)

@router.put("/company", response_model=Company)
async def update_company(company_update: CompanyUpdate, current_user: User = Depends(get_current_user)):
    """Обновява фирмата на текущия потребител (само Owner)"""
    user_doc = await server.db.users.find_one({"user_id": current_user.user_id}, {"_id": 0})

    if not user_doc or not user_doc.get("company_id"):
        raise HTTPException(status_code=404, detail="Нямате свързана фирма. Първо създайте фирма.")

    if user_doc.get("role") != "owner":
        raise HTTPException(status_code=403, detail="Само титулярят може да редактира данните на фирмата")

    update_data = {k: v for k, v in company_update.dict().items() if v is not None}
    if not update_data:
        raise HTTPException(status_code=400, detail="Няма данни за обновяване")
    
    update_data["updated_at"] = datetime.now(timezone.utc)
    
    await server.db.companies.update_one(
        {"id": user_doc["company_id"]},
        {"$set": update_data}
    )
    
    updated_company = await server.db.companies.find_one({"id": user_doc["company_id"]}, {"_id": 0})
    return Company(**updated_company)

@router.get("/company/closed-date-exceptions", response_model=List[ClosedDateException])
async def get_closed_date_exceptions(current_user: User = Depends(get_current_user)):
    """Връща еднократните изключения от седмичния график (празници,
    извънредни затваряния или отваряния)."""
    company_id, _ = await get_company_scope(current_user)
    if not company_id:
        return []
    exceptions = await server.db.closed_date_exceptions.find(
        {"company_id": company_id}, {"_id": 0}
    ).sort("date", 1).to_list(2000)
    return [ClosedDateException(**e) for e in exceptions]

@router.put("/company/closed-date-exceptions", response_model=ClosedDateException)
async def upsert_closed_date_exception(payload: ClosedDateExceptionUpsert, current_user: User = Depends(get_current_user)):
    """Добавя/обновява изключение за конкретна дата (само Owner)."""
    require_permission(current_user, "manage_company")
    company_id, _ = await get_company_scope(current_user)
    if not company_id:
        raise HTTPException(status_code=400, detail="Нямате фирма")

    existing = await server.db.closed_date_exceptions.find_one({"company_id": company_id, "date": payload.date})
    if existing:
        await server.db.closed_date_exceptions.update_one(
            {"company_id": company_id, "date": payload.date},
            {"$set": {"closed": payload.closed, "label": payload.label}}
        )
        saved = await server.db.closed_date_exceptions.find_one({"company_id": company_id, "date": payload.date}, {"_id": 0})
    else:
        exception = ClosedDateException(company_id=company_id, date=payload.date, closed=payload.closed, label=payload.label)
        await server.db.closed_date_exceptions.insert_one(exception.dict())
        saved = exception.dict()
    return ClosedDateException(**saved)

@router.delete("/company/closed-date-exceptions/{date}")
async def delete_closed_date_exception(date: str, current_user: User = Depends(get_current_user)):
    """Премахва изключение за дата - денят се връща към седмичния график по подразбиране."""
    require_permission(current_user, "manage_company")
    company_id, _ = await get_company_scope(current_user)
    if not company_id:
        raise HTTPException(status_code=400, detail="Нямате фирма")
    result = await server.db.closed_date_exceptions.delete_one({"company_id": company_id, "date": date})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Няма изключение за тази дата")
    return {"message": "Изключението е премахнато"}

@router.get("/company/open-days-count")
async def get_open_days_count(start_date: str, end_date: str, current_user: User = Depends(get_current_user)):
    """Брой работни (неизключени) дни в затворен интервал [start_date, end_date]
    (YYYY-MM-DD, включително двата края) - използва се за коректно смятане
    на среден дневен оборот, без почивните дни да го влачат надолу."""
    company_id, _ = await get_company_scope(current_user)
    closed_weekdays, exceptions_map = await get_closed_days_lookup(company_id)

    start = datetime.strptime(start_date, "%Y-%m-%d").date()
    end = datetime.strptime(end_date, "%Y-%m-%d").date()
    if end < start:
        raise HTTPException(status_code=400, detail="Крайната дата е преди началната")

    total_days = (end - start).days + 1
    if total_days > 1827:  # ~5 years - far more than any real averaging window needs
        raise HTTPException(status_code=400, detail="Периодът е твърде голям (максимум 5 години)")
    open_days = 0
    d = start
    while d <= end:
        date_str = d.strftime("%Y-%m-%d")
        if not is_date_closed(date_str, closed_weekdays, exceptions_map):
            open_days += 1
        d += timedelta(days=1)

    return {"open_days": open_days, "closed_days": total_days - open_days, "total_days": total_days}
