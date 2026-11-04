import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { AuthUser } from '../auth/auth-user';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import { ContractsService } from './contracts.service';
import { ChangePriceDto, CreateContractDto, EndPositionDto, TerminateContractDto, UpdateContractDto } from './dto';

class ContractFilter {
  @IsOptional() @IsUUID()
  client_id?: string;

  @IsOptional() @IsIn(['draft', 'upcoming', 'active', 'expiring', 'expired', 'terminated'])
  status?: string;
}

@Controller('contracts')
export class ContractsController {
  constructor(private readonly contracts: ContractsService) {}

  @RequirePermission('contract.view')
  @Get()
  list(@CurrentUser() user: AuthUser, @Query() filter: ContractFilter) {
    return this.contracts.list(user, filter);
  }

  @RequirePermission('contract.view')
  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.contracts.get(user, id);
  }

  @RequirePermission('contract.manage')
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateContractDto) {
    return this.contracts.create(user, dto);
  }

  @RequirePermission('contract.manage')
  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateContractDto) {
    return this.contracts.update(user, id, dto);
  }

  @RequirePermission('contract.manage')
  @Post(':id/terminate')
  @HttpCode(200)
  terminate(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TerminateContractDto) {
    return this.contracts.terminate(user, id, dto);
  }

  @RequirePermission('contract.manage')
  @Post(':id/prices')
  changePrice(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ChangePriceDto) {
    return this.contracts.changePrice(user, id, dto);
  }

  @RequirePermission('contract.manage')
  @Post(':id/prices/:position/end')
  @HttpCode(200)
  endPosition(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('position') position: string,
    @Body() dto: EndPositionDto,
  ) {
    return this.contracts.endPosition(user, id, position, dto);
  }
}
