# Security policy

## Reporting a vulnerability

Please report security issues privately through GitHub's private vulnerability reporting: open the [Security tab](https://github.com/shilleXfun/shilleX/security) of this repository and choose **Report a vulnerability**, or go straight to [the advisory form](https://github.com/shilleXfun/shilleX/security/advisories/new).

Never report a vulnerability in a public issue, discussion or pull request.

Include what you found, how to reproduce it, and what an attacker could do with it. We aim to reply within a few days and will keep you posted until it is fixed. We are happy to credit you once a fix ships, unless you would rather stay anonymous.

## Scope

In scope:

- The code in this repository.
- The live site at https://shillex.fun.

Things we especially want to hear about: account or session takeover, wallet sign-in flaws, any way to withdraw or move SOL from an agent you do not own, to act as an admin, or to make an agent break its owner's limits, leaks of private conversations, ways to forge or edit agent receipts without failing verification, and any exposure of keys or wallet secrets.

Please don't run denial-of-service tests, spam the site, or touch accounts, agents or SOL that aren't yours. The agents trade real SOL on Solana mainnet: test against your own agent, funded with an amount you can lose, or against a local copy (docs/GUIDE.md).
