import path from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';

function parseText(session){
  if(typeof session.getLastAssistantText==='function')return session.getLastAssistantText()||'';
  const last=[...(session.messages||[])].reverse().find(x=>x.role==='assistant');
  if(!last||last.stopReason==='error'||last.errorMessage)throw Error(last?.errorMessage||'missing Pi assistant result');
  return (last.content||[]).filter(x=>x.type==='text').map(x=>x.text).join('\n');
}
export class PiAgent{
  constructor(cfg){this.cfg=cfg;}
  async prompt(s,role,prompt){
    const {createAgentSession,SessionManager,ModelRuntime}=await import('@earendil-works/pi-coding-agent');
    const agentDir=path.join(this.cfg.dataDir,'pi-config');await mkdir(agentDir,{recursive:true});
    const modelsPath=path.join(agentDir,'models.json');
    await writeFile(modelsPath,JSON.stringify({providers:{'deepseek-harness':{
      baseUrl:this.cfg.baseUrl||'https://api.deepseek.com',api:'openai-completions',apiKey:'DEEPSEEK_API_KEY',authHeader:true,
      models:[{id:this.cfg.modelId||'deepseek-flash',name:'DeepSeek Flash',reasoning:true,input:['text'],contextWindow:1000000,maxTokens:16384,
      compat:{supportsDeveloperRole:false,maxTokensField:'max_tokens',thinkingFormat:'deepseek',requiresReasoningContentOnAssistantMessages:true,supportsStrictMode:false}}]
    }}}));
    const runtime=await ModelRuntime.create({modelsPath,authPath:path.join(agentDir,'auth.json'),allowModelNetwork:false});
    await runtime.setRuntimeApiKey('deepseek-harness',this.cfg.apiKey);
    const model=runtime.getModel('deepseek-harness',this.cfg.modelId||'deepseek-flash');if(!model)throw Error('model registration failed');
    const folder=path.join(this.cfg.dataDir,'runs',s.id,'sessions',role);await mkdir(folder,{recursive:true});
    const manager=role==='generator'?SessionManager.continueRecent(s.workspace,folder):SessionManager.create(s.workspace,folder);
    const {session}=await createAgentSession({cwd:s.workspace,agentDir,modelRuntime:runtime,model,
      tools:role==='generator'?['read','grep','find','ls','edit','write']:['read','grep','find','ls'],
      thinkingLevel:this.cfg.thinkingLevel||'off',sessionManager:manager});
    let timer;
    try{
      await Promise.race([session.prompt(prompt),new Promise((_,reject)=>{timer=setTimeout(()=>{session.abort().catch(()=>{});reject(Error('Pi timeout'));},this.cfg.agentTimeoutMs||240000);})]);
      return parseText(session);
    }finally{clearTimeout(timer);session.dispose();}
  }
  async plan(s){return this.prompt(s,'planner','You are a product planner. Goal: '+s.task.goal+'. Immutable acceptance: '+JSON.stringify(s.task.criteria)+'. Inspect read-only and draft high-level feature plan. Never weaken acceptance.');}
  async generate(s){return this.prompt(s,'generator','You are coding generator. GOAL: '+s.task.goal+'. PLAN: '+s.plan+'. ACCEPTANCE: '+JSON.stringify(s.task.criteria)+'. Previous QA: '+(s.feedback||'none')+'. Modify implementation only, never tests, evaluation rules or CI. No shell; independent runner tests code. Make concrete changes.');}
  async judge(s,payload){return this.prompt(s,'evaluator','You are a skeptical independent evaluator. Read code and inspect evidence for stubs and broken integrations. '+JSON.stringify(payload)+'. Do not edit files or invent results. Return ONLY JSON {"verdict":"PASS|FAIL|INCONCLUSIVE","criteriaPassed":["exact acceptance criterion"],"notes":"reason"}.');}
}
