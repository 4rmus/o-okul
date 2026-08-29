BEGIN;

SELECT set_config('app.bypass_rls', 'true', true);

LOCK TABLE "Class" IN SHARE ROW EXCLUSIVE MODE;

CREATE OR REPLACE FUNCTION public.class_name_key(input_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
STRICT
AS $function$
  SELECT regexp_replace(lower(input_name COLLATE "tr-x-icu"), '[[:space:]]+', '', 'g');
$function$;

DO $migration$
DECLARE
  duplicate_groups integer;
BEGIN
  SELECT count(*)
  INTO duplicate_groups
  FROM (
    SELECT "tenantId", public.class_name_key("name")
    FROM "Class"
    WHERE "deletedAt" IS NULL
    GROUP BY "tenantId", public.class_name_key("name")
    HAVING count(*) > 1
  ) AS duplicates;

  IF duplicate_groups > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = 'CLASS_ACTIVE_NAME_DUPLICATES_BLOCK_MIGRATION',
      DETAIL = format('%s active duplicate class name group(s) found', duplicate_groups);
  END IF;
END;
$migration$;

CREATE UNIQUE INDEX "Class_tenantId_active_name_key"
  ON "Class" ("tenantId", (public.class_name_key("name")))
  WHERE "deletedAt" IS NULL;

COMMIT;
