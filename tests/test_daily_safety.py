import copy
import io
import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch, Mock
from urllib.error import HTTPError

from services.trackify import Trackify, KST, fresh_overview
from scripts.collect import collect, atomic_json
from scripts.daily_collection import claim
from scripts.viewer_adjustments import adjust, raw_previous
from scripts.dynamic_collect import dynamic_snapshot, calculate_targets
from scripts.rolling_inputs import build_rolling_inputs

ROOT = Path(__file__).resolve().parents[1]
# Fixed two-event fixture; operational assumptions may acquire later distinct events.
POLICY = {'streamerId':'singgyul','viewerAdjustments':[
    {'date':'2026-10-17','delta':-20000,'reason':'suspected_viewbot_traffic'},
    {'date':'2026-10-18','delta':-20000,'reason':'suspected_viewbot_traffic'}],
    'sourceCorrectionResolutions':[]}


def response(data):
    result = Mock()
    result.status = 200
    result.read.return_value = json.dumps(data).encode()
    result.__enter__ = Mock(return_value=result)
    result.__exit__ = Mock(return_value=False)
    return result


def blocked(code=429, body=b'{"message":"Blocked IP","retryAfter":3600}'):
    return HTTPError('https://www.trackify.kr/test',code,'Blocked',{'Retry-After':'3600'},io.BytesIO(body))


class AdapterSafetyTests(unittest.TestCase):
    def test_response_reuse_and_fresh_safety_confirmation(self):
        with patch('services.trackify.urlopen',return_value=response({'value':1})) as request, patch('services.trackify.time.sleep'):
            api=Trackify()
            first=api.get('/test',{'b':2,'a':1});first['value']=9
            self.assertEqual(api.get('/test',{'a':1,'b':2})['value'],1)
            self.assertEqual(request.call_count,1)
            api.overview('singgyul');fresh_overview(api,'singgyul')
            self.assertEqual(request.call_count,3)
            self.assertEqual(api.request_report()['cacheHits'],1)
            self.assertEqual(api.request_report()['freshConfirmationRequests'],1)

    def test_block_latches_for_all_remaining_candidates_without_retry(self):
        for code in (429,403):
            with self.subTest(code=code),patch('services.trackify.urlopen',side_effect=blocked(code)) as request,patch('services.trackify.time.sleep'):
                api=Trackify()
                for account in ('a','b','c'):
                    with self.assertRaises(HTTPError) as caught:api.overview(account)
                    self.assertEqual(caught.exception.code,429)
                request.assert_called_once()
                self.assertEqual(api.request_report()['http429'],1)

    def test_no_automatic_retry_on_5xx(self):
        with patch('services.trackify.urlopen',side_effect=HTTPError('x',503,'Unavailable',{},io.BytesIO(b'{}'))) as request,patch('services.trackify.time.sleep'):
            with self.assertRaises(HTTPError):Trackify().overview('a')
            request.assert_called_once()

    def test_monthly_fallback_stops_at_first_429(self):
        api=Trackify()
        with patch.object(api,'get',side_effect=[{'periodType':'monthly','periodKey':'2026-09','items':[]},blocked()]) as request:
            with self.assertRaises(HTTPError):api.monthly_users(['a','b','c'],'2026-09')
            self.assertEqual(request.call_count,2)

    def test_rolling_fallback_stops_at_first_429(self):
        old=json.loads((ROOT/'tests/fixtures/legacy-ranking.json').read_text());old.pop('rollingForecast')
        api=Mock();api.get.side_effect=blocked()
        with self.assertRaises(HTTPError):build_rolling_inputs(api,old,datetime.now(KST),lambda *a,**k:None)
        api.get.assert_called_once()


