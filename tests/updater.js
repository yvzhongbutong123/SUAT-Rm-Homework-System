'use strict';
const assert = require('node:assert');
const { compareVersions } = require('../src/main/updater');

assert.strictEqual(compareVersions('1.0.0', '1.0.0'), 0);
assert.strictEqual(compareVersions('1.0.1', '1.0.0'), 1);
assert.strictEqual(compareVersions('1.0', '1.0.0'), 0);
assert.strictEqual(compareVersions('v1.2.0', '1.1.9'), 1);
assert.strictEqual(compareVersions('0.9.9', '1.0.0'), -1);
console.log('updater: compareVersions 5 项通过');
