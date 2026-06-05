-- @paradigm: sql
-- 0013 DOWN — Remove bronze TTL (revert to no TTL, CH as durable copy).
--
-- Use this rollback if P1-D S3 goes offline or if the TTL was applied
-- prematurely (before S3 was confirmed as the durable source of truth).
--
-- MODIFY TTL with an empty TTL expression removes the existing TTL.
-- Note: rows already deleted by a prior TTL merge cannot be recovered from
-- CH — only from the S3 archive or the BACKUP cron copies.

ALTER TABLE brain.connector_raw_events
    REMOVE TTL;
