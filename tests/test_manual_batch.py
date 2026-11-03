import copy
import json
from pathlib import Path
import unittest
from datetime import datetime
from unittest.mock import patch
from scripts.manual_batch_update import parse_table,match_table,prepare
from services.trackify import KST

ROOT=Path(__file__).resolve().parents[1]
PASTE=ROOT/'tests/fixtures/manual-batch-balloon.txt'
BEFORE=ROOT/'tests/fixtures/manual-batch-before.json'
VIEWER_PASTE=ROOT/'tests/fixtures/manual-batch-viewer.txt'


class CurrentNameMatchingTests(unittest.TestCase):
    def test_renamed_accounts_match_existing_ids_without_changing_the_cohort(self):
        snapshot={'streamers':[
            {'soopId':'singgyul','name':'띵귤_'},
            {'soopId':'ioioiobb','name':'정윤종..'},
            {'soopId':'mygomiee','name':'마이곰이'},
            {'soopId':'dkfksl00','name':'아란♥'}]}
        original=copy.deepcopy(snapshot)
        rows=[{'name':name} for name in ['띵귤_','BJ.정윤종','마이곰이_','[ω]아란♥']]
        matched,outside=match_table(rows,snapshot)
        self.assertEqual([row['soopId'] for row in matched],
                         ['singgyul','ioioiobb','mygomiee','dkfksl00'])
        self.assertEqual(outside,[])
        self.assertEqual(snapshot,original)


