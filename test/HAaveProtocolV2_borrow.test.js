const chainId = network.config.chainId;
if (chainId == 1 || chainId == 137) {
  // This test supports to run on these chains.
} else {
  return;
}

const {
  balance,
  BN,
  ether,
  expectRevert,
} = require('@openzeppelin/test-helpers');
const { tracker } = balance;
const abi = require('ethereumjs-abi');
const utils = web3.utils;

const { expect } = require('chai');

const {
  WETH_TOKEN,
  DAI_TOKEN,
  USDT_TOKEN,
  AUSDT_V2_DEBT_VARIABLE,
  COMP_TOKEN,
  ADAI_V2,
  AAVEPROTOCOL_V2_PROVIDER,
  AWETH_V2_DEBT_STABLE,
  AUSDT_V2_DEBT_STABLE,
  AAVE_RATEMODE,
  WRAPPED_NATIVE_TOKEN,
  AWRAPPED_NATIVE_V2_DEBT_VARIABLE,
} = require('./utils/constants');
const {
  evmRevert,
  evmSnapshot,
  profileGas,
  expectEqWithinBps,
  getTokenProvider,
  mwei,
} = require('./utils/utils');

const HAaveV2 = artifacts.require('HAaveProtocolV2');
const FeeRuleRegistry = artifacts.require('FeeRuleRegistry');
const Registry = artifacts.require('Registry');
const Proxy = artifacts.require('ProxyMock');
const IToken = artifacts.require('IERC20');
const IAToken = artifacts.require('IATokenV2');
const ILendingPool = artifacts.require('ILendingPoolV2');
const IProvider = artifacts.require('ILendingPoolAddressesProviderV2');
const SimpleToken = artifacts.require('SimpleToken');

const IStableDebtToken = artifacts.require('IStableDebtToken');
const IVariableDebtToken = artifacts.require('IVariableDebtToken');

