// Generate only this blog's four workflows. Credentials are referenced by ID, never embedded.
import { randomUUID } from 'node:crypto';

export function buildWorkflow(kind, { siteUrl, environment, webhookCredential, callbackCredential, modelCredential }) {
  const names = {summary:'요약',tags:'태그',comment:'자동 답글',article:'실험실 글 초안'};
  const nodes = [], connections = {};
  function node(name,type,typeVersion,parameters,position,extra={}) {
    nodes.push({id:randomUUID(),name,type,typeVersion,parameters,position,...extra});
  }
  function connect(from,to,type='main',index=0) {
    connections[from] ??= {}; connections[from][type] ??= [];
    connections[from][type][index] ??= []; connections[from][type][index].push({node:to,type,index:0});
  }
  const webhookBody = "$('Request').first().json.body";
  node('Request','n8n-nodes-base.webhook',2.1,{httpMethod:'POST',path:`ggeujeok-${environment}-${kind}`,authentication:'headerAuth',responseMode:'responseNode',options:{}},[0,0],{webhookId:randomUUID(),credentials:{httpHeaderAuth:webhookCredential}});
  const http = (method,suffix,jsonBody)=>({method,url:`=${siteUrl}/api/automation/ai/tasks/{{ ${webhookBody}.requestId }}/${suffix}`,
    authentication:'genericCredentialType',genericAuthType:'httpHeaderAuth',sendBody:true,specifyBody:'json',jsonBody,
    options:{timeout:10000,redirect:{redirect:{followRedirects:false}}}});
  node('Claim','n8n-nodes-base.httpRequest',4.2,http('POST','claim',`={{ { hash: ${webhookBody}.hash } }}`),[240,0],{credentials:{httpHeaderAuth:callbackCredential}});
  node('Already completed','n8n-nodes-base.if',2.2,{conditions:{options:{caseSensitive:true,leftValue:'',typeValidation:'strict',version:2},conditions:[{id:randomUUID(),leftValue:'={{ $json.cached }}',rightValue:true,operator:{type:'boolean',operation:'true',singleValue:true}}],combinator:'and'},options:{}},[460,0]);
  connect('Request','Claim');connect('Claim','Already completed');
  node('Cached response','n8n-nodes-base.respondToWebhook',1.4,{respondWith:'json',responseBody:'={{ $json.result }}',options:{}},[700,-180]);
  connect('Already completed','Cached response','main',0);
  if(kind==='article') {
    node('Recent sources','n8n-nodes-base.rssFeedRead',1.2,{url:`={{ 'https://news.google.com/rss/search?hl=ko&gl=KR&ceid=KR:ko&q=' + encodeURIComponent(${webhookBody}.context.topic + ' when:7d') }}`,options:{}},[680,100]);
    node('Context','n8n-nodes-base.code',2,{jsCode:`const sources = $input.all().slice(0,8).map(({json:s})=>({title:s.title,url:s.link,date:s.isoDate||s.pubDate,excerpt:String(s.contentSnippet||'').slice(0,500)})).filter(s=>typeof s.url==='string' && s.url.startsWith('https://'));\nif(!sources.length)throw new Error('NO_SOURCES');\nreturn [{json:{context:{...${webhookBody}.context,sources},sources}}];`},[900,100]);
    connect('Already completed','Recent sources','main',1);connect('Recent sources','Context');
  } else {
    node('Context','n8n-nodes-base.code',2,{jsCode:`return [{json:{context:${webhookBody}.context}}];`},[700,100]);
    connect('Already completed','Context','main',1);
  }
  const object=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
  const schemas={summary:object({summary:{type:'string',minLength:1,maxLength:500}}),tags:object({tags:{type:'array',items:{type:'string',minLength:1,maxLength:30},minItems:1,maxItems:8}}),
    comment:object({comment:{type:['string','null'],maxLength:800}}),article:{anyOf:[object({skip:{const:true,type:'boolean'}}),object({title:{type:'string',minLength:1,maxLength:200},paragraphs:{type:'array',items:{type:'string',maxLength:3000},minItems:3,maxItems:20},sources:{type:'array',minItems:1,maxItems:10,items:object({title:{type:'string'},url:{type:'string'}})}})]}};
  const instructions={
    summary:'현재 작업은 게시글 요약이다. 댓글이나 대화를 작성하는 작업이 아니다. 제공된 본문의 핵심 내용을 독자가 바로 파악하도록 2~4문장으로 압축해 summary 필드에 넣는다. 캐릭터의 반말과 시선은 유지하되 감탄, 자기 감상, 호기심 표현, 독자에게 묻는 질문은 넣지 않는다. 본문에 없는 사실은 넣지 않는다. 500자 이내. 올바른 예: 이 글은 도커 배포 설정을 다뤄. 환경별 파일을 나누는 방법과 주의할 점을 설명해.',
    tags:'현재 작업은 본문 주제를 나타내는 태그만 tags 배열로 고르는 것이다. 한국어를 기본으로 하되 제품명과 기술 고유명사는 원래 표기를 유지한다. 댓글, 감상, 요약 문장을 쓰지 않는다. 태그 1~8개, 각 30자 이내.',
    comment:'현재 작업은 target 댓글에 대한 답글이다. directMention이면 인사에도 자연스럽게 답한다. 캐릭터의 성격과 말투를 적용한다. 일상적인 댓글은 보통 1~3문장으로 짧게 답하고 필요한 경우만 더 설명한다. 감정에 맞는 이모지 사용은 말투 설정을 따른다. 실제 memory와 thread에 없는 이전 대화나 자신의 경험을 만들지 않는다. 예를 들어 나도 파일을 날려봤다는 식의 허구 경험으로 공감하지 않는다. 제공된 사실로만 반응한다. 이름을 매번 부르거나 상담하듯 칭찬과 질문을 늘어놓지 않는다. recentResponses는 표현 반복 방지용이다. 결과는 comment 필드에 넣는다.',
    article:'현재 작업은 제공된 sources를 근거로 블로그 글 초안을 작성하는 것이다. 댓글을 쓰거나 독자에게 작업을 되묻지 않는다. title, paragraphs, sources를 채운다. 자료가 부족하면 skip:true로 끝낸다. 제공된 sources의 URL만 인용한다.',
  };
  node('AI Agent','@n8n/n8n-nodes-langchain.agent',3.1,{promptType:'define',text:`={{ '참고 자료 JSON:\\n' + JSON.stringify($json.context) + '\\n\\n현재 작업 지시: ' + ${JSON.stringify(instructions[kind])} }}`,hasOutputParser:kind==='article'||kind==='tags',options:{systemMessage:`={{ ${webhookBody}.system }}`,maxIterations:3}},[1120,100]);
  node('OpenRouter free','@n8n/n8n-nodes-langchain.lmChatOpenRouter',1,{model:'openrouter/free',options:{temperature:kind==='summary'||kind==='tags'?0.2:0.6,responseFormat:'json_object',maxTokens:kind==='article'?8000:4096,timeout:65000,maxRetries:0}},[1020,340],{credentials:{openRouterApi:modelCredential}});
  if(kind==='article'||kind==='tags')node('Result schema','@n8n/n8n-nodes-langchain.outputParserStructured',1.3,{schemaType:'manual',inputSchema:JSON.stringify(schemas[kind]),autoFix:false},[1460,340]);
  node('Text length','@n8n/n8n-nodes-langchain.toolCode',1.3,{name:'text_length',description:'Count characters in a draft. Input is plain text. Read-only; no external effects.',jsCode:'return String(query.length);'},[1240,340]);
  connect('Context','AI Agent');connect('OpenRouter free','AI Agent','ai_languageModel');connect('Text length','AI Agent','ai_tool');
  if(kind==='article'||kind==='tags')connect('Result schema','AI Agent','ai_outputParser');
  node('Validate result','n8n-nodes-base.code',2,{jsCode:`const text=$json.output;\nif(JSON.stringify(text??null).length>30000)throw new Error('INVALID_OUTPUT');\nconst result=typeof text==='string'?JSON.parse(text.replace(/^\x60\x60\x60(?:json)?\\s*/,'').replace(/\\s*\x60\x60\x60$/,'')):text;\nif(!result||typeof result!=='object'||Array.isArray(result))throw new Error('INVALID_OUTPUT');\n${kind==='article'?"if(!result.skip){const allowed=new Set($('Context').first().json.sources.map(s=>s.url));if(!Array.isArray(result.sources)||!result.sources.length||result.sources.some(s=>!allowed.has(s.url)))throw new Error('UNKNOWN_SOURCE');}":''}\nreturn [{json:{result}}];`},[1400,100]);
  node('Save result','n8n-nodes-base.httpRequest',4.2,http('PUT','result',`={{ { hash:${webhookBody}.hash, result:$json.result } }}`),[1620,100],{credentials:{httpHeaderAuth:callbackCredential}});
  node('Response','n8n-nodes-base.respondToWebhook',1.4,{respondWith:'json',responseBody:'={{ $json }}',options:{}},[1840,100]);
  connect('AI Agent','Validate result');connect('Validate result','Save result');connect('Save result','Response');
  node('Record failure','n8n-nodes-base.httpRequest',4.2,http('POST','failure',`={{ {hash:${webhookBody}.hash} }}`),[1400,520],{credentials:{httpHeaderAuth:callbackCredential}});
  node('Failure details','n8n-nodes-base.set',3.4,{assignments:{assignments:[{id:randomUUID(),name:'diagnostic',type:'string',value:"={{ String($json.error?.message || $json.error || $json.message || 'Unknown generation error').replace(/(?:Bearer\\s+[^\\s]+|sk-[A-Za-z0-9_-]+)/g,'[redacted]').slice(0,400) }}"}]},options:{}},[1160,520]);
  node('Failed response','n8n-nodes-base.respondToWebhook',1.4,{respondWith:'json',responseBody:"={{ { error:'GENERATION_FAILED', diagnostic:$('Failure details').first().json.diagnostic } }}",options:{responseCode:502}},[1620,520]);
  connect('Failure details','Record failure');
  connect('Record failure','Failed response');
  for(const name of ['AI Agent','Validate result','Context',...(kind==='article'?['Recent sources']:[])]){
    nodes.find(node=>node.name===name).onError='continueErrorOutput';connect(name,'Failure details','main',1);
  }
  return {name:`[끄적 ${environment}] ${names[kind]}`,nodes,connections,settings:{executionOrder:'v1',executionTimeout:90,
    saveDataErrorExecution:'none',saveDataSuccessExecution:'none',saveManualExecutions:false,saveExecutionProgress:false}};
}
