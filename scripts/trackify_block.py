"""Persistent Retry-After gate for automatic Trackify collection."""
import json
from datetime import datetime,timezone,timedelta
from email.utils import parsedate_to_datetime
from urllib.error import HTTPError

def load(path):
    return json.loads(path.read_text()) if path and path.exists() else {}

def active(path,now):
    state=load(path)
    until=state.get('blockedUntil')
    return state if until and now<datetime.fromisoformat(until) else None

def record_429(exc,path,now,atomic_json):
    if not isinstance(exc,HTTPError) or exc.code!=429 or not path:return None
    body={}
    try:body=json.loads(exc.read().decode('utf-8'))
    except Exception:pass
    raw=exc.headers.get('Retry-After') if exc.headers else None
    seconds=None
    if raw:
        try:seconds=int(raw)
        except ValueError:
            try:seconds=max(0,int((parsedate_to_datetime(raw)-now).total_seconds()))
            except (TypeError,ValueError):pass
    if seconds is None and type(body.get('retryAfter')) is int:seconds=body['retryAfter']
    if seconds is None:seconds=86400
    until=now+timedelta(seconds=max(0,seconds))
    state={'blockedUntil':until.isoformat(),'recordedAt':now.isoformat(),'retryAfterSeconds':seconds,
           'source':'Trackify HTTP 429','message':body.get('message','Too Many Requests')}
    atomic_json(path,state)
    return state
