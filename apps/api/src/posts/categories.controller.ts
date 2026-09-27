import { Body, Controller, Delete, Get, Inject, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { AdminGuard, type AuthRequest } from '../http.js';
import { Categories } from './categories.service.js';
import { uuid } from './post-input.js';

@Controller('api/admin/categories')
@UseGuards(AdminGuard)
export class CategoriesController {
  constructor(@Inject(Categories) private readonly categories: Categories) {}
  @Get() list() { return this.categories.list(); }
  @Post() create(@Body() input: unknown, @Req() request: AuthRequest) {
    return this.categories.save(null, input, request.session!.userId!);
  }
  @Put(':id') update(@Param('id') id: string, @Body() input: unknown, @Req() request: AuthRequest) {
    return this.categories.save(uuid.parse(id), input, request.session!.userId!);
  }
  @Delete(':id') remove(@Param('id') id: string, @Req() request: AuthRequest) {
    return this.categories.remove(uuid.parse(id), request.session!.userId!);
  }
}
