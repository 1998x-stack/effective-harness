import {digest,validateChecks} from './runner.mjs';

export function verifyEvidence({checks,results,runId,commit,contractHash,baseline=[]}){
  validateChecks(checks);
  const failures=[],regressions=[],byId=new Map();
  for(const r of results){if(byId.has(r.id))failures.push('duplicate evidence: '+r.id);byId.set(r.id,r);}
  for(const c of checks){
    const r=byId.get(c.id);if(!r){failures.push('missing evidence: '+c.id);continue;}
    const {evidenceHash,...unsigned}=r;
    if(r.runId!==runId||r.commit!==commit||r.contractHash!==contractHash||r.producer!=='isolated-docker-runner'||evidenceHash!==digest(unsigned))failures.push('invalid provenance: '+c.id);
    if(r.kind!==c.kind||JSON.stringify(r.argv)!==JSON.stringify(c.argv))failures.push('changed check: '+c.id);
    if(!r.passed||r.code!==0||r.timedOut||r.truncated||r.spawnError||r.empty)failures.push('check failed: '+c.id);
  }
  if(byId.size!==checks.length)failures.push('extra or missing evidence');
  for(const b of baseline)if(b.passed===true&&(!byId.has(b.id)||byId.get(b.id).passed!==true))regressions.push(b.id);
  return {passed:failures.length===0&&regressions.length===0,failures,regressions};
}
export function parseJudge(s){
  const block=s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const v=JSON.parse((block?block[1]:s).trim());
  if(!['PASS','FAIL','INCONCLUSIVE'].includes(v.verdict)||!Array.isArray(v.criteriaPassed)||v.criteriaPassed.some(x=>typeof x!=='string'))throw Error('invalid LLM judge response');
  return {verdict:v.verdict,criteriaPassed:v.criteriaPassed,notes:String(v.notes??'').slice(0,4000)};
}
export async function independentEvaluate({task,results,baseline=[],runId,commit,contractHash,judge}){
  const deterministic=verifyEvidence({checks:task.checks,results,baseline,runId,commit,contractHash});
  const evidence=results.map(({id,kind,passed,code,empty,timedOut,truncated,stdout,stderr,evidenceHash})=>({id,kind,passed,code,empty,timedOut,truncated,stdout:stdout.slice(-1200),stderr:stderr.slice(-1200),evidenceHash}));
  let llm={verdict:'INCONCLUSIVE',criteriaPassed:[],notes:'judge unavailable'};
  try{llm=parseJudge(await judge({goal:task.goal,criteria:task.criteria,evidence,regressions:deterministic.regressions,commit}));}
  catch(e){llm={verdict:'INCONCLUSIVE',criteriaPassed:[],notes:'Judge error: '+e.message};}
  const passed=deterministic.passed&&llm.verdict==='PASS'&&task.criteria.every(c=>llm.criteriaPassed.includes(c));
  return {passed,deterministic,llm,reason:passed?'verified':(!deterministic.passed?'deterministic_failure':'independent_judge_not_pass')};
}
