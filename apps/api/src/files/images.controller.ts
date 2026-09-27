import { Body, Controller, Get, Headers, Inject, Param, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { Sessions } from '../auth/sessions.js';
import { AdminGuard, type AuthRequest } from '../http.js';
import { Images } from './images.service.js';
import { Posts } from '../posts/posts.service.js';
import { slug } from '../posts/post-input.js';
import type { Session } from '../auth/sessions.js';

@Controller('api/admin')
@UseGuards(AdminGuard)
export class AdminImagesController {
  constructor(@Inject(Images) private readonly images: Images) {}

  @Post('posts/:id/uploads') start(@Param('id') id: string, @Body() input: unknown, @Req() request: AuthRequest) {
    return this.images.start(z.uuid().parse(id), request.session!.userId!, input);
  }
  @Patch('uploads/:id') chunk(@Param('id') id: string, @Headers('upload-offset') offset: string, @Body() input: Buffer, @Req() request: AuthRequest) {
    const position = z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(0).max(20 * 1024 * 1024)).parse(offset);
    return this.images.chunk(z.uuid().parse(id), request.session!.userId!, position, input);
  }
  @Post('uploads/:id/complete') complete(@Param('id') id: string, @Req() request: AuthRequest) {
    return this.images.complete(z.uuid().parse(id), request.session!.userId!);
  }
}

@Controller('api')
export class ImagesController {
  constructor(@Inject(Images) private readonly images: Images, @Inject(Sessions) private readonly sessions: Sessions,
    @Inject(Posts) private readonly posts: Posts) {}

  @Get('files/:id/views') async views(@Param('id') id: string, @Req() request: AuthRequest) {
    return this.images.resolve(z.uuid().parse(id), await this.sessions.read(request));
  }
  @Get(['files/:id/content', 'files/:id/content/:variant']) async content(@Param('id') id: string, @Param('variant') variant: string | undefined,
    @Query('download') download: string | undefined,
    @Req() request: AuthRequest, @Res() response: Response) {
    return this.stream(z.uuid().parse(id), await this.sessions.read(request), variant ?? (download === '1' ? 'download' : 'original'), response);
  }

  @Get('public/posts/:slug/image') async cover(@Param('slug') value: string, @Res() response: Response) {
    // A stable crawler URL, with no expiring ticket in HTML and no admin bypass.
    return this.stream(await this.posts.publicImage(slug.parse(value)), null, 'preview', response);
  }

  private async stream(id: string, session: Session | null, type: string, response: Response) {
    const abort = new AbortController();
    const close = () => abort.abort();
    response.once('close', close);
    try {
      const result = await this.images.content(id, session, abort.signal, type);
      response.setHeader('Content-Type', result.mediaType);
      response.setHeader('Content-Disposition', `${type === 'download' ? 'attachment' : 'inline'}; filename="image"; filename*=UTF-8''${encodeURIComponent(result.file.original_name).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16)}`)}`);
      if (!result.response.body) throw new Error('Empty image response');
      await pipeline(Readable.fromWeb(result.response.body as import('node:stream/web').ReadableStream), response);
    } catch (error) {
      if (response.headersSent || response.destroyed) response.destroy();
      else throw error;
    } finally { response.off('close', close); abort.abort(); }
  }
}
