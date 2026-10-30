import {realpath} from 'node:fs/promises';
import {digest,validateChecks} from './contracts.mjs';
import {runCommand} from './process.mjs';
import {archiveCommit} from './workspace.mjs';
export function dockerArguments(archive,check,image){
  if(!/^[a-zA-Z0-9_./:@-]{3,180}$/.test(image))throw Error('invalid Docker image');
  return ['run','--rm','--network','none','--read-only','--cap-drop','ALL',
    '--security-opt','no-new-privileges','--pids-limit','128','--cpus','2','--memory','1g',
    '--user','1000:1000','--tmpfs','/tmp:rw,nosuid,size=128m,mode=1777',
    '--tmpfs','/work:rw,nosuid,size=512m,mode=1777',
    '-e','CI=1','-e','HOME=/tmp','-e','PYTHONDONTWRITEBYTECODE=1','-e','RUFF_NO_CACHE=1',
    '--mount','type=bind,src='+archive+',dst=/snapshot.tar,readonly',
    '-w','/work',image,'sh','-ec','tar xf /snapshot.tar -C /work; cd /work; exec "$@"','check',...check.argv];
}
export function makeEvidence({raw,check,runId,commit,contractHash}){
  const output=String(raw.stdout||'')+'\n'+String(raw.stderr||'');
  const count=/\b[1-9][0-9]* passed\b/i.test(output);
  const empty=/\b(no tests ran|collected 0 items|0 passed)\b/i.test(output);
  const passed=raw.code===0&&!raw.timedOut&&!raw.truncated&&!raw.error&&!empty&&(!['pytest','e2e'].includes(check.kind)||count);
  const record={runId,commit,contractHash,id:check.id,kind:check.kind,argv:check.argv,passed,empty,code:raw.code,signal:raw.signal??null,
    stdout:String(raw.stdout??''),stderr:String(raw.stderr??''),truncated:Boolean(raw.truncated),timedOut:Boolean(raw.timedOut),error:raw.error||'',durationMs:raw.durationMs,producer:'harness-docker-runner'};
  return {...record,evidenceHash:digest(record)};
}
export async function runIsolated({workspace,checks,runId,commit,contractHash,image='effective-harness-tests:local',timeoutMs=120000,maxBytes=100000,
  execute=runCommand,archive=archiveCommit}){
  validateChecks(checks);
  if(!/^[0-9a-f]{40}$/.test(commit)||!/^[0-9a-f]{64}$/.test(contractHash))throw Error('invalid commit or contract SHA');
  const root=await realpath(workspace);
  const snap=await archive(root,commit);
  try{
    const results=[];
    for(const check of checks){
      const raw=await execute('docker',dockerArguments(snap.file,check,image),{timeoutMs,maxBytes});
      results.push(makeEvidence({raw,check,runId,commit,contractHash}));
    }
    return results;
  }finally{await snap.cleanup();}
}
