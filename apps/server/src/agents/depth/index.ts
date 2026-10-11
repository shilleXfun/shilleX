import { DepthRegistry } from './registry.ts';
import { driftModule } from './drift.ts';
import { beliefsModule } from './beliefs.ts';
import { reputationModule } from './reputation.ts';
import { factionsModule } from './factions.ts';
import { leaksModule } from './leaks.ts';
import { lineageModule } from './lineage.ts';
import { weatherModule } from './weather.ts';
import { lifeModule } from './life.ts';

/** Every depth module, in the order hooks run. Later tasks append theirs here. */
export function createDepth(): DepthRegistry {
  return new DepthRegistry([driftModule, reputationModule, beliefsModule, factionsModule, leaksModule, lineageModule, weatherModule, lifeModule]);
}
