#!/usr/bin/env node
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {Workflow} from './workflow.mjs';
import {PiAgent} from './pi.mjs';

const [command,a,b]=process.argv.slice(2);
const key=process.env.DEEPSEEK_API_KEY||'';
const dataDir=path.resolve(process.env.HARNESS_DATA_DIR||'.harness-data');
if((process.env.HARNESS_RUNNER_MODE||'docker')!=='docker')throw Error('Only isolated Docker runner is permitted');
if(!['status','help','--help'].includes(command)&&(!key||key.startsWith('replace_')))throw Error('Missing DEEPSEEK_API_KEY');
const agent=new PiAgent({dataDir,apiKey:key,baseUrl:process.env.DEEPSEEK_BASE_URL||'https://api.deepseek.com',modelId:process.env.DEEPSEEK_MODEL||'deepseek-flash',thinkingLevel:process.env.PI_THINKING_LEVEL||'off',agentTimeoutMs:Number(process.env.HARNESS_AGENT_TIMEOUT_MS||240000)});
const workflow=new Workflow({dataDir,agent,image:process.env.HARNESS_TEST_IMAGE||'effective-harness-test:local',maxRounds:Number(process.env.HARNESS_MAX_ROUNDS||3)});
if(command==='help'||command==='--help'||!command){
  console.log('npm start -- run <git-repo> <task.json> | resume <run-id> | status <run-id>');
}else if(command==='run'){
  if(!a||!b)throw Error('run requires repo path and task file');
  const task=JSON.parse(await readFile(b,'utf8')),s=await workflow.create(a,task);
  console.log('Run '+s.id);
  const result=await workflow.execute(s.id);
  console.log(JSON.stringify({status:result.status,round:result.round,commit:result.verifiedCommit??null},null,2));
  if(result.status!=='VERIFIED_PASS')process.exitCode=1;
}else if(command==='resume'){
  if(!a)throw Error('resume requires run ID');
  const result=await workflow.execute(a);
  console.log(JSON.stringify({status:result.status,round:result.round,commit:result.verifiedCommit??null},null,2));
  if(result.status!=='VERIFIED_PASS')process.exitCode=1;
}else if(command==='status'){
  const s=await workflow.load(a);
  console.log(JSON.stringify({id:s.id,status:s.status,phase:s.phase,round:s.round,feedback:s.feedback},null,2));
}else throw Error('Unknown command: '+command);
