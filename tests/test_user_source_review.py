import copy
import json
from pathlib import Path
import unittest
from unittest.mock import Mock,patch
from scripts.source_corrections import confirm_correction,current_source_observation
from scripts.dynamic_collect import annual_actual,dynamic_snapshot
from datetime import datetime
from services.trackify import KST

ROOT=Path(__file__).resolve().parents[1]


class UserSourceReviewTests(unittest.TestCase):
    def setUp(self):
        self.base={'soopId':'ititit','name':'test','status':'ok','cumulativeUsers':19949281,'donorCount':4123,'balloonCount':2764158}
        self.current={**self.base,'cumulativeUsers':15930675,'donorCount':4298,'balloonCount':2907644}
        self.approvals=json.loads((ROOT/'data/source-correction-approvals.json').read_text())['approvals']

    def test_exact_user_review_accepts_only_the_approved_source_observation(self):
        api=Mock()
        with patch('scripts.source_corrections.collection_date',return_value='2026-10-18'):
            row,records=confirm_correction(api,self.base,self.base,self.current,annual_actual,self.approvals)
        self.assertEqual(row['cumulativeUsers'],15930675)
        self.assertEqual(records[0]['reason'],'source_correction')
        self.assertEqual(records[0]['policy']['mode'],'user_approved_exact_observation')
        api.overview.assert_not_called()

    def test_other_value_date_account_and_unreviewed_drop_remain_blocked(self):
        scenarios=[([],self.current,'2026-10-18'),(self.approvals,{**self.current,'cumulativeUsers':15930674},'2026-10-18'),
                   (self.approvals,self.current,'2026-10-19')]
        for approvals,current,date in scenarios:
            with patch('scripts.source_corrections.collection_date',return_value=date),self.assertRaisesRegex(ValueError,'limits'):
                confirm_correction(Mock(),self.base,self.base,current,annual_actual,approvals)
        base={**self.base,'soopId':'other'}
        with patch('scripts.source_corrections.collection_date',return_value='2026-10-18'),self.assertRaisesRegex(ValueError,'limits'):
            confirm_correction(Mock(),base,base,{**self.current,'soopId':'other'},annual_actual,self.approvals)

    def test_current_competitor_policy_preserves_source_decreases_and_excludes_singgyul(self):
        policy=json.loads((ROOT/'data/source-observation-policy.json').read_text())
        records=current_source_observation(self.base,self.base,self.current,policy)
        self.assertEqual(records[0]['current'],15930675)
        self.assertEqual(records[0]['reason'],'source_correction')
        self.assertIsNone(current_source_observation({**self.base,'soopId':'singgyul'},self.base,self.current,policy))

    def test_approved_competitors_require_one_detail_each_with_unchanged_baseline(self):
        old=json.loads((ROOT/'tests/fixtures/legacy-ranking.json').read_text());before=copy.deepcopy(old)
        raw={r['soopId']:{'userId':r['soopId'],'totalViewCountDelta':r['cumulativeUsers'],'monthDonors':r['donorCount'],'monthBalloon':r['balloonCount'],'isBalloonHidden':r['status']=='unavailable'} for r in old['streamers']}
        raw['arinbbidol']['totalViewCountDelta']=15266404
        raw['ititit']['totalViewCountDelta']=15930675
        api=Mock();api.overview.side_effect=lambda account:raw[account]
        policy=json.loads((ROOT/'data/source-observation-policy.json').read_text())
        result=dynamic_snapshot(api,old,datetime(2026,10,18,4,tzinfo=KST),source_policy=policy)
        self.assertEqual(api.overview.call_count,100);api.get.assert_not_called()
        self.assertEqual(result['simulationBaseline'],before['simulationBaseline'])
        self.assertEqual(next(r for r in result['streamers'] if r['soopId']=='arinbbidol')['cumulativeUsers'],15266404)
