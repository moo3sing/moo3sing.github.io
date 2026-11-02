"""Cookie-free public Trackify adapter. Never use donors.total (a TOP-N count)."""
import json
import math
import time
import calendar
import copy
import io
from pathlib import Path
from datetime import datetime
from urllib.parse import urlencode, quote
from urllib.request import Request, build_opener, ProxyHandler, HTTPRedirectHandler
from urllib.error import HTTPError
from zoneinfo import ZoneInfo

BASE = 'https://www.trackify.kr/api/v1/p/soop'
KST = ZoneInfo('Asia/Seoul')
CACHE_SECONDS = 60 * 60
MIN_REQUEST_INTERVAL_SECONDS = 2.0


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


# Use this server's connection directly; redirects must not hide extra requests.
urlopen = build_opener(ProxyHandler({}), NoRedirect()).open


def collection_date(now=None):
    today = (now or datetime.now(KST)).astimezone(KST).date().isoformat()
    if not '2026-01-01' <= today <= '2026-11-30':
        raise ValueError('심사 기간 밖: 연간 API에 12월 데이터가 섞이지 않도록 마지막 성공 데이터를 유지합니다.')
    return today


class Trackify:
    def __init__(self):
        self.last_request = 0
        self.responses = {}
        self.requests = []
        self.cache_hits = 0
        self.blocked_error = None
        self.audit_dir = None

    def get(self, path, params, *, fresh=False):
        # A block latches for the entire run, including callers with fallback logic.
        if self.blocked_error is not None:
            raise self.blocked_error
        url = BASE + path + '?' + urlencode(sorted(params.items()))
        if not fresh and url in self.responses:
            self.cache_hits += 1
            return copy.deepcopy(self.responses[url])
        time.sleep(max(0, MIN_REQUEST_INTERVAL_SECONDS - (time.monotonic() - self.last_request)))
        self.last_request = time.monotonic()
        record = {'url':url, 'freshConfirmation':fresh, 'httpStatus':None}
        self.requests.append(record)
        try:
            with urlopen(Request(url, headers={'Accept':'application/json', 'User-Agent':'StreamerIndex/1.0 (public-statistics; daily-cache)'}), timeout=20) as response:
                record['httpStatus'] = response.status
                payload = response.read()
                if b'blocked ip' in payload.lower():
                    raise HTTPError(url,429,'Blocked IP',response.headers,io.BytesIO(payload))
                result = json.loads(payload)
            self.responses[url] = result
            if self.audit_dir:
                folder = Path(self.audit_dir)
                folder.mkdir(parents=True, exist_ok=True)
                (folder / f'response-{len(self.requests):03d}.json').write_text(json.dumps({'request':record,'response':result},ensure_ascii=False)+'\n')
            return copy.deepcopy(result)
        except HTTPError as exc:
            payload = exc.read()
            blocked = exc.code == 429 or b'blocked ip' in payload.lower()
            record['httpStatus'] = exc.code
            error = HTTPError(exc.url,429 if blocked else exc.code,exc.reason,exc.headers,io.BytesIO(payload))
            if blocked:
                self.blocked_error = error
                record['blocked'] = True
            raise error

    def request_report(self):
        urls = [r['url'] for r in self.requests]
        return {'totalRequests':len(urls),'cacheHits':self.cache_hits,
                'duplicateRequests':len(urls)-len(set(urls)),
                'freshConfirmationRequests':sum(r['freshConfirmation'] for r in self.requests),
                'http429':sum(r['httpStatus']==429 or r.get('blocked',False) for r in self.requests),
                'requests':self.requests}

    def candidates(self):
        result = self.get('/ranking/summary', {
            'range': 'yearly', 'date': '2026', 'sortKey': 'uviewer',
            'order': 'desc', 'page': 1, 'size': 200,
        })
        rows = result['items']
        if len(rows) < 140 or len({r['broadUserId'] for r in rows}) != len(rows):
            raise ValueError('후보 응답의 크기 또는 중복 ID 검증 실패')
        return rows

    def overview(self, soop_id, *, fresh=False):
        # The UI's "년별" view uses granularity=month&period=YYYY.
        # `from` and `to` do NOT constrain the overview section of /batch.
        return self.get('/streamer/' + quote(soop_id, safe=''), {
            'granularity': 'month', 'period': '2026',
        }, fresh=fresh)

    def monthly_users(self, soop_ids, period):
        """One filtered monthly summary, with explicit overview fallback for absent rows."""
        result = self.get('/ranking/summary', {
            'range': 'monthly', 'date': period, 'sortKey': 'uviewer',
            'order': 'desc', 'page': 1, 'size': 200, 'ids': ','.join(soop_ids),
        })
        if result.get('periodType') != 'monthly' or result.get('periodKey') != period:
            raise ValueError('월간 응답 기간 불일치')
        indexed = {row['broadUserId']: row for row in result['items']}
        rows, errors = [], []
        for soop_id in soop_ids:
            try:
                row = indexed.get(soop_id)
                actual_period = period
                if row is not None and row.get('uniqueViewers') is not None:
                    gain = number(row, 'uniqueViewers')
                    source = 'monthly-summary.uniqueViewers'
                else:
                    year, month = map(int, period.split('-'))
                    for lookback in range(4):
                        if month-lookback < 1:
                            raise ValueError('확인 가능한 최근 월간 통계 없음')
                        actual_period = f'{year}-{month-lookback:02d}'
                        detail = self.get('/streamer/' + quote(soop_id, safe=''), {
                            'granularity': 'day', 'period': actual_period,
                        })
                        if detail.get('userId') != soop_id:
                            raise ValueError('월간 스트리머 ID 불일치')
                        if detail.get('totalViewCountDelta') is not None:
                            break
                    gain = number(detail, 'totalViewCountDelta')
                    source = 'monthly-overview.totalViewCountDelta'
                rows.append({'soopId': soop_id, 'recentMonthlyUsers': gain, 'source': source,
                             'referenceMonth': actual_period, 'fallback': actual_period != period})
            except HTTPError as exc:
                if exc.code == 429: raise
                errors.append({'soopId': soop_id, 'message': str(exc)})
            except Exception as exc:
                errors.append({'soopId': soop_id, 'message': str(exc)})
        return {'rows': rows, 'errors': errors}


