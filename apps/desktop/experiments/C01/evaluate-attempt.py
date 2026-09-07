"""Freeze an attempt and evaluate a separate copy; never patch a recorded attempt."""
from pathlib import Path
import hashlib, json, os, shutil, subprocess, sys, time
from evaluation_outcomes import assertion_outcome

prototype = Path(__file__).resolve().parents[2]
private = prototype / '.local/comparison-C01'
manifest = json.loads((private/'manifest.json').read_text())
name = sys.argv[1]
assert name in ('sol','terra')
attempt = next(a for a in manifest['attempts'] if a['key']==name)
source = Path(attempt['workspace'])
output = private/name
result = json.loads((output/'result.json').read_text())
assert result['manifestHash']==manifest['manifestHash']
for relative, sha in manifest['inputs'].items():
    assert hashlib.sha256((prototype/relative).read_bytes()).hexdigest()==sha, relative

def git(*args, cwd=source, binary=False):
    return subprocess.check_output(['git',*args],cwd=cwd,text=not binary)

assert git('rev-parse','HEAD').strip()==manifest['baseCommit']
evaluator=source.parent/('evaluator-'+name)
assert not evaluator.exists(), 'Refuse to reuse an evaluated checkout'
subprocess.run(['git','clone','--quiet','--no-local',str(source),str(evaluator)],check=True,capture_output=True)
subprocess.run(['git','remote','remove','origin'],cwd=evaluator,check=True)
paths=git('ls-files','-z','--cached','--others','--exclude-standard',binary=True).decode().split('\0')
identities=[]
for relative in sorted(set(p for p in paths if p)):
    path=source/relative
    assert not path.is_symlink(), 'Snapshot does not follow symlinks'
    if not path.exists():
        target=evaluator/relative
        if target.exists():target.unlink()
        identities.append([relative,'deleted'])
        continue
    assert path.is_file()
    data=path.read_bytes();identities.append([relative,hashlib.sha256(data).hexdigest()])
    target=evaluator/relative;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(path,target)
snapshotHash=hashlib.sha256(json.dumps(identities,separators=(',',':')).encode()).hexdigest()
(output/'snapshot.json').write_text(json.dumps({'hash':snapshotHash,'files':identities},indent=2)+'\n')
(output/'final.patch').write_bytes(git('diff','--binary','HEAD',binary=True))

# External grades use baseline assertions. Agent-authored tests remain in the
# preserved final tree and patch, but cannot redefine the frozen evaluator.
baseline_paths=git('ls-tree','-r','--name-only',manifest['baseCommit']).splitlines()
for relative in baseline_paths:
    if '/test/' in relative or '/tests/' in relative:
        target=evaluator/relative;target.parent.mkdir(parents=True,exist_ok=True)
        target.write_bytes(git('show',manifest['baseCommit']+':'+relative,binary=True))
for p in evaluator.rglob('*.test.ts'):
    if 'node_modules' not in p.parts and str(p.relative_to(evaluator)) not in baseline_paths:p.unlink()
subprocess.run(['git','apply',str(prototype/'experiments/C01/native-boundary.patch')],cwd=evaluator,check=True)
subprocess.run(['pnpm','install','--offline','--frozen-lockfile'],cwd=evaluator,check=True,stdout=subprocess.DEVNULL)

def command(label,args,timeout=150):
    started=time.time()
    try:
        r=subprocess.run(args,cwd=evaluator,capture_output=True,text=True,timeout=timeout)
        code=r.returncode;text=r.stdout+r.stderr
    except subprocess.TimeoutExpired as e:
        code=None;text='Evaluator command exceeded its time limit.\n'+str(e.stdout or '')+str(e.stderr or '')
    filename=label+'.log';data=('Command: '+' '.join(args)+'\n\n'+text).encode()
    (output/filename).write_bytes(data)
    return {'exitCode':code,'command':' '.join(args),'durationMs':round((time.time()-started)*1000),'outputFile':filename,'artifactSha256':hashlib.sha256(data).hexdigest()}

checks=[]
# Run typecheck before injecting evaluator-only test source.
types=command('typecheck',['pnpm','typecheck'])
checks.append({'id':'typecheck','outcome':'unknown' if types['exitCode'] is None else 'pass' if types['exitCode']==0 else 'fail',**types})
suite=command('regression-suite',['pnpm','vitest','--run','--no-file-parallelism','--maxWorkers=1','--reporter=default','--reporter=json','--outputFile='+str(output/'regression-suite.json')])
suite_json=json.loads((output/'regression-suite.json').read_text()) if (output/'regression-suite.json').exists() else None
suite_outcome='unknown' if suite['exitCode'] is None or not suite_json or not suite_json.get('numTotalTests') else 'pass' if suite['exitCode']==0 and suite_json['numFailedTests']==0 else 'fail'
checks.append({'id':'inherited-suite-with-declared-supplement','outcome':suite_outcome,**suite})
shutil.copy2(prototype/'experiments/C01/independent.test.ts',evaluator/'apps/cli/test/C01-independent.test.ts')
external=command('independent',['pnpm','vitest','apps/cli/test/C01-independent.test.ts','--run','--no-file-parallelism','--maxWorkers=1','--reporter=default','--reporter=json','--outputFile='+str(output/'independent.json')])
external_json=json.loads((output/'independent.json').read_text()) if (output/'independent.json').exists() else {}
assertions=[a for f in external_json.get('testResults',[]) for a in f.get('assertionResults',[])]
for key,prefix in [('stdout-64mib','C01-stdout:'),('stderr-64mib','C01-stderr:'),('byte-limit-crlf','C01-boundary:'),('utf8-tail','C01-framing:'),('backpressure','C01-backpressure:')]:
    matches=[a for a in assertions if a['title'].startswith(prefix)]
    status=matches[0]['status'] if len(matches)==1 else 'unknown'
    outcome=assertion_outcome(status, external['exitCode'])
    checks.append({'id':key,'outcome':outcome,**external})
checks.sort(key=lambda c:manifest['checks'].index(c['id']))
report={'schemaVersion':1,'manifestHash':manifest['manifestHash'],'runId':result['result']['runId'],'snapshotHash':snapshotHash,'endedAt':round(time.time()*1000),'checks':checks,'controlNotes':['Independent evaluator restores original test assertions and applies the declared one-test historical correction. Agent-authored tests remain preserved in the original attempt.'],'suiteCounts':None if not suite_json else {k:suite_json.get(k) for k in ['numTotalTests','numPassedTests','numFailedTests']},'coverageLimits':['Stderr test checks discard and subsequent stdout recovery, not separate stderr recovery.','One-byte producer writes may be coalesced by the OS; exhaustive split UTF-8 coverage is not established.','Backpressure uses a two-second blocked interval and a baseline negative control; no peak-RSS claim.']}
(output/'evaluation.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'attempt':name,'checks':[{k:c[k] for k in ['id','outcome']} for c in checks],'suite':report['suiteCounts'],'snapshotHash':snapshotHash}))
