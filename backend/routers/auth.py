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
import html

import server
from routers.company import accept_invitation_code
from services import two_factor as tf

router = APIRouter(prefix="/api")

# A login waiting for its second step: good for 10 minutes, 5 tries.
LOGIN_CHALLENGE_MINUTES = 10
LOGIN_CHALLENGE_TRIES = 5
# Wrong second-step codes for one account, across logins: after this many
# within the pause, no more tries (nor emailed codes) until it passes - so
# a known password cannot be paired with endless guesses of the code.
SECOND_STEP_FAILURES = 10
SECOND_STEP_PAUSE_MINUTES = 15

# The code that confirms the email of a new account: good for a day (the
# email may be read in the evening), 5 tries, a new one at most once a
# minute.
EMAIL_CODE_HOURS = 24
EMAIL_CODE_TRIES = 5
EMAIL_CODE_RESEND_SECONDS = 60
# At most this many codes a day for one account: with 5 tries each, a code
# cannot be guessed by asking for new ones, and an inbox is not flooded.
EMAIL_CODES_PER_DAY = 10


def _utc(value: Optional[datetime]) -> Optional[datetime]:
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


async def _send_email_code(user: Dict[str, Any]) -> bool:
    """A new code for the account's email - the one before it stops
    working. The email carries nothing the person who opened the account
    wrote (not even the name): it may reach someone else's inbox."""
    code = tf.new_email_code()
    now = datetime.now(timezone.utc)
    before: Dict[str, Any] = await server.db.email_verifications.find_one({"user_id": user["user_id"]}, {"_id": 0}) or {}
    day_start = _utc(before.get("day_start"))
    day_sends = int(before.get("day_sends") or 0)
    if not day_start or now - day_start >= timedelta(hours=24):
        day_start, day_sends = now, 0
    await server.db.email_verifications.update_one(
        {"user_id": user["user_id"]},
        {"$set": {
            "user_id": user["user_id"], "code_hash": tf.hash_code(code), "tries": 0,
            "sent_at": now, "expires_at": now + timedelta(hours=EMAIL_CODE_HOURS),
            "day_start": day_start, "day_sends": day_sends + 1,
        }},
        upsert=True,
    )
    return await server.send_email(
        to_email=user["email"],
        subject="Потвърдете имейла си - Фактура+",
        html_body=(
            "<p>Здравейте!</p>"
            "<p>С този имейл беше отворен профил във Фактура+. Кодът за потвърждение е:</p>"
            f"<h2 style=\"letter-spacing:4px;\">{code}</h2>"
            f"<p>Въведете го в приложението. Валиден е {EMAIL_CODE_HOURS} часа.</p>"
            "<p>Ако не сте били вие, не правете нищо: без кода профилът не може да влезе в ничия фирма.</p>"
        ),
    )


def _second_step_paused(second: Dict[str, Any]) -> bool:
    failed_at = second.get("failed_at")
    if not failed_at or int(second.get("failures") or 0) < SECOND_STEP_FAILURES:
        return False
    if failed_at.tzinfo is None:
        failed_at = failed_at.replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc) - failed_at < timedelta(minutes=SECOND_STEP_PAUSE_MINUTES)


SECOND_STEP_PAUSED = HTTPException(
    status_code=429, detail=f"Твърде много грешни кодове - опитайте отново след {SECOND_STEP_PAUSE_MINUTES} минути",
)


async def _second_step_failed(user_id: str, second: Dict[str, Any]) -> None:
    """Counts a wrong code - from the first after a quiet pause anew."""
    failed_at = second.get("failed_at")
    recent = False
    if failed_at:
        if failed_at.tzinfo is None:
            failed_at = failed_at.replace(tzinfo=timezone.utc)
        recent = datetime.now(timezone.utc) - failed_at < timedelta(minutes=SECOND_STEP_PAUSE_MINUTES)
    failures = (int(second.get("failures") or 0) if recent else 0) + 1
    await server.db.users.update_one({"user_id": user_id}, {"$set": {
        "two_factor.failures": failures, "two_factor.failed_at": datetime.now(timezone.utc),
    }})


