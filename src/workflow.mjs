import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {mkdir,readdir,readFile} from 'node:fs/promises';
import {validateTask,digest} from './contracts.mjs';
import {StateStore} from './store.mjs';
import {createWorkspace,snapshot,git} from './workspace.mjs';
import {runIsolated} from './runner.mjs';
import {evaluate} from './evaluator.mjs';

async function testSources(workspace,checks){
  const files=[];
  async function visit(relative){
    if(files.length>=16)return;
    const absolute=path.join(workspace,relative);
    let entries;
    try{entries=await readdir(absolute,{withFileTypes:true});}
    catch(error){if(error.code==='ENOENT')return;throw error;}
    for(const entry of entries){
      if(files.length>=16)return;
      const next=path.join(relative,entry.name);
      if(entry.isDirectory())await visit(next);
      else if(entry.isFile()&&entry.name.endsWith('.py'))files.push(next);
    }
  }
  for(const check of checks){
    if(!['pytest','e2e'].includes(check.kind))continue;
    for(const arg of check.argv){
      if(!/^(tests|test|e2e)\/[a-zA-Z0-9_./-]+$/.test(arg)||arg.split('/').includes('..'))continue;
      if(arg.endsWith('.py'))files.push(arg);
      else await visit(arg);
    }
  }
  const unique=[...new Set(files)].slice(0,16);
  const sources=[];
  for(const file of unique){
    let source;
    try{source=await readFile(path.join(workspace,file),'utf8');}
    catch(error){if(error.code==='ENOENT')continue;throw error;}
    sources.push({path:file,source:source.slice(0,12000)});
  }
  return sources;
}

export class Workflow{
  constructor({dataDir='.harness-data',agent,runner=runIsolated,maxRounds=3,image='effective-harness-tests:local',timeoutMs=120000}){
    if(!agent)throw Error('agent required');
    if(!Number.isInteger(maxRounds)||maxRounds<1||maxRounds>30)throw Error('invalid max rounds');
    this.store=new StateStore(dataDir);Object.assign(this,{agent,runner,maxRounds,image,timeoutMs});
  }
  async create(repo,rawTask){
    const task=validateTask(rawTask),id='run-'+randomUUID().replaceAll('-','').slice(0,16);
    const workspace=path.join(this.store.dir,'workspaces',id);
    await mkdir(path.dirname(workspace),{recursive:true});
    const {root,base}=await createWorkspace(repo,workspace);
    const s={id,workspace,repo:root,base,task,contractHash:digest(task),phase:'BASELINE',status:'RUNNING',
      round:0,history:[],baseline:[],feedback:'',createdAt:new Date().toISOString()};
    await this.store.save(s);return s;
  }
  async execute(id){
    const unlock=await this.store.lock(id);
    try{
      const s=await this.store.load(id);
      if(s.status!=='RUNNING')return s;
      if(digest(s.task)!==s.contractHash)throw Error('frozen acceptance contract modified');
      if(await git(s.workspace,'rev-parse','--show-toplevel')!==s.workspace)throw Error('workspace mismatch');
      for(;;){
        if(s.phase==='BASELINE'){
          s.baseline=await this.runner({workspace:s.workspace,checks:s.task.checks,runId:s.id,commit:s.base,contractHash:s.contractHash,image:this.image,timeoutMs:this.timeoutMs});
          if(s.baseline.some(r=>r.error)){s.status='INFRA_ERROR';await this.store.save(s);return s;}
          if(s.baseline.every(r=>r.passed)){
            s.review=await evaluate({task:s.task,results:s.baseline,baseline:s.baseline,runId:s.id,commit:s.base,
              contractHash:s.contractHash,testSources:await testSources(s.workspace,s.task.checks),
              judge:data=>this.agent.judge(s,data)});
            s.history.push({round:0,commit:s.base,review:s.review});
            s.status=s.review.passed?'VERIFIED_PASS':'JUDGE_REJECTED';
            s.phase='DONE';
            if(s.review.passed)s.verifiedCommit=s.base;
            else s.feedback=JSON.stringify(s.review);
            await this.store.save(s);return s;
          }
          s.phase='PLANNING';await this.store.save(s);
        }
        if(s.phase==='PLANNING'){
          s.plan=(await this.agent.plan(s)).slice(0,16000);
          s.phase='GENERATING';await this.store.save(s);
        }
        if(s.phase==='GENERATING'){
          if(s.round>=this.maxRounds){s.status='BUDGET_EXCEEDED';await this.store.save(s);return s;}
          s.round++;await this.store.save(s);
          s.summary=(await this.agent.generate(s)).slice(0,8000);
          s.phase='SNAPSHOT';await this.store.save(s);
        }
        if(s.phase==='SNAPSHOT'){
          try{s.candidate=await snapshot(s.workspace,s.base,s.task.protectedPrefixes,s.round);}
          catch(e){s.status='BLOCKED';s.feedback=String(e.message);await this.store.save(s);return s;}
          s.phase='TESTING';await this.store.save(s);
        }
        if(s.phase==='TESTING'){
          s.results=await this.runner({workspace:s.workspace,checks:s.task.checks,runId:s.id,commit:s.candidate,contractHash:s.contractHash,image:this.image,timeoutMs:this.timeoutMs});
          if(s.results.some(r=>r.error)){s.status='INFRA_ERROR';await this.store.save(s);return s;}
          s.phase='EVALUATING';await this.store.save(s);
        }
        if(s.phase==='EVALUATING'){
          s.review=await evaluate({task:s.task,results:s.results,baseline:s.baseline,runId:s.id,commit:s.candidate,contractHash:s.contractHash,
            testSources:await testSources(s.workspace,s.task.checks),judge:data=>this.agent.judge(s,data)});
          s.history.push({round:s.round,commit:s.candidate,review:s.review});
          if(s.review.passed){s.status='VERIFIED_PASS';s.phase='DONE';s.verifiedCommit=s.candidate;}
          else if(s.review.reason==='judge_not_pass'){
            s.status='JUDGE_REJECTED';s.phase='DONE';s.feedback=JSON.stringify(s.review);
          }else{
            s.feedback=JSON.stringify({review:s.review,failures:s.results.filter(r=>!r.passed).map(r=>({
              id:r.id,code:r.code,stdout:r.stdout.slice(-6000),stderr:r.stderr.slice(-3000),timedOut:r.timedOut
            }))});
            s.phase='GENERATING';
          }
          await this.store.save(s);
        }
        if(s.status!=='RUNNING')return s;
      }
    }finally{await unlock();}
  }
}
