const anchor = require('@project-serum/anchor');
const serumCmn = require("@project-serum/common");
const { TOKEN_PROGRAM_ID, Token, ASSOCIATED_TOKEN_PROGRAM_ID } = require("@solana/spl-token");
const _ = require('lodash')
const { BN, web3, Program, ProgramError, Provider } = anchor
const { PublicKey, SystemProgram, Keypair, Transaction } = web3
const assert = require("assert");
const utf8 = anchor.utils.bytes.utf8;
const provider = anchor.Provider.local()

const farmIdl = require('../target/idl/neonomad_staking.json');

const { expect } = require('chai');
const { Connection } = require('@solana/web3.js');

async function wrapError (fn) {
  try {
    if (typeof fn === 'function')
      await fn()
    else
      await fn
  } catch (error) {
    let translatedErr
    if (error instanceof ProgramError) {
      translatedErr = error
    } else {
      translatedErr = ProgramError.parse(error, parseIdlErrors(farmIdl))
    }
    if (translatedErr === null) {
      throw error
    } else {
      console.log(`ErrCode=${translatedErr.code} msg=${translatedErr.msg}`)
    }
    throw translatedErr
  }
}

async function wrapIdoError (fn) {
  try {
    if (typeof fn === 'function')
      await fn()
    else
      await fn
  } catch (error) {
    let translatedErr
    if (error instanceof ProgramError) {
      translatedErr = error
    } else {
      translatedErr = ProgramError.parse(error, parseIdlErrors(idoIdl))
    }
    if (translatedErr === null) {
      throw error
    }
    throw translatedErr
  }
}

async function assertError (fn, msg) {
  try {
    await wrapError(fn)
  } catch (error) {
    assert(error.msg === msg, `Expect ${msg} but got ${error.msg}`)
  }
}
async function assertIdoError (fn, msg) {
  try {
    await wrapIdoError(fn)
    throw new Error('Not ERROR')
  } catch (error) {
    assert(error.msg === msg, `Expect ${msg} but got ${error.msg}`)
  }
}

function parseIdlErrors (idl) {
  const errors = new Map();
  if (idl.errors) {
    idl.errors.forEach((e) => {
      let msg = e.msg ?? e.name;
      errors.set(e.code, msg);
    });
  }
  return errors;
}

module.exports = {
  assertError, wrapError, wrapIdoError,assertIdoError
}