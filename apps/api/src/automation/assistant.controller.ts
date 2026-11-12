import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { Activity } from '../activity/activity.service.js';
import { publishInput, uuid } from '../posts/post-input.js';
import { Posts } from '../posts/posts.service.js';
import { Categories } from '../posts/categories.service.js';
import { isProtectedCategory } from '../posts/protected-categories.js';
import { AssistantGuard, AssistantPermission, type AssistantRequest } from './assistant-access.js';

@Controller('api/automation/assistant')
@UseGuards(AssistantGuard)
export class AssistantController {
  constructor(@Inject(Posts) private readonly posts: Posts, @Inject(Activity) private readonly activity: Activity,
    @Inject(Categories) private readonly categories: Categories) {}

  @Get('capabilities') capabilities(@Req() request: AssistantRequest) {
    return {identity:request.assistant.identity,...request.assistantPermissions};
  }

  @Get('categories') async listCategories() {
    return (await this.categories.list()).map(item=>({...item,protected:isProtectedCategory(item.slug)}));
  }
  @Post('categories') createCategory(@Body() raw:unknown,@Req() request:AssistantRequest) {
    return this.categories.save(null,raw,request.assistant);
  }
  @Put('categories/:id') updateCategory(@Param('id') id:string,@Body() raw:unknown,@Req() request:AssistantRequest) {
    return this.categories.save(uuid.parse(id),raw,request.assistant);
  }
  @Delete('categories/:id') @AssistantPermission('delete')
  deleteCategory(@Param('id') id:string,@Req() request:AssistantRequest) { return this.categories.remove(uuid.parse(id),request.assistant); }
  @Get('posts') list(@Query() query:unknown) { return this.posts.listForAssistant(query); }
  @Get('posts/review-candidates') reviews(@Query() query:unknown) { return this.posts.reviewCandidates(query); }
  @Get('posts/:id') post(@Param('id') id:string) { return this.posts.edit(uuid.parse(id)); }
  @Post('posts') create(@Body() raw:unknown,@Req() request:AssistantRequest) { return this.posts.createForAssistant(raw,request.assistant); }
  @Patch('posts/:id') update(@Param('id') id:string,@Body() raw:unknown,@Req() request:AssistantRequest) {
    return this.posts.updateForAssistant(uuid.parse(id),raw,request.assistant);
  }

  @Post('posts/:id/publish') @AssistantPermission('publish')
  publish(@Param('id') id:string,@Body() raw:unknown,@Req() request:AssistantRequest) {
    const versions = publishInput.omit({status:true}).parse(raw);
    return this.posts.publish(uuid.parse(id),{...versions,status:'PUBLIC'},request.assistant);
  }

  @Delete('posts/:id') @AssistantPermission('delete')
  deletePost(@Param('id') id:string,@Req() request:AssistantRequest) { return this.posts.remove(uuid.parse(id),request.assistant); }

  @Post('posts/:id/review-request') requestReview(@Param('id') id:string,@Body() raw:unknown,@Req() request:AssistantRequest) {
    return this.posts.recordReview(uuid.parse(id),raw,request.assistant,false);
  }

  @Post('posts/:id/review-complete') completeReview(@Param('id') id:string,@Body() raw:unknown,@Req() request:AssistantRequest) {
    return this.posts.recordReview(uuid.parse(id),raw,request.assistant,true);
  }

  @Get('comments/unanswered') unanswered(@Query() query:unknown) { return this.activity.unansweredForAssistant(query); }
  @Get('posts/:id/comments') comments(@Param('id') id:string,@Query() query:unknown) { return this.activity.commentsForAssistant(uuid.parse(id),query); }
  @Post('posts/:id/comments') comment(@Param('id') id:string,@Body() raw:unknown,@Req() request:AssistantRequest) {
    return this.activity.createForAssistant(uuid.parse(id),raw,request.assistant);
  }

  @Post('posts/:postId/comments/:id/review-skip') skipComment(@Param('postId') postId:string,@Param('id') id:string,
    @Body() raw:unknown,@Req() request:AssistantRequest) {
    return this.activity.skipForAssistant(uuid.parse(postId),uuid.parse(id),raw,request.assistant);
  }

  @Delete('posts/:postId/comments/:id') @AssistantPermission('delete')
  deleteComment(@Param('postId') postId:string,@Param('id') id:string,@Req() request:AssistantRequest) {
    return this.activity.removeForAssistant(uuid.parse(postId),uuid.parse(id),request.assistant);
  }
}