async def _start_session(user_id: str, response: Response) -> Dict[str, Any]:
    """A new 7-day session for this user, as the cookies and the reply."""
    session_token = uuid.uuid4().hex
    now = datetime.now(timezone.utc)
    await server.db.user_sessions.insert_one({
        "user_id": user_id, "session_token": session_token,
        "expires_at": now + timedelta(days=7), "created_at": now,
    })
    set_session_cookies(response, session_token)
    user_doc = await server.db.users.find_one({"user_id": user_id}, {"_id": 0})
    return {"user": sanitize_user(user_doc or {}), "session_token": session_token}


async def _send_login_code(user: dict, code: str) -> bool:
    return await server.send_email(
        to_email=user["email"],
        subject="Код за вход - Фактура+",
        html_body=(
            f"<p>Здравейте, {html.escape(user.get('name') or '')}!</p>"
            f"<p>Кодът за вход във Фактура+ е:</p><h2 style=\"letter-spacing:4px;\">{code}</h2>"
            f"<p>Валиден е {LOGIN_CHALLENGE_MINUTES} минути. Ако не влизате вие, сменете паролата си.</p>"
        ),
    )

@router.get("/auth/me")
async def get_me(current_user: User = Depends(get_current_user)):
    return current_user.model_dump()

# ~500KB raw after the ~4/3 base64 expansion - generous for a small square
# avatar once the client has center-cropped/resized it (see the frontend
# upload flow), but still a fixed, small cap regardless of what a client
# actually sends - same data-URI-length-as-byte-size-proxy approach as
# MAX_OCR_IMAGE_BASE64_CHARS in routers/scan_credits.py, scaled way down
# since a profile picture (unlike an invoice scan) is fetched and rendered
# everywhere this person's identity shows up, not read once by OCR.
MAX_PICTURE_BASE64_CHARS = 700_000

@router.put("/auth/me/picture")
async def update_my_picture(data: UpdatePictureRequest, current_user: User = Depends(get_current_user)):
    """Sets/replaces/clears the caller's own profile picture - the same
    data-URI base64 convention already used for invoice/asset/payroll
    images. Stored once on the user document; every other screen that
    shows this person's identity (team list, chat, calendar, audit log,
    "scanned by" on invoices) resolves it via GET /company/directory
    rather than denormalizing a copy, so it updates everywhere the moment
    it's changed here."""
    picture = data.picture
    if picture is not None:
        if not picture.startswith("data:image/") or "," not in picture:
            raise HTTPException(status_code=400, detail="Невалиден формат на снимката")
        _, payload = picture.split(",", 1)
        if len(payload) > MAX_PICTURE_BASE64_CHARS:
            raise HTTPException(status_code=413, detail="Снимката е твърде голяма. Моля, използвайте по-малка снимка.")
    await server.db.users.update_one({"user_id": current_user.user_id}, {"$set": {"picture": picture}})
    return {"picture": picture}

