import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {validateChecks,dockerArgs,runIsolated,digest} from '../src/runner.mjs';
import {verifyEvidence,independentEvaluate,parseJudge} from '../src/evaluator.mjs';
import {Workflow,validateTask} from '../src/workflow.mjs';

const checks=[
{id:'unit',kind:'pytest',argv:['python','-m','pytest','-q','tests/unit']},
{id:'browser',kind:'e2e',argv:['python','-m','pytest','-q','tests/e2e']},
{id:'lint',kind:'lint',argv:['ruff','check','.']},
{id:'types',kind:'typecheck',argv:['mypy','src']}
];
const task={goal:'Repair a broken sample program',criteria:['feature works'],checks};
const commit='a'.repeat(40),contractHash='b'.repeat(64),runId='run-1111111111111111';
function records(fail=null){
 return checks.map(c=>{
  const r={runId,commit,contractHash,id:c.id,kind:c.kind,argv:c.argv,passed:c.id!==fail,empty:false,code:c.id===fail?1:0,signal:null,stdout:'ok',stderr:'',truncated:false,timedOut:false,spawnError:'',durationMs:1,producer:'isolated-docker-runner'};
  return {...r,evidenceHash:digest(r)};
 });
}
test('check schema requires all four suites and restricts commands',()=>{
 assert.equal(validateChecks(checks).length,4);
 assert.throws(()=>validateChecks(checks.slice(1)),/requires/);
 assert.throws(()=>validateChecks([...checks,{id:'bad',kind:'lint',argv:['sh','-c','echo']}]),/invalid check argv/);
 assert.throws(()=>validateChecks([...checks,checks[0]]),/duplicate/);
});
test('Docker command has no network, readonly source and resource limits',()=>{
 const args=dockerArgs('/tmp/repo',checks[0],'test:local');
 for(const flag of ['--network','none','--read-only','--cap-drop','ALL','--user','1000:1000','--pids-limit'])assert.ok(args.includes(flag));
 assert.ok(args.includes('type=bind,src=/tmp/repo,dst=/source,readonly'));
 assert.deepEqual(args.slice(-5),['python','-m','pytest','-q','tests/unit']);
});
test('evidence integrity and baseline regression checks',()=>{
 const results=records(),base={checks,results,runId,commit,contractHash};
 assert.equal(verifyEvidence(base).passed,true);
 assert.deepEqual(verifyEvidence({...base,results:records('unit'),baseline:[{id:'unit',passed:true}]}).regressions,['unit']);
 results[0].stdout='tampered';assert.match(verifyEvidence(base).failures.join(),/invalid provenance/);
});
test('independent LLM judge cannot bypass failing typecheck',async()=>{
 const out=await independentEvaluate({task,results:records('types'),runId,commit,contractHash,judge:async()=>JSON.stringify({verdict:'PASS',criteriaPassed:['feature works']})});
 assert.equal(out.passed,false);assert.equal(out.reason,'deterministic_failure');
});
test('LLM judge fails closed on invalid JSON or incomplete acceptance',async()=>{
 const args={task,results:records(),runId,commit,contractHash};
 assert.equal((await independentEvaluate({...args,judge:async()=>'{not json'})).passed,false);
 assert.equal((await independentEvaluate({...args,judge:async()=>JSON.stringify({verdict:'PASS',criteriaPassed:[]})})).passed,false);
 assert.equal((await independentEvaluate({...args,judge:async()=>JSON.stringify({verdict:'PASS',criteriaPassed:['feature works']})})).passed,true);
});
test('Docker mock runner rejects empty pytest suite',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'pi-eval-'));
 try{
  const rs=await runIsolated({workspace:dir,checks,runId,commit,contractHash,exec:async()=>({code:0,stdout:'no tests ran',stderr:'',truncated:false,timedOut:false,spawnError:'',durationMs:1})});
  assert.equal(rs.length,4);assert.ok(rs.every(x=>!x.passed));
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('fenced LLM judge JSON parser',()=>assert.equal(parseJudge('```json\n{"verdict":"PASS","criteriaPassed":[],"notes":"ok"}\n```').verdict,'PASS'));
test('task rejects missing acceptance',()=>assert.throws(()=>validateTask({...task,criteria:[]}),/invalid goal/));
function git(cwd,...args){return execFileSync('git',args,{cwd,encoding:'utf8'}).trim();}
async function fixture(){
 const root=await mkdtemp(path.join(os.tmpdir(),'pi-workflow-')),repo=path.join(root,'repo');
 await mkdir(repo);await writeFile(path.join(repo,'app.py'),'def calc(): return 1\n');
 git(repo,'init','-q');git(repo,'add','.');git(repo,'-c','user.name=Test','-c','user.email=test@example.com','commit','-qm','init');
 return {root,repo};
}
function fakeRunner({checks,runId,commit,contractHash}){return Promise.resolve(checks.map(c=>{
 const r={runId,commit,contractHash,id:c.id,kind:c.kind,argv:c.argv,passed:true,empty:false,code:0,signal:null,stdout:'ok',stderr:'',truncated:false,timedOut:false,spawnError:'',durationMs:1,producer:'isolated-docker-runner'};
 return {...r,evidenceHash:digest(r)};
}));}
test('end-to-end orchestrator preserves original repo and commits candidate',async()=>{
 const {root,repo}=await fixture();
 try{
  const agent={plan:async()=>'{"features":["fix"]}',generate:async s=>{await writeFile(path.join(s.workspace,'app.py'),'def calc(): return 2\n');return 'fixed';},judge:async()=>'{"verdict":"PASS","criteriaPassed":["feature works"],"notes":"ok"}'};
  const w=new Workflow({dataDir:path.join(root,'data'),agent,runner:fakeRunner}),s=await w.create(repo,task);
  const result=await w.execute(s.id);
  assert.equal(result.status,'VERIFIED_PASS');assert.notEqual(result.verifiedCommit,s.baseCommit);
  assert.equal(git(repo,'rev-parse','HEAD'),s.baseCommit);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('protected tests changes block release',async()=>{
 const {root,repo}=await fixture();
 try{
  const agent={plan:async()=>'{"features":[]}',generate:async s=>{await mkdir(path.join(s.workspace,'tests'),{recursive:true});await writeFile(path.join(s.workspace,'tests','bypass.py'),'assert True\n');return 'tamper';},judge:async()=>{throw Error('judge should not run')}};
  const w=new Workflow({dataDir:path.join(root,'data'),agent,runner:fakeRunner}),s=await w.create(repo,task);
  assert.equal((await w.execute(s.id)).status,'BLOCKED');
 }finally{await rm(root,{recursive:true,force:true});}
});
