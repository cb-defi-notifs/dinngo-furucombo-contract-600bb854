# Change Log

All notable changes to this project will be documented in this file.

## [unreleased]

## [2.10.0] - 2023-12-28

### Deprecated

- Deprecate 1inch

## [2.9.0] - 2023-11-06

### Added

- Support Radiant handler on Ethereum

## [2.8.0] - 2023-08-08

### Added

- Support add, addMany, and sub.
- Support Radiant handler on Arbitrum

### Changed

- Add diff returns to deposit/supply function of AAVE handlers

## [2.7.0] - 2023-06-07

### Added

- Support Hummus protocol.
- Support Aave Protocol V3 on Metis.
- Support Maia(Uni) protocol.

## [2.6.1] - 2023-05-24

### Fixed

- Hotfix CompoundV3 handler.

## [2.6.0] - 2023-05-09

### Added

- Support CompoundV3.

## [2.5.0] - 2023-03-16

### Added

- Support Lido ETH submit.

### Changed

- Fix chained input amountIn for `swapETH()`.
- Support Stargate on Fantom.

## [2.4.0] - 2023-03-02

### Added

- Add send token to addresses in `HFunds`.
- Support swap ETH/ERC20/STG token on Stargate token bridge.
- Add `setTokenBalance` in utils.js to manipulate token balance for unit testing.
- Support Aave Protocol V3 on Ethereum.
- Support Geist Protocol and SpookySwap Protocol and add Fantom unit test stage.
- Support CurveDao handler without mint function.

### Changed

- Use fixed prettier version 2.8.4 and fixed prettier solidity plugin version 1.1.2.

## [2.3.2] - 2022-12-21

### Changed

- Generalize unit tests in `HOneInchV5.test.js`
- Replace oneInchV3 with oneInchV5 in Certora files
- Use addresses_xxx.js file as a reference in constants_xxx.js file

## [2.3.1] - 2022-12-07

### Changed

- Merge multi-chain unit test stages into single unit test stage in CI.

## [2.3.0] - 2022-11-29

### Added

- Support Foundry fuzzing and add fuzzing tests.
- Add ERC1155 fee rule.

### Changed

- Replace `RCubeNFT` with `RStarNFTV4`.
- Replace `HOneInchV3` with `HOneInchV5`.

## [2.2.0] - 2022-10-21

### Added

- Support Aave Protocol V3.

### Changed

- Add multi-chain stages in CI.
- Add free pass fee rule test cases.
- Refactor deploy for multichain.

## [2.1.0] - 2022-10-08

### Changed

- Upgrade CI node image from node 14 to node 18.

### Added

- Add cube nft fee rule

## [2.0.0] - 2022-08-26

### Added

- Add fee flow for ether and token in `Proxy` and `HFunds` respectively.
- Add `FeeRuleRegistry` for fee related configurations.
- Add `RuleBase` as the base of future rules.
- Duplicate `inject` for `addFunds` in `HFunds`.

## [1.12.0] - 2022-07-27

### Added

- Static analysis tool - slither
- Support Curve withdraw to gauges in `HCurveDao`.

### Changed

- Replace if-revertMsg with requireMsg.
- Move cube counter to \_execs() local memory.
- Upgrade solidity version to 0.8.10.
- Replace all uint256(-1) with type(uint256).max.
- Unify 0xEeee...eE naming to NATIVE_TOKEN_ADDRESS.
- Replace safeApprove with \_tokenApprove.
- Set token allowance to zero after each \_tokenApprove.
- Peek first and second element from stack at once in \_setPostProcess() to avoid too many push/pop.

### Fixed

- Warning free.

## [1.11.1] - 2022-05-27

### Changed

- Archive GasTokens related handlers and tests.

## [1.11.0] - 2022-02-14

### Added

- Support ParaSwapV5.

### Changed

- Refine token provider for tests.

### Fixed

- Fix bignumber zero checks.

## [1.10.0] - 2021-10-20

### Added

- Support sending ether to miner.
- Add event to log the handler execution.

### Changed

- Refine gelato v2 limit order handler
- Migrate developing environment from Truffle to Hardhat.
- Archive Balancer v1 related handlers and tests.
- Archive Aave v1 related handlers and tests.
- Archive KyberNetwork related handlers and tests.
- Archive 1inch v2 related handlers and tests.

