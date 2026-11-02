-- Prevent the same UPI reference from being submitted by multiple accounts.
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_claims_unique_utr
  ON payment_claims(utr_reference)
  WHERE utr_reference IS NOT NULL AND length(trim(utr_reference)) > 0;

-- A verified payment can create only one subscription record.
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_subscriptions_payment_once
  ON user_subscriptions(payment_transaction_id)
  WHERE payment_transaction_id IS NOT NULL;
