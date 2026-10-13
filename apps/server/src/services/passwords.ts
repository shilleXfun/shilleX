import { hash, verify } from '@node-rs/argon2';

let dummy: Promise<string> | null = null;
/** One full argon2 verify against a fixed hash, so a login for no account (or one with no password) costs as long as a real one. */
export async function dummyVerify(password: string): Promise<void> {
  dummy ??= hash('shillex-no-such-account');
  await verify(await dummy, password).catch(() => false);
}

/** The password check every login path uses: a missing hash still pays for one verify, then fails. */
export async function passwordMatches(u: { passwordHash: string | null }, password: string): Promise<boolean> {
  if (!u.passwordHash) { await dummyVerify(password); return false; }
  return verify(u.passwordHash, password);
}