@router.get("/company/directory")
async def get_company_directory(current_user: User = Depends(get_current_user)):
    """Every company member's name + picture, nothing else - resolves
    "who did this" wherever a document only ever stored a user_id/name
    snapshot (invoices' scanner, calendar event creators, audit log
    actors, chat senders no longer in the conversation's own member
    list). Not gated beyond belonging to a company: a teammate's name is
    already visible in half a dozen other places (invitations, audit log,
    chat) with no extra permission check, and their current picture
    alongside it carries no more sensitivity than that."""
    if not current_user.company_id:
        return []
    users = await server.db.users.find(
        {"company_id": current_user.company_id}, {"_id": 0, "user_id": 1, "name": 1, "picture": 1}
    ).to_list(1000)
    # An accountant with access to this company might currently be
    # switched into a different client - same cross-reference as
    # /auth/users and get_team_members, so a past action of theirs here
    # still resolves to their real name/picture.
    existing_ids = {u["user_id"] for u in users}
    accountant_ids = await server.db.company_memberships.distinct(
        "user_id", {"company_id": current_user.company_id, "role": "accountant"}
    )
    extra_ids = [uid for uid in accountant_ids if uid not in existing_ids]
    if extra_ids:
        users.extend(await server.db.users.find(
            {"user_id": {"$in": extra_ids}}, {"_id": 0, "user_id": 1, "name": 1, "picture": 1}
        ).to_list(1000))
    return users

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

    # A new account confirms its email with a code (whenever the program
    # sends email at all). Until then a good invitation only waits: the
    # account starts in its own new company, as with a code that did not
    # work, and joins the inviter's once the code is in - an invitation goes
    # to a person by their email, and anyone can type any email here.
    needs_check = server.EMAIL_FEATURES_ENABLED
    pending_invitation_code = invitation["code"] if invitation and needs_check else None
    if pending_invitation_code:
        invitation = None

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
        await server.db.companies.insert_one(new_company.model_dump())
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
        "email_verified": not needs_check,
        "created_at": datetime.now(timezone.utc)
    }
    if pending_invitation_code:
        new_user["pending_invitation_code"] = pending_invitation_code
    await server.db.users.insert_one(new_user)

    if invitation:
        await ensure_membership(user_id, company_id, role, permissions)
        await server.db.invitations.update_one({"id": invitation["id"]}, {"$set": {"status": "accepted"}})

    email_code_sent = await _send_email_code(new_user) if needs_check else False

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
    assert user_doc is not None  # the user document was just inserted above under this same user_id
    return {
        "user": sanitize_user(user_doc), "session_token": session_token, "invite_error": invite_error,
        "email_code_sent": email_code_sent,
    }


class EmailCode(BaseModel):
    code: str = Field(min_length=4, max_length=20)


@router.post("/auth/verify-email")
@limiter.limit("10/minute")
async def verify_email(request: Request, payload: EmailCode, current_user: User = Depends(get_current_user)):
    """Confirms the account's email with the code sent to it; an invitation
    kept from the registration is taken up right after."""
    user = await server.db.users.find_one({"user_id": current_user.user_id}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="Потребителят не е намерен")
    if not server.email_is_verified(user):
        invalid = HTTPException(status_code=400, detail="Невалиден или изтекъл код - поискайте нов")
        sent = await server.db.email_verifications.find_one({"user_id": user["user_id"]}, {"_id": 0})
        if not sent or not sent.get("code_hash"):
            raise invalid
        expires_at = _utc(sent["expires_at"])
        if (expires_at and expires_at < datetime.now(timezone.utc)) or int(sent.get("tries") or 0) >= EMAIL_CODE_TRIES:
            # Spent - but the record of when codes went out stays, so asking
            # for new ones keeps its pace.
            await server.db.email_verifications.update_one({"user_id": user["user_id"]}, {"$set": {"code_hash": None}})
            raise invalid
        if not tf.matches_hash(payload.code, sent.get("code_hash")):
            await server.db.email_verifications.update_one({"user_id": user["user_id"]}, {"$inc": {"tries": 1}})
            raise invalid
        # Each code counts once, even for two tries at the same moment.
        spent = await server.db.email_verifications.delete_one({"user_id": user["user_id"], "code_hash": sent["code_hash"]})
        if spent.deleted_count != 1:
            raise invalid
        await server.db.users.update_one({"user_id": user["user_id"]}, {"$set": {"email_verified": True}})

    joined_company = None
    invite_error = None
    pending = user.get("pending_invitation_code")
    if pending:
        await server.db.users.update_one({"user_id": user["user_id"]}, {"$unset": {"pending_invitation_code": ""}})
        fresh = await server.db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
        try:
            joined = await accept_invitation_code(User(**sanitize_user(fresh or {})), pending)
            joined_company = joined.get("company")
        except HTTPException as e:
            invite_error = str(e.detail)
    user_doc = await server.db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
    return {"user": sanitize_user(user_doc or {}), "joined_company": joined_company, "invite_error": invite_error}


