# Reads the dry run JSON lines and checks every pass rule; prints a compact table.
import sys, json
rows = [json.loads(l) for f in sys.argv[1:] for l in open(f) if l.strip()]
print(f"{'night':9} {'pace':6} {'bonus':3} {'rds':5} {'games':5} {'sits':5} {'offers':34} {'brk':3} {'time check':26} {'plan':8} {'end':8} {'left':4} {'idle':4} flags")
fails = []
for r in rows:
    flags = []
    if r['past10']: flags.append('PAST10')
    if r['pace'] in ('fast', 'normal'):
        if r['left'] > 30 and (r['accept'] or not r['offers']): flags.append(f">30")
        if r['left'] < 10: flags.append('<10')
    if r['left'] > 40: flags.append('UNUSED>40')
    lo, hi = map(int, r['sits'].split('-'))
    if hi - lo > 1: flags.append('SITS-UNEVEN')
    if r['sitStreak'] > 2 and not r['tag'].startswith('7'): flags.append(f"STREAK{r['sitStreak']}")
    if r['sitStreak'] > 2 and r['tag'].startswith('7'): flags.append(f"STREAK{r['sitStreak']}")
    if r['overlap']: flags.append('OVERLAP')
    if r['idle']: flags.append(f"IDLE{len(r['idle'])}")
    if not r['money'].startswith('0'): flags.append('MONEY')
    if r['stuck']: flags.append('STUCK')
    if not r['end'] or r['end']['status'] != 200: flags.append('END')
    for o in r['offers']:
        if 'left0' in o or 'left1' in o: flags.append('LATE-OFFER')
    offers = ','.join(o.split(' ')[0] + ('+' if 'ACC' in o else '-') + o.split(' ')[1] + o.split(' ')[2] for o in r['offers'])
    tcs = ','.join(x.split(' ')[0] + x.split(' ')[1][0] + x.split(' ')[2] for x in r['timeChecks'])
    print(f"{r['tag']:9} {r['pace']:6} {'acc' if r['accept'] else 'dec':3} {r['plan']['rounds']}/{r['roundsPlayed']:<3} {r['games']:5} {r['sits']:5} {offers[:34]:34} {len(r['breaks']):<3} {tcs[:26]:26} {r['plannedFinish']:8} {r['finish']:8} {r['left']:<4} {r['idleCourtMin']:<4} {' '.join(flags)}")
    if flags: fails.append((r['tag'], r['pace'], r['accept'], flags))
print(f"\n{len(fails)} of {len(rows)} nights fail a rule")
