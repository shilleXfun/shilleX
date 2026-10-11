import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/client.ts';
import type { Chain } from '../world/chain.ts';
import type { WorldEvents } from '../world/events.ts';
import type { ImagePolicy, Moments } from './types.ts';

export interface EngineDeps { app: FastifyInstance; db: Db; chain: Chain; events: WorldEvents; worldKey: Buffer; now: () => Date; rng: () => number; moments?: Moments; images?: ImagePolicy }
