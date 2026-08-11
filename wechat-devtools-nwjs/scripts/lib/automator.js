"use strict";

function loadAutomator() {
  const overrideModule = process.env.WEAPP_AUTO_AUTOMATOR_MODULE;
  if (overrideModule) {
    return require(overrideModule);
  }
  return require("miniprogram-automator");
}

module.exports = {
  loadAutomator,
};
