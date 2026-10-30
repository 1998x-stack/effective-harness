import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createAgentSession,ModelRuntime,SessionManager} from '@earendil-works/pi-coding-agent';

test('Pi SDK can register iagent standard and initialize a tool-free evaluator offline', async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'harness-pi-sdk-'));
  try{
    const config={providers:{iagent:{baseUrl:'https://example.invalid/v1',api:'openai-completions',apiKey:'test-key-not-real',
      models:[{id:'iagent/standard',name:'IAgent Standard',reasoning:true,input:['text'],contextWindow:512000,maxTokens:16384}]}}};
    const modelsPath=path.join(dir,'models.json');
    await writeFile(modelsPath,JSON.stringify(config));
    const runtime=await ModelRuntime.create({
      modelsPath,authPath:path.join(dir,'auth.json'),
      refreshOnCreate:false,allowModelNetwork:false
    });
    const model=runtime.getModel('iagent','iagent/standard');
    assert.ok(model,'iagent model registration should succeed');
    const {session}=await createAgentSession({
      cwd:dir,modelRuntime:runtime,model,
      sessionManager:SessionManager.inMemory(),
      noTools:'all',thinkingLevel:'high'
    });
    try{
      assert.equal(session.model?.id,'iagent/standard');
      assert.deepEqual(session.getActiveToolNames(),[]);
    }finally{session.dispose();}
  }finally{await rm(dir,{recursive:true,force:true});}
});
