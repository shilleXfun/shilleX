import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { WalletVerifyResult } from '@shillex/shared';
import { requireUser } from '../lib/auth.ts';
import { errors } from '../lib/errors.ts';
import { decodeAddress } from '../lib/siws.ts';
import { parse } from '../lib/validate.ts';
import { meView, startSession } from '../services/accounts.ts';
import { WalletProofBody, issueChallenge, issueSignupToken, verifyProof } from '../services/wallet-auth.ts';
import { touchLogin, verifiedWalletOwner } from '../services/wallets.ts';

const Challenge = z.object({ purpose: z.enum(['login', 'reset', 'link', 'confirm']), address: z.string().min(32).max(44).optional() });

export default async function walletAuthRoutes(app: FastifyInstance) {
  const deps = app.deps;
  const { db, now } = deps;

  app.post('/auth/wallet/challenge', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const body = parse(Challenge, req.body);
    if (body.address && !decodeAddress(body.address)) throw errors.badRequest('BAD_ADDRESS', 'That isn’t a Solana address');
    const user = body.purpose === 'link' || body.purpose === 'confirm' ? requireUser(req) : null;
    return issueChallenge(deps, { purpose: body.purpose, user, address: body.address });
  });

  app.post('/auth/wallet/verify', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply): Promise<WalletVerifyResult> => {
    const body = parse(WalletProofBody.extend({ purpose: z.enum(['login']) }), req.body);
    const w = await verifyProof(deps, body, 'login', null);
    const owner = await verifiedWalletOwner(db, w.address);
    if (owner) {
      await touchLogin(db, w.address, now());
      await startSession(app, reply, owner.id);
      return { status: 'signedIn', user: await meView(db, owner) };
    }
    return { status: 'new', signupToken: await issueSignupToken(deps, w), address: w.address, walletName: w.walletName };
  });
}
