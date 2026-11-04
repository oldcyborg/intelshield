import { DeepPartial, FindManyOptions, FindOptionsWhere, Repository } from 'typeorm';
import { TenantEntity } from './entities/base.entity';
import { BusinessException } from './errors/business.exception';

/** Typed escape hatch for building `where` objects on a generic entity. */
export const where = <T>(value: object) => value as unknown as FindOptionsWhere<T>;

/**
 * A repository that cannot forget the tenant. Every read adds `tenant_id`, every
 * write sets it, and a row of another tenant is indistinguishable from a missing one.
 */
export class TenantRepository<T extends TenantEntity> {
  constructor(readonly raw: Repository<T>) {}

  private scoped(tenantId: string, filter?: FindOptionsWhere<T> | FindOptionsWhere<T>[]) {
    const add = (w: FindOptionsWhere<T>) => where<T>({ ...w, tenant_id: tenantId });
    return Array.isArray(filter) ? filter.map(add) : add(filter ?? where<T>({}));
  }

  find(tenantId: string, options: FindManyOptions<T> = {}): Promise<T[]> {
    return this.raw.find({ ...options, where: this.scoped(tenantId, options.where) });
  }

  findOne(tenantId: string, filter: FindOptionsWhere<T>): Promise<T | null> {
    return this.raw.findOne({ where: this.scoped(tenantId, filter) });
  }

  async get(tenantId: string, id: string): Promise<T> {
    const entity = await this.findOne(tenantId, where<T>({ id }));
    if (!entity) throw new BusinessException('NOT_FOUND');
    return entity;
  }

  create(tenantId: string, data: DeepPartial<T>): Promise<T> {
    return this.raw.save(this.raw.create({ ...data, tenant_id: tenantId } as DeepPartial<T>));
  }

  async update(tenantId: string, id: string, patch: DeepPartial<T>): Promise<T> {
    const entity = await this.get(tenantId, id);
    this.raw.merge(entity, patch);
    entity.tenant_id = tenantId; // a patch can never move a row to another tenant
    return this.raw.save(entity);
  }

  /** Only for entities with a @DeleteDateColumn. */
  async softDelete(tenantId: string, id: string): Promise<void> {
    await this.get(tenantId, id);
    await this.raw.softDelete(where<T>({ id, tenant_id: tenantId }));
  }
}