class DailySafetyTests(unittest.TestCase):
    def test_pending_review_skips_api_and_does_not_spend_daily_full_attempt(self):
        with tempfile.TemporaryDirectory() as folder:
            p=Path(folder)/'ranking.json';d=Path(folder)/'daily.json';atomic_json(p,{'updatedAt':'2026-10-17T00:00:00+09:00','streamers':[]})
            atomic_json(p.with_name('collection-status.json'),{'publicationStatus':'held','viewerAdjustmentReview':{'status':'pending'}})
            before=p.read_bytes()
            with patch('scripts.collect.Trackify') as api:
                self.assertFalse(collect(p,True,daily_state=d,adjustment_policy={'sourceCorrectionReview':{'status':'pending'}}))
            api.assert_not_called();self.assertFalse(d.exists());self.assertEqual(p.read_bytes(),before)
            self.assertEqual(json.loads(p.with_name('collection-status.json').read_text())['collectionStatus'],'review_required')
            self.assertEqual(json.loads(p.with_name('collection-status.json').read_text())['publicationStatus'],'held')

    def test_same_day_cannot_retry_and_next_day_can_run(self):
        with tempfile.TemporaryDirectory() as folder:
            p=Path(folder)/'daily.json';s=Path(folder)/'status.json';now=datetime(2026,10,18,3,15,tzinfo=KST)
            self.assertTrue(claim(p,s,now,atomic_json))
            self.assertFalse(claim(p,s,now+timedelta(hours=20),atomic_json))
            self.assertTrue(claim(p,s,now+timedelta(days=1),atomic_json))

    def test_successful_collection_without_gate_also_prevents_second_run(self):
        with tempfile.TemporaryDirectory() as folder:
            p=Path(folder)/'daily.json';s=Path(folder)/'status.json';now=datetime(2026,10,18,3,15,tzinfo=KST)
            atomic_json(s,{'lastSuccessfulCollection':now.isoformat()})
            self.assertFalse(claim(p,s,now,atomic_json))

    def test_429_stops_full_run_and_preserves_production_data(self):
        old=json.loads((ROOT/'tests/fixtures/legacy-ranking.json').read_text())
        calls=[]
        class API:
            def overview(self,account):
                calls.append(account)
                if len(calls)==3:raise blocked()
                r=next(r for r in old['streamers'] if r['soopId']==account)
                return {'userId':account,'totalViewCountDelta':r['cumulativeUsers'],'monthDonors':r['donorCount'],'monthBalloon':r['balloonCount'],'isBalloonHidden':r['status']=='unavailable'}
        with tempfile.TemporaryDirectory() as folder:
            p=Path(folder)/'ranking.json';b=Path(folder)/'block.json';d=Path(folder)/'daily.json';atomic_json(p,old);before=p.read_bytes()
            with patch('scripts.collect.Trackify',API):self.assertFalse(collect(p,True,Path(folder)/'history',b,d))
            self.assertEqual(len(calls),3);self.assertEqual(p.read_bytes(),before)
            self.assertEqual(json.loads(b.read_text())['retryAfterSeconds'],3600)
            status=json.loads(p.with_name('collection-status.json').read_text())
            self.assertEqual(status['collectionStatus'],'api_blocked')
            with patch('scripts.collect.Trackify') as api:self.assertTrue(collect(p,True,block_state=b,daily_state=d))
            api.assert_not_called()

    def test_legacy_candidate_loop_also_aborts_before_remaining_97(self):
        calls=[]
        class API:
            def candidates(self):return [{'broadUserId':'khm11903' if i==0 else f'id{i}','nick':'test','rank':i+1} for i in range(200)]
            def overview(self,account):
                calls.append(account)
                if len(calls)==4:raise blocked()
                return {'userId':account,'totalViewCountDelta':100,'monthDonors':10,'monthBalloon':20,'isBalloonHidden':False}
        with tempfile.TemporaryDirectory() as folder:
            p=Path(folder)/'ranking.json';atomic_json(p,{'status':'ok','updatedAt':'2026-09-01T00:00:00+00:00','streamers':[]});before=p.read_bytes()
            with patch('scripts.collect.Trackify',API),patch('scripts.collect.collection_date',return_value='2026-09-30'):
                self.assertFalse(collect(p,True,block_state=Path(folder)/'block.json'))
            self.assertEqual(len(calls),4);self.assertEqual(p.read_bytes(),before)

    def test_single_cron_entry_matches_0315_kst(self):
        content=(ROOT/'ops/soop-ranking.cron').read_text()
        entries=[line for line in content.splitlines() if line and not line.startswith('#') and '=' not in line]
        self.assertEqual(len(entries),1)
        self.assertEqual(entries[0].split()[:5],['15','18','*','*','*'])
        scheduled=datetime(2026,10,18,18,15,tzinfo=timezone.utc).astimezone(KST)
        self.assertEqual(scheduled.isoformat(),'2026-10-19T03:15:00+09:00')


