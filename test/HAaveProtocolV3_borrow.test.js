const chainId = network.config.chainId;

if (
  chainId == 1 ||
  chainId == 10 ||
  chainId == 137 ||
  // chainId == 1088 ||
  chainId == 42161 ||
  chainId == 43114
) {
  // This test supports to run on these chains.
} else {
  return;
}

const { balance, ether, expectRevert } = require('@openzeppelin/test-helpers');
const { tracker } = balance;
const abi = require('ethereumjs-abi');
const utils = web3.utils;

const { expect } = require('chai');

const {
  DAI_TOKEN,
  USDC_TOKEN,
  WETH_TOKEN,
  COMP_TOKEN,
  ADAI_V3_TOKEN,
  WRAPPED_NATIVE_TOKEN,
  AAVEPROTOCOL_V3_PROVIDER,
  AWRAPPED_NATIVE_V3_DEBT_VARIABLE,
  ADAI_V3_DEBT_VARIABLE,
  AUSDC_V3_DEBT_STABLE,
  AUSDC_V3_DEBT_VARIABLE,
  AAVE_RATEMODE,
} = require('./utils/constants');
const {
  evmRevert,
  evmSnapshot,
  profileGas,
  getBalanceSlotNum,
  setTokenBalance,
  expectEqWithinBps,
  mwei,
} = require('./utils/utils');

const HAaveV3 = artifacts.require('HAaveProtocolV3');
const FeeRuleRegistry = artifacts.require('FeeRuleRegistry');
const Registry = artifacts.require('Registry');
const Proxy = artifacts.require('ProxyMock');
const IToken = artifacts.require('IERC20');
const IAToken = artifacts.require('IATokenV3');
const IPool = artifacts.require('contracts/handlers/aaveV3/IPool.sol:IPool');
const IProvider = artifacts.require('IPoolAddressesProvider');
const SimpleToken = artifacts.require('SimpleToken');
const IStableDebtToken = artifacts.require('IStableDebtToken');
const IVariableDebtToken = artifacts.require('IVariableDebtTokenV3');