@router.post("/auth/verify-email/resend")
@limiter.limit("3/minute")
async def resend_email_code(request: Request, current_user: User = Depends(get_current_user)):
    """A new code for the account's email - at most once a minute."""
    user = await server.db.users.find_one({"user_id": current_user.user_id}, {"_id": 0})
    if not user or server.email_is_verified(user):
        return {"sent": False, "already_verified": True}
    last: Dict[str, Any] = await server.db.email_verifications.find_one({"user_id": user["user_id"]}, {"_id": 0}) or {}
    now = datetime.now(timezone.utc)
    sent_at = _utc(last.get("sent_at"))
    if sent_at and now - sent_at < timedelta(seconds=EMAIL_CODE_RESEND_SECONDS):
        raise HTTPException(status_code=429, detail="Нов код може след минута - проверете и папката за нежелана поща")
    day_start = _utc(last.get("day_start"))
    if day_start and now - day_start < timedelta(hours=24) and int(last.get("day_sends") or 0) >= EMAIL_CODES_PER_DAY:
        raise HTTPException(status_code=429, detail="Днес бяха изпратени много кодове - опитайте отново утре")
    return {"sent": await _send_email_code(user), "already_verified": False}

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

    # A second step at login, for whoever turned it on: no session yet -
    # a short-lived challenge the code (or a recovery code) completes.
    second = user.get("two_factor") or {}
    if second.get("method"):
        if _second_step_paused(second):
            raise SECOND_STEP_PAUSED
        challenge: Dict[str, Any] = {
            "token": uuid.uuid4().hex, "user_id": user["user_id"], "method": second["method"], "tries": 0,
            "expires_at": datetime.now(timezone.utc) + timedelta(minutes=LOGIN_CHALLENGE_MINUTES),
        }
        reply: Dict[str, Any] = {"two_factor_required": True, "challenge_token": challenge["token"], "method": second["method"]}
        if second["method"] == "email":
            code = tf.new_email_code()
            challenge["code_hash"] = tf.hash_code(code)
            # Not sent (email not working): the recovery codes still let in.
            reply["code_sent"] = await _send_login_code(user, code)
        await server.db.login_challenges.insert_one(challenge)
        return reply

    return await _start_session(user["user_id"], response)


class SecondStepLogin(BaseModel):
    challenge_token: str
    code: str = Field(min_length=4, max_length=20)


@router.post("/auth/login/2fa")
@limiter.limit("10/minute")
async def login_second_step(request: Request, payload: SecondStepLogin, response: Response):
    """The second step of a login: the code of the authenticator app (or
    the one sent by email), or one of the recovery codes."""
    invalid = HTTPException(status_code=401, detail="Невалиден или изтекъл код")
    challenge = await server.db.login_challenges.find_one({"token": payload.challenge_token}, {"_id": 0})
    if not challenge:
        raise invalid
    expires_at = challenge["expires_at"]
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < datetime.now(timezone.utc) or challenge.get("tries", 0) >= LOGIN_CHALLENGE_TRIES:
        await server.db.login_challenges.delete_one({"token": payload.challenge_token})
        raise invalid
    user = await server.db.users.find_one({"user_id": challenge["user_id"]}, {"_id": 0})
    second = (user or {}).get("two_factor") or {}
    if not user or not second.get("method"):
        raise invalid
    if _second_step_paused(second):
        raise SECOND_STEP_PAUSED

    # Each code counts once, even for two tries at the same moment: the app's
    # time step and a recovery code are claimed in the same write that
    # checks them, and the challenge itself is spent the same way.
    accepted = False
    if second["method"] == "totp":
        step = tf.verify_app_code(second.get("secret") or "", payload.code, second.get("last_step"))
        if step is not None:
            claimed = await server.db.users.update_one(
                {"user_id": user["user_id"], "$or": [{"two_factor.last_step": None}, {"two_factor.last_step": {"$lt": step}}]},
                {"$set": {"two_factor.last_step": step}},
            )
            accepted = claimed.modified_count == 1
    elif tf.matches_hash(payload.code, challenge.get("code_hash")):
        accepted = True
    if not accepted:
        hashed = tf.hash_code(payload.code)
        claimed = await server.db.users.update_one(
            {"user_id": user["user_id"], "two_factor.recovery_codes": hashed},
            {"$pull": {"two_factor.recovery_codes": hashed}},
        )
        accepted = claimed.modified_count == 1
    if not accepted:
        await server.db.login_challenges.update_one({"token": payload.challenge_token}, {"$inc": {"tries": 1}})
        await _second_step_failed(user["user_id"], second)
        raise invalid
    spent = await server.db.login_challenges.delete_one({"token": payload.challenge_token})
    if spent.deleted_count != 1:
        raise invalid
    if second.get("failures"):
        await server.db.users.update_one({"user_id": user["user_id"]}, {"$unset": {"two_factor.failures": "", "two_factor.failed_at": ""}})
    return await _start_session(user["user_id"], response)


