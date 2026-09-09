-- Private operation custody is deliberately outside the tenant's portable business-data archive.
-- Bootstrap creates a NOLOGIN role; migration never installs credentials or grants role membership.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='o_okul_device_restore_worker') THEN
    CREATE ROLE o_okul_device_restore_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  END IF;
END $$;
CREATE SCHEMA device_existing_restore;
REVOKE ALL ON SCHEMA device_existing_restore FROM PUBLIC;
GRANT USAGE ON SCHEMA device_existing_restore TO app,o_okul_device_restore_worker;
GRANT USAGE ON SCHEMA public TO o_okul_device_restore_worker;

CREATE TABLE device_existing_restore.work (
  operation_id text PRIMARY KEY CHECK(operation_id ~ '^[a-f0-9]{32}$'),
  tenant_id text NOT NULL REFERENCES public."Tenant"(id) ON DELETE RESTRICT,
  archive_digest text NOT NULL CHECK(archive_digest ~ '^[a-f0-9]{64}$'),
  target text NOT NULL CHECK(target ~ '^[a-f0-9]{64}$'),
  envelope bytea CHECK(octet_length(envelope) BETWEEN 29 AND 50331648),
  recovery_envelope bytea CHECK(recovery_envelope IS NULL OR octet_length(recovery_envelope) BETWEEN 29 AND 50331648),
  request jsonb NOT NULL CHECK(jsonb_typeof(request)='object'), approval jsonb,
  state text NOT NULL DEFAULT 'AWAITING_APPROVAL' CHECK(state IN ('AWAITING_APPROVAL','QUEUED','RUNNING','COMPLETED','ABORTED','BLOCKED')),
  error_code text CHECK(error_code IS NULL OR error_code ~ '^DEVICE_[A-Z_]+$'), result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(envelope IS NOT NULL OR state IN ('COMPLETED','ABORTED')),
  UNIQUE(tenant_id,operation_id)
);
CREATE UNIQUE INDEX device_restore_work_active ON device_existing_restore.work(tenant_id) WHERE state NOT IN ('COMPLETED','ABORTED');
CREATE TABLE device_existing_restore.object_jobs (
  operation_id text PRIMARY KEY CHECK(operation_id ~ '^[a-f0-9]{32}$'),
  tenant_id text NOT NULL REFERENCES public."Tenant"(id) ON DELETE RESTRICT,
  archive_digest text NOT NULL CHECK(archive_digest ~ '^[a-f0-9]{64}$'),
  target text NOT NULL CHECK(target ~ '^[a-f0-9]{64}$'),
  state text NOT NULL CHECK(state IN ('PREPARED','CLEANING','ABORTED','COMPLETE')),
  intent jsonb NOT NULL CHECK(jsonb_typeof(intent)='array' AND jsonb_array_length(intent)<=2000)
);
CREATE UNIQUE INDEX device_restore_objects_active ON device_existing_restore.object_jobs(tenant_id) WHERE state IN ('PREPARED','CLEANING');
CREATE TABLE device_existing_restore.receipts (
  operation_id text PRIMARY KEY CHECK(operation_id ~ '^[a-f0-9]{32}$'),
  tenant_id text NOT NULL REFERENCES public."Tenant"(id) ON DELETE RESTRICT,
  archive_digest text NOT NULL CHECK(archive_digest ~ '^[a-f0-9]{64}$'),
  schema_digest text NOT NULL CHECK(schema_digest ~ '^[a-f0-9]{64}$'),
  result_digest text NOT NULL CHECK(result_digest ~ '^[a-f0-9]{64}$'), created_at timestamptz NOT NULL DEFAULT now()
);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['work','object_jobs','receipts'] LOOP
    EXECUTE format('ALTER TABLE device_existing_restore.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE device_existing_restore.%I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY tenant_isolation ON device_existing_restore.%I USING (tenant_id=current_setting(''app.current_tenant_id'',true)) WITH CHECK (tenant_id=current_setting(''app.current_tenant_id'',true))',t);
    EXECUTE format('CREATE POLICY protected_target ON device_existing_restore.%I AS RESTRICTIVE TO o_okul_device_restore_worker USING (EXISTS (SELECT 1 FROM public."Tenant" boundary WHERE boundary.id=tenant_id)) WITH CHECK (EXISTS (SELECT 1 FROM public."Tenant" boundary WHERE boundary.id=tenant_id))',t);
  END LOOP;
END $$;
GRANT SELECT(operation_id,tenant_id,archive_digest,target,request,approval,state,error_code,result,created_at,updated_at),INSERT,UPDATE(state,approval,updated_at) ON device_existing_restore.work TO app;
GRANT SELECT,UPDATE(state,error_code,result,recovery_envelope,updated_at) ON device_existing_restore.work TO o_okul_device_restore_worker;
GRANT SELECT,INSERT,UPDATE(state) ON device_existing_restore.object_jobs TO o_okul_device_restore_worker;
GRANT SELECT,INSERT ON device_existing_restore.receipts TO o_okul_device_restore_worker;
GRANT SELECT(operation_id,tenant_id,archive_digest) ON device_existing_restore.receipts TO app;
GRANT SELECT(operation_id,tenant_id,state) ON device_existing_restore.object_jobs TO app;

