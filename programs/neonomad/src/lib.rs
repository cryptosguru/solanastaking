use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};
use std::convert::TryFrom;
use std::convert::TryInto;
use std::mem::size_of;

declare_id!("GfXYYi5TFPG5ixdfiXLQacgjZbatqpb9uZZPMTBxMVCx");

const FULL_100: u64 = 100_000_000_000;
const ACC_PRECISION: u128 = 100_000_000_000;

#[program]
pub mod neonomad_staking {
    use super::*;

    pub fn create_state(
        _ctx: Context<CreateState>,
        bump: u8,
        token_per_second: u64,
    ) -> ProgramResult {
        let state = &mut _ctx.accounts.state.load_init()?;
        state.authority = _ctx.accounts.authority.key();
        state.bump = bump;
        state.start_time = _ctx.accounts.clock.unix_timestamp;
        state.token_per_second = token_per_second;
        state.reward_mint = _ctx.accounts.reward_mint.key();
        state.reward_vault = _ctx.accounts.reward_vault.key();
        Ok(())
    }

    pub fn create_extra_reward_configs(
        _ctx: Context<CreateExtraRewardsConfigs>,
        bump: u8,
        configs: Vec<DurationExtraRewardConfig>,
    ) -> ProgramResult {
        let extra_account = &mut _ctx.accounts.extra_reward_account;
        extra_account.authority = _ctx.accounts.authority.key();
        extra_account.bump = bump;
        extra_account.configs = configs;
        extra_account.validate()?;
        Ok(())
    }

    pub fn set_extra_reward_configs(
        _ctx: Context<SetExtraRewardsConfigs>,
        configs: Vec<DurationExtraRewardConfig>,
    ) -> ProgramResult {
        let extra_account = &mut _ctx.accounts.extra_reward_account;
        extra_account.configs = configs;
        extra_account.validate()?;
        Ok(())
    }

    pub fn fund_reward_token(_ctx: Context<Fund>, amount: u64) -> ProgramResult {
        msg!("funding...");
        let mut state = _ctx.accounts.state.load_mut()?;
        let mut pool = _ctx.accounts.pool.load_mut()?;
        msg!("loaded state, pool");
        let cpi_accounts = Transfer {
            from: _ctx.accounts.user_vault.to_account_info(),
            to: _ctx.accounts.reward_vault.to_account_info(),
            authority: _ctx.accounts.authority.to_account_info(),
        };
        let cpi_program = _ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, amount)?;
        msg!("funded {}", amount);

