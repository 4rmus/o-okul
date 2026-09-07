DO $$
DECLARE
  partition_name TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "AuditLog" FROM app;

    FOR partition_name IN
      SELECT child.relname
      FROM pg_inherits inheritance
      JOIN pg_class parent ON parent.oid = inheritance.inhparent
      JOIN pg_class child ON child.oid = inheritance.inhrelid
      JOIN pg_namespace namespace ON namespace.oid = child.relnamespace
      WHERE parent.relname = 'AuditLog' AND namespace.nspname = current_schema()
    LOOP
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %I FROM app', partition_name);
    END LOOP;
  END IF;
END $$;
