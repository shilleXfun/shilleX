import { DepthRegistry } from './registry.ts';
import { driftModule } from './drift.ts';
import { beliefsModule } from './beliefs.ts';
import { reputationModule } from './reputation.ts';

/** Every depth module, in the order hooks run. Later tasks append theirs here. */
export function createDepth(): DepthRegistry {
  return new DepthRegistry([driftModule, reputationModule, beliefsModule]);
}
