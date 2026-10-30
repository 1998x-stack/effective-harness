#!/usr/bin/env node
import path from 'node:path';
import os from 'node:os';
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
  const agent=new PiAgent({dataDir:dir,provider:process.env.PI_PROVIDER||'iagent',
    modelId:process.env.PI_MODEL||'iagent/standard',
    modelsPath:path.resolve(process.env.PI_MODELS_PATH||path.join(os.homedir(),'.pi/agent/models.json')),
    apiKey:process.env.PI_API_KEY||process.env.IAUTO_API_KEY||'',thinkingLevel:process.env.PI_THINKING_LEVEL||'high',
    timeoutMs:Number(process.env.HARNESS_AGENT_TIMEOUT_MS||1800000)});
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