        state.total_point = state
            .total_point
            .checked_add(amount)
            .unwrap();
        pool.point = pool
            .point
            .checked_add(amount)
            .unwrap();
        pool.update(&state, &_ctx.accounts.clock)?;
        msg!("updated pool");
        Ok(())
    }

    pub fn change_tokens_per_second(
        _ctx: Context<ChangeTokensPerSecond>,
        token_per_second: u64,
    ) -> ProgramResult {
        let mut state = _ctx.accounts.state.load_mut()?;
        for pool_acc in _ctx.remaining_accounts.iter() {
            let loader = Loader::<FarmPoolAccount>::try_from(&_ctx.program_id, &pool_acc)?;
            loader.load_mut()?.update(&state, &_ctx.accounts.clock)?;
        }
        state.token_per_second = token_per_second;
        emit!(RateChanged { token_per_second });
        Ok(())
    }

    pub fn create_pool(
        _ctx: Context<CreateFarmPool>,
        bump: u8,
        point: u64,
        amount_multipler: u64,
    ) -> ProgramResult {
        let mut state = _ctx.accounts.state.load_mut()?;
        for pool_acc in _ctx.remaining_accounts.iter() {
            let loader = Loader::<FarmPoolAccount>::try_from(&_ctx.program_id, &pool_acc)?;
            loader.load_mut()?.update(&state, &_ctx.accounts.clock)?;
        }

        let pool = &mut _ctx.accounts.pool.load_init()?;
        pool.bump = bump;
        pool.mint = _ctx.accounts.mint.key();
        pool.vault = _ctx.accounts.vault.key();
        pool.point = point;
        pool.amount_multipler = amount_multipler;
        pool.authority = _ctx.accounts.authority.key();

        state.total_point = state.total_point.checked_add(point).unwrap();

        emit!(PoolCreated {
            pool: _ctx.accounts.pool.key(),
            mint: _ctx.accounts.mint.key()
        });
        Ok(())
    }

    pub fn close_pool(_ctx: Context<CloseFarmPool>) -> ProgramResult {
        let mut state = _ctx.accounts.state.load_mut()?;
        for pool_acc in _ctx.remaining_accounts.iter() {
            let loader = Loader::<FarmPoolAccount>::try_from(&_ctx.program_id, &pool_acc)?;
            loader.load_mut()?.update(&state, &_ctx.accounts.clock)?;
        }
        let pool = _ctx.accounts.pool.load()?;
        require!(pool.amount == 0, ErrorCode::WorkingPool);
        state.total_point = state.total_point.checked_sub(pool.point).unwrap();
        Ok(())
    }

    pub fn change_pool_amount_multipler(
        _ctx: Context<ChangePoolSetting>,
        amount_multipler: u64,
    ) -> ProgramResult {
        let mut pool = _ctx.accounts.pool.load_mut()?;
        pool.amount_multipler = amount_multipler;
        emit!(PoolAmountMultiplerChanged {
            pool: _ctx.accounts.pool.key(),
            amount_multipler
        });
        Ok(())
    }

    pub fn change_pool_point(_ctx: Context<ChangePoolSetting>, point: u64) -> ProgramResult {
        let mut state = _ctx.accounts.state.load_mut()?;
        for pool_acc in _ctx.remaining_accounts.iter() {
            let loader = Loader::<FarmPoolAccount>::try_from(&_ctx.program_id, &pool_acc)?;
            loader.load_mut()?.update(&state, &_ctx.accounts.clock)?;
        }
        let mut pool = _ctx.accounts.pool.load_mut()?;
        state.total_point = state
            .total_point
            .checked_sub(pool.point)
            .unwrap()
            .checked_add(point)
            .unwrap();
        pool.point = point;
        emit!(PoolPointChanged {
            pool: _ctx.accounts.pool.key(),
            point
        });
        Ok(())
    }

    pub fn create_user(_ctx: Context<CreatePoolUser>, bump: u8) -> ProgramResult {
        let user = &mut _ctx.accounts.user.load_init()?;
        user.authority = _ctx.accounts.authority.key();
        user.bump = bump;
        user.pool = _ctx.accounts.pool.key();

        let mut pool = _ctx.accounts.pool.load_mut()?;
        pool.total_user += 1;
        emit!(UserCreated {
            pool: _ctx.accounts.pool.key(),
            user: _ctx.accounts.user.key(),
            authority: _ctx.accounts.authority.key(),
        });
        Ok(())
    }

    pub fn create_user_ether_address(
        _ctx: Context<CreateUserEtherAddress>,
        bump: u8,
        ether_address: String,
    ) -> ProgramResult {
        let user = &mut _ctx.accounts.user.load_init()?;
        let src = ether_address.as_bytes();
        let mut data = [0u8; 42];
        data[..src.len()].copy_from_slice(src);
        user.ether_address = data;
        user.bump = bump;
        user.authority = _ctx.accounts.authority.key();
        emit!(UserEtherAddressChanged {
            authority: _ctx.accounts.authority.key(),
            ether_address
        });
        Ok(())
    }

    pub fn set_user_ether_address(
        _ctx: Context<SetUserEtherAddress>,
        ether_address: String,
    ) -> ProgramResult {
        let mut user = _ctx.accounts.user.load_mut()?;
        let src = ether_address.as_bytes();
        let mut data = [0u8; 42];
        data[..src.len()].copy_from_slice(src);
        user.ether_address = data;
        emit!(UserEtherAddressChanged {
            authority: _ctx.accounts.authority.key(),
            ether_address
        });
        Ok(())
    }

    pub fn stake(_ctx: Context<Stake>, amount: u64, lock_duration: i64) -> ProgramResult {
        msg!("staking...");
        let state = _ctx.accounts.state.load()?;
        let extra_account = &mut _ctx.accounts.extra_reward_account;
        let mut user = _ctx.accounts.user.load_mut()?;
        let mut pool = _ctx.accounts.pool.load_mut()?;
        msg!("loaded states");
        extra_account.validate_lock_duration(&lock_duration)?;
        msg!("passed validate_lock_duration");
        require!(
            lock_duration >= user.lock_duration,
            ErrorCode::InvalidLockDuration
        );
        msg!("passed lock_duration >= user.lock_duration");

        pool.update(&state, &_ctx.accounts.clock)?;
        msg!("updated state");
        let user_lock_duration = user.lock_duration;
        user.calculate_reward_amount(&pool, &extra_account.get_extra_reward_percentage(&user_lock_duration))?;
        msg!("calculate_reward_amount");
        user.amount = user.amount.checked_add(amount).unwrap();
        pool.amount = pool.amount.checked_add(amount).unwrap();

        user.lock_duration = lock_duration;
        user.calculate_reward_debt(&pool)?;
        user.last_stake_time = _ctx.accounts.clock.unix_timestamp;
        msg!("calculate_reward_debt");
        let cpi_accounts = Transfer {
            from: _ctx.accounts.user_vault.to_account_info(),
            to: _ctx.accounts.pool_vault.to_account_info(),
            authority: _ctx.accounts.authority.to_account_info(),
        };
        let cpi_program = _ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, amount)?;
        msg!("staked {}", amount);
        emit!(UserStaked {
            pool: _ctx.accounts.pool.key(),
            user: _ctx.accounts.user.key(),
            authority: _ctx.accounts.authority.key(),
            amount,
            lock_duration
        });
        Ok(())
    }

    pub fn unstake(_ctx: Context<Stake>, amount: u64) -> ProgramResult {
        let extra_account = &mut _ctx.accounts.extra_reward_account;
        let state = _ctx.accounts.state.load()?;
        let mut user = _ctx.accounts.user.load_mut()?;
        let mut pool = _ctx.accounts.pool.load_mut()?;

        require!(user.amount >= amount, ErrorCode::UnstakeOverAmount);
        require!(
            user.last_stake_time
                .checked_add(user.lock_duration)
                .unwrap()
                <= _ctx.accounts.clock.unix_timestamp,
            ErrorCode::UnderLocked
        );

        pool.update(&state, &_ctx.accounts.clock)?;
        let user_lock_duration = user.lock_duration;
        user.calculate_reward_amount(&pool, &extra_account.get_extra_reward_percentage(&user_lock_duration))?;

        user.last_stake_time = _ctx.accounts.clock.unix_timestamp;
        user.amount = user.amount.checked_sub(amount).unwrap();
        pool.amount = pool.amount.checked_sub(amount).unwrap();

        if user.amount == 0
        {
            user.lock_duration = 0;
        }

        user.calculate_reward_debt(&pool)?;
        drop(pool);

        let new_pool = _ctx.accounts.pool.load()?;
        let cpi_accounts = Transfer {
            from: _ctx.accounts.pool_vault.to_account_info(),
            to: _ctx.accounts.user_vault.to_account_info(),
            authority: _ctx.accounts.pool.to_account_info(),
        };

        let seeds = &[new_pool.mint.as_ref(), &[new_pool.bump]];
        let signer = &[&seeds[..]];
        let cpi_program = _ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::transfer(cpi_ctx, amount)?;
        emit!(UserUnstaked {
            pool: _ctx.accounts.pool.key(),
            user: _ctx.accounts.user.key(),
            authority: _ctx.accounts.authority.key(),
            amount
        });
        Ok(())
    }

    pub fn harvest(_ctx: Context<Harvest>) -> ProgramResult {
        let extra_account = &mut _ctx.accounts.extra_reward_account;
        let state = _ctx.accounts.state.load()?;
        let mut pool = _ctx.accounts.pool.load_mut()?;
        let mut user = _ctx.accounts.user.load_mut()?;

        pool.update(&state, &_ctx.accounts.clock)?;
        let user_lock_duration = user.lock_duration;
        user.calculate_reward_amount(&pool, &extra_account.get_extra_reward_percentage(&user_lock_duration))?;

        let total_reward = user.reward_amount.checked_add(user.extra_reward).unwrap().try_into().unwrap();

        let cpi_accounts = Transfer {
            from: _ctx.accounts.reward_vault.to_account_info(),
            to: _ctx.accounts.user_vault.to_account_info(),
            authority: _ctx.accounts.state.to_account_info(),
        };

        let seeds = &[b"state".as_ref(), &[state.bump]];
        let signer = &[&seeds[..]];
        let cpi_program = _ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::transfer(cpi_ctx, total_reward)?;

        user.reward_amount = 0;
        user.extra_reward = 0;
        user.calculate_reward_debt(&pool)?;
        emit!(UserHarvested {
            pool: _ctx.accounts.pool.key(),
            user: _ctx.accounts.user.key(),
            authority: _ctx.accounts.authority.key(),
            amount: total_reward
        });
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(bump: u8)]
pub struct CreateState<'info> {
    #[account(
        init,
        seeds = [b"state".as_ref()],
        bump = bump,
        payer = authority,
        space = 8 + size_of::<StateAccount>()
    )]
    pub state: Loader<'info, StateAccount>,
    #[account(constraint = reward_vault.owner == state.key())]
    pub reward_vault: Account<'info, TokenAccount>,
    pub reward_mint: Box<Account<'info, Mint>>,
    pub authority: Signer<'info>,
    pub system_program: UncheckedAccount<'info>,
    #[account(constraint = token_program.key == &token::ID)]
    pub token_program: Program<'info, Token>,
    pub clock: Sysvar<'info, Clock>,
}

