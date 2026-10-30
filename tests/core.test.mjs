import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {digest,validateTask,validateChecks,isProtected} from '../src/contracts.mjs';
import {dockerArguments,makeEvidence,runIsolated} from '../src/runner.mjs';
import {verifyEvidence,evaluate,parseVerdict} from '../src/evaluator.mjs';
import {Workflow} from '../src/workflow.mjs';
import {StateStore} from '../src/store.mjs';
import {git,archiveCommit} from '../src/workspace.mjs';
const checks=[
{id:'unit',kind:'pytest',argv:['python','-m','pytest','-q','tests/unit']},
{id:'web',kind:'e2e',argv:['python','-m','pytest','-q','tests/e2e']},
{id:'lint',kind:'lint',argv:['ruff','check','.']},
{id:'typing',kind:'typecheck',argv:['mypy','src']}
];
const task={goal:'Repair the sample application',criteria:['feature works'],checks};
const commit='a'.repeat(40),contractHash='b'.repeat(64),runId='run-aaaaaaaaaaaaaaaa';
const raw={code:0,signal:null,stdout:'2 passed in 0.2s',stderr:'',truncated:false,timedOut:false,error:'',durationMs:40};
const evidence=(withCommit=commit,rawOverrides={})=>checks.map(c=>makeEvidence({raw:{...raw,...rawOverrides},check:c,runId,commit:withCommit,contractHash}));
const mockRunner=async({checks,runId,commit,contractHash})=>checks.map(c=>makeEvidence({raw,check:c,runId,commit,contractHash}));
const runnerAfterBaseline=repo=>async({checks,runId,commit,contractHash})=>checks.map(c=>makeEvidence({
 raw:commit===g(repo,'rev-parse','HEAD')&&c.id==='unit'?{...raw,code:1,stdout:'baseline failure'}:raw,
 check:c,runId,commit,contractHash
}));
function g(cwd,...args){return execFileSync('git',args,{cwd,encoding:'utf8'}).trim()}
async function repoFixture(){
 const root=await mkdtemp(path.join(os.tmpdir(),'harness-refactor-')),repo=path.join(root,'repo');
 await mkdir(repo);
 await writeFile(path.join(repo,'app.py'),'def calc(): return 1\n');
 g(repo,'init','-q');g(repo,'add','.');g(repo,'-c','user.name=Test','-c','user.email=test@example.com','commit','-qm','init');
 return {root,repo};
}
test('requires all four check categories and typed deterministic argv',()=>{
 assert.equal(validateChecks(checks).length,4);
 assert.throws(()=>validateChecks(checks.slice(1)),/four check/);
 assert.throws(()=>validateChecks([...checks,{id:'shell',kind:'lint',argv:['sh','-c','rm -rf .']}]),/invalid command/);
 assert.throws(()=>validateChecks([...checks,checks[0]]),/duplicate/);
 assert.throws(()=>validateChecks(checks.map(c=>c.kind==='lint'?{...c,argv:['bash','-c','true']}:c)),/invalid command/);
});
test('contract schema and protected paths',()=>{
 const t=validateTask(task);assert.ok(t.protectedPrefixes.includes('tests/'));
 assert.equal(isProtected('tests/test_auth.py',t.protectedPrefixes),true);
 assert.equal(isProtected('.github/workflows/ci.yml',t.protectedPrefixes),true);
 assert.equal(isProtected('src/main.py',t.protectedPrefixes),false);
 assert.throws(()=>validateTask({...task,criteria:[]}),/invalid goal/);
});
test('Docker runner has isolated snapshot and no network',()=>{
 const args=dockerArguments('/tmp/candidate.tar',checks[0],'effective-harness-tests:local',runId);
 for(const required of ['none','--read-only','--cap-drop','ALL','--pids-limit','1000:1000'])assert.ok(args.includes(required));
 assert.ok(args.includes('type=bind,src=/tmp/candidate.tar,dst=/snapshot.tar,readonly'));
 assert.ok(args.includes('effective-harness-run='+runId));
 assert.deepEqual(args.slice(-5),['python','-m','pytest','-q','tests/unit']);
});
test('pytest zero test count fails closed despite exit code zero',()=>{
 const record=makeEvidence({raw:{...raw,stdout:'no tests ran in 0.01s'},check:checks[0],runId,commit,contractHash});
 assert.equal(record.passed,false);
 assert.equal(makeEvidence({raw:{...raw,stdout:'no tests ran\n1 passed'},check:checks[0],runId,commit,contractHash}).passed,false);
});
test('ruff and mypy exit-zero results pass without pytest counts',()=>{
 for(const c of checks.slice(2))assert.equal(makeEvidence({raw:{...raw,stdout:''},check:c,runId,commit,contractHash}).passed,true);
});
test('evidence integrity, candidate hash, regression checks',()=>{
 const good=evidence();assert.equal(verifyEvidence({checks,results:good,runId,commit,contractHash}).passed,true);
 good[0].stdout='tampered';
 assert.equal(verifyEvidence({checks,results:good,runId,commit,contractHash}).passed,false);
 const failed=evidence().map(r=>r.id==='unit'?{...r,passed:false}:r);
 const result=verifyEvidence({checks,results:failed,runId,commit,contractHash,baseline:[{id:'unit',passed:true}]});
 assert.ok(result.regressions.includes('unit'));
});
test('LLM judge cannot override deterministic FAIL',async()=>{
 let called=false;
 const results=evidence().map((r,i)=>i===0?makeEvidence({raw:{...raw,code:1},check:checks[0],runId,commit,contractHash}):r);
 const output=await evaluate({task,results,baseline:[],runId,commit,contractHash,judge:async()=>{called=true;return JSON.stringify({verdict:'PASS',criteriaPassed:['feature works']});}});
 assert.equal(output.passed,false);assert.equal(called,false);
});
test('judge incomplete and malformed results are not PASS',async()=>{
 const opts={task,results:evidence(),baseline:[],runId,commit,contractHash};
 assert.equal((await evaluate({...opts,judge:async()=>JSON.stringify({verdict:'PASS',criteriaPassed:[]})})).passed,false);
 assert.equal((await evaluate({...opts,judge:async()=>'{oops'})).passed,false);
 assert.equal((await evaluate({...opts,judge:async()=>JSON.stringify({verdict:'PASS',criteriaPassed:['feature works']})})).passed,true);
 assert.equal(parseVerdict('```json\n{"verdict":"PASS","criteriaPassed":[],"notes":"ok"}\n```').verdict,'PASS');
});
test('judge receives protected test source with passing command evidence',async()=>{
 const sources=[{path:'tests/unit/test_feature.py',source:'def test_feature(): assert True'}];
 let received;
 const result=await evaluate({task,results:evidence(),baseline:[],runId,commit,contractHash,testSources:sources,
  judge:async payload=>{received=payload;return JSON.stringify({verdict:'PASS',criteriaPassed:['feature works']});}});
 assert.equal(result.passed,true);
 assert.deepEqual(received.testSources,sources);
});
test('archive is tied to commit, not uncommitted workspace content',async()=>{
 const {root,repo}=await repoFixture();
 try{
  const sha=await git(repo,'rev-parse','HEAD');
  await writeFile(path.join(repo,'app.py'),'INJECTED UNCOMMITTED\n');
  const archive=await archiveCommit(repo,sha,{runId});
  try{
   assert.ok(path.basename(path.dirname(archive.file)).startsWith('harness-archive-'+runId+'-'));
   const tar=execFileSync('tar',['-xOf',archive.file,'app.py'],{encoding:'utf8'});
   assert.match(tar,/return 1/);assert.doesNotMatch(tar,/INJECTED/);
  }finally{await archive.cleanup();}
 }finally{await rm(root,{recursive:true,force:true});}
});
test('mock Docker runner retains correct check identity and cleans archive',async()=>{
 const {root,repo}=await repoFixture();
 try{
  const sha=await git(repo,'rev-parse','HEAD');let calls=0;
  const results=await runIsolated({workspace:repo,checks,runId,commit:sha,contractHash,execute:async(binary,args)=>{
    assert.equal(binary,'docker');calls++;assert.ok(args.includes('none'));return {...raw};
  }});
  assert.equal(calls,4);assert.equal(results.length,4);
  assert.ok(results.every(r=>r.passed&&r.commit===sha));
 }finally{await rm(root,{recursive:true,force:true});}
});
test('workflow creates candidate in worktree without modifying main',async()=>{
 const {root,repo}=await repoFixture();
 try{
  const original=g(repo,'rev-parse','HEAD');
  const agent={plan:async()=> 'Implement calc fix',generate:async s=>{await writeFile(path.join(s.workspace,'app.py'),'def calc(): return 2\n');return 'fixed';},
   judge:async()=>JSON.stringify({verdict:'PASS',criteriaPassed:['feature works'],notes:'good'})};
  const w=new Workflow({dataDir:path.join(root,'data'),agent,runner:runnerAfterBaseline(repo)});
  const s=await w.create(repo,task);const out=await w.execute(s.id);
  assert.equal(out.status,'VERIFIED_PASS');assert.notEqual(out.verifiedCommit,original);
  assert.equal(g(repo,'rev-parse','HEAD'),original);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('workflow rejects modifications to protected files',async()=>{
 const {root,repo}=await repoFixture();
 try{
  const agent={plan:async()=> 'plan',generate:async s=>{
   await mkdir(path.join(s.workspace,'tests'),{recursive:true});
   await writeFile(path.join(s.workspace,'tests','new_test.py'),'assert True\n');return 'done';
  },judge:async()=>{throw Error('should not judge');}};
  const w=new Workflow({dataDir:path.join(root,'data'),agent,runner:runnerAfterBaseline(repo)});
  const s=await w.create(repo,task),out=await w.execute(s.id);
  assert.equal(out.status,'BLOCKED');assert.match(out.feedback,/protected/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('judge rejection stops without asking generator to change passing code',async()=>{
 const {root,repo}=await repoFixture();
 try{
  let generations=0;
  const agent={plan:async()=> 'plan',generate:async s=>{
   generations++;
   await writeFile(path.join(s.workspace,'app.py'),'def calc(): return 2\n');
   return 'done';
  },judge:async()=>JSON.stringify({verdict:'INCONCLUSIVE',criteriaPassed:[],notes:'insufficient evidence'})};
  const w=new Workflow({dataDir:path.join(root,'data'),agent,runner:runnerAfterBaseline(repo)});
  const s=await w.create(repo,task),out=await w.execute(s.id);
  assert.equal(out.status,'JUDGE_REJECTED');
  assert.equal(generations,1);
  assert.equal(out.round,1);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('failed check output reaches the next generation round',async()=>{
 const {root,repo}=await repoFixture();
 try{
  const observed=[];
  const agent={plan:async()=> 'plan',generate:async s=>{
   observed.push(s.feedback);
   await writeFile(path.join(s.workspace,'app.py'),`def calc(): return ${observed.length+1}\n`);
   return 'done';
  },judge:async()=>JSON.stringify({verdict:'PASS',criteriaPassed:['feature works']})};
  const runner=async({checks,runId,commit,contractHash})=>checks.map(c=>makeEvidence({
   raw:commit===g(repo,'rev-parse','HEAD')&&c.id==='unit'?{...raw,code:1,stdout:'baseline failure'}:observed.length===1&&c.id==='unit'?{...raw,code:1,stdout:'test_calc failed: expected 3'}:raw,
   check:c,runId,commit,contractHash
  }));
  const w=new Workflow({dataDir:path.join(root,'data'),agent,runner});
  const s=await w.create(repo,task),out=await w.execute(s.id);
  assert.equal(out.status,'VERIFIED_PASS',out.feedback);
  assert.equal(observed.length,2);
  assert.match(observed[1],/test_calc failed: expected 3/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('state lock recovers after its owner process exits',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'harness-stale-lock-'));
 try{
  const store=new StateStore(root),id='run-aaaaaaaaaaaaaaaa';
  const lock=path.join(root,'runs',id,'lock');
  await mkdir(path.dirname(lock),{recursive:true});
  await writeFile(lock,JSON.stringify({pid:99999999,at:'2026-01-01T00:00:00Z'}));
  const release=await store.lock(id);
  await release();
  await assert.rejects(readFile(lock),/ENOENT/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('state lock refuses to take ownership from a live process',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'harness-live-lock-'));
 try{
  const store=new StateStore(root),id='run-aaaaaaaaaaaaaaaa';
  const release=await store.lock(id);
  await assert.rejects(store.lock(id),/already locked/);
  await release();
 }finally{await rm(root,{recursive:true,force:true});}
});
test('already passing baseline verifies without requiring a source change',async()=>{
 const {root,repo}=await repoFixture();
 try{
  const agent={plan:async()=>{throw Error('should not plan');},generate:async()=>{throw Error('should not generate');},
   judge:async()=>JSON.stringify({verdict:'PASS',criteriaPassed:['feature works']})};
  const w=new Workflow({dataDir:path.join(root,'data'),agent,runner:mockRunner});
  const s=await w.create(repo,task),out=await w.execute(s.id);
  assert.equal(out.status,'VERIFIED_PASS');
  assert.equal(out.round,0);
  assert.equal(out.verifiedCommit,s.base);
 }finally{await rm(root,{recursive:true,force:true});}
});