-- Fail closed even if an application session tries to reactivate an unfinished institution.
CREATE FUNCTION device_existing_restore.block_activation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status='ACTIVE' AND OLD.status<>'ACTIVE' AND EXISTS (
    SELECT 1 FROM device_existing_restore.work WHERE tenant_id=NEW.id AND state IN ('QUEUED','RUNNING','BLOCKED')
  ) THEN RAISE EXCEPTION 'DEVICE_RESTORE_OPERATION_IN_PROGRESS'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Tenant_block_active_during_device_restore" BEFORE UPDATE OF status ON public."Tenant"
FOR EACH ROW EXECUTE FUNCTION device_existing_restore.block_activation();

CREATE FUNCTION device_existing_restore.enforce_work_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.state<>'AWAITING_APPROVAL' OR NEW.recovery_envelope IS NOT NULL OR NEW.result IS NOT NULL THEN
      RAISE EXCEPTION 'DEVICE_RESTORE_INITIAL_STATE_INVALID';
    END IF;
  ELSE
    IF OLD.state IN ('COMPLETED','ABORTED') AND OLD.updated_at<now()-interval '7 days'
       AND NEW.envelope IS NULL AND NEW.recovery_envelope IS NULL
       AND (to_jsonb(NEW)-ARRAY['envelope','recovery_envelope'])=(to_jsonb(OLD)-ARRAY['envelope','recovery_envelope'])
    THEN RETURN NEW; END IF;
    IF (NEW.operation_id,NEW.tenant_id,NEW.archive_digest,NEW.target,NEW.envelope,NEW.request,NEW.created_at)
       IS DISTINCT FROM (OLD.operation_id,OLD.tenant_id,OLD.archive_digest,OLD.target,OLD.envelope,OLD.request,OLD.created_at)
       OR (OLD.recovery_envelope IS NOT NULL AND NEW.recovery_envelope IS DISTINCT FROM OLD.recovery_envelope)
       OR (OLD.approval IS NOT NULL AND NEW.approval IS DISTINCT FROM OLD.approval)
       OR OLD.state IN ('COMPLETED','ABORTED')
       OR (OLD.state='AWAITING_APPROVAL' AND NEW.state NOT IN ('AWAITING_APPROVAL','QUEUED','ABORTED'))
       OR (NEW.state='QUEUED' AND NEW.approval IS NULL)
       OR (OLD.state='QUEUED' AND NEW.state NOT IN ('QUEUED','RUNNING','BLOCKED'))
    THEN RAISE EXCEPTION 'DEVICE_RESTORE_OPERATION_IMMUTABLE'; END IF;
    IF NEW.state='COMPLETED' AND (NOT EXISTS (
      SELECT 1 FROM device_existing_restore.receipts r WHERE r.operation_id=NEW.operation_id AND r.tenant_id=NEW.tenant_id AND r.archive_digest=NEW.archive_digest
    ) OR NOT EXISTS (
      SELECT 1 FROM device_existing_restore.object_jobs j WHERE j.operation_id=NEW.operation_id AND j.tenant_id=NEW.tenant_id AND j.state='COMPLETE'
    )) THEN RAISE EXCEPTION 'DEVICE_RESTORE_COMPLETION_UNVERIFIED'; END IF;
    IF NEW.state='ABORTED' AND OLD.state<>'AWAITING_APPROVAL' AND (EXISTS (
      SELECT 1 FROM device_existing_restore.receipts r WHERE r.operation_id=NEW.operation_id AND r.tenant_id=NEW.tenant_id
    ) OR NOT EXISTS (
      SELECT 1 FROM device_existing_restore.object_jobs j WHERE j.operation_id=NEW.operation_id AND j.tenant_id=NEW.tenant_id AND j.state='ABORTED'
    )) THEN RAISE EXCEPTION 'DEVICE_RESTORE_ABORT_UNVERIFIED'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER enforce_work_transition BEFORE INSERT OR UPDATE ON device_existing_restore.work
FOR EACH ROW EXECUTE FUNCTION device_existing_restore.enforce_work_transition();