class SecondStepSetup(BaseModel):
    method: Literal["totp", "email"]
    # The password again: a session left open on someone else's phone
    # cannot turn the second step on with an app of theirs.
    password: Optional[str] = None


class SecondStepCode(BaseModel):
    code: str = Field(min_length=4, max_length=20)


class SecondStepOff(BaseModel):
    password: Optional[str] = None
    code: Optional[str] = None


@router.get("/auth/2fa")
async def second_step_status(current_user: User = Depends(get_current_user)):
    user = await server.db.users.find_one({"user_id": current_user.user_id}, {"_id": 0, "two_factor": 1})
    second = (user or {}).get("two_factor") or {}
    return {
        "enabled": bool(second.get("method")), "method": second.get("method"),
        "recovery_codes_left": len(second.get("recovery_codes") or []),
        "email_available": server.EMAIL_FEATURES_ENABLED,
        # Recommended for whoever sees the whole business.
        "recommended": current_user.role in ("owner", "manager"),
    }


@router.post("/auth/2fa/setup")
@limiter.limit("5/minute")
async def second_step_setup(request: Request, payload: SecondStepSetup, current_user: User = Depends(get_current_user)):
    """Starts turning the second step on: a secret for the authenticator
    app (to type in or open as a link), or a code sent by email - either
    confirmed with a code before it counts."""
    user = await server.db.users.find_one({"user_id": current_user.user_id}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="Потребителят не е намерен")
    if (user.get("two_factor") or {}).get("method"):
        raise HTTPException(status_code=400, detail="Втората стъпка вече е включена")
    if user.get("password_hash") and not (payload.password and pwd_context.verify(payload.password, user["password_hash"])):
        raise HTTPException(status_code=401, detail="Грешна парола")
    expires = datetime.now(timezone.utc) + timedelta(minutes=LOGIN_CHALLENGE_MINUTES)
    if payload.method == "totp":
        secret = tf.new_secret()
        await server.db.users.update_one({"user_id": current_user.user_id}, {"$set": {
            "two_factor_pending": {"method": "totp", "secret": secret, "expires_at": expires},
        }})
        return {"method": "totp", "secret": secret, "otpauth_uri": tf.otpauth_uri(secret, user.get("email") or "")}
    if not server.EMAIL_FEATURES_ENABLED:
        raise HTTPException(status_code=503, detail="Изпращането на имейли не е настроено - ползвайте приложение за кодове")
    code = tf.new_email_code()
    await server.db.users.update_one({"user_id": current_user.user_id}, {"$set": {
        "two_factor_pending": {"method": "email", "code_hash": tf.hash_code(code), "expires_at": expires},
    }})
    await _send_login_code(user, code)
    return {"method": "email", "sent_to": user.get("email")}


