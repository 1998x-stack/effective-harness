import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {cp,mkdir,readdir,readFile,writeFile,appendFile,rm} from 'node:fs/promises';
import {spawn,execFileSync} from 'node:child_process';
import {StateStore} from '../src/store.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dataDir=path.resolve(process.env.HARNESS_DATA_DIR||path.join(root,'.harness-data'));
const suite=process.env.HARNESS_SUITE||'long-running';
if(!/^[a-z][a-z0-9-]*$/.test(suite))throw Error('Invalid HARNESS_SUITE');
const fixtureDir=path.join(root,'examples',suite);
const budgets={simple:30*60_000,medium:60*60_000,complex:120*60_000,extreme:120*60_000};
const rounds={simple:4,medium:7,complex:12,extreme:15};
const budgetOverride=process.env.HARNESS_BUDGET_MS?Number(process.env.HARNESS_BUDGET_MS):null;
if(budgetOverride!==null&&(!Number.isInteger(budgetOverride)||budgetOverride<1000))throw Error('HARNESS_BUDGET_MS must be at least 1000');
const selected=process.argv[2]||'all';
const names=selected==='all'?['simple','medium','complex']:[selected];
if(names.some(name=>!(name in budgets)))throw Error('Usage: node scripts/long-eval.mjs [simple|medium|complex|extreme|all]');
const label=process.argv[3]||'';
if(label&&!/^[a-z0-9_-]{1,30}$/.test(label))throw Error('Run label must use lowercase letters, numbers, hyphens, or underscores');

function git(cwd,...args){execFileSync('git',args,{cwd,stdio:'ignore'});}

async function run(name){
  const budgetMs=Math.min(budgets[name],budgetOverride??budgets[name]);
  const base=path.join(dataDir,'benchmarks',suite==='long-running'?'':suite,label?`${name}-${label}`:name);
  const repo=path.join(base,'repo');
  const output=path.join(base,'run.log');
  const timeline=path.join(base,'timeline.jsonl');
  await mkdir(base,{recursive:true});
  const entries=await readdir(base);
  if(entries.length)throw Error(`${name} already has run artifacts at ${base}`);
  if(name==='extreme'){
    const source=process.env.HARNESS_BASE_REPO;
    if(!source)throw Error('HARNESS_BASE_REPO is required for extreme');
    await cp(path.resolve(source),repo,{recursive:true,filter:entry=>path.basename(entry)!=='.git'});
    await cp(path.join(fixtureDir,'extreme-overlay'),repo,{recursive:true,force:true});
    await cp(path.join(fixtureDir,'holdout'),path.join(repo,'tests/unit'),{recursive:true,force:true});
  }else await cp(path.join(fixtureDir,'seed'),repo,{recursive:true});
  git(repo,'init','-q');
  git(repo,'add','.');
  git(repo,'-c','user.name=Benchmark','-c','user.email=benchmark@localhost','commit','-qm','benchmark seed');
  const started=Date.now();
  await writeFile(output,'');
  await writeFile(timeline,JSON.stringify({at:new Date().toISOString(),event:'started',name,budgetMs})+'\n');
  const log=async message=>appendFile(output,message);
  const child=spawn(process.execPath,[path.join(root,'src/cli.mjs'),'run',repo,path.join(fixtureDir,`${name}.json`)],{
    cwd:root,env:{...process.env,HARNESS_DATA_DIR:dataDir,HARNESS_TEST_IMAGE:'effective-harness-benchmark:local',
      HARNESS_AGENT_TIMEOUT_MS:String(Math.min(budgetMs,30*60_000)),HARNESS_MAX_ROUNDS:String(rounds[name])},
    detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']
  });
  let runId='',stdoutTail='';
  child.stdout.on('data',chunk=>{
    const value=chunk.toString();
    stdoutTail=(stdoutTail+value).slice(-200);
    const match=stdoutTail.match(/Run ID: (run-[0-9a-f]{16})/);
    if(match)runId=match[1];
    void log(value);
  });
  child.stderr.on('data',chunk=>{void log('[stderr] '+chunk.toString());});
  let last='';
  const poll=async()=>{
    if(!runId)return;
    try{
      const state=JSON.parse(await readFile(path.join(dataDir,'runs',runId,'state.json'),'utf8'));
      const marker=JSON.stringify({status:state.status,phase:state.phase,round:state.round,history:state.history.length});
      if(marker!==last){
        last=marker;
        await appendFile(timeline,JSON.stringify({at:new Date().toISOString(),elapsedMs:Date.now()-started,runId,...JSON.parse(marker)})+'\n');
      }
    }catch(error){
      if(error.code!=='ENOENT')throw error;
    }
  };
  const timer=setInterval(()=>{void poll();},5000);
  const stopChild=signal=>{
    try{if(process.platform!=='win32'&&child.pid)process.kill(-child.pid,signal);else child.kill(signal);}catch(error){if(error.code!=='ESRCH')throw error;}
  };
  let timedOut=false;
  let force;
  const deadline=setTimeout(()=>{timedOut=true;stopChild('SIGTERM');force=setTimeout(()=>stopChild('SIGKILL'),5000);force.unref();},budgetMs);
  const result=await new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));
  clearInterval(timer);
  clearTimeout(deadline);
  if(force)clearTimeout(force);
  if(timedOut&&runId){
    const containers=execFileSync('docker',['ps','-q','--filter',`label=effective-harness-run=${runId}`],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
    if(containers.length)execFileSync('docker',['rm','-f',...containers],{stdio:'ignore'});
    for(const entry of await readdir(os.tmpdir(),{withFileTypes:true})){
      if(entry.isDirectory()&&entry.name.startsWith(`harness-archive-${runId}-`)){
        await rm(path.join(os.tmpdir(),entry.name),{recursive:true,force:true});
      }
    }
    const store=new StateStore(dataDir);
    const unlock=await store.lock(runId);
    try{
      const state=await store.load(runId);
      if(state.status==='RUNNING'){
        state.status='TIME_BUDGET_EXCEEDED';state.phase='DONE';state.feedback=`Run stopped at ${budgetMs} ms budget`;
        state.finishedAt=new Date().toISOString();
        await store.save(state);
      }
    }finally{await unlock();}
  }
  await poll();
  await appendFile(timeline,JSON.stringify({at:new Date().toISOString(),event:'finished',elapsedMs:Date.now()-started,runId,timedOut,...result})+'\n');
  return {name,runId,elapsedMs:Date.now()-started,timedOut,...result,output,timeline};
}

for(const name of names){
  const result=await run(name);
  console.log(JSON.stringify(result));
}
