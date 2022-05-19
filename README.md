# Staking Tier Contract

This is Staking tiers smart contract project.

Users can stake their tokens by several rules (tiers).

Each tier has lock duration and extra rewards rate.
## How to install & run

npm i -g @project-serum/anchor-cli@0.16.2

yarn install

anchor build

anchor test

anchor deploy

## Project Structure

- programs

This contains smart contract codes. there is main logic of staking program

- tests

Unit tests are in this directory and it is tested by "anchor test"

- staking_scripts

This directory contains staking scripts to create & change settings, pool informations, reward rates etc.

You can set or change any staking configurations by using these scripts.

All configurations are defined in the CONFIG.js file.

You can use next commands to create global settings & pool for your token after you define configurations.

--devnet

yarn run staking:createState:dev

yarn run staking:createRewardConfig:dev

yarn run staking:createPool:dev

yarn run staking:fundReward:dev

--mainnet

yarn run staking:createState:main

yarn run staking:createRewardConfig:main

yarn run staking:createPool:main

yarn run staking:fundReward:main


## Functional Requirements

- Roles

Staking Admin : All control regarding the staking contract belongs to a staking admin.

A staking admin can create pool & reward tier configrations, change staking rate, set reward configurations and fund reward.

User: can stake tokens according to a provided tier plan.

- Features

Create pool

Create extra rewards configurations. Max tiers can be 10.

Change reward rate & reward configurations

Fund reward tokens

Stake tokens and harvest the rewards

## Use cases

Admin can set several reward configurations in the CONFIG.js.

and run this command to set it.

yarn run staking:setRewardConfig:main

## Detailed Information

This section contains detailed information about staking contract & scripts.

- create_state.js (interacting with create_state() function in the contract)

set STAKING_RATE in the CONFIG.js file to run this command.

command: yarn run staking:createState:main

this creates global state and set super owner of this program.

- create_reward_config.js (interacting with create_reward_config() function in the contract)

set REWARD_CONFIGS in the CONFIG.js file to run this command.

REWARD_CONFIGS can be array with max 10 items.

duration means lock duration for the tier.

extraPercentage means extra reward than general reward.

command: yarn run staking:createRewardConfig:main

this creates extra reward configuration account.

- create_pool.js (interacting with create_pool() function in the contract)

set REWARD_TOKEN_ID, POOL_POINT & POOL_AMOUNT_MULTIPLIER in the CONFIG.js file to run this command.

REWARD_TOKEN_ID should be the reward token mint address.

POOL_POINT means reward percentage of total for this pool.

POOL_AMOUNT_MULTIPLIER is amplifier of POOL_POINT.

command: yarn run staking:createPool:main

This creates one pool with given reward point.

- fund_reward.js (interacting with fund_reward() function in the contract)

set FUND_AMOUNT in the CONFIG.js file to run this command.

command: yarn run staking:fundReward:main

This funds reward token with given amount.

- change_staking_rate.js (interacting with change_staking_rate() function in the contract)

set STAKING_RATE in the CONFIG.js file to run this command.

command: yarn run staking:changeStakingRate:main

This changes staking reward rate in the global settings.

- set_reward_config.js (interacting with set_reward_config() function in the contract)

set REWARD_CONFIGS in the CONFIG.js file to run this command.

command: yarn run staking:setRewardConfig:main

This updates current extra reward configurations with given one.

- change_pool_point.js (interacting with change_pool_point() function in the contract)

set POOL_POINT in the CONFIG.js file to run this command.

command: yarn run staking:changePoolPoint:main

This updates current pool point with given one.

If you are using single pool for staking, the pool point is full point of rewards.

- change_pool_multipler.js (interacting with change_pool_multipler() function in the contract)

set POOL_AMOUNT_MULTIPLIER in the CONFIG.js file to run this command.

command: yarn run staking:changePoolMultipler:main

This updates current pool multipler with given one.

Except above functions, there are stake, unstake & harvest for users.