## [1.9.0] - 2021-09-30

### Changed

- Change 1inch v3 unoswap dst token fetching mechanism.

## [1.8.0] - 2021-09-13

### Added

- Support 1inch v3 swap and unoswap.

### Changed

- Add `updateTokens` to `HFunds` and add return value for `inject`.

### Fixed

- Fix Curve handler add liquidity getting max amount on native token mechanism.

## [1.7.0] - 2021-07-20

### Added

- Support Curve crypto swap.
- Support Curve factory metapool.

## [1.6.0] - 2021-06-15

### Added

- Support Polygon token bridge.
- Support gelatov2 limit order.
- Support uniswap v3 swapping.

### Changed

- Archive Uniswap and Mooniswap handlers.
- Change post process handler checking flow.
- Check proxy instead of sender for ban.

## [1.5.1] - 2021-05-05

### Added

- Update audit reports.

## [1.5.0] - 2021-04-15

### Added

- Support for Furucombo rCOMBO.

## [1.4.1] - 2021-04-15

### Fixed

- Certora audit fix.

## [1.4.0] - 2021-03-09

### Added

- Support Aave v2 borrowETH/borrow.
- Add send tokens function of `HFunds` handler.
- Add `Halt` functions in `Registry`.
- Add `bannedAgents` and related functions in `Registry`.
- Add addition checks for external function call in `Proxy`.
- Support for B.Protocol.
- Support for Sushiswap.

### Changed

- Replace safeApprove with \_tokenApprove in Curve and UniswapV2 handler.
- Refine send token/Ether function of `HFunds` handler.
- Separate `infos` into `handlers` and `callers`.
- Separate `fallback()` and `receive()` in `Proxy`.
- Small refactor in HMaker.sol to allow overriding `CDP_MANAGER` and `PROXY_ACTIONS` addresses
- Read `MCD_JUG` address from Maker ChainLog contract. This change would support JUG contract upgardes on Maker side.

### Removed

- Remove Oasis related contracts and tests.
- Remove 1inch related contracts and tests.

## [1.3.0] - 2021-02-04

### Added

- Support Synthetix `StakingRewards` contract by adding `StakingRewardsAdapter` contract template.
- Support stake/withdraw/getReward/exit onbehalf of user through `StakingRewardsAdapter` in `HStakingRewardsAdapter`.

### Changed

- Fix openzeppelin contracts dependency to 3.3.0.
- Update Maker unit test for dust handling.

## [1.2.0] - 2021-01-28

### Changed

- Update curve handler to support eth and aave pools.
- Update curve handler to remove onesplit swap.

## [1.1.0] - 2021-01-25

### Added

- Support 1inch v2.
- Support Aave v2 depositETH/withdrawETH/repayETH.

## [1.0.0] - 2021-01-09

### Added

- Dynamic input mechanism.
- Apply new `cache` mapping structure and `LibCache` to handler sender related functions.
- Cube counting error message handling.
- Support check slippage function in `HFunds`.
- Support Aave v2 deposit/withdraw/repay/flashloan in `HAaveProtocolV2`.
- Support get proxy current balance by using `-1` feature in several handlers.
- Speed up CI process by contract migration improvement.

### Changed

- Update to solidity 0.6.x.
- Sender related functions is removed from `LibCache` and implemented in `contract Storage`.
- `Cache.sol` is changed to `Storage.sol`.
- `Cache` is now `Stack`. `LibCache` is now `LibStack`.
- `Registry` allows to register non-deprecated registration to apply new info.
- Rename `handlers` to `infos` in `Registry`.

## [0.13.1] - 2020-12-23

### Fixed

- Fixed execs issue.

## [0.13.0] - 2020-12-08

### Added

- Support Compound borrow, repayBorrow and claimComp with DSProxy in `HSCompound` and `FCompoundActions`.
- Support Stake, unstake and claimAll `$COMBO` in `HFurucombo`.

## [0.12.1] - 2020-10-28

### Changed

- Refine Curve handler supporting hbtc, 3pool and meta pools.

## [0.12.0] - 2020-10-19

### Added

- Support CHI and GST2 gas tokens in `HGasTokens`.
- Support Balancer multihop swapping in `HBalancerExchange`.

