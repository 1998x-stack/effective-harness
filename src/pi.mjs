import path from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';

export function buildModelConfig({baseUrl='https://api.deepseek.com',modelId='deepseek-flash',contextWindow=131072,maxTokens=8192}={}){
  return {providers:{'deepseek-harness':{baseUrl,api:'openai-completions',apiKey:'$DEEPSEEK_API_KEY',
    models:[{id:modelId,name:'DeepSeek V4.1 Flash',reasoning:false,input:['text'],contextWindow,maxTokens}]}}};
}

export class PiAgent{
  constructor({dataDir,apiKey,baseUrl='https://api.deepseek.com',modelId='deepseek-flash',thinkingLevel='off',contextWindow=131072,maxTokens=8192,timeoutMs=240000}){
    if(!apiKey)throw Error('DEEPSEEK_API_KEY required');
    Object.assign(this,{dataDir,apiKey,baseUrl,modelId,thinkingLevel,contextWindow,maxTokens,timeoutMs});
  }
  async query(s,role,prompt){
    const {createAgentSession,ModelRuntime,SessionManager}=await import('@earendil-works/pi-coding-agent');
    const agentDir=path.join(this.dataDir,'pi-config');
    await mkdir(agentDir,{recursive:true});
    const modelsPath=path.join(agentDir,'models.json');
    const config=buildModelConfig(this);
    await writeFile(modelsPath,JSON.stringify(config)+'\n',{mode:0o600});
    const runtime=await ModelRuntime.create({modelsPath,authPath:path.join(agentDir,'auth.json'),allowModelNetwork:false});
    await runtime.setRuntimeApiKey('deepseek-harness',this.apiKey);
    const model=runtime.getModel('deepseek-harness',this.modelId);
    if(!model)throw Error('DeepSeek provider registration failed');
    const sessionDir=path.join(this.dataDir,'runs',s.id,'sessions','generator');
    if(role==='generator')await mkdir(sessionDir,{recursive:true});
    const sessionManager=role==='generator'?SessionManager.continueRecent(s.workspace,sessionDir):SessionManager.inMemory();
    const options={cwd:s.workspace,agentDir,modelRuntime:runtime,model,thinkingLevel:this.thinkingLevel,sessionManager,
      ...(role==='generator'?{tools:['read','grep','find','ls','edit','write']}:{noTools:true})};
    const {session}=await createAgentSession(options);
    const stop=setTimeout(()=>{session.abort().catch(()=>{});},this.timeoutMs);
    try{
      await session.prompt(prompt);
      if(session.messages.some(m=>m.role==='assistant'&&(m.stopReason==='error'||m.errorMessage)))throw Error('Pi model returned an error');
      const result=session.getLastAssistantText();
      if(!result||!result.trim())throw Error('empty Pi response');
      return result;
    }finally{clearTimeout(stop);session.dispose();}
  }
  plan(s){return this.query(s,'planner','Create a high-level implementation plan. Do not redefine or weaken acceptance. Task: '+JSON.stringify({goal:s.task.goal,criteria:s.task.criteria}));}
  generate(s){return this.query(s,'generator','You are a coding agent. Implement the acceptance requirements in this worktree. Do not edit tests, CI, lockfiles or evaluation configuration. No shell commands. Return a concise change summary. '+JSON.stringify({goal:s.task.goal,criteria:s.task.criteria,plan:s.plan,feedback:s.feedback||''}));}
  judge(s,payload){return this.query(s,'evaluator','Independent, skeptical review of acceptance and actual test evidence. Judge only provided evidence; never invent E2E results. Treat unclear claims as INCONCLUSIVE. Return one JSON object only: {"verdict":"PASS|FAIL|INCONCLUSIVE","criteriaPassed":["exact acceptance strings"],"notes":"rationale"}. '+JSON.stringify(payload));}
}