#[derive(Accounts)]
pub struct Fund<'info> {
    #[account(mut, seeds = [pool.load()?.mint.key().as_ref()], bump = pool.load()?.bump)]
    pub pool: Loader<'info, FarmPoolAccount>,
    #[account(mut, seeds = [b"state".as_ref()], bump = state.load()?.bump)]
    pub state: Loader<'info, StateAccount>,
    pub authority: Signer<'info>,
    #[account(mut, constraint = reward_vault.owner == state.key())]
    pub reward_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, constraint = user_vault.owner == authority.key())]
    pub user_vault: Box<Account<'info, TokenAccount>>,
    #[account(constraint = token_program.key == &token::ID)]
    pub token_program: Program<'info, Token>,
    pub clock: Sysvar<'info, Clock>,
} 

#[derive(Accounts)]
pub struct ChangeTokensPerSecond<'info> {
    #[account(mut, seeds = [b"state".as_ref()], bump = state.load()?.bump, has_one = authority)]
    pub state: Loader<'info, StateAccount>,
    pub authority: Signer<'info>,
    pub clock: Sysvar<'info, Clock>,
}

#[derive(Accounts)]
#[instruction(bump: u8)]
pub struct CreateFarmPool<'info> {
    #[account(
        init,
        seeds = [mint.key().as_ref()],
        bump = bump,
        payer = authority,
        space = 8 + size_of::<FarmPoolAccount>()
    )]
    pub pool: Loader<'info, FarmPoolAccount>,
    #[account(mut, seeds = [b"state".as_ref()], bump = state.load()?.bump, has_one = authority)]
    pub state: Loader<'info, StateAccount>,
    pub mint: Box<Account<'info, Mint>>,
    #[account(constraint = vault.owner == pool.key())]
    pub vault: Account<'info, TokenAccount>,
    pub authority: Signer<'info>,
    pub system_program: UncheckedAccount<'info>,
    #[account(constraint = token_program.key == &token::ID)]
    pub token_program: Program<'info, Token>,
    pub clock: Sysvar<'info, Clock>,
}

