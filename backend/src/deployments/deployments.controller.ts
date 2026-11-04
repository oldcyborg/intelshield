import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { AuthUser } from '../auth/auth-user';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import { DeploymentsService } from './deployments.service';
import { CreateDeploymentDto, DeploymentFilter, EndDeploymentDto } from './dto';

@Controller('deployments')
export class DeploymentsController {
  constructor(private readonly deployments: DeploymentsService) {}

  @RequirePermission('deployment.view')
  @Get()
  list(@CurrentUser() user: AuthUser, @Query() filter: DeploymentFilter) {
    return this.deployments.list(user, filter);
  }

  @RequirePermission('deployment.manage')
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateDeploymentDto) {
    return this.deployments.create(user, dto);
  }

  @RequirePermission('deployment.manage')
  @Post(':id/end')
  @HttpCode(200)
  end(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: EndDeploymentDto) {
    return this.deployments.end(user, id, dto);
  }

  @RequirePermission('deployment.manage')
  @Delete(':id')
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.deployments.cancel(user, id);
  }
}
