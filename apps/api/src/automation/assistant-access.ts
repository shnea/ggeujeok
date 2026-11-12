import { Body, Controller, Delete, ForbiddenException, Get, Inject, Injectable, NotFoundException, Param, Post, Req, SetMetadata, UnauthorizedException, UseGuards, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { identity, type Assistant } from '../ai/assistant.js';
import { newSecret } from '../auth/sessions.js';
import { config } from '../config.js';
import { Database } from '../database/database.js';
import { AdminGuard, type AuthRequest } from '../http.js';
import { audit, type AssistantActor } from '../operations/audit.js';

const permissionKey = Symbol('assistantPermission');
type Permission = 'write' | 'publish' | 'delete';
export const AssistantPermission = (permission: Permission) => SetMetadata(permissionKey, permission);
export type AssistantRequest = AuthRequest & { assistant: AssistantActor; assistantPermissions: Record<Permission,boolean> };
const hash = (token: string) => createHash('sha256').update(token).digest('hex');

@Injectable()
export class AssistantGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector, @Inject(Database) private readonly db: Database) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AssistantRequest>();
    const token = /^Bearer (ggm_[A-Za-z0-9_-]{43})$/i.exec(request.header('authorization') ?? '')?.[1];
    if (!token || !config.ADMIN_OIDC_ISSUER || !config.ADMIN_OIDC_SUBJECT) throw new UnauthorizedException('AI 도우미 전용 키가 필요합니다.');
    const { rows: [key] } = await this.db.query(`SELECT k.id,k.issuer_id,k.can_write,k.can_publish,k.can_delete,s.data FROM assistant_keys k
      JOIN users u ON u.id=k.issuer_id LEFT JOIN ai_settings s ON s.singleton
      WHERE k.token_hash=$1 AND k.expires_at>now() AND u.issuer=$2 AND u.subject=$3`,
    [hash(token),config.ADMIN_OIDC_ISSUER,config.ADMIN_OIDC_SUBJECT]);
    if (!key) throw new UnauthorizedException('AI 도우미 키가 만료되었거나 유효하지 않습니다.');
    const permissions = { write:Boolean(key.can_write),publish:Boolean(key.can_publish),delete:Boolean(key.can_delete) };
    const permission = this.reflector.get<Permission | undefined>(permissionKey,context.getHandler()) ??
      (['GET','HEAD'].includes(request.method) ? undefined : 'write');
    if (permission && !permissions[permission]) throw new ForbiddenException('이 AI 도우미 키에는 해당 작업 권한이 없습니다.');
    const profile = key.data as Assistant | null;
    request.assistant = { issuerId:key.issuer_id,keyId:key.id,
      identity:{ ...(profile?.name ? identity(profile) : {name:'루미',imageUrl:null}),source:'mcp' } };
    request.assistantPermissions = permissions;
    return true;
  }
}

const keyInput = z.strictObject({ name:z.string().trim().min(1).max(60), canWrite:z.boolean().default(true), canPublish:z.boolean().default(false),
  canDelete:z.boolean().default(false) });
const keyColumns = 'id,name,can_write AS "canWrite",can_publish AS "canPublish",can_delete AS "canDelete",expires_at AS "expiresAt"';

@Controller('api/admin/settings/assistant-keys')
@UseGuards(AdminGuard)
export class AssistantKeysController {
  constructor(@Inject(Database) private readonly db: Database) {}

  @Get() async list(@Req() request: AuthRequest) {
    return (await this.db.query(`SELECT ${keyColumns} FROM assistant_keys WHERE issuer_id=$1 AND expires_at>now() ORDER BY expires_at DESC`,
      [request.session!.userId])).rows;
  }

  @Post() async issue(@Req() request: AuthRequest, @Body() raw: unknown) {
    const {name,canWrite,canPublish,canDelete} = keyInput.parse(raw);
    const actor = request.session!.userId!, token = `ggm_${newSecret()}`;
    return this.db.transaction(async tx => {
      await tx.query('DELETE FROM assistant_keys WHERE issuer_id=$1 AND expires_at<=now()', [actor]);
      const { rows:[key] } = await tx.query(`INSERT INTO assistant_keys(issuer_id,name,token_hash,can_write,can_publish,can_delete,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,now()+interval '90 days') RETURNING ${keyColumns}`, [actor,name,hash(token),canWrite,canPublish,canDelete]);
      await audit(tx,actor,'assistant.key.issue',key.id);
      return {key,token};
    });
  }

  @Delete(':id') async revoke(@Req() request: AuthRequest,@Param('id') raw: string) {
    const id = z.uuid().parse(raw), actor = request.session!.userId!;
    return this.db.transaction(async tx => {
      const removed = await tx.query('DELETE FROM assistant_keys WHERE id=$1 AND issuer_id=$2',[id,actor]);
      if (!removed.rowCount) throw new NotFoundException('키를 찾을 수 없습니다.');
      await audit(tx,actor,'assistant.key.revoke',id);
      return {revoked:true};
    });
  }
}
