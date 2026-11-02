"""One full production attempt per Korean calendar day, even with --force."""
import json
from datetime import datetime
from services.trackify import KST


def claim(path, status_path, now, atomic_json):
    date = now.astimezone(KST).date().isoformat()
    prior = json.loads(path.read_text()) if path.exists() else {}
    status = json.loads(status_path.read_text()) if status_path.exists() else {}
    successful = status.get('lastSuccessfulCollection')
    if prior.get('kstDate') == date:
        return False
    if successful and datetime.fromisoformat(successful).astimezone(KST).date().isoformat() == date:
        return False
    atomic_json(path, {'kstDate':date,'startedAt':now.isoformat(),'status':'started',
                       'policy':'one full attempt per KST day; no automatic retry'})
    return True


def finish(path, result, report, atomic_json):
    if path is None:return
    prior = json.loads(path.read_text())
    atomic_json(path,{**prior,'status':result,'apiRequests':report})