contract('Aave V2', function ([_, user, someone]) {
  const aTokenAddress = ADAI_V2;
  const tokenAddress = DAI_TOKEN;

  let id;
  let balanceUser;
  let balanceProxy;
  let providerAddress;

  before(async function () {
    providerAddress = await getTokenProvider(tokenAddress);

    this.registry = await Registry.new();
    this.feeRuleRegistry = await FeeRuleRegistry.new('0', _);
    this.proxy = await Proxy.new(
      this.registry.address,
      this.feeRuleRegistry.address
    );
    this.hAaveV2 = await HAaveV2.new(
      WRAPPED_NATIVE_TOKEN,
      AAVEPROTOCOL_V2_PROVIDER
    );
    await this.registry.register(
      this.hAaveV2.address,
      utils.asciiToHex('AaveProtocolV2')
    );
    this.provider = await IProvider.at(AAVEPROTOCOL_V2_PROVIDER);
    this.lendingPoolAddress = await this.provider.getLendingPool.call();
    this.lendingPool = await ILendingPool.at(this.lendingPoolAddress);
    this.token = await IToken.at(tokenAddress);
    this.aToken = await IAToken.at(aTokenAddress);
    this.weth = await IToken.at(WETH_TOKEN);
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
    if (chainId == 1 || chainId == 137) {
      // Stable Rate borrow is not available on Ethereum and Polygon.
      return;
    }
    const depositAmount = ether('10000');
    const borrowTokenAddr = USDT_TOKEN;
    const rateMode = AAVE_RATEMODE.STABLE;
    const debtTokenAddr = AUSDT_V2_DEBT_STABLE;
    const debtWETHAddr = AWETH_V2_DEBT_STABLE;

    let borrowTokenUserBefore;
    let debtTokenUserBefore;
    let debtWETHUserBefore;

    before(async function () {
      this.borrowToken = await IToken.at(borrowTokenAddr);
      this.weth = await IToken.at(WETH_TOKEN);
      this.debtWETH = await IStableDebtToken.at(debtWETHAddr);
      this.debtToken = await IStableDebtToken.at(debtTokenAddr);
    });

    beforeEach(async function () {
      // Deposit
      await this.token.approve(this.lendingPool.address, depositAmount, {
        from: providerAddress,
      });
      expect(await this.aToken.balanceOf.call(user)).to.be.bignumber.zero;
      await this.lendingPool.deposit(
        this.token.address,
        depositAmount,
        user,
        0,
        { from: providerAddress }
      );
      expectEqWithinBps(await this.aToken.balanceOf.call(user), depositAmount);

      borrowTokenUserBefore = await this.borrowToken.balanceOf.call(user);
      borrowWETHUserBefore = await this.weth.balanceOf.call(user);
      debtTokenUserBefore = await this.debtToken.balanceOf.call(user);
      debtWETHUserBefore = await this.debtWETH.balanceOf.call(user);
    });

    it('borrow token', async function () {
      const borrowAmount = mwei('100');
      const to = this.hAaveV2.address;
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
      const borrowTokenUserAfter = await this.borrowToken.balanceOf.call(user);
      const debtTokenUserAfter = await this.debtToken.balanceOf.call(user);
      // Verify proxy balance
      expect(await balanceProxy.get()).to.be.bignumber.zero;
      expect(
        await this.borrowToken.balanceOf.call(this.proxy.address)
      ).to.be.bignumber.zero;
      expect(
        await this.debtToken.balanceOf.call(this.proxy.address)
      ).to.be.bignumber.zero;

      // Verify user balance
      expect(
        borrowTokenUserAfter.sub(borrowTokenUserBefore)
      ).to.be.bignumber.eq(borrowAmount);

      //  borrowAmount - 1 <= (debtTokenUserAfter-debtTokenUserBefore) < borrowAmount + interestMax
      const interestMax = borrowAmount.mul(new BN(1)).div(new BN(10000));
      expect(debtTokenUserAfter.sub(debtTokenUserBefore)).to.be.bignumber.gte(
        borrowAmount.sub(new BN(1))
      );
      expect(debtTokenUserAfter.sub(debtTokenUserBefore)).to.be.bignumber.lt(
        borrowAmount.add(interestMax)
      );
      profileGas(receipt);
    });

    it('borrow weth', async function () {
      const borrowAmount = ether('1');
      const to = this.hAaveV2.address;
      const data = abi.simpleEncode(
        'borrow(address,uint256,uint256)',
        WETH_TOKEN,
        borrowAmount,
        rateMode
      );

      await this.debtWETH.approveDelegation(this.proxy.address, borrowAmount, {
        from: user,
      });
      await balanceUser.get();
      const receipt = await this.proxy.execMock(to, data, {
        from: user,
        value: ether('0.1'),
      });
      const borrowWETHUserAfter = await this.weth.balanceOf.call(user);
      const debtWETHUserAfter = await this.debtWETH.balanceOf.call(user);
      // Verify proxy balance
      expect(await balanceProxy.get()).to.be.bignumber.zero;
      expect(
        await this.borrowToken.balanceOf.call(this.proxy.address)
      ).to.be.bignumber.zero;
      expect(
        await this.debtToken.balanceOf.call(this.proxy.address)
      ).to.be.bignumber.zero;

      // Verify user balance
      expect(borrowWETHUserAfter.sub(borrowWETHUserBefore)).to.be.bignumber.eq(
        borrowAmount
      );

      //  borrowAmount - 1 <= (debtTokenUserAfter-debtTokenUserBefore) < borrowAmount + interestMax
      const interestMax = borrowAmount.mul(new BN(1)).div(new BN(10000));
      expect(debtWETHUserAfter.sub(debtWETHUserBefore)).to.be.bignumber.gte(
        borrowAmount.sub(new BN(1))
      );
      expect(debtWETHUserAfter.sub(debtWETHUserBefore)).to.be.bignumber.lt(
        borrowAmount.add(interestMax)
      );
      profileGas(receipt);
    });

    it('borrow eth', async function () {
      const borrowAmount = ether('1');
      const to = this.hAaveV2.address;
      const data = abi.simpleEncode(
        'borrowETH(uint256,uint256)',
        borrowAmount,
        rateMode
      );
      await this.debtWETH.approveDelegation(this.proxy.address, borrowAmount, {
        from: user,
      });
      const balancerUserBefore = await balanceUser.get();
      const receipt = await this.proxy.execMock(to, data, {
        from: user,
        value: ether('0.1'),
      });

      const balancerUserAfter = await balanceUser.get();
      const debtWETHUserAfter = await this.debtWETH.balanceOf.call(user);
      // Verify proxy balance
      expect(await balanceProxy.get()).to.be.bignumber.zero;
      expect(
        await this.debtToken.balanceOf.call(this.proxy.address)
      ).to.be.bignumber.zero;

      // Verify user balance
      expect(balancerUserAfter.sub(balancerUserBefore)).to.be.bignumber.eq(
        borrowAmount
      );
      //  borrowAmount - 1 <= (debtTokenUserAfter-debtTokenUserBefore) < borrowAmount + interestMax
      const interestMax = borrowAmount.mul(new BN(1)).div(new BN(10000));
      expect(debtWETHUserAfter.sub(debtWETHUserBefore)).to.be.bignumber.gte(
        borrowAmount.sub(new BN(1))
      );
      expect(debtWETHUserAfter.sub(debtWETHUserBefore)).to.be.bignumber.lt(
        borrowAmount.add(interestMax)
      );
      profileGas(receipt);
    });

    it('should revert: borrow token over the collateral value', async function () {
      const borrowAmount = ether('20000');
      const to = this.hAaveV2.address;
      const data = abi.simpleEncode(
        'borrow(address,uint256,uint256)',
        this.borrowToken.address,
        borrowAmount,
        rateMode
      );
      await this.debtWETH.approveDelegation(this.proxy.address, borrowAmount, {
        from: user,
      });

      await expectRevert(
        this.proxy.execMock(to, data, { from: user, value: ether('0.1') }),
        'HAaveProtocolV2_borrow: 11' // AAVEV2 Error Code: VL_COLLATERAL_CANNOT_COVER_NEW_BORROW
      );
    });

    it('should revert: borrow token without approveDelegation', async function () {
      const borrowAmount = mwei('2');
      const to = this.hAaveV2.address;
      const data = abi.simpleEncode(
        'borrow(address,uint256,uint256)',
        this.borrowToken.address,
        borrowAmount,
        rateMode
      );

      await expectRevert(
        this.proxy.execMock(to, data, { from: user }),
        'HAaveProtocolV2_borrow: 59' // AAVEV2 Error Code: BORROW_ALLOWANCE_NOT_ENOUGH
      );
    });

    it('should revert: borrow token approveDelegation < borrow amount', async function () {
      const borrowAmount = mwei('2');
      const to = this.hAaveV2.address;
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
        'HAaveProtocolV2_borrow: 59' // AAVEV2 Error Code: BORROW_ALLOWANCE_NOT_ENOUGH
      );
    });

    it('should revert: borrow token that is not in aaveV2 pool', async function () {
      const borrowAmount = ether('2');
      const to = this.hAaveV2.address;
      const data = abi.simpleEncode(
        'borrow(address,uint256,uint256)',
        COMP_TOKEN,
        borrowAmount,
        rateMode
      );

      await expectRevert(
        this.proxy.execMock(to, data, { from: user }),
        'HAaveProtocolV2_borrow: Unspecified'
      );
    });

    it('should revert: borrow token with no collateral ', async function () {
      const borrowAmount = mwei('2');
      const to = this.hAaveV2.address;
      const data = abi.simpleEncode(
        'borrow(address,uint256,uint256)',
        this.borrowToken.address,
        borrowAmount,
        rateMode
      );

      await expectRevert(
        this.proxy.execMock(to, data, { from: someone }),
        'HAaveProtocolV2_borrow: 9' // AAVEV2 Error Code: VL_COLLATERAL_BALANCE_IS_0
      );
    });
  });

  describe('Borrow with Variable Rate', function () {
    const depositAmount = ether('10000');
    const borrowTokenAddr = USDT_TOKEN;
    const rateMode = AAVE_RATEMODE.VARIABLE;
    const debtTokenAddr = AUSDT_V2_DEBT_VARIABLE;
    const debtWrappedNativeTokenAddr = AWRAPPED_NATIVE_V2_DEBT_VARIABLE;

    let borrowTokenUserBefore;
    let debtTokenUserBefore;
    let debtWrappedNativeTokenUserBefore;

    before(async function () {
      this.borrowToken = await IToken.at(borrowTokenAddr);
      this.wrappedNativeToken = await IToken.at(WRAPPED_NATIVE_TOKEN);
      this.debtWrappedNativeToken = await IVariableDebtToken.at(
        debtWrappedNativeTokenAddr
      );
      this.debtToken = await IVariableDebtToken.at(debtTokenAddr);
    });

    beforeEach(async function () {
      // Deposit
      await this.token.approve(this.lendingPool.address, depositAmount, {
        from: providerAddress,
      });

      expect(await this.aToken.balanceOf.call(user)).to.be.bignumber.zero;
      await this.lendingPool.deposit(
        this.token.address,
        depositAmount,
        user,
        0,
        { from: providerAddress }
      );
      expectEqWithinBps(await this.aToken.balanceOf.call(user), depositAmount);

      borrowTokenUserBefore = await this.borrowToken.balanceOf.call(user);
      borrowWrappedNativeTokenUserBefore =
        await this.wrappedNativeToken.balanceOf.call(user);
      debtTokenUserBefore = await this.debtToken.balanceOf.call(user);
      debtWrappedNativeTokenUserBefore =
        await this.debtWrappedNativeToken.balanceOf.call(user);
    });

    it('borrow token', async function () {
      const borrowAmount = mwei('100');
      const to = this.hAaveV2.address;
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
      const borrowTokenUserAfter = await this.borrowToken.balanceOf.call(user);
      const debtTokenUserAfter = await this.debtToken.balanceOf.call(user);
      // Verify proxy balance
      expect(await balanceProxy.get()).to.be.bignumber.zero;
      expect(
        await this.borrowToken.balanceOf.call(this.proxy.address)
      ).to.be.bignumber.zero;
      expect(
        await this.debtToken.balanceOf.call(this.proxy.address)
      ).to.be.bignumber.zero;

      // Verify user balance
      expect(
        borrowTokenUserAfter.sub(borrowTokenUserBefore)
      ).to.be.bignumber.eq(borrowAmount);

      //  borrowAmount <= (debtTokenUserAfter-debtTokenUserBefore) < borrowAmount + interestMax
      const interestMax = borrowAmount.mul(new BN(1)).div(new BN(10000));
      expectEqWithinBps(
        debtTokenUserAfter.sub(debtTokenUserBefore),
        borrowAmount
      );
      expect(debtTokenUserAfter.sub(debtTokenUserBefore)).to.be.bignumber.lt(
        borrowAmount.add(interestMax)
      );

      profileGas(receipt);
    });

    it('borrow weth', async function () {
      const borrowAmount = ether('1');
      const to = this.hAaveV2.address;
      const data = abi.simpleEncode(
        'borrow(address,uint256,uint256)',
        WRAPPED_NATIVE_TOKEN,
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
      await balanceUser.get();
      const receipt = await this.proxy.execMock(to, data, {
        from: user,
        value: ether('0.1'),
      });

      const debtWrappedNativeTokenUserAfter =
        await this.debtWrappedNativeToken.balanceOf.call(user);
      // Verify proxy balance
      expect(await balanceProxy.get()).to.be.bignumber.zero;
      expect(
        await this.borrowToken.balanceOf.call(this.proxy.address)
      ).to.be.bignumber.zero;
      expect(
        await this.debtToken.balanceOf.call(this.proxy.address)
      ).to.be.bignumber.zero;

      // Verify user balance
      expect(
        debtWrappedNativeTokenUserAfter.sub(borrowWrappedNativeTokenUserBefore)
      ).to.be.bignumber.eq(borrowAmount);

      //  borrowAmount - 1 <= (debtTokenUserAfter-debtTokenUserBefore) < borrowAmount + interestMax
      const interestMax = borrowAmount.mul(new BN(1)).div(new BN(10000));
      expect(
        debtWrappedNativeTokenUserAfter.sub(debtWrappedNativeTokenUserBefore)
      ).to.be.bignumber.gte(borrowAmount.sub(new BN(1)));
      expect(
        debtWrappedNativeTokenUserAfter.sub(debtWrappedNativeTokenUserBefore)
      ).to.be.bignumber.lt(borrowAmount.add(interestMax));

      profileGas(receipt);
    });

    it('borrow eth', async function () {
      const borrowAmount = ether('1');
      const to = this.hAaveV2.address;
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
        await this.debtWrappedNativeToken.balanceOf.call(user);
      // Verify proxy balance
      expect(await balanceProxy.get()).to.be.bignumber.zero;
      expect(
        await this.debtToken.balanceOf.call(this.proxy.address)
      ).to.be.bignumber.zero;

      // Verify user balance
      expect(balancerUserAfter.sub(balancerUserBefore)).to.be.bignumber.eq(
        borrowAmount
      );

      //  borrowAmount - 1 <= (debtTokenUserAfter-debtTokenUserBefore) < borrowAmount + interestMax
      const interestMax = borrowAmount.mul(new BN(1)).div(new BN(10000));
      expect(
        debtWrappedNativeTokenUserAfter.sub(debtWrappedNativeTokenUserBefore)
      ).to.be.bignumber.gte(borrowAmount.sub(new BN(1)));
      expect(
        debtWrappedNativeTokenUserAfter.sub(debtWrappedNativeTokenUserBefore)
      ).to.be.bignumber.lt(borrowAmount.add(interestMax));
      profileGas(receipt);
    });

    it('should revert: borrow token over the collateral value', async function () {
      const borrowAmount = ether('20000');
      const to = this.hAaveV2.address;
      const data = abi.simpleEncode(
        'borrow(address,uint256,uint256)',
        this.borrowToken.address,
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

      await expectRevert(
        this.proxy.execMock(to, data, { from: user, value: ether('0.1') }),
        'HAaveProtocolV2_borrow: 11' // AAVEV2 Error Code: VL_COLLATERAL_CANNOT_COVER_NEW_BORROW
      );
    });

    it('should revert: borrow token without approveDelegation', async function () {
      const borrowAmount = mwei('2');
      const to = this.hAaveV2.address;
      const data = abi.simpleEncode(
        'borrow(address,uint256,uint256)',
        this.borrowToken.address,
        borrowAmount,
        rateMode
      );

      await expectRevert(
        this.proxy.execMock(to, data, { from: user }),
        'HAaveProtocolV2_borrow: 59' // AAVEV2 Error Code: BORROW_ALLOWANCE_NOT_ENOUGH
      );
    });

    it('should revert: borrow token that is not in aaveV2 pool', async function () {
      const borrowAmount = ether('2');
      const to = this.hAaveV2.address;
      const data = abi.simpleEncode(
        'borrow(address,uint256,uint256)',
        COMP_TOKEN,
        borrowAmount,
        rateMode
      );

      await expectRevert(
        this.proxy.execMock(to, data, { from: user }),
        'HAaveProtocolV2_borrow: Unspecified'
      );
    });

    it('should revert: borrow token with no collateral', async function () {
      const borrowAmount = ether('2');
      const to = this.hAaveV2.address;
      const data = abi.simpleEncode(
        'borrow(address,uint256,uint256)',
        this.borrowToken.address,
        borrowAmount,
        rateMode
      );

      await expectRevert(
        this.proxy.execMock(to, data, { from: someone }),
        'HAaveProtocolV2_borrow: 9' // AAVEV2 Error Code: VL_COLLATERAL_BALANCE_IS_0
      );
    });

    it('should revert: borrow token is the same with collateral', async function () {
      const borrowAmount = ether('2');
      const to = this.hAaveV2.address;
      const data = abi.simpleEncode(
        'borrow(address,uint256,uint256)',
        this.token.address,
        borrowAmount,
        rateMode
      );

      await this.debtWrappedNativeToken.approveDelegation(user, borrowAmount, {
        from: user,
      });

      await expectRevert(
        this.proxy.execMock(to, data, { from: user }),
        'HAaveProtocolV2_borrow: 59' // AAVEV2 Error Code: BORROW_ALLOWANCE_NOT_ENOUGH
        // Variable rate doesn't check collateral and debt
      );
    });
  });
});
