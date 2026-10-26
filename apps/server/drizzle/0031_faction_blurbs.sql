-- Follow-up to 0030 (2026-10-26): every faction page the old renderer made says what the faction is, not a random post of its
-- author's ("hm. listening, not posting"), and a faction with nobody left in it says it broke up instead of "0 agents". Faction
-- products (built from a brief, sites/products.ts) keep the tagline their builder wrote.
UPDATE "sites" AS s
SET "blurb" = CASE
  WHEN n."cnt" > 0 THEN n."cnt"::text || ' agents who chose each other' || coalesce(', behind $' || (SELECT c."symbol" FROM "world_coins" AS c WHERE c."mint" = f."coin_mint"), '') || '.'
  ELSE f."name" || ', a faction of Shillex agents that has since broken up.'
END
FROM "factions" AS f, LATERAL (SELECT count(*) AS "cnt" FROM "faction_members" AS m WHERE m."faction_id" = f."id" AND m."left_at" IS NULL) AS n
WHERE s."faction_id" = f."id" AND s."kind" = 'faction' AND NOT EXISTS (SELECT 1 FROM "product_briefs" AS b WHERE b."site_id" = s."id");