#[derive(Accounts)]
pub struct CloseFarmPool<'info> {
    #[account(mut, seeds = [b"state".as_ref()], bump = state.load()?.bump, has_one = authority)]
    pub state: Loader<'info, StateAccount>,
    #[account(mut, seeds = [pool.load()?.mint.key().as_ref()], bump = pool.load()?.bump, has_one = authority, close = authority)]
    pub pool: Loader<'info, FarmPoolAccount>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: UncheckedAccount<'info>,
    pub clock: Sysvar<'info, Clock>,
}

#[derive(Accounts)]
pub struct ChangePoolSetting<'info> {
    #[account(mut, seeds = [b"state".as_ref()], bump = state.load()?.bump)]
    pub state: Loader<'info, StateAccount>,
    #[account(mut, seeds = [pool.load()?.mint.key().as_ref()], bump = pool.load()?.bump, has_one = authority)]
    pub pool: Loader<'info, FarmPoolAccount>,
    pub authority: Signer<'info>,
    pub clock: Sysvar<'info, Clock>,
}

#[derive(Accounts)]
#[instruction(bump: u8)]
pub struct CreateExtraRewardsConfigs<'info> {
    #[account(init, seeds = [b"extra".as_ref()], bump = bump, payer = authority, space = 8 + 197)]
    pub extra_reward_account: Box<Account<'info, ExtraRewardsAccount>>,
    pub authority: Signer<'info>,
    pub system_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct SetExtraRewardsConfigs<'info> {
    #[account(mut, seeds = [b"extra".as_ref()], bump = extra_reward_account.bump, has_one = authority)]
    pub extra_reward_account: Box<Account<'info, ExtraRewardsAccount>>,
    pub authority: Signer<'info>,
    pub system_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
