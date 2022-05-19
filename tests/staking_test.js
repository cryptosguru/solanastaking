const anchor = require('@project-serum/anchor');
const serumCmn = require("@project-serum/common");
const { TOKEN_PROGRAM_ID, Token, ASSOCIATED_TOKEN_PROGRAM_ID } = require("@solana/spl-token");
const _ = require('lodash')
const { BN, web3, Program, ProgramError, Provider } = anchor
const { PublicKey, SystemProgram, Keypair, Transaction } = web3
const assert = require("assert");
const { assertError, wrapError } = require("./utils")
const utf8 = anchor.utils.bytes.utf8;
const provider = anchor.Provider.local()

const farmIdl = require('../target/idl/neonomad_staking.json');
const { expect } = require('chai');
const { Connection } = require('@solana/web3.js');

let stateSigner = Keypair.generate().publicKey
let stateBump = 255
let stateRewardVault = Keypair.generate().publicKey

let extraRewardSigner = Keypair.generate().publicKey
let extraRewardBump = 255

let rewardMint = new Token()
let poolSigner = Keypair.generate().publicKey
let poolVault = Keypair.generate().publicKey
let poolBump = 255

let lpMint = new Token()
let lpPoolSigner = Keypair.generate().publicKey
let lpPoolVault = Keypair.generate().publicKey
let lpPoolBump = 255


anchor.setProvider(provider);

let creatorKey = provider.wallet.publicKey
let program = anchor.workspace.NeonomadStaking
let connection = provider.connection

const cccc = new Connection(connection._rpcEndpoint, { commitment: 'confirmed' })

const users = _.map(new Array(10), () => {
  const user = anchor.web3.Keypair.generate();
  const publicKey = user.publicKey
  const rewardUserVault = user.publicKey
  const rewardAmount = new BN(0)
  const wallet = new anchor.Wallet(user)
  const provider = new anchor.Provider(connection, wallet)
  const userAccount1 = user.publicKey
  const bump1 = 255;
  const lpUserVault = user.publicKey
  const lpUserAccount = user.publicKey
  const etherAddressAccount = user.publicKey
  const etherAddressBump = 255
  const lpBump = 255

  const joinedPool = false
  return { lastHarvestTime1: 0, etherAddressAccount, etherAddressBump, user, publicKey, wallet, provider, userAccount1, bump1, rewardUserVault, rewardAmount, lpUserVault, joinedPool, lpUserAccount, lpBump, lpLastHarvestTime: 0 }
})

const [master, user1, user2, user3, user4, userLP1, userLP2, ...otherUsers] = users

const defaultAccounts = {
  tokenProgram: TOKEN_PROGRAM_ID,
  clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
  systemProgram: SystemProgram.programId,
}

