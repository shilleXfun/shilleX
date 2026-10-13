/** Router state from a wallet sign-in that found no account: the one-use token and the wallet it proved. */
export interface WalletSignupState { token: string; address: string; walletName: string | null; next: string }