#[instruction(bump: u8)]
pub struct CreatePoolUser<'info> {
    #[account(
        init,
        seeds = [pool.key().as_ref(), authority.key().as_ref()],
        bump = bump,
        payer = authority,
        space = 8 + size_of::<FarmPoolUserAccount>()
    )]
    pub user: Loader<'info, FarmPoolUserAccount>,
    #[account(seeds = [b"state".as_ref()], bump = state.load()?.bump)]
    pub state: Loader<'info, StateAccount>,
    #[account(mut, seeds = [pool.load()?.mint.key().as_ref()], bump = pool.load()?.bump)]
    pub pool: Loader<'info, FarmPoolAccount>,
    pub authority: Signer<'info>,
    pub system_program: UncheckedAccount<'info>,
    #[account(constraint = token_program.key == &token::ID)]
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(bump: u8)]
pub struct CreateUserEtherAddress<'info> {
    #[account(
        init,
        seeds = [b"ether".as_ref(), authority.key().as_ref()],
        bump = bump,
        payer = authority,
        space = 8 + size_of::<FarmUserEtherAddress>()
    )]
    pub user: Loader<'info, FarmUserEtherAddress>,
    pub authority: Signer<'info>,
    pub system_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct SetUserEtherAddress<'info> {
    #[account(mut, seeds = [b"ether".as_ref(), authority.key().as_ref()], bump = user.load()?.bump, has_one = authority)]
    pub user: Loader<'info, FarmUserEtherAddress>,
    pub authority: Signer<'info>,
    pub system_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct Stake<'info> {
    #[account(mut, seeds = [pool.key().as_ref(), authority.key().as_ref()], bump = user.load()?.bump, has_one = pool, has_one = authority)]
    pub user: Loader<'info, FarmPoolUserAccount>,
    #[account(mut, seeds = [b"state".as_ref()], bump = state.load()?.bump)]
    pub state: Loader<'info, StateAccount>,
    #[account(seeds = [b"extra".as_ref()], bump = extra_reward_account.bump)]
    pub extra_reward_account: Box<Account<'info, ExtraRewardsAccount>>,
    #[account(mut, seeds = [pool.load()?.mint.key().as_ref()], bump = pool.load()?.bump)]
    pub pool: Loader<'info, FarmPoolAccount>,
    pub authority: Signer<'info>,
    #[account(constraint = mint.key() == pool.load()?.mint)]
    pub mint: Box<Account<'info, Mint>>,
    #[account(mut, constraint = pool_vault.owner == pool.key())]
    pub pool_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, constraint = user_vault.owner == authority.key())]
    pub user_vault: Box<Account<'info, TokenAccount>>,
    pub system_program: UncheckedAccount<'info>,
    #[account(constraint = token_program.key == &token::ID)]
    pub token_program: Program<'info, Token>,
    pub clock: Sysvar<'info, Clock>,
}

