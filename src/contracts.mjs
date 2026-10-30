import {createHash} from 'node:crypto';
export const digest=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const kinds=['pytest','e2e','lint','typecheck'];
const runners={
  pytest:argv=>argv.length>=4&&['python','python3'].includes(argv[0])&&argv[1]==='-m'&&argv[2]==='pytest',
  e2e:argv=>argv.length>=4&&['python','python3'].includes(argv[0])&&argv[1]==='-m'&&argv[2]==='pytest',
  lint:argv=>argv[0]==='ruff'&&argv[1]==='check',
  typecheck:argv=>argv[0]==='mypy'||(argv[0]==='python'&&argv[1]==='-m'&&argv[2]==='mypy')
};
const SAFE_ID=/^[a-z][a-z0-9_-]{1,63}$/;
export function validateChecks(checks){
  if(!Array.isArray(checks)||checks.length<4||checks.length>32)throw Error('require four check types');
  const ids=new Set();
  for(const c of checks){
    if(!c||!SAFE_ID.test(c.id||'')||ids.has(c.id)||!kinds.includes(c.kind))throw Error('invalid/duplicate check');
    ids.add(c.id);
    if(!Array.isArray(c.argv)||!runners[c.kind](c.argv)||c.argv.length>32)throw Error('invalid command: '+c.id);
    if(c.argv.some(x=>typeof x!=='string'||!x||x.length>512||/[\0\r\n]/.test(x)))throw Error('invalid argv');
    // No flags that explicitly disable checks or load external plugins.
    if(c.argv.some(x=>/^--(override-ini|pyargs|ignore|exclude|disable-error-code|follow-imports|plugins|config-file)=/.test(x)))throw Error('untrusted check option');
  }
  if(kinds.some(k=>!checks.some(c=>c.kind===k)))throw Error('missing required test type');
  return checks;
}
export const PROTECTED=['tests/','test/','e2e/','.github/','.env','.pi/','.agents/','AGENTS.md','pyproject.toml','package.json','package-lock.json','requirements.txt','tox.ini','.gitmodules'];
export function isProtected(p,paths=PROTECTED){
  const normalized=p.replaceAll('\\','/');
  return paths.some(x=>normalized===x||normalized.startsWith(x.endsWith('/')?x:x+'/')||(x==='.env'&&normalized.startsWith('.env.')));
}
export function validateTask(t){
  if(!t||typeof t.goal!=='string'||t.goal.trim().length<5||!Array.isArray(t.criteria)||!t.criteria.length||t.criteria.some(x=>typeof x!=='string'||!x.trim()))throw Error('invalid goal or criteria');
  validateChecks(t.checks);
  const extra=t.protectedPrefixes??[];
  if(!Array.isArray(extra)||extra.some(x=>typeof x!=='string'||!x||x.startsWith('/')||x.split('/').includes('..')))throw Error('invalid protected path');
  return {goal:t.goal,criteria:[...t.criteria],checks:t.checks.map(c=>({id:c.id,kind:c.kind,argv:[...c.argv]})),protectedPrefixes:[...new Set([...PROTECTED,...extra])]};
}
