import path from 'node:path';
import {mkdir,readFile,writeFile,rename,open,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
export class StateStore{
  constructor(dir){this.dir=path.resolve(dir);}
  statePath(id){if(!/^run-[0-9a-f]{16}$/.test(id))throw Error('invalid run ID');return path.join(this.dir,'runs',id,'state.json');}
  async load(id){return JSON.parse(await readFile(this.statePath(id),'utf8'));}
  async save(s){
    const file=this.statePath(s.id);await mkdir(path.dirname(file),{recursive:true});
    const tmp=file+'.'+randomUUID()+'.tmp';
    await writeFile(tmp,JSON.stringify(s,null,2)+'\n',{mode:0o600});
    await rename(tmp,file);
  }
  async lock(id){
    const dir=path.dirname(this.statePath(id));await mkdir(dir,{recursive:true});
    const file=path.join(dir,'lock');let handle;
    try{handle=await open(file,'wx',0o600);}
    catch(error){
      if(error.code!=='EEXIST')throw error;
      const recovery=path.join(dir,'lock.recovery');
      const gate=await open(recovery,'wx',0o600);
      try{
        const owner=JSON.parse(await readFile(file,'utf8'));
        if(!Number.isInteger(owner.pid)||owner.pid<=0)throw Error('invalid run lock owner');
        try{process.kill(owner.pid,0);throw Error('run already locked by pid '+owner.pid);}
        catch(checkError){if(checkError.code!=='ESRCH')throw checkError;}
        await rm(file);
        handle=await open(file,'wx',0o600);
      }finally{await gate.close();await rm(recovery,{force:true});}
    }
    await handle.writeFile(JSON.stringify({pid:process.pid,at:new Date().toISOString()}));
    return async()=>{await handle.close();await rm(file,{force:true});};
  }
}