#[derive(Accounts)]
pub struct Harvest<'info> {
    #[account(mut, seeds = [pool.key().as_ref(), authority.key().as_ref()], bump = user.load()?.bump, has_one = pool, has_one = authority)]
    pub user: Loader<'info, FarmPoolUserAccount>,
    #[account(mut, seeds = [b"state".as_ref()], bump = state.load()?.bump)]
    pub state: Loader<'info, StateAccount>,
    #[account(seeds = [b"extra".as_ref()], bump = extra_reward_account.bump)]
    pub extra_reward_account: Box<Account<'info, ExtraRewardsAccount>>,
    #[account(mut, seeds = [pool.load()?.mint.key().as_ref()], bump = pool.load()?.bump)]
    pub pool: Loader<'info, FarmPoolAccount>,
    pub authority: Signer<'info>,
    #[account(constraint = mint.key() == pool.load()?.mint)]
    pub mint: Box<Account<'info, Mint>>,
    #[account(mut, constraint = reward_vault.owner == state.key())]
    pub reward_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, constraint = user_vault.owner == authority.key())]
    pub user_vault: Box<Account<'info, TokenAccount>>,
    pub system_program: UncheckedAccount<'info>,
    #[account(constraint = token_program.key == &token::ID)]
    pub token_program: Program<'info, Token>,
    pub clock: Sysvar<'info, Clock>,
}

#[account(zero_copy)]
pub struct StateAccount {
    pub authority: Pubkey,
    pub reward_mint: Pubkey,
    pub reward_vault: Pubkey,
    pub bump: u8,
    pub total_point: u64,
    pub start_time: i64,
    pub token_per_second: u64,
}

#[account]
pub struct ExtraRewardsAccount {
    pub bump: u8,
    pub authority: Pubkey,
    pub configs: Vec<DurationExtraRewardConfig>,
} // 37 + 10 * 16

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default, Copy)]
pub struct DurationExtraRewardConfig {
    duration: i64,
    extra_percentage: u64, // decimals 9, MAX = 100_000_000_000
}

impl ExtraRewardsAccount {
    fn validate<'info>(&mut self) -> Result<()> {
        if self.configs.len() > 1 {
            let mut duration = 0;
            let mut extra_percentage = 0;
            for config in self.configs.iter() {
                require!(config.duration >= duration, ErrorCode::InvalidSEQ);
                require!(
                    config.extra_percentage >= extra_percentage,
                    ErrorCode::InvalidSEQ
                );
                duration = config.duration;
                extra_percentage = config.extra_percentage;
            }
        }
        Ok(())
    }
    fn validate_lock_duration<'info>(&mut self, lock_duration: &i64) -> Result<()> {
        for config in self.configs.iter() {
            if config.duration == *lock_duration {
                return Ok(())
            }
        }
        Err(ErrorCode::InvalidLockDuration.into())
    }
    fn get_extra_reward_percentage<'info>(&mut self, lock_duration: &i64) -> u64 {
        let reversed_configs: Vec<DurationExtraRewardConfig> =
            self.configs.iter().rev().cloned().collect();
        for tier in reversed_configs.iter() {
            if *lock_duration >= tier.duration {
                return tier.extra_percentage;
            }
        }
        return 0;
    }
}

#[account(zero_copy)]
pub struct FarmPoolAccount {
    pub bump: u8,
    pub authority: Pubkey,
    pub amount: u64,
    pub mint: Pubkey,
    pub vault: Pubkey,
    pub point: u64,
    pub last_reward_time: i64,
    pub acc_reward_per_share: u128,
    pub amount_multipler: u64,
    pub total_user: u64,
}

impl FarmPoolAccount {
    fn update<'info>(&mut self, state: &StateAccount, clock: &Sysvar<'info, Clock>) -> Result<()> {
        let seconds = u128::try_from(
            clock
                .unix_timestamp
                .checked_sub(self.last_reward_time)
                .unwrap(),
        )
        .unwrap();
        let mut reward_per_share: u128 = 0;
        if self.amount > 0 && seconds > 0 && self.point > 0 {
            reward_per_share = u128::from(state.token_per_second)
                .checked_mul(seconds)
                .unwrap()
                .checked_mul(u128::from(self.point))
                .unwrap()
                .checked_mul(ACC_PRECISION)
                .unwrap()
                .checked_div(u128::from(state.total_point))
                .unwrap()
                .checked_div(u128::from(self.amount))
                .unwrap();
        }
        self.acc_reward_per_share = self
            .acc_reward_per_share
            .checked_add(reward_per_share)
            .unwrap();
        self.last_reward_time = clock.unix_timestamp;

        Ok(())
    }
}