contract('Aave V3', function ([_, user, someone]) {
  const aTokenAddress = ADAI_V3_TOKEN;
  const tokenAddress = DAI_TOKEN;
  const tokenSymbol = 'DAI';

  let id;
  let balanceUser;
  let balanceProxy;

  before(async function () {
    this.feeRuleRegistry = await FeeRuleRegistry.new('0', _);
    this.registry = await Registry.new();
    this.proxy = await Proxy.new(
      this.registry.address,
      this.feeRuleRegistry.address
    );
    this.hAaveV3 = await HAaveV3.new(
      WRAPPED_NATIVE_TOKEN,
      AAVEPROTOCOL_V3_PROVIDER
    );
    await this.registry.register(
      this.hAaveV3.address,
      utils.asciiToHex('AaveProtocolV3')
    );
    this.provider = await IProvider.at(AAVEPROTOCOL_V3_PROVIDER);
    this.poolAddress = await this.provider.getPool();
    this.pool = await IPool.at(this.poolAddress);
    this.token = await IToken.at(tokenAddress);
    this.aToken = await IAToken.at(aTokenAddress);
    this.mockToken = await SimpleToken.new();
  });

  beforeEach(async function () {
    id = await evmSnapshot();
    balanceUser = await tracker(user);
    balanceProxy = await tracker(this.proxy.address);
  });

  afterEach(async function () {
    await evmRevert(id);
  });

  describe('Borrow with Stable Rate', function () {
    if (
      chainId == 1 ||
      chainId == 10 ||
      chainId == 137 ||
      chainId == 1088 ||
      chainId == 42161 ||
      chainId == 43114
    ) {
      // Ethereum and Metis does not support borrow in stable mode
      // Optimism, Polygon, Arbitrum, Avalaunche disable stable mode in 2023/11
      return;
    }

    const supplyAmount = ether('5000');
    const borrowTokenAddr = USDC_TOKEN;
    const rateMode = AAVE_RATEMODE.STABLE;
    const debtTokenAddr = AUSDC_V3_DEBT_STABLE;

    let borrowTokenUserBefore;
    let debtTokenUserBefore;

    before(async function () {
      this.borrowToken = await IToken.at(borrowTokenAddr);
      this.debtToken = await IStableDebtToken.at(debtTokenAddr);
    });

    beforeEach(async function () {
      // Supply
      await sendToken(tokenSymbol, this.token, user, supplyAmount);
      await this.token.approve(this.pool.address, supplyAmount, {
        from: user,
      });
      expect(await this.aToken.balanceOf(user)).to.be.bignumber.zero;
      await this.pool.supply(this.token.address, supplyAmount, user, 0, {
        from: user,
      });
      expectEqWithinBps(await this.aToken.balanceOf(user), supplyAmount, 1);

      borrowTokenUserBefore = await this.borrowToken.balanceOf(user);
      debtTokenUserBefore = await this.debtToken.balanceOf(user);
    });

    it('borrow token', async function () {
      const borrowAmount = mwei('1');
      const to = this.hAaveV3.address;
      const data = abi.simpleEncode(
        'borrow(address,uint256,uint256)',
        this.borrowToken.address,
        borrowAmount,
        rateMode
      );

      await this.debtToken.approveDelegation(this.proxy.address, borrowAmount, {
        from: user,
      });
      await balanceUser.get();
      const receipt = await this.proxy.execMock(to, data, {
        from: user,
        value: ether('0.1'),
      });

      const borrowTokenUserAfter = await this.borrowToken.balanceOf(user);
      const debtTokenUserAfter = await this.debtToken.balanceOf(user);
      // Verify proxy balance
      expect(await balanceProxy.get()).to.be.bignumber.zero;
      expect(
        await this.borrowToken.balanceOf(this.proxy.address)
      ).to.be.bignumber.zero;
      expect(
        await this.debtToken.balanceOf(this.proxy.address)
      ).to.be.bignumber.zero;

      // Verify user balance
      expect(
        borrowTokenUserAfter.sub(borrowTokenUserBefore)
      ).to.be.bignumber.eq(borrowAmount);
      expectEqWithinBps(
        debtTokenUserAfter.sub(debtTokenUserBefore),
        borrowAmount,
        1
      );
      profileGas(receipt);
    });

    it('should revert: borrow token over the collateral value', async function () {
      const borrowAmount = mwei('6000');
      const to = this.hAaveV3.address;
      const data = abi.simpleEncode(
        'borrow(address,uint256,uint256)',
        this.borrowToken.address,
        borrowAmount,
        rateMode
      );

      await this.debtToken.approveDelegation(this.proxy.address, borrowAmount, {
        from: user,
      });

      await expectRevert(
        this.proxy.execMock(to, data, { from: user, value: ether('0.1') }),
        'HAaveProtocolV3_borrow: 36' // AAVEV3 Error Code: COLLATERAL_CANNOT_COVER_NEW_BORROW
      );
    });

    it('should revert: borrow token without approveDelegation', async function () {
      const borrowAmount = mwei('2');
      const to = this.hAaveV3.address;
      const data = abi.simpleEncode(
        'borrow(address,uint256,uint256)',
        this.borrowToken.address,
        borrowAmount,
        rateMode
      );

      await expectRevert(
        this.proxy.execMock(to, data, { from: user }),
        'HAaveProtocolV3_borrow: Unspecified' // decreaseBorrowAllowance Failed
      );
    });

    it('should revert: borrow token approveDelegation < borrow amount', async function () {
      const borrowAmount = mwei('2');
      const to = this.hAaveV3.address;
      const data = abi.simpleEncode(
        'borrow(address,uint256,uint256)',
        this.borrowToken.address,
        borrowAmount,
        rateMode
      );

      await this.debtToken.approveDelegation(
        this.proxy.address,
        borrowAmount.sub(mwei('1')),
        {
          from: user,
        }
      );

      await expectRevert(
        this.proxy.execMock(to, data, { from: user }),
        'HAaveProtocolV3_borrow: Unspecified' // decreaseBorrowAllowance Failed
      );
    });

    it('should revert: borrow token that is not in aaveV3 pool', async function () {
      const borrowAmount = ether('2');
      const to = this.hAaveV3.address;
      const data = abi.simpleEncode(
        'borrow(address,uint256,uint256)',
        COMP_TOKEN,
        borrowAmount,
        rateMode
      );

      await expectRevert(
        this.proxy.execMock(to, data, { from: user }),
        'HAaveProtocolV3_borrow: Unspecified'
      );
    });

    it('should revert: borrow token that is not enable stable mode', async function () {
      const borrowAmount = ether('1');
      const to = this.hAaveV3.address;
      const data = abi.simpleEncode(
        'borrow(address,uint256,uint256)',
        WETH_TOKEN,
        borrowAmount,
        rateMode
      );

      await expectRevert(
        this.proxy.execMock(to, data, { from: user }),
        'HAaveProtocolV3_borrow: 31' // AAVEV3 Error Code: STABLE_BORROWING_NOT_ENABLED
      );
    });

    it('should revert: borrow token with no collateral ', async function () {
      const borrowAmount = mwei('2');
      const to = this.hAaveV3.address;
      const data = abi.simpleEncode(
        'borrow(address,uint256,uint256)',
        this.borrowToken.address,
        borrowAmount,
        rateMode
      );

      await expectRevert(
        this.proxy.execMock(to, data, { from: someone }),
        'HAaveProtocolV3_borrow: 34' // AAVEV3 Error Code: COLLATERAL_BALANCE_IS_ZERO
      );
    });

    it('should revert: borrow token is the same with collateral', async function () {
      const borrowAmount = ether('2');
      const to = this.hAaveV3.address;
      const data = abi.simpleEncode(
        'borrow(address,uint256,uint256)',
        this.token.address,
        borrowAmount,
        rateMode
      );

      await expectRevert(
        this.proxy.execMock(to, data, { from: user }),
        'HAaveProtocolV3_borrow: 37' // AAVEV3 Error Code: COLLATERAL_SAME_AS_BORROWING_CURRENCY
      );
    });
  });

  describe('Borrow with Variable Rate', function () {
    const supplyAmount = ether('5000');
    const borrowTokenAddr = USDC_TOKEN;
    const rateMode = AAVE_RATEMODE.VARIABLE;
    const debtTokenAddr = AUSDC_V3_DEBT_VARIABLE;

    let borrowTokenUserBefore;
    let debtTokenUserBefore;

    before(async function () {
      this.borrowToken = await IToken.at(borrowTokenAddr);
      this.debtToken = await IVariableDebtToken.at(debtTokenAddr);
    });

    beforeEach(async function () {
      // Supply
      await sendToken(tokenSymbol, this.token, user, supplyAmount);
      await this.token.approve(this.pool.address, supplyAmount, {
        from: user,
      });

      expect(await this.aToken.balanceOf(user)).to.be.bignumber.zero;
      await this.pool.supply(this.token.address, supplyAmount, user, 0, {
        from: user,
      });
      expectEqWithinBps(await this.aToken.balanceOf(user), supplyAmount, 1);

      borrowTokenUserBefore = await this.borrowToken.balanceOf(user);
      debtTokenUserBefore = await this.debtToken.balanceOf(user);
    });

    it('borrow token', async function () {
      const borrowAmount = mwei('1');
      const to = this.hAaveV3.address;
      const data = abi.simpleEncode(
        'borrow(address,uint256,uint256)',
        this.borrowToken.address,
        borrowAmount,
        rateMode
      );
      await this.debtToken.approveDelegation(this.proxy.address, borrowAmount, {
        from: user,
      });
      await balanceUser.get();

      const receipt = await this.proxy.execMock(to, data, {
        from: user,
        value: ether('0.1'),
      });
      const borrowTokenUserAfter = await this.borrowToken.balanceOf(user);
      const debtTokenUserAfter = await this.debtToken.balanceOf(user);

      // Verify proxy balance
      expect(await balanceProxy.get()).to.be.bignumber.zero;
      expect(
        await this.borrowToken.balanceOf(this.proxy.address)
      ).to.be.bignumber.zero;
      expect(
        await this.debtToken.balanceOf(this.proxy.address)
      ).to.be.bignumber.zero;

      // Verify user balance
      expect(
        borrowTokenUserAfter.sub(borrowTokenUserBefore)
      ).to.be.bignumber.eq(borrowAmount);
      expectEqWithinBps(
        debtTokenUserAfter.sub(debtTokenUserBefore),
        borrowAmount,
        1
      );
      profileGas(receipt);
    });

    it('borrow eth', async function () {
      // metis chain only use borrow(address,uint256,uint256) function
      if (chainId == 1088) {
        return;
      }

      const debtWNativeAddr = AWRAPPED_NATIVE_V3_DEBT_VARIABLE;
      this.debtWrappedNativeToken = await IVariableDebtToken.at(
        debtWNativeAddr
      );
      let debtWrappedNativeTokenUserBefore =
        await this.debtWrappedNativeToken.balanceOf(user);

      const borrowAmount = ether('1');
      const to = this.hAaveV3.address;
      const data = abi.simpleEncode(
        'borrowETH(uint256,uint256)',
        borrowAmount,
        rateMode
      );
      await this.debtWrappedNativeToken.approveDelegation(
        this.proxy.address,
        borrowAmount,
        {
          from: user,
        }
      );

      const balancerUserBefore = await balanceUser.get();
      const receipt = await this.proxy.execMock(to, data, {
        from: user,
        value: ether('0.1'),
      });
      const balancerUserAfter = await balanceUser.get();
      const debtWrappedNativeTokenUserAfter =
        await this.debtWrappedNativeToken.balanceOf(user);

      // Verify proxy balance
      expect(await balanceProxy.get()).to.be.bignumber.zero;
      expect(
        await this.debtToken.balanceOf(this.proxy.address)
      ).to.be.bignumber.zero;

      // Verify user balance
      expect(balancerUserAfter.sub(balancerUserBefore)).to.be.bignumber.eq(
        borrowAmount
      );
      expectEqWithinBps(
        debtWrappedNativeTokenUserAfter.sub(debtWrappedNativeTokenUserBefore),
        borrowAmount,
        1
      );
      profileGas(receipt);
    });

    it('should revert: unsupported borrowETH', async function () {
      if (chainId != 1088) {
        return;
      }
      const borrowAmount = mwei('1');
      const to = this.hAaveV3.address;
      const data = abi.simpleEncode(
        'borrowETH(uint256,uint256)',
        borrowAmount,
        rateMode
      );
      await expectRevert(
        this.proxy.execMock(to, data, {
          from: user,
          value: ether('0.1'),
        }),
        'HAaveProtocolV3_borrow: Unspecified'
      );
    });

    it('should revert: borrow token over the collateral value', async function () {
      const borrowAmount = mwei('10000');
      const to = this.hAaveV3.address;
      const data = abi.simpleEncode(
        'borrow(address,uint256,uint256)',
        this.borrowToken.address,
        borrowAmount,
        rateMode
      );

      await this.debtToken.approveDelegation(this.proxy.address, borrowAmount, {
        from: user,
      });

      await expectRevert(
        this.proxy.execMock(to, data, { from: user, value: ether('0.1') }),
        'HAaveProtocolV3_borrow: 36' // AAVEV3 Error Code: COLLATERAL_CANNOT_COVER_NEW_BORROW
      );
    });

    it('should revert: borrow token without approveDelegation', async function () {
      const borrowAmount = mwei('0.2');
      const to = this.hAaveV3.address;
      const data = abi.simpleEncode(
        'borrow(address,uint256,uint256)',
        this.borrowToken.address,
        borrowAmount,
        rateMode
      );

      await expectRevert(
        this.proxy.execMock(to, data, { from: user }),
        'HAaveProtocolV3_borrow: Unspecified' // decreaseBorrowAllowance Failed
      );
    });

    it('should revert: borrow token that is not in aaveV3 pool', async function () {
      const borrowAmount = mwei('2');
      const to = this.hAaveV3.address;
      const noPoolToken = chainId == 1088 ? WRAPPED_NATIVE_TOKEN : COMP_TOKEN;
      const data = abi.simpleEncode(
        'borrow(address,uint256,uint256)',
        noPoolToken,
        borrowAmount,
        rateMode
      );

      await expectRevert(
        this.proxy.execMock(to, data, { from: user }),
        'HAaveProtocolV3_borrow: Unspecified'
      );
    });

    it('should revert: borrow token with no collateral', async function () {
      const borrowAmount = mwei('2');
      const to = this.hAaveV3.address;
      const data = abi.simpleEncode(
        'borrow(address,uint256,uint256)',
        this.borrowToken.address,
        borrowAmount,
        rateMode
      );

      await expectRevert(
        this.proxy.execMock(to, data, { from: someone }),
        'HAaveProtocolV3_borrow: 34' // AAVEV3 Error Code: COLLATERAL_BALANCE_IS_ZERO
      );
    });

    it('should revert: borrow token is the same with collateral', async function () {
      const borrowAmount = ether('2');
      const to = this.hAaveV3.address;
      const collateralDebtToken = await IVariableDebtToken.at(
        ADAI_V3_DEBT_VARIABLE
      );
      const data = abi.simpleEncode(
        'borrow(address,uint256,uint256)',
        this.token.address,
        borrowAmount,
        rateMode
      );

      await collateralDebtToken.approveDelegation(user, borrowAmount, {
        from: user,
      });

      await expectRevert(
        this.proxy.execMock(to, data, { from: user }),
        'HAaveProtocolV3_borrow: Unspecified'
        // Variable rate doesn't check collateral and debt
      );
    });
  });

  async function sendToken(symbol, token, to, amount) {
    const baseTokenBalanceSlotNum = await getBalanceSlotNum(symbol, chainId);
    await setTokenBalance(token.address, to, amount, baseTokenBalanceSlotNum);
  }
});
