import { Injectable, ServiceUnavailableException, BadGatewayException } from '@nestjs/common';
import { config } from '../config.js';

export type PlatformUpload = { uploadId: string; state: string; size: number; receivedBytes: number; maxChunkBytes: number; fileId: string | null };
export type PlatformFile = { fileId: string; size: number; sha256: string; visibility: string; retentionCode: string };

@Injectable()
export class PlatformFiles {
  private checkedUntil = 0;

  async request(path: string, init: RequestInit = {}) {
    if (!config.PLATFORM_API_KEY) throw new ServiceUnavailableException('플랫폼 파일 연결 설정이 필요합니다.');
    const base = new URL(config.PLATFORM_URL);
    if (base.protocol !== 'https:' || base.pathname !== '/' || base.search || base.hash || base.username || base.password) {
      throw new ServiceUnavailableException('플랫폼 주소 설정을 확인해 주세요.');
    }
    let response: Response;
    try {
      response = await fetch(new URL(path, base), { ...init, redirect: 'error', signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000),
        headers: { ...init.headers, 'X-Platform-Key': config.PLATFORM_API_KEY } });
    } catch { throw new BadGatewayException('파일 서버에 연결하지 못했습니다. 다시 시도하면 이어서 전송합니다.'); }
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 401 || response.status === 403) throw new ServiceUnavailableException('플랫폼 키의 파일 읽기·업로드 권한을 확인해 주세요.');
      throw new BadGatewayException(`파일 서버 요청을 처리하지 못했습니다(${response.status}). 다시 시도해 주세요.`);
    }
    return response;
  }

  async json<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const response = await this.request(path, { method,
      ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
    try { return await response.json() as T; }
    catch { throw new BadGatewayException('파일 서버 응답 형식을 확인할 수 없습니다.'); }
  }

  async checkEnvironment() {
    if (this.checkedUntil > Date.now()) return;
    const context = await this.json<{ projectId: string; environmentId: string }>('/api/v1/integration/context');
    if (!config.PLATFORM_PROJECT_ID || !config.PLATFORM_ENVIRONMENT_ID || context.projectId !== config.PLATFORM_PROJECT_ID || context.environmentId !== config.PLATFORM_ENVIRONMENT_ID) {
      throw new ServiceUnavailableException('파일 키의 프로젝트·환경이 끄적 설정과 일치하지 않습니다.');
    }
    const policies = await this.json<{ code: string; enabled: boolean; periodUnit: string }[]>('/api/v1/files/retention-policies');
    if (!policies.some(policy => policy.code === '영구' && policy.enabled && policy.periodUnit === 'FOREVER')) {
      throw new ServiceUnavailableException('플랫폼의 영구 보존 정책을 확인해 주세요.');
    }
    this.checkedUntil = Date.now() + 60000;
  }
}
