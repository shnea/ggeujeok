import { Body, Controller, Delete, Get, Inject, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { AdminGuard, type AuthRequest } from '../http.js';
import { Posts } from './posts.service.js';
import { slug, uuid } from './post-input.js';

@Controller('api/public')
export class PostsController {
  constructor(@Inject(Posts) private readonly posts: Posts) {}
  @Get('posts') list(@Query() query: unknown) { return this.posts.list(query); }
  @Get('posts/:slug') detail(@Param('slug') value: string) { return this.posts.publicPost(slug.parse(value)); }
  @Get('posts/:slug/related') related(@Param('slug') value: string) { return this.posts.related(slug.parse(value)); }
  @Get('posts/:slug/neighbors') neighbors(@Param('slug') value: string) { return this.posts.neighbors(slug.parse(value)); }
  @Get('feed') feed() { return this.posts.feed(); }
  @Get('sitemap') sitemap() { return this.posts.sitemap(); }
  @Get('categories') categories() { return this.posts.categories(); }
}

@Controller('api/admin/tags')
@UseGuards(AdminGuard)
export class AdminTagsController {
  constructor(@Inject(Posts) private readonly posts: Posts) {}
  @Get() search(@Query() query: unknown) { return this.posts.tags(query); }
}

@Controller('api/admin/posts')
@UseGuards(AdminGuard)
export class AdminPostsController {
  constructor(@Inject(Posts) private readonly posts: Posts) {}
  @Get() list() { return this.posts.adminList(); }
  @Post() create(@Req() request: AuthRequest) { return this.posts.create(request.session!.userId!); }
  @Get(':id') edit(@Param('id') id: string) { return this.posts.edit(uuid.parse(id)); }
  @Put(':id/draft') save(@Param('id') id: string, @Body() input: unknown) { return this.posts.save(uuid.parse(id), input); }
  @Post(':id/publish') publish(@Param('id') id: string, @Body() input: unknown, @Req() request: AuthRequest) {
    return this.posts.publish(uuid.parse(id), input, request.session!.userId!);
  }
  @Delete(':id') remove(@Param('id') id: string, @Req() request: AuthRequest) { return this.posts.remove(uuid.parse(id), request.session!.userId!); }
}
