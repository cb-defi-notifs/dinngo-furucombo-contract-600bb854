const metis = require('../../deploy/utils/addresses_metis');

module.exports = {
  /* MDAI */
  DAI_TOKEN: '0x4c078361FC9BbB78DF910800A991C7c3DD2F6ce0',

  /* MUSDT */
  USDT_TOKEN: '0xbB06DCA3AE6887fAbF931640f67cab3e3a16F4dC',

  /* MUSDC */
  USDC_TOKEN: '0xEA32A96608495e54156Ae48931A7c20f0dcc1a21',

  /* MAI */
  MAI_TOKEN: '0xdFA46478F9e5EA86d57387849598dbFB2e964b02',

  /* Services */
  HUMMUS_ROUTER01: metis.HUMMUS_ROUTER01,
  HUMMUS_POOL_USDT_USDC_DAI: '0x248fD66e6ED1E0B325d7b80F5A7e7d8AA2b2528b',
  HUMMUS_POOL_USDC_MAI: '0x5b7e71F6364DA1716c44a5278098bc46711b9516',

  /* Event Signature */
  RecordHandlerResultSig:
    '0x90c726ff5efa7268723ee48df835144384bc0f012e89750782886764b5e54f16',

  // Handler Type
  HANDLER_TYPE: { TOKEN: 0, CUSTOM: 1, OTHERS: 2 },

  // Fee
  STORAGE_KEY_MSG_SENDER:
    '0xb2f2618cecbbb6e7468cc0f2aa43858ad8d153e0280b22285e28e853bb9d453a',
  STORAGE_KEY_CUBE_COUNTER:
    '0xf9543f11459ccccd21306c8881aaab675ff49d988c1162fd1dd9bbcdbe4446be',
  STORAGE_KEY_FEE_RATE:
    '0x142183525227cae0e4300fd0fc77d7f3b08ceb0fd9cb2a6c5488668fa0ea5ffa',
  STORAGE_KEY_FEE_COLLECTOR:
    '0x60d7a7cc0a45d852bd613e4f527aaa2e4b81fff918a69a2aab88b6458751d614',
};
