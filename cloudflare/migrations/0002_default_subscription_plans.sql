-- Initial editable plan catalogue. Prices/durations are copied to payment and
-- subscription records at purchase/approval time, so future plan edits do not
-- rewrite a student's old purchase history.
INSERT OR IGNORE INTO subscription_plans
  (code, name, price_inr, duration_days, tier, features_json, enabled, sort_order)
VALUES
  ('FREE', 'Free', 0, NULL, 'FREE', '{"basicAttendance":true,"semesterManagement":true,"subjectWiseAttendance":true,"basicDashboard":true,"activeSemesterLimit":1}', 1, 0),
  ('PRO_MONTHLY', 'Pro Monthly', 49, 30, 'PRO', '{"attendancePlanning":true,"recoveryCalculator":true,"customCategories":true,"subjectAnalytics":true,"trendCharts":true,"pdfCsvExport":true,"multipleSemesters":true,"completeHistory":true}', 1, 1),
  ('PRO_QUARTERLY', 'Pro Quarterly', 129, 90, 'PRO', '{"attendancePlanning":true,"recoveryCalculator":true,"customCategories":true,"subjectAnalytics":true,"trendCharts":true,"pdfCsvExport":true,"multipleSemesters":true,"completeHistory":true}', 1, 2),
  ('PRO_YEARLY', 'Pro Yearly', 399, 365, 'PRO', '{"attendancePlanning":true,"recoveryCalculator":true,"customCategories":true,"subjectAnalytics":true,"trendCharts":true,"pdfCsvExport":true,"multipleSemesters":true,"completeHistory":true}', 1, 3);


-- Enforce one active plan per account. The expiry workflow first supersedes
-- the existing active row before activating a replacement plan.
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_subscription_per_user
  ON user_subscriptions(user_id) WHERE status = 'ACTIVE';
