import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,open,rm} from 'node:fs/promises';
import {spawnBounded,digest,runIsolated,validateChecks} from './runner.mjs';
import {independentEvaluate} from './evaluator.mjs';

export const MANDATORY_PROTECTED=['tests/','test/','e2e/','.github/','.env','.pi/','.agents/','AGENTS.md','package-lock.json','pyproject.toml','.gitmodules'];
export function validateTask(task){
  if(!task||typeof task.goal!=='string'||task.goal.length<5||!Array.isArray(task.criteria)||!task.criteria.length||task.criteria.some(s=>typeof s!=='string'||!s.trim()))throw Error('invalid goal/criteria');
  validateChecks(task.checks);
  if(task.protectedPrefixes!==undefined&&(!Array.isArray(task.protectedPrefixes)||task.protectedPrefixes.some(x=>typeof x!=='string'||!x||x.startsWith('/')||x.includes('..'))))throw Error('invalid protectedPrefixes');
  return {...task,protectedPrefixes:[...new Set([...MANDATORY_PROTECTED,...(task.protectedPrefixes||[])])]};
}
async function save(file,value){await mkdir(path.dirname(file),{recursive:true});const tmp=file+'.'+randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify(value,null,2)+'\n',{mode:0o600});await rename(tmp,file);}
async function git(cwd,...args){
  const r=await spawnBounded('git',['-C',cwd,...args],{timeoutMs:30000,maxBytes:200000});
  if(r.code!==0||r.truncated)throw Error('git failed: '+(r.stderr||r.stdout));return r.stdout.trim();
}
function protectedFile(p,prefixes){return prefixes.some(x=>p===x||p.startsWith(x.endsWith('/')?x:x+'/')||(x==='.env'&&p.startsWith('.env.')));}
async function dirtyFiles(cwd){const s=await git(cwd,'status','--porcelain','-z');return s.split('\0').filter(Boolean).map(x=>x.slice(3));}

export class Workflow{
  constructor({dataDir='.harness-data',runner=runIsolated,agent,image='effective-harness-test:local',maxRounds=3}){
    if(!agent)throw Error('agent required');this.dataDir=path.resolve(dataDir);this.runner=runner;this.agent=agent;this.image=image;this.maxRounds=maxRounds;
  }
  file(id){if(!/^run-[a-f0-9]{16}$/.test(id))throw Error('invalid run id');return path.join(this.dataDir,'runs',id,'state.json');}
  async load(id){return JSON.parse(await readFile(this.file(id),'utf8'));}
  async store(s){await save(this.file(s.id),s);}
  async create(repo,rawTask){
    const task=validateTask(rawTask),root=await git(path.resolve(repo),'rev-parse','--show-toplevel');
    if((await dirtyFiles(root)).length)throw Error('source repository must be clean');
    const baseCommit=await git(root,'rev-parse','HEAD'),id='run-'+randomUUID().replaceAll('-','').slice(0,16);
    const workspace=path.join(this.dataDir,'workspaces',id);await mkdir(path.dirname(workspace),{recursive:true});
    await git(root,'worktree','add','--detach',workspace,baseCommit);
    const s={id,repo:root,workspace,baseCommit,task,contractHash:digest(task),phase:'BASELINE',status:'RUNNING',round:0,baseline:[],history:[],feedback:'',created:new Date().toISOString()};
    await this.store(s);return s;
  }
  async execute(id){
    const lockPath=path.join(path.dirname(this.file(id)),'lock'),lock=await open(lockPath,'wx',0o600);
    try{
      const s=await this.load(id);
      if(s.status!=='RUNNING')return s;
      if(digest(s.task)!==s.contractHash)throw Error('contract modified');
      const root=await git(s.workspace,'rev-parse','--show-toplevel');if(root!==s.workspace)throw Error('worktree changed');
      while(s.status==='RUNNING'){
        if(s.phase==='BASELINE'){
          s.baseline=await this.runner({workspace:s.workspace,checks:s.task.checks,runId:s.id,commit:s.baseCommit,contractHash:s.contractHash,image:this.image});
          s.phase='PLANNING';await this.store(s);
        }
        if(s.phase==='PLANNING'){
          s.plan=String(await this.agent.plan(s)).slice(0,20000);s.phase='GENERATING';await this.store(s);
        }
        if(s.phase==='GENERATING'){
          if(s.round>=this.maxRounds){s.status='BUDGET_EXCEEDED';await this.store(s);break;}
          s.round++;await this.store(s);
          s.generatorSummary=String(await this.agent.generate(s)).slice(0,8000);s.phase='SNAPSHOT';await this.store(s);
        }
        if(s.phase==='SNAPSHOT'){
          const changed=await dirtyFiles(s.workspace),violations=changed.filter(p=>protectedFile(p,s.task.protectedPrefixes));
          if(violations.length){s.status='BLOCKED';s.feedback='protected paths: '+violations.join(', ');await this.store(s);break;}
          await git(s.workspace,'add','-A');
          await git(s.workspace,'-c','user.name=Harness','-c','user.email=harness@localhost','commit','--allow-empty','-m','candidate round '+s.round);
          s.candidate=await git(s.workspace,'rev-parse','HEAD');s.phase='TESTING';await this.store(s);
        }
        if(s.phase==='TESTING'){
          s.results=await this.runner({workspace:s.workspace,checks:s.task.checks,runId:s.id,commit:s.candidate,contractHash:s.contractHash,image:this.image});
          s.phase='EVALUATING';await this.store(s);
        }
        if(s.phase==='EVALUATING'){
          s.review=await independentEvaluate({task:s.task,results:s.results,baseline:s.baseline,runId:s.id,commit:s.candidate,contractHash:s.contractHash,judge:payload=>this.agent.judge(s,payload)});
          s.history.push({round:s.round,candidate:s.candidate,review:s.review});
          if(s.review.passed){s.status='VERIFIED_PASS';s.phase='DONE';s.verifiedCommit=s.candidate;}
          else{s.feedback=JSON.stringify(s.review);s.phase='GENERATING';}
          await this.store(s);
        }
      }
      return s;
    }finally{await lock.close();await rm(lockPath,{force:true});}
  }
}