describe('staking', () => {
  it('Is initialized!', async function () {
    rewardMint = await createMint(provider, provider.wallet.publicKey);
    lpMint = await createMint(provider, provider.wallet.publicKey);
    [stateSigner, stateBump] = await anchor.web3.PublicKey.findProgramAddress(
      [utf8.encode('state')],
      program.programId
    );
    [extraRewardSigner, extraRewardBump] = await anchor.web3.PublicKey.findProgramAddress(
      [utf8.encode('extra')],
      program.programId
    );
    [poolSigner, poolBump] = await anchor.web3.PublicKey.findProgramAddress(
      [rewardMint.publicKey.toBuffer()],
      program.programId
    );
    [lpPoolSigner, lpPoolBump] = await anchor.web3.PublicKey.findProgramAddress(
      [lpMint.publicKey.toBuffer()],
      program.programId
    );
    stateRewardVault = await rewardMint.createAccount(stateSigner)
    poolVault = await rewardMint.createAccount(poolSigner)
    lpPoolVault = await lpMint.createAccount(lpPoolSigner)
  })
  it('Fund', async function () {
    await Promise.all(users.map(async u => {
      await connection.confirmTransaction(await connection.requestAirdrop(u.publicKey, web3.LAMPORTS_PER_SOL))
      const [userAccount1, bump1] = await PublicKey.findProgramAddress([
        poolSigner.toBuffer(), u.publicKey.toBuffer()
      ], program.programId)
      u.userAccount1 = userAccount1
      u.bump1 = bump1
      u.rewardUserVault = await getOrCreateAssociatedSPL(u.provider, rewardMint)
      const [lpUserAccount, lpBump] = await PublicKey.findProgramAddress([
        lpPoolSigner.toBuffer(), u.publicKey.toBuffer()
      ], program.programId)
      u.lpUserAccount = lpUserAccount
      u.lpBump = lpBump
      u.lpUserVault = await getOrCreateAssociatedSPL(u.provider, lpMint)
      const [etherAddressAccount, etherAddressBump] = await PublicKey.findProgramAddress([
        utf8.encode('ether'), u.publicKey.toBuffer()
      ], program.programId)
      u.etherAddressAccount = etherAddressAccount
      u.etherAddressBump = etherAddressBump
    }))
    await rewardMint.mintTo(user1.rewardUserVault, creatorKey, [provider.wallet], new BN(100).toString())
    await rewardMint.mintTo(user2.rewardUserVault, creatorKey, [provider.wallet], new BN(400).toString())
    await rewardMint.mintTo(user3.rewardUserVault, creatorKey, [provider.wallet], new BN(600).toString())
    await rewardMint.mintTo(user4.rewardUserVault, creatorKey, [provider.wallet], new BN(800).toString())
    await rewardMint.mintTo(master.rewardUserVault, creatorKey, [provider.wallet], new BN(10000).toString())
    await lpMint.mintTo(userLP1.lpUserVault, creatorKey, [provider.wallet], new BN(100).toString())
    await lpMint.mintTo(userLP2.lpUserVault, creatorKey, [provider.wallet], new BN(100).toString())
  })
  it('Create State', async function () {
    await program.rpc.createState(stateBump, new BN(20), {
      accounts: {
        state: stateSigner,
        rewardMint: rewardMint.publicKey,
        rewardVault: stateRewardVault,
        authority: creatorKey,
        ...defaultAccounts
      }
    })
    const stateInfo = await program.account.stateAccount.fetch(stateSigner)
    assert.ok(stateInfo.tokenPerSecond.eq(new BN(20)))
  })
  it('Create ExtraReward', async function () {
    await program.rpc.createExtraRewardConfigs(extraRewardBump, [
      { duration: new BN(0), extraPercentage: getNumber(0) },
    ], {
      accounts: {
        extraRewardAccount: extraRewardSigner,
        authority: creatorKey,
        ...defaultAccounts
      },
    })
    await program.rpc.setExtraRewardConfigs([
      { duration: new BN(0), extraPercentage: getNumber(0) },
      { duration: new BN(1), extraPercentage: getNumber(50) },
      { duration: new BN(2), extraPercentage: getNumber(100) },
    ], {
      accounts: {
        extraRewardAccount: extraRewardSigner,
        authority: creatorKey,
        ...defaultAccounts
      },
    })
    const extraRewardConfigs = await program.account.extraRewardsAccount.fetch(extraRewardSigner)
    assert.ok(extraRewardConfigs.configs.length === 3)
    assert.ok(new BN(1).eq(extraRewardConfigs.configs[1].duration))
    assert.ok(getNumber(50).eq(extraRewardConfigs.configs[1].extraPercentage))
  })
  
  it('Create Pool', async function () {
    let pools = await program.account.farmPoolAccount.all()
    await program.rpc.createPool(poolBump, new BN('0'), new BN('0'), {
      accounts: {
        pool: poolSigner,
        state: stateSigner,
        mint: rewardMint.publicKey,
        vault: poolVault,
        authority: creatorKey,
        ...defaultAccounts
      },
      remainingAccounts: pools.map(p => ({
        pubkey: p.publicKey,
        isWritable: true,
        isSigner: false
      }))
    })
    pools = await program.account.farmPoolAccount.all()
    await program.rpc.closePool({
      accounts: {
        pool: poolSigner,
        state: stateSigner,
        authority: creatorKey,
        ...defaultAccounts
      },
      remainingAccounts: pools.map(p => ({
        pubkey: p.publicKey,
        isWritable: true,
        isSigner: false
      }))
    })
    pools = await program.account.farmPoolAccount.all()
    await program.rpc.createPool(poolBump, new BN('0'), new BN('0'), {
      accounts: {
        pool: poolSigner,
        state: stateSigner,
        mint: rewardMint.publicKey,
        vault: poolVault,
        authority: creatorKey,
        ...defaultAccounts
      },
      remainingAccounts: pools.map(p => ({
        pubkey: p.publicKey,
        isWritable: true,
        isSigner: false
      }))
    })
    let stateInfo = await program.account.stateAccount.fetch(stateSigner)
    let poolInfo = await program.account.farmPoolAccount.fetch(poolSigner)
    assert.ok(poolInfo.point.eq(stateInfo.totalPoint))
    assert.ok(poolInfo.point.eq(new BN('0')))
    assert.ok(poolInfo.amountMultipler.eq(new BN(0)))
  })
  it('Fund to program', async function () {
    // await rewardMint.mintTo(stateRewardVault, creatorKey, [provider.wallet], getNumber(10000).toString())
    const tx = program.transaction.fundRewardToken(new BN(10000), {
      accounts: {
        pool: poolSigner,
        state: stateSigner,
        rewardVault: stateRewardVault,
        userVault: master.rewardUserVault,
        authority: master.publicKey,
        ...defaultAccounts
      }
    })
    await master.provider.send(tx, [], {})
  })
  it('changePoolAmountMultipler', async function () {
    await program.rpc.changePoolAmountMultipler(new BN(1), {
      accounts: {
        pool: poolSigner,
        state: stateSigner,
        authority: creatorKey,
        ...defaultAccounts
      }
    })
    let poolInfo = await program.account.farmPoolAccount.fetch(poolSigner)
    assert.ok(poolInfo.amountMultipler.eq(new BN(1)))
  })
  it('changePoolPoint', async function () {
    let pools = await program.account.farmPoolAccount.all()
    await program.rpc.changePoolPoint(new BN(1000), {
      accounts: {
        pool: poolSigner,
        state: stateSigner,
        authority: creatorKey,
        ...defaultAccounts
      },
      remainingAccounts: pools.map(p => ({
        pubkey: p.publicKey,
        isWritable: true,
        isSigner: false
      }))
    })
    let stateInfo = await program.account.stateAccount.fetch(stateSigner)
    let poolInfo = await program.account.farmPoolAccount.fetch(poolSigner)
    assert.ok(poolInfo.point.eq(stateInfo.totalPoint))
    assert.ok(poolInfo.point.eq(new BN(1000)))
  })
  it('Create Pool LP', async function () {
    let pools = await program.account.farmPoolAccount.all()
    await wrapError(program.rpc.createPool(lpPoolBump, new BN('1000'), new BN('1000'), {
      accounts: {
        pool: lpPoolSigner,
        state: stateSigner,
        mint: lpMint.publicKey,
        vault: lpPoolVault,
        authority: creatorKey,
        ...defaultAccounts
      },
      remainingAccounts: pools.map(p => ({
        pubkey: p.publicKey,
        isWritable: true,
        isSigner: false
      }))
    }))
    let stateInfo = await program.account.stateAccount.fetch(stateSigner)
    let poolInfo = await program.account.farmPoolAccount.fetch(poolSigner)
    assert.ok(stateInfo.totalPoint.eq(new BN('2000')))
    assert.ok(poolInfo.point.eq(new BN('1000')))
    assert.ok(poolInfo.amountMultipler.eq(new BN(1)))
  })
  it('Create User', async function () {
    await Promise.all(users.map(u => wrapError(async () => {
      const tx = program.transaction.createUser(u.bump1, {
        accounts: {
          user: u.userAccount1,
          state: stateSigner,
          pool: poolSigner,
          authority: u.publicKey,
          ...defaultAccounts
        }
      })
      await u.provider.send(tx, [], { skipPreflight: true })
      const tx2 = program.transaction.createUser(u.lpBump, {
        accounts: {
          user: u.lpUserAccount,
          state: stateSigner,
          pool: lpPoolSigner,
          authority: u.publicKey,
          ...defaultAccounts
        }
      })
      await u.provider.send(tx2, [], { skipPreflight: true })
    })))
    console.log((await await program.account.farmPoolAccount.fetch(poolSigner)).totalUser.toString())
  })
  it('Change ether address', async function () {
    try {
      const u = users[0]
      // CREATE
      let tx = program.transaction.createUserEtherAddress(u.etherAddressBump, "0x60F1AAf4E9C9b79A225910eB7F525baf88bcf3A4", {
        accounts: {
          user: u.etherAddressAccount,
          state: stateSigner,
          authority: u.publicKey,
          ...defaultAccounts
        }
      })
      await u.provider.send(tx, [], { skipPreflight: true })

      let userInfo = await program.account.farmUserEtherAddress.fetch(u.etherAddressAccount)
      let etherAddress = new TextDecoder("utf-8").decode(new Uint8Array(userInfo.etherAddress));
      assert.ok(etherAddress === "0x60F1AAf4E9C9b79A225910eB7F525baf88bcf3A4", etherAddress)

      // UPDATE
      tx = program.transaction.setUserEtherAddress("0x7e1FbF37D52A677788B95f2e718998cA8fbe15fb", {
        accounts: {
          user: u.etherAddressAccount,
          state: stateSigner,
          authority: u.publicKey,
          ...defaultAccounts
        }
      })
      await u.provider.send(tx, [], { skipPreflight: true })

      userInfo = await program.account.farmUserEtherAddress.fetch(u.etherAddressAccount)
      etherAddress = new TextDecoder("utf-8").decode(new Uint8Array(userInfo.etherAddress));
      assert.ok(etherAddress === "0x7e1FbF37D52A677788B95f2e718998cA8fbe15fb", etherAddress)
    } catch (error) {
      console.error(error)
      throw error
    }
  })
  it('Stake invalid lock duration', async function () {
    await assertError(stake(user1, new BN(100), 4), 'Invalid Lock Duration')
  })
  it('Stake', async function () {
    await guardTime(2000, async () => {
      const [t1, t2, t3] = await Promise.all([
        stake(user1, new BN(100)),
        stake(user2, new BN(300)),
        stake(user3, new BN(600)),
      ])
      user1.lastHarvestTime1 = user2.lastHarvestTime1 = user3.lastHarvestTime1 = t1.blockTime
      const poolInfo = await program.account.farmPoolAccount.fetch(poolSigner)
      const poolVaultAmount = await getTokenAmount(poolVault)
      assert.ok(poolVaultAmount.eq(poolInfo.amount))
      assert.ok(new BN(1000).eq(poolInfo.amount))

      const userInfo = await program.account.farmPoolUserAccount.fetch(user1.userAccount1)
      assert.ok(new BN(t1.blockTime).eq(userInfo.lastStakeTime))
    })
  })
  it('StakeLP', async function () {
    const [t1, t2] = await Promise.all([
      stakeLP(userLP1, new BN(100)),
      stakeLP(userLP2, new BN(100)),
    ])
    userLP1.lpLastHarvestTime = userLP2.lpLastHarvestTime = t1.blockTime
  })
  it('Harvest', async function () {
    // 2s
    await guardTime(2000, async () => {
      const [t1] = await Promise.all([harvest(user1), harvest(user2), harvest(user3)])
      const diff = t1.blockTime - user1.lastHarvestTime1
      user1.lastHarvestTime1 = user2.lastHarvestTime1 = user3.lastHarvestTime1 = t1.blockTime
      await assertUserReward(user1, 1 * diff)
      await assertUserReward(user2, 100 + 3 * diff)
      await assertUserReward(user3, 6 * diff)
    })
  })
  it('Unstake over amount', async function () {
    await assertError(unstake(user1, new BN(200)), 'Over staked amount')
  })
  it('Unstake', async function () {
    // 4s
    let diff1 = 0
    await guardTime(2000, () => wrapError(async () => {
      const t = await unstake(user3, new BN(600));
      diff1 = t.blockTime - user3.lastHarvestTime1
      user3.lastHarvestTime1 = t.blockTime
      const poolInfo = await program.account.farmPoolAccount.fetch(poolSigner)
      const poolVaultAmount = await getTokenAmount(poolVault)
      assert.ok(poolVaultAmount.eq(poolInfo.amount))
      assert.ok(new BN(400).eq(poolInfo.amount))
      await assertUserReward(user3, user3.rewardAmount.add(new BN(600)))

      await harvest(user3)
      await assertUserReward(user3, user3.rewardAmount.add(new BN(diff1 * 6)))

      const userInfo = await program.account.farmPoolUserAccount.fetch(user3.userAccount1)
      assert.ok(new BN(t.blockTime).eq(userInfo.lastStakeTime))
    }))
    const [t1] = await Promise.all([harvest(user1), harvest(user2)])
    const totalDiff = t1.blockTime - user1.lastHarvestTime1
    const diff2 = totalDiff - diff1
    user1.lastHarvestTime1 = user2.lastHarvestTime1 = t1.blockTime
    await assertUserReward(user1, user1.rewardAmount.add(new BN(diff1 * 1)).add(new BN(diff2 * 2.5)))
    await assertUserReward(user2, user2.rewardAmount.add(new BN(diff1 * 3)).add(new BN(diff2 * 7.5)))
  })
  it('ChangeTokenPerSecond', async function () {
    const pools = await program.account.farmPoolAccount.all()
    const [t1] = await Promise.all([harvest(user1), harvest(user2), harvestLP(userLP1), harvestLP(userLP2), program.rpc.changeTokensPerSecond(new BN(40), {
      accounts: {
        state: stateSigner,
        authority: creatorKey,
        ...defaultAccounts
      },
      remainingAccounts: pools.map(p => ({
        pubkey: p.publicKey,
        isWritable: true,
        isSigner: false
      }))
    })])
    const diff = t1.blockTime - user1.lastHarvestTime1
    user1.lastHarvestTime1 = user2.lastHarvestTime1 = t1.blockTime
    await assertUserReward(user1, user1.rewardAmount.add(new BN(diff * 2.5)))
    await assertUserReward(user2, user2.rewardAmount.add(new BN(diff * 7.5)))

    userLP1.lpLastHarvestTime = userLP2.lpLastHarvestTime = t1.blockTime
    await assertUserReward(userLP1, 0, false)
    await assertUserReward(userLP2, 0, false)
  })
  it('Flow OK after change tokenPerSeconds', async function () {
    let diff1, diff2, diff3
    diff1 = diff2 = diff3 = 0
    const user1Rate = {
      rate1: 2.5 * 2,    // 
      rate2: 2 * 2,
      rate3: 5 * 2,
    }
    const user2Rate = {
      rate1: 7.5 * 2,
      rate2: 8 * 2,
      rate3: 5 * 2,
    }
    await guardTime(1000, async () => {
      const tx = await stake(user2, new BN(100))
      diff1 = tx.blockTime - user2.lastHarvestTime1
      await assertUserReward(user2, user2.rewardAmount.sub(new BN(100)))
    })
    await guardTime(1000, async () => {
      const tx = await unstake(user2, new BN(300))
      diff2 = tx.blockTime - user2.lastHarvestTime1 - diff1
      await assertUserReward(user2, user2.rewardAmount.add(new BN(300)))
    })
    const [tx1, tx2] = await Promise.all([harvest(user1), harvest(user2)])
    diff3 = tx1.blockTime - user2.lastHarvestTime1 - diff1 - diff2
    await assertUserReward(user1, user1.rewardAmount.add(new BN(diff1 * user1Rate.rate1)).add(new BN(diff2 * user1Rate.rate2)).add(new BN(diff3 * user1Rate.rate3)))
    await assertUserReward(user2, user2.rewardAmount.add(new BN(diff1 * user2Rate.rate1)).add(new BN(diff2 * user2Rate.rate2)).add(new BN(diff3 * user2Rate.rate3)))
  })
  it('Complex case', async function () {
    // tokenPerSeconds = 40

    // user1: .25, user2: .25, user4: .5
    const t1 = await stake(user4, new BN(200), 0)
    await sleep(2000)

    // user1: .1, user2: .1, user4: .8 + .4 (extra)
    const t2 = await stake(user4, new BN(600), 1)
    const reward1 = (t2.blockTime - t1.blockTime) * 20 * .5
    await sleep(2000)

    // user1: .25, user2: .25, user4: .5 + .25 (extra)
    const t3 = await unstake(user4, new BN(600))
    const reward2 = (t3.blockTime - t2.blockTime) * 20 * 1.2
    await sleep(2000)
    // user1: .1, user2: .1, user4: .8 + .8 (extra)
    const t4 = await stake(user4, new BN(600), 2)
    const reward3 = (t4.blockTime - t3.blockTime) * 20 * .75
    await sleep(2000)
    const t5 = await harvest(user4)
    const reward4 = (t5.blockTime - t4.blockTime) * 20 * 1.6

    await sleep(2000)
    const t6 = await harvest(user4)
    const reward5 = (t6.blockTime - t5.blockTime) * 20 * 1.6
    await assertUserReward(user4, reward1 + reward2 + reward3 + reward4 + reward5)
  })
  it('Check LP POOL', async function () {
    // set point POOL 1 to ZERO
    let pools = await program.account.farmPoolAccount.all()
    const changePoolPointTx = await program.transaction.changePoolPoint(new BN(0), {
      accounts: {
        pool: poolSigner,
        state: stateSigner,
        authority: creatorKey,
        ...defaultAccounts
      },
      remainingAccounts: pools.map(p => ({
        pubkey: p.publicKey,
        isWritable: true,
        isSigner: false
      }))
    })
    const tx = await provider.send(changePoolPointTx, [], { commitment: 'confirmed' })
    const tran1 = await cccc.getTransaction(tx)
    let stateInfo = await program.account.stateAccount.fetch(stateSigner)
    let poolInfo = await program.account.farmPoolAccount.fetch(poolSigner)
    assert.ok(stateInfo.totalPoint.eq(new BN(1000)))
    assert.ok(poolInfo.point.eq(new BN(0)))

    // POOL1 harvest
    await Promise.all([harvest(user1), harvest(user2)])
    await assertUserReward(user1, 0, false)
    await assertUserReward(user2, 0, false)

    await sleep(2000)
    const [txLP] = await Promise.all([harvestLP(userLP1), harvestLP(userLP2), harvest(user1), harvest(user2)])

    // users POOL 1 doens't change reward amount
    await assertUserReward(user1, user1.rewardAmount)
    await assertUserReward(user2, user2.rewardAmount)

    // users POOL 2 get valid amount
    await assertUserReward(userLP1, userLP1.rewardAmount.add(new BN(10 * (tran1.blockTime - userLP1.lpLastHarvestTime) + 20 * (txLP.blockTime - tran1.blockTime))))
    await assertUserReward(userLP2, userLP2.rewardAmount.add(new BN(10 * (tran1.blockTime - userLP2.lpLastHarvestTime) + 20 * (txLP.blockTime - tran1.blockTime))))
  })
})

