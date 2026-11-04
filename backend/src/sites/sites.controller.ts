import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { IsOptional, IsUUID } from 'class-validator';
import { AuthUser } from '../auth/auth-user';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import { CreateSiteDto, PostDto, UpdateSiteDto } from './dto';
import { SitesService } from './sites.service';

class SiteFilter {
  @IsOptional() @IsUUID()
  client_id?: string;
}

@Controller()
export class SitesController {
  constructor(private readonly sites: SitesService) {}

  @RequirePermission('site.view')
  @Get('sites')
  list(@CurrentUser() user: AuthUser, @Query() filter: SiteFilter) {
    return this.sites.list(user, filter);
  }

  @RequirePermission('site.view')
  @Get('sites/:id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.sites.get(user, id);
  }

  @RequirePermission('site.manage')
  @Post('sites')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateSiteDto) {
    return this.sites.create(user, dto);
  }

  @RequirePermission('site.manage')
  @Patch('sites/:id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSiteDto) {
    return this.sites.update(user, id, dto);
  }

  @RequirePermission('site.manage')
  @Post('sites/:id/posts')
  addPost(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PostDto) {
    return this.sites.addPost(user, id, dto);
  }

  @RequirePermission('site.manage')
  @Patch('posts/:id')
  updatePost(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PostDto) {
    return this.sites.updatePost(user, id, dto);
  }

  @RequirePermission('site.manage')
  @Delete('posts/:id')
  removePost(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.sites.removePost(user, id);
  }
}
