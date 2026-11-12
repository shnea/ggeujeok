import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

test('real stdio tools list posts, preserve patch fields, and report API rejection', async () => {
  const token = `ggm_${'a'.repeat(43)}`, postId = '00000000-0000-4000-8000-000000000001', calls = [];
  const api = createServer(async (req,res)=>{
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);
    calls.push({method:req.method,url:req.url,authorized:req.headers.authorization===`Bearer ${token}`,
      body:!buffer.length ? undefined : req.headers['content-type']==='application/octet-stream' ?
        {offset:req.headers['upload-offset'],bytes:[...buffer]} : JSON.parse(buffer.toString())});
    res.setHeader('Content-Type','application/json');
    if (req.method==='DELETE') {res.statusCode=403; res.end(JSON.stringify({detail:'보호 카테고리의 글은 삭제할 수 없습니다.'}));return;}
    res.end(JSON.stringify(req.method==='GET' ? {items:[{id:postId,title:'루미의 글',summary:'요약'}]} : {version:3}));
  });
  api.listen(0,'127.0.0.1');
  await once(api,'listening');
  const transport = new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../server.mjs',import.meta.url))],
    env:{GGEUJEOK_URL:`http://127.0.0.1:${api.address().port}`,GGEUJEOK_MCP_TOKEN:token},stderr:'pipe'});
  const client = new Client({name:'ggeujeok-test',version:'1.0.0'});
  try {
    await client.connect(transport);
    const {tools} = await client.listTools();
    for (const name of ['list_posts','create_post','update_post','list_post_review_candidates','list_unanswered_comments','reply_to_comment','delete_comment']) {
      assert.ok(tools.some(tool=>tool.name===name),name);
    }
    assert.equal(tools.find(tool=>tool.name==='delete_post').annotations.destructiveHint,true);
    const recent = await client.callTool({name:'list_posts',arguments:{}});
    assert.equal(recent.isError,undefined);
    assert.equal(JSON.parse(recent.content[0].text).items[0].summary,'요약');
    const changed = await client.callTool({name:'update_post',arguments:{postId,version:2,changes:{title:'새 제목'}}});
    assert.equal(JSON.parse(changed.content[0].text).version,3);
    const refused = await client.callTool({name:'delete_post',arguments:{postId}});
    assert.equal(refused.isError,true);
    assert.match(refused.content[0].text,/HTTP 403.*보호 카테고리/);
    const chunk = await client.callTool({name:'upload_image_chunk',arguments:{postId,uploadId:postId,offset:2,data:'AQID'}});
    assert.ok(!chunk.isError);
    assert.deepEqual(calls,[
      {method:'GET',url:'/api/automation/assistant/posts',authorized:true,body:undefined},
      {method:'PATCH',url:`/api/automation/assistant/posts/${postId}`,authorized:true,body:{version:2,changes:{title:'새 제목'}}},
      {method:'DELETE',url:`/api/automation/assistant/posts/${postId}`,authorized:true,body:undefined},
      {method:'PATCH',url:`/api/automation/assistant/posts/${postId}/uploads/${postId}`,authorized:true,body:{offset:'2',bytes:[1,2,3]}},
    ]);
  } finally {
    await client.close();
    await new Promise((resolve,reject)=>api.close(error=>error?reject(error):resolve()));
  }
});
