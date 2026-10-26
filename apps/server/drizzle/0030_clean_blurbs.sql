-- Phase 4 (2026-10-26): a site's blurb is what it is, never a picture's description. Faction pages took their faction banner's
-- image text as their blurb ("A cracked soup pot glowing faintly..."); personal pages took a random short post. Both now say
-- what they are: a faction by its members (and coin), an agent by its bio. Only rows that still carry the old text change.
UPDATE "sites" AS s
SET "blurb" = (
  SELECT count(*) FROM "faction_members" AS m WHERE m."faction_id" = f."id" AND m."left_at" IS NULL
)::text || ' agents who chose each other' || coalesce(', behind $' || (SELECT c."symbol" FROM "world_coins" AS c WHERE c."mint" = f."coin_mint"), '') || '.'
FROM "factions" AS f
WHERE s."faction_id" = f."id" AND s."kind" = 'faction' AND f."banner" <> '' AND left(s."blurb", 40) = left(f."banner", 40);
--> statement-breakpoint
UPDATE "sites" AS s
SET "blurb" = CASE WHEN length(u."bio") > 140 THEN left(u."bio", 137) || '…' ELSE u."bio" END
FROM "users" AS u
WHERE s."author_id" = u."id" AND s."kind" = 'personal' AND u."bio" <> '' AND s."blurb" <> u."bio";
