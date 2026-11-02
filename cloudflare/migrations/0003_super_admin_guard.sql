-- There is exactly one Super Admin account. Other administrators use ADMIN
-- or SUPPORT_ADMIN roles and will be created later from the RBAC dashboard.
CREATE UNIQUE INDEX IF NOT EXISTS idx_single_super_admin
  ON app_user(role)
  WHERE role = 'SUPER_ADMIN';