@unittest.skipUnless(PASTE.exists() and BEFORE.exists(),'Pasted batch fixture not available')
class ManualBatchTests(unittest.TestCase):
    def setUp(self):
        self.old=json.loads(BEFORE.read_text());self.text=PASTE.read_text()
        # These historical paste fixtures precede the separately confirmed third event.
        self.policy={'streamerId':'singgyul','viewerAdjustments':[
            {'date':'2026-10-17','delta':-20000,'reason':'suspected_viewbot_traffic'},
            {'date':'2026-10-18','delta':-20000,'reason':'suspected_viewbot_traffic'}],
            'sourceCorrectionResolutions':[]}
        self.observed=datetime(2026,10,18,4,30,tzinfo=KST)

    def test_parse_and_match_without_adding_balloon_ranked_accounts(self):
        rows=parse_table(self.text);matched,outside=match_table(rows,self.old)
        self.assertEqual(len(rows),120);self.assertEqual(len(matched),34);self.assertEqual(len(outside),86)
        self.assertEqual(next(r for r in matched if r['soopId']=='pookygamja')['name'],'[BJ]김인호')
        self.assertEqual(next(r for r in matched if r['soopId']=='juju0228')['name'],'미오탱')
        self.assertNotIn('커맨더지코',[r['name'] for r in matched])

    def test_prepare_preserves_donors_missing_rows_baselines_and_source_values(self):
        original=copy.deepcopy(self.old)
        with patch('services.trackify.Trackify',side_effect=AssertionError('No API requests')):
            working,report,summary=prepare(self.old,self.text,self.observed,self.policy,ROOT)
        self.assertEqual(self.old,original)
        self.assertEqual(summary['matched'],34)
        self.assertEqual(len(working['streamers']),100)
        old={r['soopId']:r for r in self.old['streamers']};new={r['soopId']:r for r in working['streamers']}
        for account,row in new.items():self.assertEqual(row['donorCount'],old[account]['donorCount'])
        self.assertEqual(new['lshooooo'],old['lshooooo'])
        self.assertEqual(new['arinbbidol']['cumulativeUsers'],15266404)
        self.assertEqual(new['singgyul']['cumulativeUsers'],7382588)
        self.assertEqual(new['singgyul']['balloonCount'],4929477)
        self.assertEqual(new['singgyul']['donorCount'],4817)
        self.assertEqual(working['manualOverride']['rawViewer'],7422588)
        self.assertEqual(working['manualOverride']['adjustment'],-40000)
        self.assertEqual(new['singgyul']['metricObservedAt']['donorCount'],original['manualOverride']['observedAt'])
        self.assertEqual(new['khm11903']['metricObservedAt']['donorCount'],original['competitorDataAsOf'])
        self.assertEqual(new['khm11903']['metricObservedAt']['cumulativeUsers'],self.observed.isoformat())
        for key in ('simulationBaseline','supportBaseline','rollingForecast','forecast','exclusions'):self.assertEqual(working[key],original[key])
        self.assertEqual(len(report['dynamic']['projectedRows']),98)
        self.assertEqual(len(report['dynamic']['models']),3)
        self.assertTrue(any(c['streamerId']=='arinbbidol' and c['reason']=='source_correction' for c in working['sourceCorrections']))

    def test_malformed_duplicate_and_ambiguous_rows_are_rejected(self):
        with self.assertRaises(ValueError):parse_table(self.text.replace('7,422,588명','bad'))
        with self.assertRaises(ValueError):parse_table(self.text.replace('커맨더지코','[BJ]케이'))
        rows=parse_table(self.text)
        rows.append({**rows[0],'name':'김인호'})
        with self.assertRaises(ValueError):match_table(rows,self.old)

    @unittest.skipUnless(VIEWER_PASTE.exists(),'Viewer-ordered paste not available')
    def test_viewer_ordered_paste_without_header_accepts_hidden_and_excluded_zero_balloon(self):
        rows=parse_table(VIEWER_PASTE.read_text(),source_sort='viewer_desc');matched,outside=match_table(rows,self.old)
        self.assertEqual(len(rows),119);self.assertEqual(len(matched),98);self.assertEqual(len(outside),21)
        self.assertEqual(next(r for r in rows if r['name']=='VALORANT_TH')['balloon'],0)
        self.assertIsNone(next(r for r in matched if r['soopId']=='danchu17')['balloon'])
        self.assertEqual(next(r for r in matched if r['soopId']=='hwt1014')['name'],'가습기')
        self.assertEqual(next(r for r in matched if r['soopId']=='singgyul')['sourceRankByViewer'],89)

    @unittest.skipUnless(VIEWER_PASTE.exists(),'Viewer-ordered paste not available')
    def test_viewer_batch_preserves_cohort_donors_private_support_and_missing_accounts(self):
        before=copy.deepcopy(self.old)
        with patch('services.trackify.Trackify',side_effect=AssertionError('No API requests')):
            working,report,summary=prepare(self.old,VIEWER_PASTE.read_text(),self.observed,self.policy,ROOT,source_sort='viewer_desc')
        self.assertEqual(self.old,before);self.assertEqual(summary['matched'],98);self.assertEqual(summary['retained'],2)
        prior={r['soopId']:r for r in before['streamers']};new={r['soopId']:r for r in working['streamers']}
        self.assertEqual(list(prior),list(new))
        self.assertTrue(all(prior[k]['donorCount']==new[k]['donorCount'] for k in prior))
        for account in ('kaksjak0730','ayanesena'):self.assertEqual(prior[account],new[account])
        for account in ('danchu17','honeys2'):
            self.assertEqual(new[account]['status'],'unavailable');self.assertIsNone(new[account]['donorCount']);self.assertIsNone(new[account]['balloonCount'])
        self.assertEqual(new['danchu17']['cumulativeUsers'],12790650)
        self.assertEqual(new['honeys2']['cumulativeUsers'],6714158)
        self.assertEqual(new['singgyul']['cumulativeUsers'],7382588)
        audit=working['manualBatchOverride']['viewerRankingAudit']
        self.assertEqual(new['singgyul']['rankByViewer'],89)
        self.assertEqual(audit['sourceRawRank'],89);self.assertEqual(len(audit['excludedRowsAboveTarget']),7)
        self.assertEqual(len(audit['excludedRowsPresent']),9);self.assertEqual(audit['rankAfterConfiguredExclusions'],82)
        self.assertEqual(audit['adjustedViewerRankWithinExistingCandidates'],82)
        self.assertEqual(working['simulationBaseline'],before['simulationBaseline']);self.assertEqual(len(report['dynamic']['projectedRows']),98)

    @unittest.skipUnless(VIEWER_PASTE.exists(),'Viewer-ordered paste not available')
    def test_viewer_order_is_validated_and_adjustment_is_not_applied_twice(self):
        text=VIEWER_PASTE.read_text()
        with self.assertRaisesRegex(ValueError,'descending viewer'):
            parse_table(text.replace('123,536,367명','1명'),source_sort='viewer_desc')
        first,_,_=prepare(self.old,self.text,self.observed,self.policy,ROOT)
        second,_,_=prepare(first,text,self.observed,self.policy,ROOT,source_sort='viewer_desc')
        self.assertEqual(second['manualOverride']['rawViewer'],7422588)
        self.assertEqual(second['manualOverride']['adjustment'],-40000)
        self.assertEqual(next(r for r in second['streamers'] if r['soopId']=='singgyul')['cumulativeUsers'],7382588)