@router.post("/auth/2fa/enable")
@limiter.limit("10/minute")
async def second_step_enable(request: Request, payload: SecondStepCode, current_user: User = Depends(get_current_user)):
    """Turns the second step on once its first code is right - and gives
    the recovery codes, shown this once."""
    user = await server.db.users.find_one({"user_id": current_user.user_id}, {"_id": 0})
    pending = (user or {}).get("two_factor_pending") or {}
    expires_at = pending.get("expires_at")
    if expires_at and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if not pending or not expires_at or expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Започнете отначало - кодът изтече")
    step = None
    if pending["method"] == "totp":
        step = tf.verify_app_code(pending.get("secret") or "", payload.code)
        if step is None:
            raise HTTPException(status_code=400, detail="Грешен код - проверете часа на телефона и опитайте пак")
    elif not tf.matches_hash(payload.code, pending.get("code_hash")):
        raise HTTPException(status_code=400, detail="Грешен код")
    recovery = tf.new_recovery_codes()
    await server.db.users.update_one({"user_id": current_user.user_id}, {
        "$set": {"two_factor": {
            "method": pending["method"], "secret": pending.get("secret"), "last_step": step,
            "recovery_codes": [tf.hash_code(c) for c in recovery], "enabled_at": datetime.now(timezone.utc),
        }},
        "$unset": {"two_factor_pending": ""},
    })
    await audit_service.log_action(
        user_id=current_user.user_id, user_name=current_user.name, action="update", entity_type="user_security",
        entity_id=current_user.user_id, company_id=current_user.company_id, details={"two_factor": pending["method"]},
    )
    return {"enabled": True, "method": pending["method"], "recovery_codes": recovery}


@router.post("/auth/2fa/disable")
@limiter.limit("5/minute")
async def second_step_disable(request: Request, payload: SecondStepOff, current_user: User = Depends(get_current_user)):
    """Turns the second step off - with the password (and, for the app, a
    code of it or a recovery code), so a borrowed session cannot."""
    user = await server.db.users.find_one({"user_id": current_user.user_id}, {"_id": 0})
    second = (user or {}).get("two_factor") or {}
    if not user or not second.get("method"):
        raise HTTPException(status_code=400, detail="Втората стъпка не е включена")
    if user.get("password_hash") and not (payload.password and pwd_context.verify(payload.password, user["password_hash"])):
        raise HTTPException(status_code=401, detail="Грешна парола")
    if second["method"] == "totp":
        good_code = payload.code and (
            tf.verify_app_code(second.get("secret") or "", payload.code, second.get("last_step")) is not None
            or tf.hash_code(payload.code) in (second.get("recovery_codes") or [])
        )
        if not good_code:
            raise HTTPException(status_code=400, detail="Въведете код от приложението или резервен код")
    await server.db.users.update_one({"user_id": current_user.user_id}, {"$unset": {"two_factor": "", "two_factor_pending": ""}})
    await audit_service.log_action(
        user_id=current_user.user_id, user_name=current_user.name, action="update", entity_type="user_security",
        entity_id=current_user.user_id, company_id=current_user.company_id, details={"two_factor": "off"},
    )
    return {"enabled": False}

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

