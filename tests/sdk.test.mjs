import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {buildModelConfig} from '../src/pi.mjs';
import {createAgentSession,ModelRuntime,SessionManager} from '@earendil-works/pi-coding-agent';

test('Pi SDK can register DeepSeek Flash and initialize a read-only session offline', async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'harness-pi-sdk-'));
  try{
    const config=buildModelConfig();
    assert.equal(config.providers['deepseek-harness'].models[0].id,'deepseek-flash');
    const modelsPath=path.join(dir,'models.json');
    await writeFile(modelsPath,JSON.stringify(config));
    const runtime=await ModelRuntime.create({
      modelsPath,authPath:path.join(dir,'auth.json'),
      refreshOnCreate:false,allowModelNetwork:false
    });
    await runtime.setRuntimeApiKey('deepseek-harness','test-key-not-real');
    const model=runtime.getModel('deepseek-harness','deepseek-flash');
    assert.ok(model,'DeepSeek model registration should succeed');
    const {session}=await createAgentSession({
      cwd:dir,modelRuntime:runtime,model,
      sessionManager:SessionManager.inMemory(),
      noTools:true,thinkingLevel:'off'
    });
    try{
      assert.equal(session.model?.id,'deepseek-flash');
      assert.deepEqual(session.getActiveToolNames(),[]);
    }finally{session.dispose();}
  }finally{await rm(dir,{recursive:true,force:true});}
});
