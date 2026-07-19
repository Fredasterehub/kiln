import test from 'node:test';
import assert from 'node:assert/strict';
import { median } from './median.mjs';
test('odd-length median', () => { assert.equal(median([3, 1, 2]), 2); });
