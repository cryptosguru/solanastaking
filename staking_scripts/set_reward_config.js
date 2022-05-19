// client.js is used to introduce the reader to generating clients from IDLs.
// It is not expected users directly test with this example. For a more
// ergonomic example, see `tests/basic-0.js` in this workspace.

const anchor = require('@project-serum/anchor');
const { BN, web3, Program, ProgramError, Provider } = anchor
const { PublicKey, SystemProgram, Keypair, Transaction } = web3
const { TOKEN_PROGRAM_ID, Token, ASSOCIATED_TOKEN_PROGRAM_ID } = require("@solana/spl-token");
const utf8 = anchor.utils.bytes.utf8;
const { ENV_CONFIG, utils, STAKING_CONFIG } = require('./CONFIG')
const { program, provider } = ENV_CONFIG

async function main () {
  await program.rpc.setExtraRewardConfigs(STAKING_CONFIG.REWARD_CONFIGS,
  {
      accounts: {
        extraRewardAccount: await utils.getRewardConfigSigner(),
        authority: provider.wallet.publicKey,
        clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        systemProgram: SystemProgram.programId,
      }
    })
  const reward = await program.account.extraRewardsAccount.fetch(await utils.getRewardConfigSigner())
  console.log(reward)
}

console.log('Running client.');
main().then(() => console.log('Success')).catch(e => console.error(e));
