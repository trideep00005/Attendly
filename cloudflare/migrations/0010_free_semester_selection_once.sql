-- Allow exactly one Free working-semester selection per expired Pro subscription period.
-- NULL means the user has not used the one-time choice for the latest expired Pro period.
-- The subscription id is intentionally stored as a scalar marker: historical subscription rows
-- remain auditable, and a new Pro subscription id naturally opens a new one-time choice cycle.
ALTER TABLE user_semester_preferences
  ADD COLUMN free_selection_used_for_subscription_id INTEGER;
