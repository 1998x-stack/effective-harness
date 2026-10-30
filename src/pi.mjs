import path from 'node:path';
import {mkdir} from 'node:fs/promises';

export class PiAgent{
  constructor({dataDir,provider='iagent',modelId='iagent/standard',modelsPath,apiKey='',thinkingLevel='high',timeoutMs=1800000}){
    if(!modelsPath)throw Error('Pi models path required');
    Object.assign(this,{dataDir,provider,modelId,modelsPath,apiKey,thinkingLevel,timeoutMs});
  }
  async query(s,role,prompt){
    const {createAgentSession,ModelRuntime,SessionManager}=await import('@earendil-works/pi-coding-agent');
    const agentDir=path.join(this.dataDir,'pi-config');
    await mkdir(agentDir,{recursive:true});
    const runtime=await ModelRuntime.create({modelsPath:this.modelsPath,authPath:path.join(agentDir,'auth.json'),allowModelNetwork:false});
    if(this.apiKey)await runtime.setRuntimeApiKey(this.provider,this.apiKey);
    const model=runtime.getModel(this.provider,this.modelId);
    if(!model)throw Error('Pi model unavailable: '+this.provider+'/'+this.modelId);
    const sessionDir=path.join(this.dataDir,'runs',s.id,'sessions','generator');
    if(role==='generator')await mkdir(sessionDir,{recursive:true});
    const sessionManager=role==='generator'?SessionManager.continueRecent(s.workspace,sessionDir):SessionManager.inMemory();
    const options={cwd:s.workspace,agentDir,modelRuntime:runtime,model,thinkingLevel:this.thinkingLevel,sessionManager,
      ...(role==='generator'?{tools:['read','grep','find','ls','edit','write']}:{noTools:'all'})};
    const {session}=await createAgentSession(options);
    let timedOut=false;
    const stop=setTimeout(()=>{timedOut=true;session.abort().catch(()=>{});},this.timeoutMs);
    try{
      await session.prompt(prompt);
      if(timedOut)throw Error('Pi session timed out');
      const latest=[...session.messages].reverse().find(m=>m.role==='assistant');
      if(!latest||latest.stopReason==='error'||latest.errorMessage)throw Error(latest?.errorMessage||'Pi model returned an error');
      const result=session.getLastAssistantText();
      if(!result||!result.trim())throw Error('empty Pi response');
      return result;
    }finally{clearTimeout(stop);session.dispose();}
  }
  plan(s){return this.query(s,'planner','Create a high-level implementation plan. Do not redefine or weaken acceptance. Task: '+JSON.stringify({goal:s.task.goal,criteria:s.task.criteria}));}
  generate(s){return this.query(s,'generator','You are a coding agent. Implement the acceptance requirements in this worktree. Do not edit tests, CI, lockfiles or evaluation configuration. No shell commands. Return a concise change summary. '+JSON.stringify({goal:s.task.goal,criteria:s.task.criteria,plan:s.plan,feedback:s.feedback||''}));}
  judge(s,payload){return this.query(s,'evaluator','Independent, skeptical review of acceptance and actual test evidence. Match each acceptance criterion against the protected test source and its passing command result. Judge only provided evidence; never invent E2E results. Treat unclear claims as INCONCLUSIVE. Return one JSON object only: {"verdict":"PASS|FAIL|INCONCLUSIVE","criteriaPassed":["exact acceptance strings"],"notes":"rationale"}. '+JSON.stringify(payload));}
}
