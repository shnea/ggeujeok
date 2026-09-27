import { config } from '../config.js';

type Job = { id:string; requestId:string; payload:{taskId:string}; state:string };
export class PlatformJobs {
  private checkedUntil=0;
  async checkEnvironment() {
    if(this.checkedUntil>Date.now())return;
    const response=await fetch(new URL('/api/v1/integration/context',config.PLATFORM_URL),{
      redirect:'error',signal:AbortSignal.timeout(5000),headers:{'X-Platform-Key':config.PLATFORM_API_KEY}});
    if(!response.ok)throw Error('JOB_CONTEXT_UNAVAILABLE');
    const context=await response.json() as {projectId:string;environmentId:string};
    if(context.projectId!==config.PLATFORM_PROJECT_ID || context.environmentId!==config.PLATFORM_ENVIRONMENT_ID)throw Error('JOB_ENVIRONMENT_MISMATCH');
    this.checkedUntil=Date.now()+60000;
  }
  async request(path:string, body:unknown, lease?:string) {
    const base = new URL(config.PLATFORM_URL);
    if (base.protocol!=='https:' || base.username || base.password) throw Error('JOB_CONFIGURATION');
    const response=await fetch(new URL(`/api/v1/jobs${path}`,base),{
      method:'POST',redirect:'error',signal:AbortSignal.timeout(5000),
      headers:{'Content-Type':'application/json','X-Platform-Key':path ? config.PLATFORM_WORKER_API_KEY || config.PLATFORM_API_KEY : config.PLATFORM_API_KEY,
        ...(lease?{'X-Job-Lease':lease}:{})},body:JSON.stringify(body),
    });
    if(!response.ok){await response.body?.cancel();throw Error(`JOB_${response.status}`);}
    return response.status===204?null:await response.json() as any;
  }
  async enqueue(taskId:string, requestId:string,priority=false) {
    return await this.request('',{requestId,queue:`ggeujeok-ai${priority?'-mentions':''}-${config.APP_ENV}`,payload:{taskId},maxAttempts:3}) as Job;
  }
  async claim(workerId:string,priority=false) {
    return await this.request('/claim',{queue:`ggeujeok-ai${priority?'-mentions':''}-${config.APP_ENV}`,workerId}) as {job:Job;leaseToken:string}|null;
  }
  heartbeat(id:string,lease:string){return this.request(`/${id}/heartbeat`,{progress:10},lease);}
  complete(id:string,lease:string){return this.request(`/${id}/complete`,{result:{handled:true}},lease);}
  fail(id:string,lease:string,retryable:boolean){return this.request(`/${id}/fail`,{errorCode:'AI_EXECUTION_FAILED',retryable},lease);}
}
