const chainId = network.config.chainId;
if (chainId == 250) {
  // This test supports to run on these chains.
  return; // skipped because Geist is paused
} else {
  return;
}

const {
  balance,
  BN,
  constants,
  ether,
  expectRevert,
} = require('@openzeppelin/test-helpers');
const { tracker } = balance;
const { ZERO_BYTES32 } = constants;
const abi = require('ethereumjs-abi');
const util = require('ethereumjs-util');
const utils = web3.utils;

const { expect } = require('chai');

const {
  DAI_TOKEN,
  WRAPPED_NATIVE_TOKEN,
  GEIST_LENDING_POOL_PROVIDER,
  AAVE_RATEMODE,
} = require('./utils/constants');
const {
  evmRevert,
  evmSnapshot,
  expectEqWithinBps,
  getTokenProvider,
} = require('./utils/utils');

const FeeRuleRegistry = artifacts.require('FeeRuleRegistry');
const Registry = artifacts.require('Registry');
const Proxy = artifacts.require('ProxyMock');
const HGeist = artifacts.require('HGeist');
const HMock = artifacts.require('HMock');
const Faucet = artifacts.require('Faucet');
const SimpleToken = artifacts.require('SimpleToken');
const IToken = artifacts.require('IERC20');
const ILendingPoolV2 = artifacts.require('ILendingPoolV2');
const IProviderV2 = artifacts.require('ILendingPoolAddressesProviderV2');
const IVariableDebtToken = artifacts.require('IVariableDebtToken');
const IStableDebtToken = artifacts.require('IStableDebtToken');

