import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { AuthUser } from '../auth/auth-user';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import { SiteContactsService } from './contacts.service';
import { CreateContactDto, UpdateContactDto } from './dto';

@Controller()
export class SiteContactsController {
  constructor(private readonly contacts: SiteContactsService) {}

  /** Only the contacts this person's level allows: office, leaders, or guards on shift there. */
  @Get('sites/:id/contacts')
  list(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.contacts.list(user, id);
  }

  @RequirePermission('contact.manage')
  @Post('sites/:id/contacts')
  create(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateContactDto) {
    return this.contacts.create(user, id, dto);
  }

  @RequirePermission('contact.manage')
  @Patch('site-contacts/:id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateContactDto) {
    return this.contacts.update(user, id, dto);
  }

  @RequirePermission('contact.manage')
  @Delete('site-contacts/:id')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.contacts.remove(user, id);
  }
}
