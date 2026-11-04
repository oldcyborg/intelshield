import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { AuthUser } from '../auth/auth-user';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import { CheckpointsService } from './checkpoints.service';
import { CreateCheckpointDto, ResolveQrDto, UpdateCheckpointDto } from './dto';

@Controller()
export class CheckpointsController {
  constructor(private readonly checkpoints: CheckpointsService) {}

  @RequirePermission('site.view')
  @Get('sites/:id/checkpoints')
  list(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.checkpoints.list(user, id);
  }

  @RequirePermission('site.manage')
  @Post('sites/:id/checkpoints')
  create(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateCheckpointDto) {
    return this.checkpoints.create(user, id, dto);
  }

  @RequirePermission('site.manage')
  @Get('sites/:id/qr-sheet')
  qrSheet(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.checkpoints.qrSheet(user, id);
  }

  @RequirePermission('site.view')
  @Post('checkpoints/resolve-qr')
  resolve(@CurrentUser() user: AuthUser, @Body() dto: ResolveQrDto) {
    return this.checkpoints.resolve(user, dto.payload);
  }

  @RequirePermission('site.manage')
  @Patch('checkpoints/:id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCheckpointDto) {
    return this.checkpoints.update(user, id, dto);
  }

  @RequirePermission('site.manage')
  @Post('checkpoints/:id/rotate-qr')
  rotate(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.checkpoints.rotateQr(user, id);
  }
}