class ViewerAdjustmentTests(unittest.TestCase):
    def setUp(self):
        self.row={'soopId':'singgyul','cumulativeUsers':7500000,'donorCount':4817,'balloonCount':4895360}
        self.previous={**self.row,'cumulativeUsers':7311517}

    def test_persistent_raw_adjusted_split_and_support_unchanged(self):
        for date in ('2026-10-18','2026-10-19'):
            result=adjust(self.row,self.previous,POLICY,date)
            self.assertEqual(result['rawMetrics']['viewer'],7500000)
            self.assertEqual(result['viewerAdjustmentTotal'],-40000)
            self.assertEqual(result['cumulativeUsers'],7460000)
            self.assertEqual(result['adjustedMetrics']['viewer'],7460000)
            self.assertEqual(result['donorCount'],4817);self.assertEqual(result['balloonCount'],4895360)
            self.assertEqual([e['delta'] for e in result['viewerAdjustments']],[-20000,-20000])
            self.assertEqual(raw_previous({},result)['cumulativeUsers'],7500000)
            self.assertEqual(self.row['cumulativeUsers'],7500000)

    def test_pending_source_review_prevents_publication_even_when_raw_increases(self):
        policy={**POLICY,'sourceCorrectionReview':{'status':'pending'}}
        with self.assertRaisesRegex(ValueError,'publication held'):adjust(self.row,self.previous,policy,'2026-10-19')

    def test_third_distinct_event_on_the_same_date_is_applied_once_per_raw_snapshot(self):
        policy=copy.deepcopy(POLICY)
        policy['viewerAdjustments'].append({'eventId':'2026-10-18-evening',
            'date':'2026-10-18','delta':-20000,'reason':'suspected_viewbot_traffic'})
        first=adjust(self.row,self.previous,policy,'2026-10-19')
        self.assertEqual(first['viewerAdjustmentTotal'],-60000)
        self.assertEqual(len(first['viewerAdjustments']),3)
        raw=raw_previous({},first)
        repeated=adjust(raw,raw,policy,'2026-10-19')
        self.assertEqual(repeated['cumulativeUsers'],first['cumulativeUsers'])
        self.assertEqual(repeated['rawMetrics']['viewer'],self.row['cumulativeUsers'])
        for key in ['donorCount','balloonCount']:
            self.assertEqual(repeated[key],self.row[key])

    def test_source_decrease_requires_attribution_and_reviewed_correction_is_not_double_subtracted(self):
        row={**self.row,'cumulativeUsers':7291517}
        with self.assertRaisesRegex(ValueError,'review_required'):adjust(row,self.previous,POLICY,'2026-10-18')
        policy=copy.deepcopy(POLICY)
        policy['sourceCorrectionResolutions']=[{'adjustmentDate':'2026-10-17','previousRawViewer':7311517,'currentRawViewer':7291517,'reason':'source_correction','evidence':'reviewed exact source removal'}]
        result=adjust(row,self.previous,policy,'2026-10-18')
        self.assertEqual(result['viewerAdjustmentTotal'],-20000)
        self.assertEqual(result['cumulativeUsers'],7271517)
        tomorrow=adjust({**row,'cumulativeUsers':7500000},row,policy,'2026-10-19')
        self.assertEqual(tomorrow['viewerAdjustmentTotal'],-20000)

    def test_full_simulation_uses_adjusted_viewer_with_baseline_untouched(self):
        old=json.loads((ROOT/'tests/fixtures/legacy-ranking.json').read_text())
        original=copy.deepcopy(old)
        raw={r['soopId']:{'userId':r['soopId'],'totalViewCountDelta':r['cumulativeUsers'],'monthDonors':r['donorCount'],'monthBalloon':r['balloonCount'],'isBalloonHidden':r['status']=='unavailable'} for r in old['streamers']}
        raw['singgyul']['totalViewCountDelta']+=100000
        api=Mock();api.overview.side_effect=lambda account:raw[account]
        now=datetime(2026,10,18,4,tzinfo=KST)
        result=dynamic_snapshot(api,old,now,POLICY)
        self.assertEqual(result['simulationBaseline'],original['simulationBaseline'])
        self.assertEqual(old,original)
        target=next(r for r in result['streamers'] if r['soopId']=='singgyul')
        self.assertEqual(target['cumulativeUsers'],raw['singgyul']['totalViewCountDelta']-40000)
        self.assertEqual(api.overview.call_count,100)
        result['actualObservedAt']=now.isoformat()
        report=calculate_targets(ROOT,result,now)
        self.assertEqual(report['dynamic']['target']['actual']['cumulativeUsers'],target['adjustedMetrics']['viewer'])
        self.assertEqual(len(report['dynamic']['models']),3)
