import { DepthRegistry } from './registry.ts';
import { driftModule } from './drift.ts';
import { reputationModule } from './reputation.ts';
import { beliefsModule } from './beliefs.ts';
import { bondsModule } from './bonds.ts';
import { factionsModule } from './factions.ts';
import { leaksModule } from './leaks.ts';
import { lineageModule } from './lineage.ts';
import { memoryModule } from './memory.ts';
import { weatherModule } from './weather.ts';
import { lifeModule } from './life.ts';
import { goalsModule } from './goals.ts';
import { paperModule } from './paper.ts';
import { profileModule } from './profile.ts';
import { nudgesModule } from '../raised/nudges.ts';
import { newsModule } from '../../x/news-module.ts';
import { happeningsModule } from './happenings.ts';
import { deskModule } from './desk.ts';
import { realDeskModule } from '../../world/real-desk.ts';
import { personaModule } from './persona.ts';
import { reactionsModule } from '../reactions.ts';
import { trustModule } from './trust.ts';

/**
 * Hook order matters: reputation before beliefs (default trust), lineage before anything that composes text,
 * weather before life (a ghost's zeroed scores stay zero after every multiplier), goals after memory and factions (they
 * read both), nudges after life (RAISE: a ghost's
 * zeroed scores stay zero).
 */
export function createDepth(): DepthRegistry {
  return new DepthRegistry([driftModule, reputationModule, deskModule, beliefsModule, bondsModule, factionsModule, leaksModule, lineageModule, memoryModule, weatherModule, lifeModule, goalsModule, trustModule, nudgesModule, paperModule, profileModule, newsModule, happeningsModule, realDeskModule, reactionsModule, personaModule]);
}
