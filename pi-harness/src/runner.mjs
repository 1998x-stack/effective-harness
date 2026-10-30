import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {realpath} from 'node:fs/promises';

const KINDS=new Set(['pytest','e2e','lint','typecheck']);
const ALLOWED=new Set(['python','python3','pytest','ruff','mypy','node','npm','npx']);
export const digest=x=>createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');

export function validateChecks(checks){
  if(!Array.isArray(checks)||!checks.length)throw Error('checks must be nonempty');
  const ids=new Set();
  for(const c of checks){
    if(!c||!/^[a-z][a-z0-9_-]{1,63}$/.test(c.id||'')||ids.has(c.id))throw Error('invalid/duplicate check id');
    if(!KINDS.has(c.kind))throw Error('unsupported kind: '+c.kind);
    if(!Array.isArray(c.argv)||!c.argv.length||!ALLOWED.has(c.argv[0])||c.argv.some(a=>typeof a!=='string'||a.length>600||a.includes('\0')))throw Error('invalid check argv');
    ids.add(c.id);
  }
  if([...KINDS].some(k=>!checks.some(c=>c.kind===k)))throw Error('requires pytest, e2e, lint and typecheck checks');
  return checks;
}
export function dockerArgs(workspace,check,image){
  if(!/^[a-zA-Z0-9_./:@-]+$/.test(image))throw Error('invalid image');
  return ['run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','128','--cpus','2','--memory','1g','--user','1000:1000',
    '--tmpfs','/tmp:rw,exec,size=128m,mode=1777','--tmpfs','/work:rw,exec,size=512m,mode=1777',
    '-e','CI=1','-e','HOME=/tmp','-e','PYTHONDONTWRITEBYTECODE=1',
    '--mount',`type=bind,src=${workspace},dst=/source,readonly`,
    '-w','/work',image,'sh','-c',
    'cp -a /source/. /work/ && rm -f /work/.git && cd /work && exec "$@"',
    'isolated-check',...check.argv];
}
export async function spawnBounded(binary,args,{timeoutMs=120000,maxBytes=100000}={}){
  return new Promise(resolve=>{
    const started=Date.now();let stdout='',stderr='',truncated=false,timedOut=false,spawnError='';
    const child=spawn(binary,args,{shell:false,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe'],env:{PATH:process.env.PATH,HOME:process.env.HOME,DOCKER_HOST:process.env.DOCKER_HOST}});
    const append=(target,chunk)=>{const room=Math.max(0,maxBytes-Buffer.byteLength(stdout)-Buffer.byteLength(stderr));if(chunk.length>room)truncated=true;return target+chunk.subarray(0,room).toString('utf8');};
    child.stdout.on('data',x=>{stdout=append(stdout,x)});child.stderr.on('data',x=>{stderr=append(stderr,x)});
    const kill=s=>{try{if(process.platform!=='win32'&&child.pid)process.kill(-child.pid,s);else child.kill(s)}catch{}};
    const timer=setTimeout(()=>{timedOut=true;kill('SIGTERM');setTimeout(()=>kill('SIGKILL'),1000).unref()},timeoutMs);
    child.on('error',e=>{spawnError=e.message});
    child.on('close',(code,signal)=>{clearTimeout(timer);resolve({code,signal,stdout,stderr,truncated,timedOut,spawnError,durationMs:Date.now()-started})});
  });
}
export async function runIsolated({workspace,checks,runId,commit,contractHash,image='effective-harness-test:local',timeoutMs=120000,maxBytes=100000,exec=spawnBounded}){
  validateChecks(checks);
  if(!/^[0-9a-f]{40}$/.test(commit)||!/^[0-9a-f]{64}$/.test(contractHash))throw Error('invalid commit/contract');
  const root=await realpath(workspace),results=[];
  for(const check of checks){
    const raw=await exec('docker',dockerArgs(root,check,image),{timeoutMs,maxBytes});
    const empty=/\b(?:collected 0 items|no tests ran|Ran 0 tests|# tests 0)\b/i.test(raw.stdout+'\n'+raw.stderr);
    const passed=raw.code===0&&!raw.timedOut&&!raw.truncated&&!raw.spawnError&&!empty;
    const record={runId,commit,contractHash,id:check.id,kind:check.kind,argv:check.argv,passed,empty,...raw,producer:'isolated-docker-runner'};
    record.evidenceHash=digest(record);results.push(record);
  }
  return results;
}
