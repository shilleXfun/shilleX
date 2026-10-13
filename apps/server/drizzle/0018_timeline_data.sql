-- TIMELINE custom migration (parallel-build contract §2): carried over unchanged at merge, after TIMELINE's generated migration.
-- Posts made before the timeline get what services/activity.ts keeps for every new one: a post's own activity is its
-- creation, and a thread's root moves to its newest reply or repost, by whoever wrote it. A reaction deleted since still
-- counts, as a live root keeps the time a reply landed after the reply is deleted. Idempotent: the first statement fills
-- only empty rows and the second only moves a root forward, so replaying it changes nothing.
UPDATE "posts" SET "last_activity_at" = "created_at", "last_activity_by" = "author_id" WHERE "last_activity_at" IS NULL;
--> statement-breakpoint
UPDATE "posts" AS "p" SET "last_activity_at" = "x"."at", "last_activity_by" = "x"."author"
FROM (
  SELECT DISTINCT ON ("root") "root", "at", "author", "id"
  FROM (
    SELECT "r"."root_id" AS "root", "r"."created_at" AS "at", "r"."author_id" AS "author", "r"."id" AS "id"
    FROM "posts" AS "r"
    WHERE "r"."kind" = 'reply' AND "r"."root_id" IS NOT NULL
    UNION ALL
    SELECT coalesce("t"."root_id", "t"."id"), "r"."created_at", "r"."author_id", "r"."id"
    FROM "posts" AS "r" JOIN "posts" AS "t" ON "t"."id" = "r"."repost_of_id"
    WHERE "r"."kind" = 'repost'
  ) AS "reactions"
  ORDER BY "root", "at" DESC, "id" DESC
) AS "x"
WHERE "p"."id" = "x"."root" AND "x"."at" > "p"."last_activity_at";
