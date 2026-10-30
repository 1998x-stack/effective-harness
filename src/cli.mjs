#!/usr/bin/env node
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {Workflow} from './workflow.mjs';
import {PiAgent} from './pi.mjs';
import {StateStore} from './store.mjs';

async function main(){
  const [action,arg1,arg2]=process.argv.slice(2);
  const dir=path.resolve(process.env.HARNESS_DATA_DIR||'.harness-data');
  if(action==='status'){
    if(!arg1)throw Error('status requires run-id');
    const s=await new StateStore(dir).load(arg1);
    console.log(JSON.stringify({id:s.id,status:s.status,phase:s.phase,round:s.round,verifiedCommit:s.verifiedCommit||null},null,2));return;
  }
  if(!['run','resume'].includes(action)){console.log('Usage: npm start -- run <repo> <task.json> | resume <run-id> | status <run-id>');return;}
  const key=process.env.DEEPSEEK_API_KEY;
  if(!key)throw Error('Set DEEPSEEK_API_KEY in .env');
  const agent=new PiAgent({dataDir:dir,apiKey:key,baseUrl:process.env.DEEPSEEK_BASE_URL||'https://api.deepseek.com',
    modelId:process.env.DEEPSEEK_MODEL||'deepseek-flash',thinkingLevel:process.env.PI_THINKING_LEVEL||'off',
    contextWindow:Number(process.env.PI_CONTEXT_WINDOW||131072),maxTokens:Number(process.env.PI_MAX_OUTPUT_TOKENS||8192),
    timeoutMs:Number(process.env.HARNESS_AGENT_TIMEOUT_MS||240000)});
  const workflow=new Workflow({dataDir:dir,agent,image:process.env.HARNESS_TEST_IMAGE||'effective-harness-tests:local',
    maxRounds:Number(process.env.HARNESS_MAX_ROUNDS||3),timeoutMs:Number(process.env.HARNESS_TEST_TIMEOUT_MS||120000)});
  let id=arg1;
  if(action==='run'){
    if(!arg1||!arg2)throw Error('run requires a target repo and task json');
    const s=await workflow.create(arg1,JSON.parse(await readFile(arg2,'utf8')));id=s.id;
  }
  console.log('Run ID: '+id);
  const s=await workflow.execute(id);
  console.log(JSON.stringify({status:s.status,round:s.round,verifiedCommit:s.verifiedCommit||null,feedback:s.feedback||''},null,2));
  if(s.status!=='VERIFIED_PASS')process.exitCode=1;
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