def fresh_overview(api, account):
    """Safety confirmations must observe the source again, never cached evidence."""
    return api.overview(account, fresh=True) if isinstance(api, Trackify) else api.overview(account)


def forecast_reference(now):
    local = now.astimezone(KST)
    # At the requested September baseline use September MTD conservatively, without scaling.
    # From October onwards use the latest completed calendar month.
    month = local.month if local.month <= 9 else local.month - 1
    return {'referenceMonth': f'2026-{month:02d}', 'isPartial': local.month == month,
            'paceBasis': 'observed-month-total', 'monthDays': calendar.monthrange(2026, month)[1]}


def number(data, key):
    value = data.get(key)
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
        raise ValueError('누락/비정상 통계 필드: ' + key)
    return value


def normalize(candidate, overview):
    if overview.get('userId') != candidate['broadUserId']:
        raise ValueError('스트리머 ID 불일치')
    hidden = overview.get('isBalloonHidden') is True
    return {
        'rankByViewer': number(candidate, 'rank'),
        'name': overview.get('userNick') or candidate['nick'],
        'soopId': candidate['broadUserId'], 'category': candidate.get('category', ''),
        'cumulativeUsers': number(overview, 'totalViewCountDelta'),
        'balloonCount': None if hidden else number(overview, 'monthBalloon'),
        'donorCount': None if hidden else number(overview, 'monthDonors'),
        'status': 'unavailable' if hidden else 'ok',
        'unavailableReason': 'Trackify 후원 통계 비공개' if hidden else None,
    }


def select_candidates(rows, exclusions):
    ids = {item['soopId'].casefold() for item in exclusions}
    return [r for r in rows if r['broadUserId'].casefold() not in ids][:100]
