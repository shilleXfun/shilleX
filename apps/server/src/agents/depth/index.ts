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
import { paperModule } from './paper.ts';
import { profileModule } from './profile.ts';
import { nudgesModule } from '../raised/nudges.ts';
import { newsModule } from '../../x/news-module.ts';

/**
 * Hook order matters: reputation before beliefs (default trust), lineage before anything that composes text,
 * weather before life (a ghost's zeroed scores stay zero after every multiplier), nudges after life (RAISE: a ghost's
 * zeroed scores stay zero).
 */
export function createDepth(): DepthRegistry {
  return new DepthRegistry([driftModule, reputationModule, beliefsModule, bondsModule, factionsModule, leaksModule, lineageModule, memoryModule, weatherModule, lifeModule, nudgesModule, paperModule, profileModule, newsModule]);
}