contract('Geist flashloan', function ([_, user, someone]) {
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
    // Register geist handler
    this.hGeist = await HGeist.new(
      WRAPPED_NATIVE_TOKEN,
      GEIST_LENDING_POOL_PROVIDER,
      0
    );
    await this.registry.register(
      this.hGeist.address,
      utils.asciiToHex('Geist')
    );
    // Register mock handler
    this.hMock = await HMock.new();
    await this.registry.register(this.hMock.address, utils.asciiToHex('Mock'));

    // Register geist lending pool for flashloan
    this.provider = await IProviderV2.at(GEIST_LENDING_POOL_PROVIDER);
    const lendingPoolAddress = await this.provider.getLendingPool.call();
    this.lendingPool = await ILendingPoolV2.at(lendingPoolAddress);
    await this.registry.registerCaller(lendingPoolAddress, this.hGeist.address);

    this.faucet = await Faucet.new();
    this.tokenA = await IToken.at(WRAPPED_NATIVE_TOKEN);
    this.tokenB = await IToken.at(DAI_TOKEN);
    this.tokenAProvider = await getTokenProvider(this.tokenA.address);
    this.tokenBProvider = await getTokenProvider(this.tokenB.address);

    this.gTokenB = await IToken.at(
      (
        await this.lendingPool.getReserveData.call(this.tokenB.address)
      ).aTokenAddress
    );

    tokenAReserveData = await this.lendingPool.getReserveData.call(
      this.tokenA.address
    );
    this.stableDebtTokenA = await IStableDebtToken.at(
      tokenAReserveData.stableDebtTokenAddress
    );
    this.variableDebtTokenA = await IVariableDebtToken.at(
      tokenAReserveData.variableDebtTokenAddress
    );
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
        this.hGeist.address
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
      await this.tokenB.transfer(this.faucet.address, ether('100'), {
        from: this.tokenBProvider,
      });

      tokenAUser = await this.tokenA.balanceOf.call(user);
      tokenBUser = await this.tokenB.balanceOf.call(user);

      const depositAmount = ether('10000');
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
      expectEqWithinBps(await this.gTokenB.balanceOf.call(user), depositAmount);
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

      const to = this.hGeist.address;
      const data = _getFlashloanCubeData(
        [this.tokenA.address], // assets
        [value], // amounts
        [AAVE_RATEMODE.NODEBT], // modes
        params
      );

      const receipt = await this.proxy.execMock(to, data, {
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
      const value = ether('1');
      const params = _getFlashloanParams(
        [this.hMock.address],
        [ZERO_BYTES32],
        [this.faucet.address],
        [this.tokenA.address],
        [value]
      );

      // Get flashloan handler data
      const to = this.hGeist.address;
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
      const receipt = await this.proxy.execMock(to, data, {
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
      const value = ether('1');
      const params = _getFlashloanParams(
        [this.hMock.address],
        [ZERO_BYTES32],
        [this.faucet.address, this.faucet.address],
        [this.tokenA.address, this.tokenB.address],
        [value, value]
      );

      const to = this.hGeist.address;
      const data = _getFlashloanCubeData(
        [this.tokenA.address, this.tokenB.address], // assets
        [value, value], // amounts
        [AAVE_RATEMODE.NODEBT, AAVE_RATEMODE.NODEBT], // modes
        params
      );

      const receipt = await this.proxy.execMock(to, data, {
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

      const fee = _getFlashloanFee(value);
      expect(await this.tokenA.balanceOf.call(user)).to.be.bignumber.eq(
        tokenAUser.add(value).sub(fee)
      );
      expect(await this.tokenB.balanceOf.call(user)).to.be.bignumber.eq(
        tokenBUser.add(value).sub(fee)
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

      const to = this.hGeist.address;
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
        'HGeist_flashLoan: assets and amounts do not match'
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

      const to = this.hGeist.address;
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
        'HGeist_flashLoan: assets and modes do not match'
      );
    });

    it('should revert: not approveDelegation to proxy', async function () {
      const value = ether('1');
      const params = _getFlashloanParams(
        [this.hMock.address],
        [ZERO_BYTES32],
        [this.faucet.address],
        [this.tokenA.address],
        [value]
      );

      const to = this.hGeist.address;
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
        'HGeist_flashLoan: 59' // geist BORROW_ALLOWANCE_NOT_ENOUGH error code = 59
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

      const to = this.hGeist.address;
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
        'HGeist_flashLoan: Unspecified'
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
      await this.tokenB.transfer(this.faucet.address, ether('100'), {
        from: this.tokenBProvider,
      });
    });

    it('sequential', async function () {
      const value = ether('1');
      // Setup 1st flashloan cube
      const params1 = _getFlashloanParams(
        [this.hMock.address],
        [ZERO_BYTES32],
        [this.faucet.address, this.faucet.address],
        [this.tokenA.address, this.tokenB.address],
        [value, value]
      );

      const to1 = this.hGeist.address;
      const data1 = _getFlashloanCubeData(
        [this.tokenA.address, this.tokenB.address], // assets
        [value, value], // amounts
        [AAVE_RATEMODE.NODEBT, AAVE_RATEMODE.NODEBT], // modes
        params1
      );

      // Setup 2nd flashloan cube
      const params2 = _getFlashloanParams(
        [this.hMock.address],
        [ZERO_BYTES32],
        [this.faucet.address, this.faucet.address],
        [this.tokenA.address, this.tokenB.address],
        [value, value]
      );

      const to2 = this.hGeist.address;
      const data2 = _getFlashloanCubeData(
        [this.tokenA.address, this.tokenB.address], // assets
        [value, value], // amounts
        [AAVE_RATEMODE.NODEBT, AAVE_RATEMODE.NODEBT], // modes
        params2
      );

      // Execute proxy batchExec
      const to = [to1, to2];
      const config = [ZERO_BYTES32, ZERO_BYTES32];
      const data = [data1, data2];
      const ruleIndex = [];
      const receipt = await this.proxy.batchExec(to, config, data, ruleIndex, {
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

      const fee = value.mul(new BN('9')).div(new BN('10000')).mul(new BN('2'));

      expect(await this.tokenA.balanceOf.call(user)).to.be.bignumber.eq(
        tokenAUser.add(value.add(value)).sub(fee)
      );
      expect(await this.tokenB.balanceOf.call(user)).to.be.bignumber.eq(
        tokenBUser.add(value.add(value)).sub(fee)
      );
      expect(await balanceUser.delta()).to.be.bignumber.eq(ether('0'));
    });

    it('nested', async function () {
      // Get flashloan params
      const value = ether('1');
      const params1 = _getFlashloanParams(
        [this.hMock.address],
        [ZERO_BYTES32],
        [this.faucet.address, this.faucet.address],
        [this.tokenA.address, this.tokenB.address],
        [value, value]
      );

      // Get 1st flashloan cube data
      const to1 = this.hGeist.address;
      const data1 = _getFlashloanCubeData(
        [this.tokenA.address, this.tokenB.address], // assets
        [value, value], // amounts
        [AAVE_RATEMODE.NODEBT, AAVE_RATEMODE.NODEBT], // modes
        params1
      );

      // Encode 1st flashloan cube data as flashloan param
      const params2 = web3.eth.abi.encodeParameters(
        ['address[]', 'bytes32[]', 'bytes[]'],
        [[this.hGeist.address], [ZERO_BYTES32], [data1]]
      );

      // Get 2nd flashloan cube data
      const data2 = _getFlashloanCubeData(
        [this.tokenA.address, this.tokenB.address], // assets
        [value, value], // amounts
        [AAVE_RATEMODE.NODEBT, AAVE_RATEMODE.NODEBT], // modes
        params2
      );

      const to = [this.hGeist.address];
      const config = [ZERO_BYTES32];
      const ruleIndex = [];
      const data = [data2];

      const receipt = await this.proxy.batchExec(to, config, data, ruleIndex, {
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

      const fee = value.mul(new BN('9')).div(new BN('10000')).mul(new BN('2'));

      expect(await this.tokenA.balanceOf.call(user)).to.be.bignumber.eq(
        tokenAUser.add(value).sub(fee)
      );
      expect(await this.tokenB.balanceOf.call(user)).to.be.bignumber.eq(
        tokenBUser.add(value).sub(fee)
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
      await this.tokenB.transfer(this.faucet.address, ether('100'), {
        from: this.tokenBProvider,
      });
    });

    it('deposit geist after flashloan', async function () {
      // Get flashloan params
      const value = ether('1');
      const depositValue = ether('0.5');
      const testTo1 = [this.hMock.address, this.hGeist.address];
      const testConfig1 = [ZERO_BYTES32, ZERO_BYTES32];
      const testData1 = [
        '0x' +
          abi
            .simpleEncode(
              'drainTokens(address[],address[],uint256[])',
              [this.faucet.address, this.faucet.address],
              [this.tokenA.address, this.tokenB.address],
              [value, value]
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
      const to1 = this.hGeist.address;
      const data1 = _getFlashloanCubeData(
        [this.tokenA.address, this.tokenB.address], // assets
        [value, value], // amounts
        [AAVE_RATEMODE.NODEBT, AAVE_RATEMODE.NODEBT], // modes
        params1
      );

      const to = [this.hGeist.address];
      const config = [ZERO_BYTES32];
      const ruleIndex = [];
      const data = [data1];
      const receipt = await this.proxy.batchExec(to, config, data, ruleIndex, {
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

      const fee = _getFlashloanFee(value);
      expect(await this.tokenA.balanceOf.call(user)).to.be.bignumber.eq(
        tokenAUser.add(value).sub(fee)
      );
      expect(await this.tokenB.balanceOf.call(user)).to.be.bignumber.eq(
        tokenBUser.add(value.sub(depositValue).sub(fee))
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
      const to = this.hGeist.address;
      await expectRevert(
        this.proxy.execMock(to, data, {
          from: user,
        }),
        'HGeist_executeOperation: invalid caller'
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