async function guardTime (time, fn) {
  let completed = false
  let tooShort = false
  await Promise.all([fn().then(() => completed = true), sleep(time).then(() => tooShort = !completed)])
  if (tooShort) console.error('SHORT')
}

async function assertUserReward (user, amount, showthrow = true) {
  const realAmount = await getTokenAmount(user.rewardUserVault)
  user.rewardAmount = realAmount
  if (showthrow)
    assert.ok(new BN(amount.toString()).eq(realAmount), `Expected ${amount.toString()} but got ${realAmount.toString()}`)
}

async function unstake (u, amount) {
  const tx = program.transaction.unstake(amount, {
    accounts: {
      mint: rewardMint.publicKey,
      extraRewardAccount: extraRewardSigner,
      poolVault: poolVault,
      userVault: u.rewardUserVault,
      user: u.userAccount1,
      state: stateSigner,
      pool: poolSigner,
      authority: u.publicKey,
      ...defaultAccounts
    }
  });
  const hash = await u.provider.send(tx, [], { commitment: 'confirmed' });
  return await cccc.getTransaction(hash)
}

async function harvest (u) {
  const tx = program.transaction.harvest({
    accounts: {
      mint: rewardMint.publicKey,
      extraRewardAccount: extraRewardSigner,
      rewardVault: stateRewardVault,
      userVault: u.rewardUserVault,
      user: u.userAccount1,
      state: stateSigner,
      pool: poolSigner,
      authority: u.publicKey,
      ...defaultAccounts
    }
  });
  const hash = await u.provider.send(tx, [], { commitment: 'confirmed' });
  return await cccc.getTransaction(hash)
}

