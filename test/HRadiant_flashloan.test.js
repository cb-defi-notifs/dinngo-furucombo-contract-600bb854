const chainId = network.config.chainId;
if (chainId == 1 || chainId == 42161) {
  // This test supports to run on these chains.
} else {
  return;
}

const {
  balance,
  BN,
  constants,
  ether,
  expectRevert,
  time,
} = require('@openzeppelin/test-helpers');
const { tracker } = balance;
const { ZERO_BYTES32 } = constants;
const abi = require('ethereumjs-abi');
const util = require('ethereumjs-util');
const utils = web3.utils;

const { expect } = require('chai');

const {
  USDC_TOKEN,
  RADIANT_PROVIDER,
  RUSDC_TOKEN,
  AAVE_RATEMODE,
  WRAPPED_NATIVE_TOKEN,
  RWRAPPED_NATIVE_DEBT_VARIABLE,
  RUSDC_DEBT_VARIABLE,
} = require('./utils/constants');
const {
  evmRevert,
  evmSnapshot,
  expectEqWithinBps,
  getTokenProvider,
  mwei,
} = require('./utils/utils');

const FeeRuleRegistry = artifacts.require('FeeRuleRegistry');
const Registry = artifacts.require('Registry');
const Proxy = artifacts.require('ProxyMock');
const HRadiant = artifacts.require('HRadiant');
const HMock = artifacts.require('HMock');
const Faucet = artifacts.require('Faucet');
const SimpleToken = artifacts.require('SimpleToken');
const IToken = artifacts.require('IERC20');
const ILendingPoolV2 = artifacts.require('ILendingPoolV2');
const IProviderV2 = artifacts.require('ILendingPoolAddressesProviderV2');
const IVariableDebtToken = artifacts.require('IVariableDebtToken');

