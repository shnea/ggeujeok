import type { McpServer } from '@modelcontextprotocol/server';

export function createAssistantMcp(settings: {base:URL;token:string}): McpServer;