## [0.11.0] - 2020-09-21

### Added

- Support Yearn vault depositETH and withdrawETH in `HYVault`.

### Changed

- Apply slippage to swapping and add/remove liquidity related testcases.
- Apply evm state reset to every testcase.
- Upgrade `prettier-plugin-solidity` to `1.0.0-alpha.57`

## [0.10.0] - 2020-09-04

### Added

- Support Yearn vault deposit and withdraw in `HYVault`.
- Support Mooniswap deposit/withdraw liquidity function in `HMooniswap`.

### Removed

- Unused `HERC20TokenIn`.

## [0.9.0] - 2020-08-21

### Added

- Support Curve add liquidity in `HCurve`.
- Support Curve remove liquidity one coin in `HCurve`.
- Support WETH deposit and withdraw function in `HWeth`.
- Support Curve deposit to gauges in `HCurveDao`.
- Support Curve mint and mint_many CRV in `HCurveDao`.

## [0.8.0] - 2020-08-10

### Added

- Add token and ether sending function in `HFunds`.
- Support Balancer add liquidity single assert/all asserts function in `HBalancer`.
- Support Balancer remove liquidity single assert/all asserts function in `HBalancer`.
- Support Compound repay function in `HCEther` and `HCToken`.
- Support OneInch fixed input eth to token swap.
- Support OneInch fixed input token to eth swap.
- Support OneInch fixed input token to token swap.

### Changed

- Wrap `HERC20TokenIn` to `HFunds`.

### Deprecated

- Unused `HERC20TokenIn`.

## [0.7.0] - 2020-07-27

### Added

- Support Curve swap through curve pools in `HCurve`.
- Support Curve swap through OneSplit aggregator in `HCurve`.

## [0.6.0] - 2020-07-13

### Added

- Support UniswapV2 fixed input/output eth to token swap.
- Support UniswapV2 fixed input/output token to eth swap.
- Support UniswapV2 fixed input/output token to token swap.
- Apply solhint.

## [0.5.0] - 2020-06-23

### Added

- Support UniswapV2 add eth/token liquidity .
- Support UniswapV2 remove eth/token liquidity.
- Support Compound claim COMP token.

## [0.4.1] - 2020-06-16

### Fixed

- Fixed error handling on custom handler followed by noop.

### Deprecated

- Unintuitive post-process handling in `_setPostProcess()`.

## [0.4.0] 2020-06-12

### Added

- Add cache handling mechanism.
- Support customized handler post processor.
- Support Maker create CDP.
- Support Maker deposit.
- Support Maker withdraw.
- Support Maker generate.
- Support Maker pay back.
- Support Oasis fixed input/output eth to token swap.
- Support Oasis fixed input/output token to eth swap.
- Support Oasis fixed input/output token to token swap.

### Changed

- Change `address[] tokens` to `bytes32[] cache`.

### Fixed

- Fix USDT transfer failure.

## [0.3.0] - 2020-05-25

### Added

- Support Aave deposit and redeem.

## [0.2.1] - 2020-05-04

### Added

- Support Compound CEther and CToken redeem and redeemUnderlying.
- Gas profiling.
- Apply prettier for solidity and js files.

### Fixed

- Revert CEther redeem and redeemUnderlying on failure.
- Revert CToken mint, redeem and redeemUnderlying on failure.

## [0.2.0] - 2020-04-20

### Added

- Support Uniswap token to token swapping.
- Change proxy structure to support a callback from flashloan service.
- Prevent user direct transfer to proxy contract.

### Changed

- Combine the uniswap handlers into a single contract.

### Fixed

- Change Kyber proxy address to constant.

## [0.1.1] - 2020-04-09

### Added

- Support KyberNetwork ether to token.
- Support KyberNetwork token to ether.
- Support KyberNetwork token to token.
- Support Uniswap fix output swapping.

## [0.1.0] - 2020-03-27

### Added

- Proxy interface for Furucombo.
- Registry for handler verification.
- Support Uniswap ether to token swapping (fix input).
- Support Uniswap add liquidity.
- Support Compound CEther and CToken mint.
- Support Uniswap token to ether swapping (fix input).
- Support erc20 token inject.
- Support Uniswap remove liquidity.
