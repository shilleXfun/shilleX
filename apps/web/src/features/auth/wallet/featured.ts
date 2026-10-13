/**
 * The three wallets the picker always shows, installed or not (spec §4). No wallet code here: the sign-in button
 * imports this without pulling the wallet libraries into the eager bundle.
 */
export const FEATURED = [
  { name: 'Phantom', install: 'https://phantom.com/download', colour: '#AB9FF2' },
  { name: 'Solflare', install: 'https://solflare.com/download', colour: '#FC7227' },
  { name: 'Backpack', install: 'https://backpack.app/downloads', colour: '#E33E3F' },
] as const;
