import {spawn} from 'node:child_process';
export async function runCommand(exe,args,{cwd,timeoutMs=120000,maxBytes=100000,env}={}){
  return await new Promise(resolve=>{
    const started=Date.now();let stdout='',stderr='',truncated=false,timedOut=false,error='';
    const p=spawn(exe,args,{cwd,shell:false,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe'],env:env??process.env});
    const read=(which,chunk)=>{
      const room=Math.max(0,maxBytes-Buffer.byteLength(stdout)-Buffer.byteLength(stderr));
      if(chunk.length>room)truncated=true;
      const part=chunk.subarray(0,room).toString('utf8');
      if(which==='stdout')stdout+=part;else stderr+=part;
    };
    p.stdout.on('data',c=>read('stdout',c));p.stderr.on('data',c=>read('stderr',c));
    const stop=signal=>{try{if(process.platform!=='win32'&&p.pid)process.kill(-p.pid,signal);else p.kill(signal);}catch{}};
    const timer=setTimeout(()=>{timedOut=true;stop('SIGTERM');setTimeout(()=>stop('SIGKILL'),1000).unref();},timeoutMs);
    p.once('error',e=>{error=e.message;});
    p.once('close',(code,signal)=>{clearTimeout(timer);resolve({code,signal,stdout,stderr,truncated,timedOut,error,durationMs:Date.now()-started});});
  });
}
export function checkResult(r,name){
  if(r.code!==0||r.truncated||r.timedOut||r.error)throw Error(name+': '+(r.error||r.stderr||r.stdout||r.signal||'failed').slice(0,1000));
  return r.stdout.trim();
}