async function stake (user, amount, lock = 0) {
  const tx = program.transaction.stake(amount, new BN(lock), {
    accounts: {
      mint: rewardMint.publicKey,
      extraRewardAccount: extraRewardSigner,
      poolVault: poolVault,
      userVault: user.rewardUserVault,
      user: user.userAccount1,
      state: stateSigner,
      pool: poolSigner,
      authority: user.publicKey,
      ...defaultAccounts
    }
  });
  const hash = await user.provider.send(tx, [], { commitment: 'confirmed' });
  return await cccc.getTransaction(hash)
}

async function unstakeLP (u, amount) {
  const tx = program.transaction.unstake(amount, {
    accounts: {
      mint: lpMint.publicKey,
      extraRewardAccount: extraRewardSigner,
      poolVault: lpPoolVault,
      userVault: u.lpUserVault,
      user: u.lpUserAccount,
      state: stateSigner,
      pool: lpPoolSigner,
      authority: u.publicKey,
      ...defaultAccounts
    }
  });
  const hash = await u.provider.send(tx, [], { commitment: 'confirmed' });
  return await cccc.getTransaction(hash)
}

async function harvestLP (u) {
  const tx = program.transaction.harvest({
    accounts: {
      mint: lpMint.publicKey,
      rewardVault: stateRewardVault,
      extraRewardAccount: extraRewardSigner,
      userVault: u.rewardUserVault,
      user: u.lpUserAccount,
      state: stateSigner,
      pool: lpPoolSigner,
      authority: u.publicKey,
      ...defaultAccounts
    }
  });
  const hash = await u.provider.send(tx, [], { commitment: 'confirmed' });
  return await cccc.getTransaction(hash)
}