-- Reviewed privileges and restrictive ownership remain effective even with app.bypass_rls=true.
GRANT SELECT ON "AcademicTerm" TO o_okul_device_restore_worker;
CREATE POLICY "AcademicTerm_device_restore_boundary" ON "AcademicTerm" AS RESTRICTIVE TO o_okul_device_restore_worker USING (("AcademicTerm"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true))) WITH CHECK (("AcademicTerm"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true)));
GRANT INSERT,UPDATE,DELETE ON "AcademicTerm" TO o_okul_device_restore_worker;
GRANT SELECT ON "AcademicYear" TO o_okul_device_restore_worker;
CREATE POLICY "AcademicYear_device_restore_boundary" ON "AcademicYear" AS RESTRICTIVE TO o_okul_device_restore_worker USING (("AcademicYear"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true))) WITH CHECK (("AcademicYear"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true)));
GRANT INSERT,UPDATE,DELETE ON "AcademicYear" TO o_okul_device_restore_worker;
GRANT SELECT ON "Alan" TO o_okul_device_restore_worker;
CREATE POLICY "Alan_device_restore_boundary" ON "Alan" AS RESTRICTIVE TO o_okul_device_restore_worker USING (("Alan"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true))) WITH CHECK (("Alan"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true)));
GRANT INSERT,UPDATE,DELETE ON "Alan" TO o_okul_device_restore_worker;
GRANT SELECT ON "Announcement" TO o_okul_device_restore_worker;
CREATE POLICY "Announcement_device_restore_boundary" ON "Announcement" AS RESTRICTIVE TO o_okul_device_restore_worker USING (("Announcement"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true))) WITH CHECK (("Announcement"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true)));
GRANT SELECT ON "AnnouncementDeliveryReport" TO o_okul_device_restore_worker;
CREATE POLICY "AnnouncementDeliveryReport_device_restore_boundary" ON "AnnouncementDeliveryReport" AS RESTRICTIVE TO o_okul_device_restore_worker USING (("AnnouncementDeliveryReport"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true))) WITH CHECK (("AnnouncementDeliveryReport"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true)));
GRANT SELECT ON "AnnouncementReceipt" TO o_okul_device_restore_worker;
CREATE POLICY "AnnouncementReceipt_device_restore_boundary" ON "AnnouncementReceipt" AS RESTRICTIVE TO o_okul_device_restore_worker USING (("AnnouncementReceipt"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true))) WITH CHECK (("AnnouncementReceipt"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true)));
GRANT SELECT ON "AnswerKey" TO o_okul_device_restore_worker;
CREATE POLICY "AnswerKey_device_restore_boundary" ON "AnswerKey" AS RESTRICTIVE TO o_okul_device_restore_worker USING (("AnswerKey"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true))) WITH CHECK (("AnswerKey"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true)));
GRANT INSERT,UPDATE,DELETE ON "AnswerKey" TO o_okul_device_restore_worker;
GRANT SELECT ON "Attendance" TO o_okul_device_restore_worker;
CREATE POLICY "Attendance_device_restore_boundary" ON "Attendance" AS RESTRICTIVE TO o_okul_device_restore_worker USING (("Attendance"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true))) WITH CHECK (("Attendance"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true)));
GRANT INSERT,UPDATE,DELETE ON "Attendance" TO o_okul_device_restore_worker;
GRANT SELECT ON "AuditLog" TO o_okul_device_restore_worker;
CREATE POLICY "AuditLog_device_restore_boundary" ON "AuditLog" AS RESTRICTIVE TO o_okul_device_restore_worker USING (("AuditLog"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true))) WITH CHECK (("AuditLog"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true)));
GRANT SELECT ON "AuthSession" TO o_okul_device_restore_worker;
CREATE POLICY "AuthSession_device_restore_boundary" ON "AuthSession" AS RESTRICTIVE TO o_okul_device_restore_worker USING (("AuthSession"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true))) WITH CHECK (("AuthSession"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true)));
GRANT SELECT ON "BackupRestoreJob" TO o_okul_device_restore_worker;
CREATE POLICY "BackupRestoreJob_device_restore_boundary" ON "BackupRestoreJob" AS RESTRICTIVE TO o_okul_device_restore_worker USING (("BackupRestoreJob"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true))) WITH CHECK (("BackupRestoreJob"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true)));
GRANT SELECT ON "Campus" TO o_okul_device_restore_worker;
CREATE POLICY "Campus_device_restore_boundary" ON "Campus" AS RESTRICTIVE TO o_okul_device_restore_worker USING (("Campus"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true))) WITH CHECK (("Campus"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true)));
GRANT INSERT,UPDATE,DELETE ON "Campus" TO o_okul_device_restore_worker;
GRANT SELECT ON "Class" TO o_okul_device_restore_worker;
CREATE POLICY "Class_device_restore_boundary" ON "Class" AS RESTRICTIVE TO o_okul_device_restore_worker USING (("Class"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true))) WITH CHECK (("Class"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true)));
GRANT INSERT,UPDATE,DELETE ON "Class" TO o_okul_device_restore_worker;
GRANT SELECT ON "ConsumedRefreshToken" TO o_okul_device_restore_worker;
CREATE POLICY "ConsumedRefreshToken_device_restore_boundary" ON "ConsumedRefreshToken" AS RESTRICTIVE TO o_okul_device_restore_worker USING (("ConsumedRefreshToken"."tokenFamilyId" IN (SELECT "tokenFamilyId" FROM "AuthSession" WHERE "tenantId" = current_setting('app.current_tenant_id',true))) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true))) WITH CHECK (("ConsumedRefreshToken"."tokenFamilyId" IN (SELECT "tokenFamilyId" FROM "AuthSession" WHERE "tenantId" = current_setting('app.current_tenant_id',true))) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true)));
GRANT SELECT ON "Course" TO o_okul_device_restore_worker;
CREATE POLICY "Course_device_restore_boundary" ON "Course" AS RESTRICTIVE TO o_okul_device_restore_worker USING (("Course"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true))) WITH CHECK (("Course"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true)));
GRANT INSERT,UPDATE,DELETE ON "Course" TO o_okul_device_restore_worker;
GRANT SELECT ON "DevelopmentAssessment" TO o_okul_device_restore_worker;
CREATE POLICY "DevelopmentAssessment_device_restore_boundary" ON "DevelopmentAssessment" AS RESTRICTIVE TO o_okul_device_restore_worker USING (("DevelopmentAssessment"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true))) WITH CHECK (("DevelopmentAssessment"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true)));
GRANT INSERT,UPDATE,DELETE ON "DevelopmentAssessment" TO o_okul_device_restore_worker;
GRANT SELECT ON "DevelopmentCriterion" TO o_okul_device_restore_worker;
CREATE POLICY "DevelopmentCriterion_device_restore_boundary" ON "DevelopmentCriterion" AS RESTRICTIVE TO o_okul_device_restore_worker USING (("DevelopmentCriterion"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true))) WITH CHECK (("DevelopmentCriterion"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true)));
GRANT INSERT,UPDATE,DELETE ON "DevelopmentCriterion" TO o_okul_device_restore_worker;
GRANT SELECT ON "DevelopmentScore" TO o_okul_device_restore_worker;
CREATE POLICY "DevelopmentScore_device_restore_boundary" ON "DevelopmentScore" AS RESTRICTIVE TO o_okul_device_restore_worker USING (("DevelopmentScore"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true))) WITH CHECK (("DevelopmentScore"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true)));
GRANT INSERT,UPDATE,DELETE ON "DevelopmentScore" TO o_okul_device_restore_worker;
GRANT SELECT ON "Employee" TO o_okul_device_restore_worker;
CREATE POLICY "Employee_device_restore_boundary" ON "Employee" AS RESTRICTIVE TO o_okul_device_restore_worker USING (("Employee"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true))) WITH CHECK (("Employee"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true)));
GRANT INSERT,UPDATE,DELETE ON "Employee" TO o_okul_device_restore_worker;
GRANT SELECT ON "Exam" TO o_okul_device_restore_worker;
CREATE POLICY "Exam_device_restore_boundary" ON "Exam" AS RESTRICTIVE TO o_okul_device_restore_worker USING (("Exam"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true))) WITH CHECK (("Exam"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true)));
GRANT INSERT,UPDATE,DELETE ON "Exam" TO o_okul_device_restore_worker;
GRANT SELECT ON "ExamBookletVariant" TO o_okul_device_restore_worker;
CREATE POLICY "ExamBookletVariant_device_restore_boundary" ON "ExamBookletVariant" AS RESTRICTIVE TO o_okul_device_restore_worker USING (("ExamBookletVariant"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true))) WITH CHECK (("ExamBookletVariant"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true)));
GRANT INSERT,UPDATE,DELETE ON "ExamBookletVariant" TO o_okul_device_restore_worker;
GRANT SELECT ON "ExamParticipant" TO o_okul_device_restore_worker;
CREATE POLICY "ExamParticipant_device_restore_boundary" ON "ExamParticipant" AS RESTRICTIVE TO o_okul_device_restore_worker USING (("ExamParticipant"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true))) WITH CHECK (("ExamParticipant"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true)));
GRANT INSERT,UPDATE,DELETE ON "ExamParticipant" TO o_okul_device_restore_worker;
GRANT SELECT ON "ExamResult" TO o_okul_device_restore_worker;
CREATE POLICY "ExamResult_device_restore_boundary" ON "ExamResult" AS RESTRICTIVE TO o_okul_device_restore_worker USING (("ExamResult"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true))) WITH CHECK (("ExamResult"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true)));
GRANT INSERT,UPDATE,DELETE ON "ExamResult" TO o_okul_device_restore_worker;
GRANT SELECT ON "GradeLevel" TO o_okul_device_restore_worker;
CREATE POLICY "GradeLevel_device_restore_boundary" ON "GradeLevel" AS RESTRICTIVE TO o_okul_device_restore_worker USING (("GradeLevel"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true))) WITH CHECK (("GradeLevel"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true)));
GRANT INSERT,UPDATE,DELETE ON "GradeLevel" TO o_okul_device_restore_worker;
GRANT SELECT ON "GradeLevelCourse" TO o_okul_device_restore_worker;
CREATE POLICY "GradeLevelCourse_device_restore_boundary" ON "GradeLevelCourse" AS RESTRICTIVE TO o_okul_device_restore_worker USING (("GradeLevelCourse"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true))) WITH CHECK (("GradeLevelCourse"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true)));
GRANT INSERT,UPDATE,DELETE ON "GradeLevelCourse" TO o_okul_device_restore_worker;
GRANT SELECT ON "Guardian" TO o_okul_device_restore_worker;
CREATE POLICY "Guardian_device_restore_boundary" ON "Guardian" AS RESTRICTIVE TO o_okul_device_restore_worker USING (("Guardian"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true))) WITH CHECK (("Guardian"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true)));
GRANT INSERT,UPDATE,DELETE ON "Guardian" TO o_okul_device_restore_worker;
GRANT SELECT ON "GuardianStudent" TO o_okul_device_restore_worker;
CREATE POLICY "GuardianStudent_device_restore_boundary" ON "GuardianStudent" AS RESTRICTIVE TO o_okul_device_restore_worker USING (("GuardianStudent"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true))) WITH CHECK (("GuardianStudent"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true)));
GRANT SELECT ON "Homework" TO o_okul_device_restore_worker;
CREATE POLICY "Homework_device_restore_boundary" ON "Homework" AS RESTRICTIVE TO o_okul_device_restore_worker USING (("Homework"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true))) WITH CHECK (("Homework"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true)));
GRANT INSERT,UPDATE,DELETE ON "Homework" TO o_okul_device_restore_worker;
GRANT SELECT ON "HomeworkMaterial" TO o_okul_device_restore_worker;
CREATE POLICY "HomeworkMaterial_device_restore_boundary" ON "HomeworkMaterial" AS RESTRICTIVE TO o_okul_device_restore_worker USING (("HomeworkMaterial"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true))) WITH CHECK (("HomeworkMaterial"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true)));
GRANT INSERT,UPDATE,DELETE ON "HomeworkMaterial" TO o_okul_device_restore_worker;
GRANT SELECT ON "HomeworkMaterialAssignment" TO o_okul_device_restore_worker;
CREATE POLICY "HomeworkMaterialAssignment_device_restore_boundary" ON "HomeworkMaterialAssignment" AS RESTRICTIVE TO o_okul_device_restore_worker USING (("HomeworkMaterialAssignment"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true))) WITH CHECK (("HomeworkMaterialAssignment"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true)));
GRANT INSERT,UPDATE,DELETE ON "HomeworkMaterialAssignment" TO o_okul_device_restore_worker;
GRANT SELECT ON "HomeworkMaterialFile" TO o_okul_device_restore_worker;
CREATE POLICY "HomeworkMaterialFile_device_restore_boundary" ON "HomeworkMaterialFile" AS RESTRICTIVE TO o_okul_device_restore_worker USING (("HomeworkMaterialFile"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true))) WITH CHECK (("HomeworkMaterialFile"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true)));
GRANT INSERT,UPDATE,DELETE ON "HomeworkMaterialFile" TO o_okul_device_restore_worker;
GRANT SELECT ON "IdempotencyKey" TO o_okul_device_restore_worker;
CREATE POLICY "IdempotencyKey_device_restore_boundary" ON "IdempotencyKey" AS RESTRICTIVE TO o_okul_device_restore_worker USING (("IdempotencyKey"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true))) WITH CHECK (("IdempotencyKey"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true)));
GRANT SELECT ON "IdentityInvitation" TO o_okul_device_restore_worker;
CREATE POLICY "IdentityInvitation_device_restore_boundary" ON "IdentityInvitation" AS RESTRICTIVE TO o_okul_device_restore_worker USING (("IdentityInvitation"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true))) WITH CHECK (("IdentityInvitation"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true)));
GRANT SELECT ON "ImportQuarantine" TO o_okul_device_restore_worker;
CREATE POLICY "ImportQuarantine_device_restore_boundary" ON "ImportQuarantine" AS RESTRICTIVE TO o_okul_device_restore_worker USING (("ImportQuarantine"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true))) WITH CHECK (("ImportQuarantine"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true)));
GRANT INSERT,UPDATE,DELETE ON "ImportQuarantine" TO o_okul_device_restore_worker;
GRANT SELECT ON "LearningOutcome" TO o_okul_device_restore_worker;
CREATE POLICY "LearningOutcome_device_restore_boundary" ON "LearningOutcome" AS RESTRICTIVE TO o_okul_device_restore_worker USING (("LearningOutcome"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true))) WITH CHECK (("LearningOutcome"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true)));
GRANT INSERT,UPDATE,DELETE ON "LearningOutcome" TO o_okul_device_restore_worker;
GRANT SELECT ON "LicenseTerm" TO o_okul_device_restore_worker;
CREATE POLICY "LicenseTerm_device_restore_boundary" ON "LicenseTerm" AS RESTRICTIVE TO o_okul_device_restore_worker USING (("LicenseTerm"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true))) WITH CHECK (("LicenseTerm"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true)));
GRANT SELECT ON "LicenseUsage" TO o_okul_device_restore_worker;
CREATE POLICY "LicenseUsage_device_restore_boundary" ON "LicenseUsage" AS RESTRICTIVE TO o_okul_device_restore_worker USING (("LicenseUsage"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true))) WITH CHECK (("LicenseUsage"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true)));
GRANT SELECT ON "MembershipCampusScope" TO o_okul_device_restore_worker;
CREATE POLICY "MembershipCampusScope_device_restore_boundary" ON "MembershipCampusScope" AS RESTRICTIVE TO o_okul_device_restore_worker USING (("MembershipCampusScope"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true))) WITH CHECK (("MembershipCampusScope"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true)));
GRANT SELECT ON "MessageTemplate" TO o_okul_device_restore_worker;
CREATE POLICY "MessageTemplate_device_restore_boundary" ON "MessageTemplate" AS RESTRICTIVE TO o_okul_device_restore_worker USING (("MessageTemplate"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true))) WITH CHECK (("MessageTemplate"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true)));
GRANT INSERT,UPDATE,DELETE ON "MessageTemplate" TO o_okul_device_restore_worker;
GRANT SELECT ON "NotificationDeviceToken" TO o_okul_device_restore_worker;
CREATE POLICY "NotificationDeviceToken_device_restore_boundary" ON "NotificationDeviceToken" AS RESTRICTIVE TO o_okul_device_restore_worker USING (("NotificationDeviceToken"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true))) WITH CHECK (("NotificationDeviceToken"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true)));
GRANT SELECT ON "OpticalFormTemplate" TO o_okul_device_restore_worker;
CREATE POLICY "OpticalFormTemplate_device_restore_boundary" ON "OpticalFormTemplate" AS RESTRICTIVE TO o_okul_device_restore_worker USING (("OpticalFormTemplate"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true))) WITH CHECK (("OpticalFormTemplate"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true)));
GRANT INSERT,UPDATE,DELETE ON "OpticalFormTemplate" TO o_okul_device_restore_worker;
GRANT SELECT ON "ParsedAnswer" TO o_okul_device_restore_worker;
CREATE POLICY "ParsedAnswer_device_restore_boundary" ON "ParsedAnswer" AS RESTRICTIVE TO o_okul_device_restore_worker USING (("ParsedAnswer"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true))) WITH CHECK (("ParsedAnswer"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true)));
GRANT INSERT,UPDATE,DELETE ON "ParsedAnswer" TO o_okul_device_restore_worker;
GRANT SELECT ON "ParserConfig" TO o_okul_device_restore_worker;
CREATE POLICY "ParserConfig_device_restore_boundary" ON "ParserConfig" AS RESTRICTIVE TO o_okul_device_restore_worker USING (("ParserConfig"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true))) WITH CHECK (("ParserConfig"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true)));
GRANT INSERT,UPDATE,DELETE ON "ParserConfig" TO o_okul_device_restore_worker;
GRANT SELECT ON "PasswordResetToken" TO o_okul_device_restore_worker;
CREATE POLICY "PasswordResetToken_device_restore_boundary" ON "PasswordResetToken" AS RESTRICTIVE TO o_okul_device_restore_worker USING (("PasswordResetToken"."userId" IN (SELECT "id" FROM "User" WHERE "tenantId" = current_setting('app.current_tenant_id',true))) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true))) WITH CHECK (("PasswordResetToken"."userId" IN (SELECT "id" FROM "User" WHERE "tenantId" = current_setting('app.current_tenant_id',true))) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true)));
GRANT SELECT ON "PaymentInstallment" TO o_okul_device_restore_worker;
CREATE POLICY "PaymentInstallment_device_restore_boundary" ON "PaymentInstallment" AS RESTRICTIVE TO o_okul_device_restore_worker USING (("PaymentInstallment"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true))) WITH CHECK (("PaymentInstallment"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true)));
GRANT SELECT ON "PaymentPlan" TO o_okul_device_restore_worker;
CREATE POLICY "PaymentPlan_device_restore_boundary" ON "PaymentPlan" AS RESTRICTIVE TO o_okul_device_restore_worker USING (("PaymentPlan"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true))) WITH CHECK (("PaymentPlan"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true)));
GRANT SELECT ON "PaymentTransaction" TO o_okul_device_restore_worker;
CREATE POLICY "PaymentTransaction_device_restore_boundary" ON "PaymentTransaction" AS RESTRICTIVE TO o_okul_device_restore_worker USING (("PaymentTransaction"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true))) WITH CHECK (("PaymentTransaction"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true)));
GRANT SELECT ON "RawImport" TO o_okul_device_restore_worker;
CREATE POLICY "RawImport_device_restore_boundary" ON "RawImport" AS RESTRICTIVE TO o_okul_device_restore_worker USING (("RawImport"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true))) WITH CHECK (("RawImport"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true)));
GRANT INSERT,UPDATE,DELETE ON "RawImport" TO o_okul_device_restore_worker;
GRANT SELECT ON "ReportSnapshot" TO o_okul_device_restore_worker;
CREATE POLICY "ReportSnapshot_device_restore_boundary" ON "ReportSnapshot" AS RESTRICTIVE TO o_okul_device_restore_worker USING (("ReportSnapshot"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true))) WITH CHECK (("ReportSnapshot"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true)));
GRANT INSERT,UPDATE,DELETE ON "ReportSnapshot" TO o_okul_device_restore_worker;
GRANT SELECT ON "ScheduleLesson" TO o_okul_device_restore_worker;
CREATE POLICY "ScheduleLesson_device_restore_boundary" ON "ScheduleLesson" AS RESTRICTIVE TO o_okul_device_restore_worker USING (("ScheduleLesson"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true))) WITH CHECK (("ScheduleLesson"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true)));
GRANT INSERT,UPDATE,DELETE ON "ScheduleLesson" TO o_okul_device_restore_worker;
GRANT SELECT ON "SecretDeliveryOutbox" TO o_okul_device_restore_worker;
CREATE POLICY "SecretDeliveryOutbox_device_restore_boundary" ON "SecretDeliveryOutbox" AS RESTRICTIVE TO o_okul_device_restore_worker USING (("SecretDeliveryOutbox"."tenantId" = current_setting('app.current_tenant_id',true) OR ("SecretDeliveryOutbox"."purpose" = 'PASSWORD_RESET' AND "SecretDeliveryOutbox"."sourceId" IN (SELECT p."id" FROM "PasswordResetToken" p JOIN "User" u ON u."id" = p."userId" WHERE u."tenantId" = current_setting('app.current_tenant_id',true))) OR ("SecretDeliveryOutbox"."purpose" = 'IDENTITY_INVITATION' AND "SecretDeliveryOutbox"."sourceId" IN (SELECT "id" FROM "IdentityInvitation" WHERE "tenantId" = current_setting('app.current_tenant_id',true)))) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true))) WITH CHECK (("SecretDeliveryOutbox"."tenantId" = current_setting('app.current_tenant_id',true) OR ("SecretDeliveryOutbox"."purpose" = 'PASSWORD_RESET' AND "SecretDeliveryOutbox"."sourceId" IN (SELECT p."id" FROM "PasswordResetToken" p JOIN "User" u ON u."id" = p."userId" WHERE u."tenantId" = current_setting('app.current_tenant_id',true))) OR ("SecretDeliveryOutbox"."purpose" = 'IDENTITY_INVITATION' AND "SecretDeliveryOutbox"."sourceId" IN (SELECT "id" FROM "IdentityInvitation" WHERE "tenantId" = current_setting('app.current_tenant_id',true)))) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true)));
GRANT SELECT ON "SmsBatchDeliveryReport" TO o_okul_device_restore_worker;
CREATE POLICY "SmsBatchDeliveryReport_device_restore_boundary" ON "SmsBatchDeliveryReport" AS RESTRICTIVE TO o_okul_device_restore_worker USING (("SmsBatchDeliveryReport"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true))) WITH CHECK (("SmsBatchDeliveryReport"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true)));
GRANT SELECT ON "Student" TO o_okul_device_restore_worker;
CREATE POLICY "Student_device_restore_boundary" ON "Student" AS RESTRICTIVE TO o_okul_device_restore_worker USING (("Student"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true))) WITH CHECK (("Student"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true)));
GRANT INSERT,UPDATE,DELETE ON "Student" TO o_okul_device_restore_worker;
GRANT SELECT ON "StudentContact" TO o_okul_device_restore_worker;
CREATE POLICY "StudentContact_device_restore_boundary" ON "StudentContact" AS RESTRICTIVE TO o_okul_device_restore_worker USING (("StudentContact"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true))) WITH CHECK (("StudentContact"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true)));
GRANT SELECT ON "StudentEnrollment" TO o_okul_device_restore_worker;
CREATE POLICY "StudentEnrollment_device_restore_boundary" ON "StudentEnrollment" AS RESTRICTIVE TO o_okul_device_restore_worker USING (("StudentEnrollment"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true))) WITH CHECK (("StudentEnrollment"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true)));
GRANT INSERT,UPDATE,DELETE ON "StudentEnrollment" TO o_okul_device_restore_worker;
GRANT SELECT ON "StudySession" TO o_okul_device_restore_worker;
CREATE POLICY "StudySession_device_restore_boundary" ON "StudySession" AS RESTRICTIVE TO o_okul_device_restore_worker USING (("StudySession"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true))) WITH CHECK (("StudySession"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true)));
GRANT INSERT,UPDATE,DELETE ON "StudySession" TO o_okul_device_restore_worker;
GRANT SELECT ON "StudySessionStudent" TO o_okul_device_restore_worker;
CREATE POLICY "StudySessionStudent_device_restore_boundary" ON "StudySessionStudent" AS RESTRICTIVE TO o_okul_device_restore_worker USING (("StudySessionStudent"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true))) WITH CHECK (("StudySessionStudent"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true)));
GRANT INSERT,UPDATE,DELETE ON "StudySessionStudent" TO o_okul_device_restore_worker;
GRANT SELECT ON "SupportTicket" TO o_okul_device_restore_worker;
CREATE POLICY "SupportTicket_device_restore_boundary" ON "SupportTicket" AS RESTRICTIVE TO o_okul_device_restore_worker USING (("SupportTicket"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true))) WITH CHECK (("SupportTicket"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true)));
GRANT SELECT ON "SupportTicketAttachment" TO o_okul_device_restore_worker;
CREATE POLICY "SupportTicketAttachment_device_restore_boundary" ON "SupportTicketAttachment" AS RESTRICTIVE TO o_okul_device_restore_worker USING (("SupportTicketAttachment"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true))) WITH CHECK (("SupportTicketAttachment"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true)));
GRANT SELECT ON "SupportTicketComment" TO o_okul_device_restore_worker;
CREATE POLICY "SupportTicketComment_device_restore_boundary" ON "SupportTicketComment" AS RESTRICTIVE TO o_okul_device_restore_worker USING (("SupportTicketComment"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true))) WITH CHECK (("SupportTicketComment"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true)));
GRANT SELECT ON "Teacher" TO o_okul_device_restore_worker;
CREATE POLICY "Teacher_device_restore_boundary" ON "Teacher" AS RESTRICTIVE TO o_okul_device_restore_worker USING (("Teacher"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true))) WITH CHECK (("Teacher"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true)));
GRANT INSERT,UPDATE,DELETE ON "Teacher" TO o_okul_device_restore_worker;
GRANT SELECT ON "TeacherAssignment" TO o_okul_device_restore_worker;
CREATE POLICY "TeacherAssignment_device_restore_boundary" ON "TeacherAssignment" AS RESTRICTIVE TO o_okul_device_restore_worker USING (("TeacherAssignment"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true))) WITH CHECK (("TeacherAssignment"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true)));
GRANT INSERT,UPDATE,DELETE ON "TeacherAssignment" TO o_okul_device_restore_worker;
GRANT SELECT ON "TeacherNote" TO o_okul_device_restore_worker;
CREATE POLICY "TeacherNote_device_restore_boundary" ON "TeacherNote" AS RESTRICTIVE TO o_okul_device_restore_worker USING (("TeacherNote"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true))) WITH CHECK (("TeacherNote"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true)));
GRANT INSERT,UPDATE,DELETE ON "TeacherNote" TO o_okul_device_restore_worker;
GRANT SELECT ON "Tenant" TO o_okul_device_restore_worker;
CREATE POLICY "Tenant_device_restore_boundary" ON "Tenant" AS RESTRICTIVE TO o_okul_device_restore_worker USING (("Tenant"."id" = current_setting('app.current_tenant_id',true)) AND slug NOT IN ('dna','demoo','system') AND id<>'system') WITH CHECK (("Tenant"."id" = current_setting('app.current_tenant_id',true)) AND slug NOT IN ('dna','demoo','system') AND id<>'system');
GRANT SELECT ON "TenantFreshResetOperation" TO o_okul_device_restore_worker;
CREATE POLICY "TenantFreshResetOperation_device_restore_boundary" ON "TenantFreshResetOperation" AS RESTRICTIVE TO o_okul_device_restore_worker USING (("TenantFreshResetOperation"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true))) WITH CHECK (("TenantFreshResetOperation"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true)));
GRANT SELECT ON "TenantMembership" TO o_okul_device_restore_worker;
CREATE POLICY "TenantMembership_device_restore_boundary" ON "TenantMembership" AS RESTRICTIVE TO o_okul_device_restore_worker USING (("TenantMembership"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true))) WITH CHECK (("TenantMembership"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true)));
GRANT SELECT ON "TenantMutationActivity" TO o_okul_device_restore_worker;
CREATE POLICY "TenantMutationActivity_device_restore_boundary" ON "TenantMutationActivity" AS RESTRICTIVE TO o_okul_device_restore_worker USING (("TenantMutationActivity"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true))) WITH CHECK (("TenantMutationActivity"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true)));
GRANT SELECT ON "User" TO o_okul_device_restore_worker;
CREATE POLICY "User_device_restore_boundary" ON "User" AS RESTRICTIVE TO o_okul_device_restore_worker USING (("User"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true))) WITH CHECK (("User"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true)));
GRANT SELECT ON "WhatsAppConsent" TO o_okul_device_restore_worker;
CREATE POLICY "WhatsAppConsent_device_restore_boundary" ON "WhatsAppConsent" AS RESTRICTIVE TO o_okul_device_restore_worker USING (("WhatsAppConsent"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true))) WITH CHECK (("WhatsAppConsent"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true)));
GRANT SELECT ON "WhatsAppConsentEvent" TO o_okul_device_restore_worker;
CREATE POLICY "WhatsAppConsentEvent_device_restore_boundary" ON "WhatsAppConsentEvent" AS RESTRICTIVE TO o_okul_device_restore_worker USING (("WhatsAppConsentEvent"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true))) WITH CHECK (("WhatsAppConsentEvent"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true)));
GRANT UPDATE(status,"lifecycleVersion","suspendedAt","suspendedReason","updatedAt") ON "Tenant" TO o_okul_device_restore_worker;
GRANT INSERT ON "AuditLog" TO o_okul_device_restore_worker;
GRANT USAGE ON SCHEMA device_existing_restore TO o_okul_reset_worker;
GRANT SELECT(operation_id,tenant_id,state) ON device_existing_restore.work TO o_okul_reset_worker;

-- Only finished private payloads expire; failed/uncertain recovery material stays available for review.
CREATE FUNCTION device_existing_restore.purge_expired_custody() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,device_existing_restore AS $$
DECLARE removed integer;
BEGIN
  UPDATE device_existing_restore.work w SET envelope=NULL,recovery_envelope=NULL
  WHERE w.tenant_id=current_setting('app.current_tenant_id',true)
    AND EXISTS(SELECT 1 FROM public."Tenant" t WHERE t.id=w.tenant_id AND t.slug NOT IN ('dna','demoo','system'))
    AND w.state IN ('COMPLETED','ABORTED') AND w.updated_at<now()-interval '7 days' AND w.envelope IS NOT NULL;
  GET DIAGNOSTICS removed=ROW_COUNT; RETURN removed;
END $$;
REVOKE ALL ON FUNCTION device_existing_restore.purge_expired_custody() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION device_existing_restore.purge_expired_custody() TO o_okul_device_restore_worker;