contract('Radiant flashloan', function ([_, user, someone]) {
  let id;
  let balanceUser;
  let balanceProxy;

  before(async function () {
    this.registry = await Registry.new();
    this.feeRuleRegistry = await FeeRuleRegistry.new('0', _);
    this.proxy = await Proxy.new(
      this.registry.address,
      this.feeRuleRegistry.address
    );
    // Register radiant handler
    this.hRadiant = await HRadiant.new(WRAPPED_NATIVE_TOKEN, RADIANT_PROVIDER);
    await this.registry.register(
      this.hRadiant.address,
      utils.asciiToHex('Radiant')
    );
    // Register mock handler
    this.hMock = await HMock.new();
    await this.registry.register(this.hMock.address, utils.asciiToHex('Mock'));

    // Register radiant lending pool for flashloan
    this.provider = await IProviderV2.at(RADIANT_PROVIDER);
    const lendingPoolAddress = await this.provider.getLendingPool.call();
    this.lendingPool = await ILendingPoolV2.at(lendingPoolAddress);
    await this.registry.registerCaller(
      lendingPoolAddress,
      this.hRadiant.address
    );

    this.faucet = await Faucet.new();
    this.tokenA = await IToken.at(WRAPPED_NATIVE_TOKEN);
    this.tokenB = await IToken.at(USDC_TOKEN);
    this.tokenAProvider = await getTokenProvider(this.tokenA.address);
    this.tokenBProvider = await getTokenProvider(this.tokenB.address);
    this.aTokenB = await IToken.at(RUSDC_TOKEN);
    this.variableDebtTokenA = await IVariableDebtToken.at(
      RWRAPPED_NATIVE_DEBT_VARIABLE
    );
    this.variableDebtTokenB = await IVariableDebtToken.at(RUSDC_DEBT_VARIABLE);
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

  describe('Lending pool as handler', function () {
    it('Will success if pool is registered as handler', async function () {
      await this.registry.register(
        this.lendingPool.address,
        this.hRadiant.address
      );
      const to = this.lendingPool.address;
      const data = abi.simpleEncode(
        'initialize(address,bytes)',
        this.registry.address,
        ''
      );
      await this.proxy.execMock(to, data, {
        from: user,
        value: ether('0.1'),
      });
    });

    it('Will revert if pool is registered as caller only', async function () {
      const to = this.lendingPool.address;
      const data = abi.simpleEncode(
        'initialize(address,bytes)',
        this.registry.address,
        ''
      );
      await expectRevert(
        this.proxy.execMock(to, data, {
          from: user,
          value: ether('0.1'),
        }),
        'Invalid handler'
      );
    });
  });

  describe('Normal', function () {
    beforeEach(async function () {
      await this.tokenA.transfer(this.faucet.address, ether('100'), {
        from: this.tokenAProvider,
      });
      await this.tokenB.transfer(this.faucet.address, mwei('100'), {
        from: this.tokenBProvider,
      });

      tokenAUser = await this.tokenA.balanceOf.call(user);
      tokenBUser = await this.tokenB.balanceOf.call(user);

      const depositAmount = mwei('1000');
      await this.tokenB.approve(this.lendingPool.address, depositAmount, {
        from: this.tokenBProvider,
      });
      await this.lendingPool.deposit(
        this.tokenB.address,
        depositAmount,
        user,
        0,
        { from: this.tokenBProvider }
      );
      expectEqWithinBps(await this.aTokenB.balanceOf.call(user), depositAmount);
    });

    it('single asset with no debt', async function () {
      const value = ether('1');
      const params = _getFlashloanParams(
        [this.hMock.address],
        [ZERO_BYTES32],
        [this.faucet.address],
        [this.tokenA.address],
        [value]
      );

      const to = this.hRadiant.address;
      const data = _getFlashloanCubeData(
        [this.tokenA.address], // assets
        [value], // amounts
        [AAVE_RATEMODE.NODEBT], // modes
        params
      );

      await this.proxy.execMock(to, data, {
        from: user,
        value: ether('0.1'),
      });

      const fee = _getFlashloanFee(value);
      expect(await balanceProxy.get()).to.be.bignumber.zero;
      expect(
        await this.tokenA.balanceOf.call(this.proxy.address)
      ).to.be.bignumber.zero;
      expectEqWithinBps(
        await this.tokenA.balanceOf.call(user),
        tokenAUser.add(value).sub(fee)
      );
      expect(await balanceUser.delta()).to.be.bignumber.eq(ether('0'));
    });

    it('single asset with variable rate by borrowing from itself', async function () {
      // Get flashloan params
      const value = ether('0.1');
      const params = _getFlashloanParams(
        [this.hMock.address],
        [ZERO_BYTES32],
        [this.faucet.address],
        [this.tokenA.address],
        [value]
      );

      // Get flashloan handler data
      const to = this.hRadiant.address;
      const data = _getFlashloanCubeData(
        [this.tokenA.address], // assets
        [value], // amounts
        [AAVE_RATEMODE.VARIABLE], // modes
        params
      );

      // approve delegation to proxy get the debt
      await this.variableDebtTokenA.approveDelegation(
        this.proxy.address,
        value,
        {
          from: user,
        }
      );

      // Exec proxy
      await balanceUser.get();
      await this.proxy.execMock(to, data, {
        from: user,
        value: ether('0.1'),
      });

      expect(await balanceProxy.get()).to.be.bignumber.zero;
      expect(
        await this.tokenA.balanceOf.call(this.proxy.address)
      ).to.be.bignumber.zero;
      expect(await this.tokenA.balanceOf.call(user)).to.be.bignumber.eq(
        tokenAUser.add(value).add(value)
      );
      expectEqWithinBps(
        await this.variableDebtTokenA.balanceOf.call(user),
        value
      );
      expect(await balanceUser.delta()).to.be.bignumber.eq(ether('0'));
    });

    it('multiple assets with no debt', async function () {
      const valueA = ether('1');
      const valueB = mwei('1');
      const params = _getFlashloanParams(
        [this.hMock.address],
        [ZERO_BYTES32],
        [this.faucet.address, this.faucet.address],
        [this.tokenA.address, this.tokenB.address],
        [valueA, valueB]
      );

      const to = this.hRadiant.address;
      const data = _getFlashloanCubeData(
        [this.tokenA.address, this.tokenB.address], // assets
        [valueA, valueB], // amounts
        [AAVE_RATEMODE.NODEBT, AAVE_RATEMODE.NODEBT], // modes
        params
      );

      await this.proxy.execMock(to, data, {
        from: user,
        value: ether('0.1'),
      });

      expect(await balanceProxy.get()).to.be.bignumber.zero;
      expect(
        await this.tokenA.balanceOf.call(this.proxy.address)
      ).to.be.bignumber.zero;
      expect(
        await this.tokenB.balanceOf.call(this.proxy.address)
      ).to.be.bignumber.zero;

      const feeA = _getFlashloanFee(valueA);
      const feeB = _getFlashloanFee(valueB);
      expect(await this.tokenA.balanceOf.call(user)).to.be.bignumber.eq(
        tokenAUser.add(valueA).sub(feeA)
      );
      expect(await this.tokenB.balanceOf.call(user)).to.be.bignumber.eq(
        tokenBUser.add(valueB).sub(feeB)
      );
      expect(await balanceUser.delta()).to.be.bignumber.eq(ether('0'));
    });

    it('should revert: assets and amount do not match', async function () {
      const value = ether('1');
      const params = _getFlashloanParams(
        [this.hMock.address],
        [ZERO_BYTES32],
        [this.faucet.address, this.faucet.address],
        [this.tokenA.address, this.tokenB.address],
        [value, value]
      );

      const to = this.hRadiant.address;
      const data = _getFlashloanCubeData(
        [this.tokenA.address, this.tokenB.address], // assets
        [value], // amounts
        [AAVE_RATEMODE.NODEBT, AAVE_RATEMODE.NODEBT], // modes
        params
      );

      await expectRevert(
        this.proxy.execMock(to, data, {
          from: user,
          value: ether('0.1'),
        }),
        'HRadiant_flashLoan: assets and amounts do not match'
      );
    });

    it('should revert: assets and modes do not match', async function () {
      const value = ether('1');
      const params = _getFlashloanParams(
        [this.hMock.address],
        [ZERO_BYTES32],
        [this.faucet.address, this.faucet.address],
        [this.tokenA.address, this.tokenB.address],
        [value, value]
      );

      const to = this.hRadiant.address;
      const data = _getFlashloanCubeData(
        [this.tokenA.address, this.tokenB.address], // assets
        [value, value], // amounts
        [AAVE_RATEMODE.NODEBT], // modes
        params
      );

      await expectRevert(
        this.proxy.execMock(to, data, {
          from: user,
          value: ether('0.1'),
        }),
        'HRadiant_flashLoan: assets and modes do not match'
      );
    });

    it('should revert: not approveDelegation to proxy', async function () {
      const value = ether('0.1');
      const params = _getFlashloanParams(
        [this.hMock.address],
        [ZERO_BYTES32],
        [this.faucet.address],
        [this.tokenA.address],
        [value]
      );

      const to = this.hRadiant.address;
      const data = _getFlashloanCubeData(
        [this.tokenA.address], // assets
        [value], // amounts
        [AAVE_RATEMODE.VARIABLE], // modes
        params
      );

      await expectRevert(
        this.proxy.execMock(to, data, {
          from: user,
          value: ether('0.1'),
        }),
        'HRadiant_flashLoan: 59' // radiant BORROW_ALLOWANCE_NOT_ENOUGH error code = 59
      );
    });

    it('should revert: collateral same as borrowing currency', async function () {
      const value = mwei('1');
      const params = _getFlashloanParams(
        [this.hMock.address],
        [ZERO_BYTES32],
        [this.faucet.address],
        [this.tokenB.address],
        [value]
      );

      const to = this.hRadiant.address;
      const data = _getFlashloanCubeData(
        [this.tokenB.address], // assets
        [value], // amounts
        [AAVE_RATEMODE.VARIABLE], // modes
        params
      );

      await expectRevert(
        this.proxy.execMock(to, data, { from: user, value: ether('0.1') }),
        'HRadiant_flashLoan: 59' // Radiant Error Code: BORROW_ALLOWANCE_NOT_ENOUGH
        // Variable rate doesn't check collateral and debt
      );
    });

    it('should revert: unsupported token', async function () {
      const value = ether('1');
      const params = _getFlashloanParams(
        [this.hMock.address],
        [ZERO_BYTES32],
        [this.faucet.address],
        [this.tokenA.address],
        [value]
      );

      const to = this.hRadiant.address;
      const data = _getFlashloanCubeData(
        [this.mockToken.address], // assets
        [value], // amounts
        [AAVE_RATEMODE.STABLE], // modes
        params
      );

      await expectRevert(
        this.proxy.execMock(to, data, {
          from: user,
          value: ether('0.1'),
        }),
        'HRadiant_flashLoan: Unspecified'
      );
    });
  });

  describe('Multiple Cubes', function () {
    beforeEach(async function () {
      tokenAUser = await this.tokenA.balanceOf.call(user);
      tokenBUser = await this.tokenB.balanceOf.call(user);
      await this.tokenA.transfer(this.faucet.address, ether('100'), {
        from: this.tokenAProvider,
      });
      await this.tokenB.transfer(this.faucet.address, mwei('100'), {
        from: this.tokenBProvider,
      });
    });

    it('sequential', async function () {
      const valueA = ether('1');
      const valueB = mwei('1');
      // Setup 1st flashloan cube
      const params1 = _getFlashloanParams(
        [this.hMock.address],
        [ZERO_BYTES32],
        [this.faucet.address, this.faucet.address],
        [this.tokenA.address, this.tokenB.address],
        [valueA, valueB]
      );

      const to1 = this.hRadiant.address;
      const data1 = _getFlashloanCubeData(
        [this.tokenA.address, this.tokenB.address], // assets
        [valueA, valueB], // amounts
        [AAVE_RATEMODE.NODEBT, AAVE_RATEMODE.NODEBT], // modes
        params1
      );

      // Setup 2nd flashloan cube
      const params2 = _getFlashloanParams(
        [this.hMock.address],
        [ZERO_BYTES32],
        [this.faucet.address, this.faucet.address],
        [this.tokenA.address, this.tokenB.address],
        [valueA, valueB]
      );

      const to2 = this.hRadiant.address;
      const data2 = _getFlashloanCubeData(
        [this.tokenA.address, this.tokenB.address], // assets
        [valueA, valueB], // amounts
        [AAVE_RATEMODE.NODEBT, AAVE_RATEMODE.NODEBT], // modes
        params2
      );

      // Execute proxy batchExec
      const to = [to1, to2];
      const config = [ZERO_BYTES32, ZERO_BYTES32];
      const data = [data1, data2];
      const ruleIndex = [];
      await this.proxy.batchExec(to, config, data, ruleIndex, {
        from: user,
        value: ether('0.1'),
      });

      expect(await balanceProxy.get()).to.be.bignumber.zero;
      expect(
        await this.tokenA.balanceOf.call(this.proxy.address)
      ).to.be.bignumber.zero;
      expect(
        await this.tokenB.balanceOf.call(this.proxy.address)
      ).to.be.bignumber.zero;

      const feeA = valueA
        .mul(new BN('9'))
        .div(new BN('10000'))
        .mul(new BN('2'));
      const feeB = valueB
        .mul(new BN('9'))
        .div(new BN('10000'))
        .mul(new BN('2'));

      expect(await this.tokenA.balanceOf.call(user)).to.be.bignumber.eq(
        tokenAUser.add(valueA.add(valueA)).sub(feeA)
      );
      expect(await this.tokenB.balanceOf.call(user)).to.be.bignumber.eq(
        tokenBUser.add(valueB.add(valueB)).sub(feeB)
      );
      expect(await balanceUser.delta()).to.be.bignumber.eq(ether('0'));
    });

    it('nested', async function () {
      // Get flashloan params
      const valueA = ether('1');
      const valueB = mwei('1');
      const params1 = _getFlashloanParams(
        [this.hMock.address],
        [ZERO_BYTES32],
        [this.faucet.address, this.faucet.address],
        [this.tokenA.address, this.tokenB.address],
        [valueA, valueB]
      );

      // Get 1st flashloan cube data
      const to1 = this.hRadiant.address;
      const data1 = _getFlashloanCubeData(
        [this.tokenA.address, this.tokenB.address], // assets
        [valueA, valueB], // amounts
        [AAVE_RATEMODE.NODEBT, AAVE_RATEMODE.NODEBT], // modes
        params1
      );

      // Encode 1st flashloan cube data as flashloan param
      const params2 = web3.eth.abi.encodeParameters(
        ['address[]', 'bytes32[]', 'bytes[]'],
        [[to1], [ZERO_BYTES32], [data1]]
      );

      // Get 2nd flashloan cube data
      const data2 = _getFlashloanCubeData(
        [this.tokenA.address, this.tokenB.address], // assets
        [valueA, valueB], // amounts
        [AAVE_RATEMODE.NODEBT, AAVE_RATEMODE.NODEBT], // modes
        params2
      );

      const to = [this.hRadiant.address];
      const config = [ZERO_BYTES32];
      const ruleIndex = [];
      const data = [data2];

      await this.proxy.batchExec(to, config, data, ruleIndex, {
        from: user,
        value: ether('0.1'),
      });

      expect(await balanceProxy.get()).to.be.bignumber.zero;
      expect(
        await this.tokenA.balanceOf.call(this.proxy.address)
      ).to.be.bignumber.zero;
      expect(
        await this.tokenB.balanceOf.call(this.proxy.address)
      ).to.be.bignumber.zero;

      const feeA = valueA
        .mul(new BN('9'))
        .div(new BN('10000'))
        .mul(new BN('2'));
      const feeB = valueB
        .mul(new BN('9'))
        .div(new BN('10000'))
        .mul(new BN('2'));

      expect(await this.tokenA.balanceOf.call(user)).to.be.bignumber.eq(
        tokenAUser.add(valueA).sub(feeA)
      );
      expect(await this.tokenB.balanceOf.call(user)).to.be.bignumber.eq(
        tokenBUser.add(valueB).sub(feeB)
      );
      expect(await balanceUser.delta()).to.be.bignumber.eq(ether('0'));
    });
  });

  describe('deposit', function () {
    beforeEach(async function () {
      tokenAUser = await this.tokenA.balanceOf.call(user);
      tokenBUser = await this.tokenB.balanceOf.call(user);
      await this.tokenA.transfer(this.faucet.address, ether('100'), {
        from: this.tokenAProvider,
      });
      await this.tokenB.transfer(this.faucet.address, mwei('100'), {
        from: this.tokenBProvider,
      });
    });

    it('deposit radiant after flashloan', async function () {
      // Get flashloan params
      const valueA = ether('1');
      const valueB = mwei('1');
      const depositValue = mwei('0.5');
      const testTo1 = [this.hMock.address, this.hRadiant.address];
      const testConfig1 = [ZERO_BYTES32, ZERO_BYTES32];
      const testData1 = [
        '0x' +
          abi
            .simpleEncode(
              'drainTokens(address[],address[],uint256[])',
              [this.faucet.address, this.faucet.address],
              [this.tokenA.address, this.tokenB.address],
              [valueA, valueB]
            )
            .toString('hex'),
        abi.simpleEncode(
          'deposit(address,uint256)',
          this.tokenB.address,
          depositValue
        ),
      ];

      const params1 = web3.eth.abi.encodeParameters(
        ['address[]', 'bytes32[]', 'bytes[]'],
        [testTo1, testConfig1, testData1]
      );

      // Get flashloan cube data
      const to1 = this.hRadiant.address;
      const data1 = _getFlashloanCubeData(
        [this.tokenA.address, this.tokenB.address], // assets
        [valueA, valueB], // amounts
        [AAVE_RATEMODE.NODEBT, AAVE_RATEMODE.NODEBT], // modes
        params1
      );

      const to = [this.hRadiant.address];
      const config = [ZERO_BYTES32];
      const ruleIndex = [];
      const data = [data1];
      await this.proxy.batchExec(to, config, data, ruleIndex, {
        from: user,
        value: ether('0.1'),
      });

      expect(await balanceProxy.get()).to.be.bignumber.zero;
      expect(
        await this.tokenA.balanceOf.call(this.proxy.address)
      ).to.be.bignumber.zero;
      expect(
        await this.tokenB.balanceOf.call(this.proxy.address)
      ).to.be.bignumber.zero;

      const feeA = _getFlashloanFee(valueA);
      const feeB = _getFlashloanFee(valueB);
      expect(await this.tokenA.balanceOf.call(user)).to.be.bignumber.eq(
        tokenAUser.add(valueA).sub(feeA)
      );
      expect(await this.tokenB.balanceOf.call(user)).to.be.bignumber.eq(
        tokenBUser.add(valueB.sub(depositValue).sub(feeB))
      );
      expect(await balanceUser.delta()).to.be.bignumber.eq(ether('0'));
    });
  });

  describe('Non-proxy', function () {
    beforeEach(async function () {
      await this.tokenA.transfer(this.faucet.address, ether('100'), {
        from: this.tokenAProvider,
      });
    });

    it('should revert: not initiated by the proxy', async function () {
      const value = ether('1');
      // Setup 1st flashloan cube
      const params = _getFlashloanParams(
        [this.hMock.address],
        [ZERO_BYTES32],
        [this.faucet.address],
        [this.tokenA.address],
        [value]
      );

      await expectRevert(
        this.lendingPool.flashLoan(
          this.proxy.address,
          [this.tokenA.address],
          [value],
          [AAVE_RATEMODE.NODEBT],
          someone,
          params,
          0,
          { from: someone }
        ),
        'Sender is not initialized'
      );
    });
  });

  describe('executeOperation', function () {
    it('should revert: non-lending pool call executeOperation() directly', async function () {
      const data = abi.simpleEncode(
        'executeOperation(address[],uint256[],uint256[],address,bytes)',
        [],
        [],
        [],
        this.proxy.address,
        util.toBuffer(0)
      );
      const to = this.hRadiant.address;
      await expectRevert(
        this.proxy.execMock(to, data, {
          from: user,
        }),
        'HRadiant_executeOperation: invalid caller'
      );
    });
  });
});

function _getFlashloanParams(tos, configs, faucets, tokens, amounts) {
  const data = [
    '0x' +
      abi
        .simpleEncode(
          'drainTokens(address[],address[],uint256[])',
          faucets,
          tokens,
          amounts
        )
        .toString('hex'),
  ];

  const params = web3.eth.abi.encodeParameters(
    ['address[]', 'bytes32[]', 'bytes[]'],
    [tos, configs, data]
  );
  return params;
}

function _getFlashloanCubeData(assets, amounts, modes, params) {
  const data = abi.simpleEncode(
    'flashLoan(address[],uint256[],uint256[],bytes)',
    assets,
    amounts,
    modes,
    util.toBuffer(params)
  );
  return data;
}

function _getFlashloanFee(value) {
  return value.mul(new BN('9')).div(new BN('10000'));
}
