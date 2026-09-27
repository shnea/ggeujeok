// Usage: node --env-file=.env.dev scripts/provision-n8n.mjs
// The ignored manifest limits updates to resources created by this script.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomBytes, createHash } from 'node:crypto';
import { buildWorkflow } from './n8n-workflows.mjs';

const origin='https://n8n.shnea.kr', file='output/n8n/ggeujeok-resources.json';
const environment=process.env.APP_ENV;
if(!['development','production'].includes(environment) || !process.env.N8N_MANAGEMENT_API_KEY)throw Error('Management key and APP_ENV required');
const siteUrl=new URL(process.env.SITE_URL).origin;
await mkdir('output/n8n',{recursive:true});
let manifest;
try{manifest=JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;manifest={origin,environment,siteUrl,credentials:{},workflows:{}};}
if(manifest.origin!==origin||manifest.environment!==environment||manifest.siteUrl!==siteUrl)throw Error('Manifest environment mismatch');
const persist=()=>writeFile(file,JSON.stringify(manifest,null,2),{mode:0o600});
async function request(path,method='GET',data){
  const response=await fetch(`${origin}/api/v1${path}`,{method,redirect:'error',signal:AbortSignal.timeout(20000),
    headers:{'X-N8N-API-KEY':process.env.N8N_MANAGEMENT_API_KEY,'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});
  if(!response.ok)throw Error(`n8n ${method} ${path}: ${response.status}`);
  return await response.json();
}
const existing=await request('/workflows?limit=250');
if(existing.nextCursor)throw Error('Paginated baseline needs explicit handling');
const owned=new Set(Object.values(manifest.workflows));
const hash=w=>createHash('sha256').update(JSON.stringify({nodes:w.nodes,connections:w.connections,settings:w.settings,active:w.active})).digest('hex');
const baseline=existing.data.filter(w=>!owned.has(w.id)).map(w=>({id:w.id,hash:hash(w)}));
await writeFile('output/n8n/preserved-workflows.json',JSON.stringify(baseline),{mode:0o600});
let envText=await readFile('.env.dev','utf8');
for(const name of ['N8N_WEBHOOK_TOKEN','AI_CALLBACK_TOKEN']){
  if(!process.env[name]){
    if(Object.keys(manifest.credentials).length)throw Error('Credential exists but local token missing');
    const value=randomBytes(32).toString('base64url');process.env[name]=value;
    const line=new RegExp(`^${name}=.*$`,'m');
    envText=line.test(envText)?envText.replace(line,`${name}=${value}`):`${envText.trimEnd()}\n${name}=${value}\n`;
  }
}
if(!process.env.N8N_WEBHOOK_BASE_URL)envText=`${envText.trimEnd()}\nN8N_WEBHOOK_BASE_URL=${origin}/webhook\n`;
await writeFile('.env.dev',envText,{mode:0o600});
for(const [key,name,value] of [['webhook','X-Ggeujeok-Key',process.env.N8N_WEBHOOK_TOKEN],['callback','Authorization',`Bearer ${process.env.AI_CALLBACK_TOKEN}`]]){
  if(!manifest.credentials[key]){
    const credential=await request('/credentials','POST',{name:`끄적 ${environment} ${key}`,type:'httpHeaderAuth',data:{name,value}});
    manifest.credentials[key]={id:credential.id,name:credential.name};await persist();
  }
}
const credentials=await request('/credentials?limit=250');
const models=credentials.data.filter(c=>c.type==='openRouterApi');
if(models.length!==1)throw Error('Select one OpenRouter credential explicitly');
for(const kind of ['summary','tags','comment','article']){
  const workflow=buildWorkflow(kind,{siteUrl,environment,webhookCredential:manifest.credentials.webhook,callbackCredential:manifest.credentials.callback,modelCredential:{id:models[0].id,name:models[0].name}});
  let id=manifest.workflows[kind];
  if(!id){const created=await request('/workflows','POST',workflow);id=created.id;manifest.workflows[kind]=id;await persist();}
  else {
    // Our workflow only; do not change the user's model selection on later code updates.
    const current=await request(`/workflows/${id}`);
    const model=current.nodes.find(node=>node.name==='OpenRouter free');
    if(model)workflow.nodes.find(node=>node.name==='OpenRouter free').parameters.model=model.parameters.model;
    await request(`/workflows/${id}`,'PUT',workflow);
  }
  await request(`/workflows/${id}/activate`,'POST',{});
  console.log(`${kind}: created/updated and activated (${id})`);
}
const after=await request('/workflows?limit=250');
for(const before of baseline){const current=after.data.find(w=>w.id===before.id);if(!current||hash(current)!==before.hash)throw Error('Unrelated workflow changed; inspect before proceeding');}
console.log(`Preserved ${baseline.length} unrelated workflows. Secrets remain local.`);
