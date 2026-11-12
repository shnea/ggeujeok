import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createAssistantMcp } from './tools.mjs';

try {
  const base = new URL(process.env.GGEUJEOK_URL ?? 'https://shnea.kr');
  const loopback = ['localhost','127.0.0.1','[::1]'].includes(base.hostname);
  if ((base.protocol!=='https:' && !(loopback && base.protocol==='http:')) || base.pathname!=='/' ||
    base.search || base.hash || base.username || base.password) throw new Error('GGEUJEOK_URL은 HTTPS 사이트 주소여야 합니다.');
  const token = process.env.GGEUJEOK_MCP_TOKEN;
  if (!token || !/^ggm_[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('GGEUJEOK_MCP_TOKEN을 실행 환경에 설정하세요.');
  serveStdio(()=>createAssistantMcp({base,token}));
} catch(error) {
  console.error(error instanceof TypeError ? 'GGEUJEOK_URL을 확인하세요.' : error.message);
  process.exitCode = 1;
}
