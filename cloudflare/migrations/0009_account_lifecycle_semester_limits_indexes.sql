-- Account lifecycle, semester plan caps support, and targeted query indexes.
-- Additive only: existing student records and current plan entitlements are preserved.

ALTER TABLE app_user ADD COLUMN suspension_reason TEXT;

-- Admin directory lookups and recent account ordering.
CREATE INDEX IF NOT EXISTS idx_app_user_role_created
  ON app_user(role, created_at DESC);

-- Free workspace fallback and semester-limit checks.
CREATE INDEX IF NOT EXISTS idx_semesters_user_created
  ON semesters(user_id, created_at DESC, id DESC);

-- Child-key indexes used by subject relationship lookups and ON DELETE SET NULL.
CREATE INDEX IF NOT EXISTS idx_timetable_subjects_subject_id
  ON timetable_subjects(subject_id);
CREATE INDEX IF NOT EXISTS idx_attendance_subject_id
  ON attendance(subject_id);

-- Foreign-key child indexes for administrative/payment references.
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_activated_by
  ON user_subscriptions(activated_by);
CREATE INDEX IF NOT EXISTS idx_payment_claims_reviewed_by
  ON payment_claims(reviewed_by);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_verified_by
  ON payment_transactions(verified_by);
CREATE INDEX IF NOT EXISTS idx_admin_permission_overrides_updated_by
  ON admin_permission_overrides(updated_by);

-- User-targeted audit lookups and privacy cleanup.
CREATE INDEX IF NOT EXISTS idx_audit_logs_target_lookup
  ON audit_logs(target_type, target_id, created_at DESC);
