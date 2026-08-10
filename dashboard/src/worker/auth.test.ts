import { describe, expect, it } from 'vitest';
import { hasAdminRole } from './auth';

describe('hasAdminRole', () => {
  const env = {
    DISCORD_ADMIN_ROLE_ID: 'legacy-role',
    DISCORD_ADMIN_ROLE_IDS: 'admin-role, extra-role',
  };

  it('allows any configured admin role', () => {
    expect(hasAdminRole(['extra-role'], env)).toBe(true);
  });

  it('rejects users without a configured admin role', () => {
    expect(hasAdminRole(['member-role'], env)).toBe(false);
  });

  it('falls back to the legacy single role setting', () => {
    expect(hasAdminRole(['legacy-role'], {
      DISCORD_ADMIN_ROLE_ID: 'legacy-role',
      DISCORD_ADMIN_ROLE_IDS: undefined,
    })).toBe(true);
  });
});
