-- Lifecycle guards for accounts and account deletions (docs/state-machines.md):
--   app.users.status                          @serendipity/identity ACCOUNT_LIFECYCLE
--   app.account_deletion_requests.status      @serendipity/privacy  DELETION_LIFECYCLE

-- Up Migration

CREATE TRIGGER users_status_guard
  BEFORE UPDATE OF status ON app.users
  FOR EACH ROW
  EXECUTE FUNCTION app.guard_transition ('status',
    'pending>active', 'pending>paused', 'pending>suspended', 'pending>deleted',
    'active>paused', 'active>suspended', 'active>deleted',
    'paused>active', 'paused>suspended', 'paused>deleted',
    'suspended>active', 'suspended>deleted');

CREATE TRIGGER account_deletion_requests_status_guard
  BEFORE UPDATE OF status ON app.account_deletion_requests
  FOR EACH ROW
  EXECUTE FUNCTION app.guard_transition ('status',
    'requested>purging', 'purging>failed', 'purging>completed', 'failed>purging');

-- Down Migration

DROP TRIGGER account_deletion_requests_status_guard ON app.account_deletion_requests;
DROP TRIGGER users_status_guard ON app.users;
