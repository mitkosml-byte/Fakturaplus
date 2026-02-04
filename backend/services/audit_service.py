"""Audit logging service"""
from datetime import datetime, timezone
from typing import Optional
import uuid

class AuditService:
    def __init__(self, db):
        self.db = db
    
    async def log_action(
        self,
        user_id: str,
        user_name: str,
        action: str,
        entity_type: str,
        entity_id: Optional[str] = None,
        company_id: Optional[str] = None,
        details: Optional[dict] = None,
        ip_address: Optional[str] = None
    ):
        """Log an audit action"""
        log_entry = {
            "id": str(uuid.uuid4()),
            "company_id": company_id,
            "user_id": user_id,
            "user_name": user_name,
            "action": action,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "details": details,
            "ip_address": ip_address,
            "created_at": datetime.now(timezone.utc)
        }
        await self.db.audit_logs.insert_one(log_entry)
        return log_entry
    
    async def get_logs(
        self,
        company_id: Optional[str] = None,
        user_id: Optional[str] = None,
        action: Optional[str] = None,
        entity_type: Optional[str] = None,
        limit: int = 100
    ):
        """Get audit logs with filters"""
        query = {}
        if company_id:
            query["company_id"] = company_id
        if user_id:
            query["user_id"] = user_id
        if action:
            query["action"] = action
        if entity_type:
            query["entity_type"] = entity_type
        
        logs = await self.db.audit_logs.find(
            query, {"_id": 0}
        ).sort("created_at", -1).limit(limit).to_list(limit)
        
        return logs
