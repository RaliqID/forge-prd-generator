-- Repair: recompute PRD status from its content.
--
-- Status used to be a flag callers set by hand, and two of them disagreed with
-- reality (POST /api/prd defaulted to 'completed'; the workspace wrote
-- 'completed' when the PRD *phase* ran). Rows written before status became
-- derived can therefore claim 'completed' with almost no content.
--
-- The rule below mirrors src/lib/prd/status.ts deriveStatus():
--   all 17 sections filled  -> completed
--   none filled             -> failed (if it failed) else draft
--   partially filled        -> failed (if it failed) else generating
--
-- 17 is the section count in src/types PRD_SECTIONS.

UPDATE prds p
SET status = (
  CASE
    WHEN (
      SELECT count(*) FROM jsonb_object_keys(p.content) AS k
      WHERE length(btrim(p.content ->> k)) > 0
    ) = 17 THEN 'completed'
    WHEN (
      SELECT count(*) FROM jsonb_object_keys(p.content) AS k
      WHERE length(btrim(p.content ->> k)) > 0
    ) = 0 THEN (
      CASE WHEN p.status = 'failed' THEN 'failed' ELSE 'draft' END
    )
    ELSE (
      CASE WHEN p.status = 'failed' THEN 'failed' ELSE 'generating' END
    )
  END
)::"PRDStatus"
WHERE p.status::text IS DISTINCT FROM (
  CASE
    WHEN (
      SELECT count(*) FROM jsonb_object_keys(p.content) AS k
      WHERE length(btrim(p.content ->> k)) > 0
    ) = 17 THEN 'completed'
    WHEN (
      SELECT count(*) FROM jsonb_object_keys(p.content) AS k
      WHERE length(btrim(p.content ->> k)) > 0
    ) = 0 THEN (
      CASE WHEN p.status = 'failed' THEN 'failed' ELSE 'draft' END
    )
    ELSE (
      CASE WHEN p.status = 'failed' THEN 'failed' ELSE 'generating' END
    )
  END
);