#[account(zero_copy)]
pub struct FarmPoolUserAccount {
    pub bump: u8,
    pub pool: Pubkey,
    pub authority: Pubkey,
    pub amount: u64,
    pub reward_amount: u128,
    pub extra_reward: u128, // extra from lock duration; ex lock 12M => +10%
    pub reward_debt: u128,
    pub last_stake_time: i64,
    pub lock_duration: i64,
    pub reserved_1: u128,
    pub reserved_2: u128,
    pub reserved_3: u128,
}

#[account(zero_copy)]
pub struct FarmUserEtherAddress {
    pub bump: u8,
    pub authority: Pubkey,
    pub ether_address: [u8; 42],
}

impl FarmPoolUserAccount {
    fn calculate_reward_amount<'info>(
        &mut self,
        pool: &FarmPoolAccount,
        extra_percentage: &u64,
    ) -> Result<()> {
        let pending_amount: u128 = u128::from(self.amount)
            .checked_mul(pool.acc_reward_per_share)
            .unwrap()
            .checked_div(ACC_PRECISION)
            .unwrap()
            .checked_sub(u128::from(self.reward_debt))
            .unwrap();
        self.reward_amount = self.reward_amount.checked_add(pending_amount).unwrap();
        let extra_amount: u128 = u128::from(pending_amount)
            .checked_mul(u128::from(*extra_percentage))
            .unwrap()
            .checked_div(u128::from(FULL_100))
            .unwrap();
        self.extra_reward = self.extra_reward.checked_add(extra_amount).unwrap();
        Ok(())
    }
    fn calculate_reward_debt<'info>(&mut self, pool: &FarmPoolAccount) -> Result<()> {

        // msg!("amount {}", self.amount);
        // msg!("acc_per_share {}", pool.acc_reward_per_share);
        // msg!("multiplied {}", u128::from(self.amount).checked_mul(pool.acc_reward_per_share).unwrap());
        // msg!("scaled {}", u128::from(self.amount).checked_mul(pool.acc_reward_per_share).unwrap().checked_div(ACC_PRECISION).unwrap());

        self.reward_debt = u128::from(self.amount)
            .checked_mul(pool.acc_reward_per_share)
            .unwrap()
            .checked_div(ACC_PRECISION)
            .unwrap();
        Ok(())
    }
}

#[error]
pub enum ErrorCode {
    #[msg("Over staked amount")]
    UnstakeOverAmount,
    #[msg("Under locked")]
    UnderLocked,
    #[msg("Pool is working")]
    WorkingPool,
    #[msg("Invalid Lock Duration")]
    InvalidLockDuration,
    #[msg("Invalid SEQ")]
    InvalidSEQ,
}
#[event]
pub struct RateChanged {
    token_per_second: u64,
}
#[event]
pub struct PoolCreated {
    pool: Pubkey,
    mint: Pubkey,
}
#[event]
pub struct PoolLockDurationChanged {
    pool: Pubkey,
    lock_duration: i64,
}
#[event]
pub struct PoolAmountMultiplerChanged {
    pool: Pubkey,
    amount_multipler: u64,
}
#[event]
pub struct PoolPointChanged {
    pool: Pubkey,
    point: u64,
}
#[event]
pub struct UserCreated {
    pool: Pubkey,
    user: Pubkey,
    authority: Pubkey,
}
#[event]
pub struct UserEtherAddressChanged {
    authority: Pubkey,
    ether_address: String,
}
#[event]
pub struct UserStaked {
    pool: Pubkey,
    user: Pubkey,
    authority: Pubkey,
    amount: u64,
    lock_duration: i64,
}
#[event]
pub struct UserUnstaked {
    pool: Pubkey,
    user: Pubkey,
    authority: Pubkey,
    amount: u64,
}
#[event]
pub struct UserHarvested {
    pool: Pubkey,
    user: Pubkey,
    authority: Pubkey,
    amount: u64,
}
