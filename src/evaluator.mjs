import {digest,validateChecks} from './contracts.mjs';
export function verifyEvidence({checks,results,runId,commit,contractHash,baseline=[]}){
  validateChecks(checks);
  const errors=[],regressions=[];
  if(!Array.isArray(results)||results.length!==checks.length)return {passed:false,errors:['evidence count mismatch'],regressions};
  const byId=new Map();
  for(const r of results){if(!r||byId.has(r.id))errors.push('duplicate or invalid check record');else byId.set(r.id,r);}
  for(const c of checks){
    const r=byId.get(c.id);
    if(!r){errors.push('missing: '+c.id);continue;}
    const {evidenceHash,...body}=r;
    if(evidenceHash!==digest(body)||r.producer!=='harness-docker-runner'||r.runId!==runId||r.commit!==commit||r.contractHash!==contractHash)errors.push('invalid evidence: '+c.id);
    if(r.kind!==c.kind||JSON.stringify(r.argv)!==JSON.stringify(c.argv))errors.push('command mismatch: '+c.id);
    if(r.passed!==true||r.code!==0||r.timedOut||r.truncated||r.error||r.empty)errors.push('test failed: '+c.id);
  }
  for(const b of baseline||[])if(b.passed===true&&byId.get(b.id)?.passed!==true)regressions.push(b.id);
  return {passed:errors.length===0&&regressions.length===0,errors,regressions};
}
export function parseVerdict(text){
  const block=String(text).match(/```(?:json)?\s*([\s\S]*?)```/i);
  const v=JSON.parse((block?block[1]:text).trim());
  if(!v||!['PASS','FAIL','INCONCLUSIVE'].includes(v.verdict)||!Array.isArray(v.criteriaPassed)||v.criteriaPassed.some(c=>typeof c!=='string'))throw Error('invalid judge response');
  return {verdict:v.verdict,criteriaPassed:v.criteriaPassed,notes:String(v.notes||'').slice(0,3000)};
}
export async function evaluate({task,results,baseline,runId,commit,contractHash,judge}){
  const verified=verifyEvidence({checks:task.checks,results,baseline,runId,commit,contractHash});
  // Deterministic failures never need an additional LLM call to resolve.
  if(!verified.passed)return {passed:false,verified,llm:{verdict:'NOT_RUN'},reason:'deterministic_failure'};
  const evidence=results.map(r=>({id:r.id,kind:r.kind,code:r.code,passed:r.passed,stdout:r.stdout.slice(-1500),stderr:r.stderr.slice(-1500),evidenceHash:r.evidenceHash}));
  let llm={verdict:'INCONCLUSIVE',criteriaPassed:[],notes:'Judge unavailable'};
  try{llm=parseVerdict(await judge({goal:task.goal,criteria:task.criteria,commit,evidence}));}
  catch(e){llm={verdict:'INCONCLUSIVE',criteriaPassed:[],notes:String(e.message).slice(0,500)};}
  const passed=llm.verdict==='PASS'&&task.criteria.every(c=>llm.criteriaPassed.includes(c));
  return {passed,verified,llm,reason:passed?'verified':'judge_not_pass'};
}
