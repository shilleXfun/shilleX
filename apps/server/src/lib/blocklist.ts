import { createHash } from 'node:crypto';

/**
 * SHA-256 (hex) of each blocked word in lower case: slurs and sexual terms (spec 2026-10-13-user-agents §2.3). Stored hashed so
 * the source never spells them out. Add a word with:
 *   node -e "console.log(require('crypto').createHash('sha256').update(process.argv[1]).digest('hex'))" <word>
 */
const BLOCKED: ReadonlySet<string> = new Set([
  '8c5c04391361cbf4afd74c5ed8101ea4af881c4ee3b3df1d5b3716a19b1a834d',
  '0033728f0fbc83a0f0226d91bb063540d6d0158c0bbfa1620ae5b95b10f82932',
  'acf45488978d9ff451e305194e5dd85452b76f75ed6ca223942cd4069ed52da0',
  'c6603565c5159fbe846a53e991829d452a1546d41150c0d3c73ddbd7f476ee0d',
  'd92f4cf1e2d7e8129d7536dda13e3b1898da728ee64e2f9566cb7c86619bbda5',
  '6577be77529947bf04c41fca275a6405b66698659cbb7889c0b5f97ecded21b0',
  '12a667c9be6ff8f665d2e9163f3b96422e8025ef238817ec8101c17a23f1a4c3',
  '98d44e13f455d916674d38424d39e1cb01b2a9132aacbb7b97a6f8bb7feb2544',
  '7f5a9ba14cb89dc20e9001e41ba6f98fc1d4d71752a7407bcd082d52bb63465c',
  'e683679358a5aea345d8a6084369eae87b0a3db298631dd14aed132f84d3b4e8',
  'cd2eb0837c9b4c962c22d2ff8b5441b7b45805887f051d39bf133b583baf6860',
  '6ccffa4977d4246ed9de8ad27693e9802b50d105aae43730d06f1dc840ca6df5',
  'd516dbecbf6a8cb4d28185bdd60f8faf9c0ceb8e8eabfb987206795e87281310',
  '665cb762e3bc03d078dea6bd624f49ac355ed3389d977f6e320792111961421d',
  'dcb50ee3659fb74208645f29da8bf4c11f799cec04d259eeaace642d960e83db',
  '594810adcbee20bd1d6f8e4cee51efdf1a235691e9d08fe96ce944d7fde34fd6',
  '4dc9418555a26aa694ef4c4b4d02137070a537d7786d4b337245a54304e7824e',
  'ad505b0be8a49b89273e307106fa42133cbd804456724c5e7635bd953215d92a',
  '796e43a5a8cdb73b92b5f59eb50610cea3efa8ce229cd7f0557983091b2b4552',
  '0f28c4960d96647e77e7ab6d13b85bd16c7ca56f45df802cdc763a5e5c0c7863',
  'f6952d6eef555ddd87aca66e56b91530222d6e318414816f3ba7cf5bf694bf0f',
  '0508a634445d401652d06013cdcc95183ab78c58e406cfec6dc58a395958ef2b',
  '13a465fc6616da8d2afacaf00a8276aa841662820f9337de127f815ee71cc55d',
  '7e85c676fd97d370e2309003a5681bc4388306979b7db04c37c6fb0672891b6a',
  '7902e27065cfa96f685ba02d8168505328e5046a6d39390fb24c0e5d780efa56',
  'eff26b18165ece9cd15978f5a124cd19afc08bfc76b4fda4ed11a35a66217051',
  '701d6943ae042badbeb77d1951d502dd589f91601662a73319edaf04adf2572b',
  '102626eace2d12939928583069428230227ca3b4ac67e622d0cec1ee9bd6e5b9',
  '9ddcab3ac3610db0f0304fee83297946ced6c9c8a2b0032e7d85329a74de65e7',
  '59cc3cb8a42973019cddacdee59e0aa7746ba6c203af78cefb453cb3a1b6610d',
  'a76d588d0047e3b043406060ba6170e2313f46f15a084d680464f881f1efeeb9',
  '82e695c9e75f5bc67deea8c67acb1c7bce3f633d533f9785804b500206348b89',
  'ab26f6966ee37fdf3b66775bf6d4f5541ae62ba85301ca534723a68cc7bfeba6',
  '3ef0b158edbfe22d12f0b0a9c59e00f7ee84a3f0730ba94c659502f9bb145056',
  '0b67579a10e1bdf91d85e65414dc38fcab9b973a97ab661a169a0813338ce7bd',
  'dd32831e9d5f3da30c303bff83974931551409ef690c5233c3923923162c95eb',
  '4140197ec7959b1c0674de1ee3c6d3f542c371276e2518427e0ad89e5c30f804',
  'c2c3b68b48832afd9a4dbdd474c1b6c81c8baecdb71446f9947dac72dd0fe93d',
  '9ae315a94e428a7ee3b5e48adae6541965d93b86acf10ffa1c45b93b6fe577b4',
  '120f6e5b4ea32f65bda68452fcfaaef06b0136e1d0e4a6f60bc3771fa0936dd6',
  '08a841e996781e9e77d30a4e4420a8f501a280b00624e6d1224bf54aaff73eba',
  '341d56384afc0f47b34ca18273e793be555507a49444c30d3d0588688de46cb3',
  '8f5083e3e5c7dc8932f2bf58212f963f3a44752618c96297f82623f736c52738',
  '9915ba2d822280f22c283df4e76584a40e0119fc58f73c5f84d4fdb04d04fa6f',
  '17bde8b4064612e266eaa1b5b1dfa054d1e6dd263f66b392159006d2c9a8ae8a',
  '158869a97379229b7681efae9d7f9c9214134e836d649ba53477c0c111414d59',
  'bd331fb1d24298f52943034a243a341877957b895f4372b11babb87262904ed6',
  '16ea09fc78ca83ca502cbcf2377acdf280bf18f61e259153f0868405eedab5ef',
  'c3de533e9b7fe63b79f648687a30d2861edd92fe7c3cd1f2c485e0a605367624',
  '98b52c4b6b7d1f48e7477a5ccc10955dd195d0ac5a38c8281bfeb08762634909',
  'f9d0d9b18ae9033a5ea36df19bf279b059e887a9ae785db81117bceaecc95933',
  'eef3bd091670c3447022d619c06ad15de96da72b5a66f28bb8b75d1b1c12a05f',
  'cc02032349c833ac5e97bac094560ed40e09acf34cb1978ab7a9840b9bf15b4d',
  'e7b98c6aa5b944e0b315d350d423f895ac9e44fb84f1534b18c2572370a67b9e',
  '886d51e97ad7931d0d2af8439ca6d9e4887e3c2b469ed247cbd68ceb3649ccde',
  '12e6274e4309293e2d480272b49a6c7c73a6a6b22678ba226b533c67006c17d1',
  '22fc75e65a0e9d34324092a7c6a8dba961853294abca4e5914e60c550f48e0c2',
  '333f7618092958c75b8c5af6f1ec77b42803922a0fc6ff1570a8af3a3aab3b4a',
  '3b1e0d7c5dd45583867e897943e37a940a7e7321022317dd3deea01963ee365e',
  '2a6937d721b14cdd7331c1ad1caf6a3cfa37a266650807101d44cdcd0acb132f',
  'fd70ad909b94deb27b460692084d9f2b1dbc9df3c6bcfd3caee571e707031e3f',
]);
const LEET: Readonly<Record<string, string>> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i' };
const sha = (w: string) => createHash('sha256').update(w).digest('hex');

/**
 * The words a text is checked as: NFKC-folded, lower case, leetspeak undone. A run of one-letter words ("a s e x") is also
 * checked as every stretch of 3+ of its letters ("ase", "sex", "asex", …), so spacing a word out doesn't hide it.
 */
export function blocklistWords(text: string): string[] {
  const t = text.normalize('NFKC').toLowerCase().replace(/[013457@$!]/g, (c) => LEET[c]!);
  const tokens = t.split(/[^\p{L}]+/u).filter(Boolean);
  const out = [...tokens];
  let run = '';
  for (const w of [...tokens, '']) {
    if (w.length === 1) { run += w; continue; }
    for (let i = 0; i < run.length; i++) for (let j = i + 3; j <= run.length; j++) out.push(run.slice(i, j));
    run = '';
  }
  return out;
}

/** True when any word of the text is on the blocklist. Whole words only, so "classy" or "analysis" pass. */
export const blocklisted = (text: string): boolean => blocklistWords(text).some((w) => BLOCKED.has(sha(w)));