@router.post("/auth/delete-account")
async def delete_account(
    data: DeleteAccountRequest,
    request: Request,
    response: Response,
    current_user: User = Depends(get_current_user),
):
    """Трайно изтриване на собствения акаунт - личните данни на потребителя
    (име, имейл, парола, снимка, сесии), не и фирмените записи (фактури,
    служители, одит лог и т.н.), които остават собственост на фирмата и са
    по закон запазени дори след като неин член напусне - същият принцип
    като leave_company по-горе. Блокира се само ако потребителят е
    единственият собственик (owner) на фирма с други членове - изтриването
    тогава би ги оставило без никакъв owner, точно както при leave_company."""
    user = await server.db.users.find_one({"user_id": current_user.user_id})
    if not user:
        raise HTTPException(status_code=401, detail="Потребителят не е намерен")

    existing_hash = user.get("password_hash")
    if existing_hash:
        if not data.password:
            raise HTTPException(status_code=400, detail="Въведете паролата си, за да потвърдите изтриването на акаунта")
        if not pwd_context.verify(data.password, existing_hash):
            raise HTTPException(status_code=401, detail="Грешна парола")

    # Every company this user owns - the currently active one plus any other
    # membership (an accountant/multi-company owner can hold several, see
    # CompanyMembership above).
    owned_company_ids = set()
    if user.get("company_id") and user.get("role") == "owner":
        owned_company_ids.add(user["company_id"])
    owner_memberships = await server.db.company_memberships.find(
        {"user_id": current_user.user_id, "role": "owner"}, {"_id": 0, "company_id": 1}
    ).to_list(1000)
    owned_company_ids.update(m["company_id"] for m in owner_memberships)

    blocking_company_names = []
    for company_id in owned_company_ids:
        other_owners = await server.db.users.count_documents({
            "company_id": company_id, "role": "owner", "user_id": {"$ne": current_user.user_id}
        })
        if other_owners == 0 and await company_has_other_members(company_id, current_user.user_id):
            company_doc = await server.db.companies.find_one({"id": company_id}, {"_id": 0, "name": 1})
            blocking_company_names.append(company_doc["name"] if company_doc else company_id)

    if blocking_company_names:
        raise HTTPException(
            status_code=400,
            detail=(
                "Вие сте единственият собственик на фирма с други членове ({}). "
                "Добавете друг собственик или прехвърлете правата, преди да изтриете акаунта си."
            ).format(", ".join(blocking_company_names)),
        )

    # Logged under the still-active company (if any) before the user doc
    # disappears - the one place GET /audit-logs lets the remaining team see
    # that this member deleted their own account, not just vanished.
    if user.get("company_id"):
        await audit_service.log_action(
            user_id=current_user.user_id,
            user_name=current_user.name,
            action="delete",
            entity_type="user_account",
            entity_id=current_user.user_id,
            company_id=user["company_id"],
            details={"self_deleted": True},
        )

    await server.db.company_memberships.delete_many({"user_id": current_user.user_id})
    await server.db.user_sessions.delete_many({"user_id": current_user.user_id})
    await server.db.password_reset_codes.delete_many({"user_id": current_user.user_id})
    await server.db.push_subscriptions.delete_many({"user_id": current_user.user_id})
    await server.db.users.delete_one({"user_id": current_user.user_id})

    clear_session_cookies(response)
    return {"message": "Акаунтът е изтрит успешно"}

@router.post("/auth/forgot-password")
@limiter.limit("3/minute")
async def forgot_password(request: Request, data: ForgotPasswordRequest):
    """Изпраща код за възстановяване на паролата по имейл. Винаги връща
    същия отговор, независимо дали имейлът съществува, има парола, или
    не - иначе би издало кои имейли са регистрирани в системата."""
    if not server.EMAIL_FEATURES_ENABLED:
        raise HTTPException(status_code=503, detail="Възстановяването на парола временно не е налично. Моля, свържете се с администратора.")

    generic_response = {"message": "Ако имейлът съществува в системата, изпратихме код за възстановяване на паролата."}

    user = await server.db.users.find_one({"email": data.email.lower()})
    if not user or not user.get("password_hash"):
        # Doesn't exist, or is a Google-only account with no password to reset.
        return generic_response

    reset_code = PasswordResetCode(user_id=user["user_id"])
    await server.db.password_reset_codes.insert_one(reset_code.model_dump())

    await server.send_email(
        to_email=user["email"],
        subject="Код за възстановяване на паролата - Фактура+",
        html_body=(
            f"<p>Здравейте, {html.escape(user.get('name') or '')}!</p>"
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
    # The code came to this inbox: the email is confirmed by it as well.
    await server.db.users.update_one({"user_id": user["user_id"]}, {"$set": {"password_hash": new_hash, "email_verified": True}})
    await server.db.email_verifications.delete_one({"user_id": user["user_id"]})
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
