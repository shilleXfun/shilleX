CREATE OR REPLACE FUNCTION admin_audit_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'admin_audit is append-only';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS admin_audit_no_change ON admin_audit;
--> statement-breakpoint
CREATE TRIGGER admin_audit_no_change BEFORE UPDATE OR DELETE ON admin_audit FOR EACH ROW EXECUTE FUNCTION admin_audit_append_only();
--> statement-breakpoint
DROP TRIGGER IF EXISTS admin_audit_no_truncate ON admin_audit;
--> statement-breakpoint
CREATE TRIGGER admin_audit_no_truncate BEFORE TRUNCATE ON admin_audit FOR EACH STATEMENT EXECUTE FUNCTION admin_audit_append_only();