async function stakeLP (user, amount) {
  const tx = program.transaction.stake(amount, new BN(0), {
    accounts: {
      mint: lpMint.publicKey,
      poolVault: lpPoolVault,
      extraRewardAccount: extraRewardSigner,
      userVault: user.lpUserVault,
      user: user.lpUserAccount,
      state: stateSigner,
      pool: lpPoolSigner,
      authority: user.publicKey,
      ...defaultAccounts
    }
  });
  const hash = await user.provider.send(tx, [], { commitment: 'confirmed' });
  return await cccc.getTransaction(hash)
}

async function getTokenAccount (provider, addr) {
  return await serumCmn.getTokenAccount(provider, addr);
}

async function createMint (provider, authority, decimals = 9) {
  if (authority === undefined) {
    authority = provider.wallet.publicKey;
  }
  const mint = await Token.createMint(
    provider.connection,
    provider.wallet.payer,
    authority,
    null,
    decimals,
    TOKEN_PROGRAM_ID
  );
  return mint;
}

async function createTokenAccount (provider, mint, owner) {
  const token = new spl.Token(
    provider.connection,
    mint,
    TOKEN_PROGRAM_ID,
    provider.wallet.payer
  );
  let vault = await token.createAccount(owner);
  return vault;
}
function getNumber (num) {
  return new BN(num * 10 ** 9)
}
function getIdoAmount (amount) {
  return new BN(amount * 10 ** idoDecimals)
}
function getUsdcAmount (amount) {
  return new BN(amount * 10 ** tradeDecimals)
}
async function checkSolBalance (acc, fun) {
  const bf = await connection.getBalance(acc)
  try {
    await fun()
  } catch (error) {
    console.error(error)
    throw error
  } finally {
    const af = await connection.getBalance(acc)
    console.log({
      before: bf / 10 ** 9,
      after: af / 10 ** 9,
      diff: (af - bf) / 10 ** 9
    })
  }
}

function sleep (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getOrCreateAssociatedSPL (provider, mint) {
  const owner = provider.wallet.publicKey
  const ata = await Token.getAssociatedTokenAddress(ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, mint.publicKey, owner, true)
  try {
    await serumCmn.getTokenAccount(provider, ata)
  } catch (error) {
    const tx = new Transaction()
    tx.add(Token.createAssociatedTokenAccountInstruction(ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, mint.publicKey, ata, owner, owner))
    await provider.send(tx, [], {})
  }
  return ata
}

async function showAssociatedTokenAmount (provider, mint) {
  const add = await getOrCreateAssociatedSPL(provider, mint)
  return await getTokenAmount(provider, add)
}

async function getTokenAmount (account) {
  const { amount } = await serumCmn.getTokenAccount(provider, account)
  return amount
}

async function sleepTo (time) {
  const diff = time - Date.now() + 10000;
  console.log({ nowUnix, time, now: Date.now(), diff })
  if (diff > 0) await sleep(diff)
}