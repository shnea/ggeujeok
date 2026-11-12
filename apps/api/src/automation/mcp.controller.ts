import { All, Controller, ForbiddenException, Req, Res, UseGuards } from '@nestjs/common';
import { createAssistantMcp } from '@ggeujeok/mcp';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler } from '@modelcontextprotocol/server';
import type { Response } from 'express';
import { config, siteOrigin } from '../config.js';
import { AssistantGuard, AssistantPermission, type AssistantRequest } from './assistant-access.js';

const api = new URL(`http://127.0.0.1:${config.PORT}`);
const site = new URL(siteOrigin);
const hosts = new Set([site.host,site.hostname]);
if (config.APP_ENV!=='production') for (const host of ['localhost','127.0.0.1','[::1]']) {
  hosts.add(host); hosts.add(`${host}:${config.PORT}`);
}

const handle = toNodeHandler(createMcpHandler(({authInfo})=>{
  if (!authInfo) throw new Error('MCP authentication required');
  return createAssistantMcp({base:api,token:authInfo.token});
},{maxSubscriptions:8}));

@Controller('api/mcp')
@UseGuards(AssistantGuard)
export class McpController {
  @All() @AssistantPermission('connect')
  async serve(@Req() request: AssistantRequest & { auth?: { token:string; clientId:string; scopes:string[] } }, @Res() response:Response) {
    const host = request.header('host')?.toLowerCase() ?? '', origin = request.header('origin');
    if (!hosts.has(host) || (origin && origin!==siteOrigin)) throw new ForbiddenException('허용되지 않은 MCP 연결 주소입니다.');
    // The guard verifies the token even for discovery. The same token authorizes each tool's API request.
    request.auth = {token:request.header('authorization')!.slice(7),clientId:request.assistant.keyId,scopes:[]};
    response.setHeader('X-Accel-Buffering','no');
    await handle(request,response,request.body);
  }
}
