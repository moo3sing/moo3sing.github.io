"""Persistent simulation-only viewer adjustments; never edit source or baseline."""
import copy

METRICS = {'viewer':'cumulativeUsers','donor':'donorCount','balloon':'balloonCount'}


def raw_previous(snapshot, row):
    previous = copy.deepcopy(row)
    if row.get('rawMetrics'):
        previous.update({key:row['rawMetrics'][label] for label,key in METRICS.items()})
    else:
        manual = snapshot.get('manualOverride',{})
        if row['soopId'] == manual.get('streamerId') and 'rawViewer' in manual:
            previous['cumulativeUsers'] = manual['rawViewer']
            for label in ('donor','balloon'):
                previous[METRICS[label]] = manual['metrics'][label]
    return previous


def adjust(row, previous, policy, as_of):
    row = copy.deepcopy(row)
    raw = {label:row[key] for label,key in METRICS.items()}
    entries = copy.deepcopy([e for e in policy['viewerAdjustments'] if e['date'] <= as_of])
    resolutions = policy.get('sourceCorrectionResolutions',[])
    # A source decrease cannot establish which suspected event it removed.
    delta = raw['viewer'] - previous['cumulativeUsers']
    if policy.get('sourceCorrectionReview',{}).get('status') == 'pending':
        raise ValueError(f"viewer_adjustment_review_required: singgyul previous raw {previous['cumulativeUsers']}, current raw {raw['viewer']}, delta {delta}; publication held pending source correction evidence")
    if delta < 0 and not any(r.get('previousRawViewer')==previous['cumulativeUsers'] and r.get('currentRawViewer')==raw['viewer'] for r in resolutions):
        raise ValueError(f"viewer_adjustment_review_required: singgyul raw {previous['cumulativeUsers']} -> {raw['viewer']} (delta {delta}); source correction attribution is ambiguous")
    absorbed = {r['adjustmentDate'] for r in resolutions}
    for e in entries:
        if type(e['delta']) is not int or e['delta'] >= 0 or e['reason'] != 'suspected_viewbot_traffic':
            raise ValueError('Invalid viewer adjustment policy')
        e['appliedDelta'] = 0 if e['date'] in absorbed else e['delta']
        if e['date'] in absorbed:e['absorbedBySourceCorrection'] = True
    total = sum(e['appliedDelta'] for e in entries)
    if raw['viewer'] + total < 0:raise ValueError('Negative adjusted viewer')
    row.update(rawMetrics=raw,viewerAdjustments=entries,viewerAdjustmentTotal=total,
               adjustedMetrics={**raw,'viewer':raw['viewer']+total},
               viewerAdjustmentSourceCheck={'previousRawViewer':previous['cumulativeUsers'],'currentRawViewer':raw['viewer'],
                 'rawDelta':delta,'status':'reviewed_source_correction' if delta<0 else 'no_raw_decrease_observed',
                 'note':'Net growth alone cannot rule out a source correction masked by new traffic.'})
    row['cumulativeUsers'] = raw['viewer'] + total
    if policy.get('sourceCorrectionReview'):
        row['viewerAdjustmentSourceCheck']['review']=copy.deepcopy(policy['sourceCorrectionReview'])
    return row
