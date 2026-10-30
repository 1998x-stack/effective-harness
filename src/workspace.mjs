import path from 'node:path';
import {mkdtemp,stat,rm,open} from 'node:fs/promises';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {pipeline} from 'node:stream/promises';
import {createWriteStream} from 'node:fs';
import {checkResult,runCommand} from './process.mjs';
import {isProtected} from './contracts.mjs';

export async function git(cwd,...args){return checkResult(await runCommand('git',['-C',cwd,...args],{timeoutMs:30000,maxBytes:500000}), 'git '+args[0]);}
export async function uncommitted(cwd){
  const raw=await git(cwd,'status','--porcelain','-z');
  return raw.split('\0').filter(Boolean).map(v=>v.slice(3));
}
export async function createWorkspace(repo,workspace){
  const root=await git(path.resolve(repo),'rev-parse','--show-toplevel');
  if((await uncommitted(root)).length)throw Error('source repository is not clean');
  const base=await git(root,'rev-parse','HEAD');
  await git(root,'worktree','add','--detach',workspace,base);
  return {root,base};
}
export async function changedPaths(workspace,base){
  const tracked=await git(workspace,'diff','--name-only','-z',base,'--');
  const untracked=await git(workspace,'ls-files','--others','--exclude-standard','-z');
  return [...new Set([...tracked.split('\0'),...untracked.split('\0')].filter(Boolean))];
}
export async function snapshot(workspace,base,protectedPrefixes,round){
  const names=await changedPaths(workspace,base);
  const violations=names.filter(n=>isProtected(n,protectedPrefixes));
  if(violations.length)throw Error('protected paths modified: '+violations.join(', '));
  if(!(await uncommitted(workspace)).length)throw Error('generator made no changes');
  await git(workspace,'add','--all');
  await git(workspace,'-c','user.name=Harness','-c','user.email=harness@localhost','commit','-m', 'harness candidate '+round);
  return git(workspace,'rev-parse','HEAD');
}
export async function archiveCommit(workspace,commit,{maxBytes=100_000_000,runId}={}){
  if(!/^[0-9a-f]{40}$/.test(commit))throw Error('invalid commit');
  if(runId&&!/^run-[0-9a-f]{16}$/.test(runId))throw Error('invalid run ID');
  const dir=await mkdtemp(path.join(os.tmpdir(),`harness-archive-${runId?runId+'-':''}`)),file=path.join(dir,'candidate.tar');
  try{
    const p=spawn('git',['-C',workspace,'archive','--format=tar',commit],{stdio:['ignore','pipe','pipe']});
    let err='';p.stderr.on('data',b=>{err+=b.toString().slice(0,1000)});
    const written=pipeline(p.stdout,createWriteStream(file,{mode:0o644}));
    const closed=new Promise((resolve,reject)=>{
      p.once('error',reject);
      p.once('close',code=>code===0?resolve():reject(Error('git archive failed: '+err)));
    });
    await Promise.all([written,closed]);
    const n=(await stat(file)).size;
    if(n<=0||n>maxBytes)throw Error('snapshot archive outside size budget');
    return {file,cleanup:()=>rm(dir,{recursive:true,force:true})};
  }catch(e){await rm(dir,{recursive:true,force:true});throw e;}
}
