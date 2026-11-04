export type ScopeType = 'tenant' | 'team_group' | 'team' | 'client' | 'site';

export interface ScopeInput {
  scope_type: ScopeType;
  scope_id?: string | null;
}
