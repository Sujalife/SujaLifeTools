import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {generateRules} from '../scripts/rules.mjs';

test('committed direct RTDB rules match the authoritative generator',async()=>{
 const committed=JSON.parse(await readFile(new URL('../database.rules.json',import.meta.url),'utf8'));
 assert.deepEqual(committed,generateRules());
});

test('Master identity is Console pinned and anonymous session lookups are absent',()=>{
 const rules=generateRules().rules;
 assert.equal(rules['.read'],false);assert.equal(rules['.write'],false);
 assert.equal(rules.toolsV2.config['.write'],false);
 assert.equal(rules.toolsV2.sessions,undefined);assert.equal(rules.toolsV2.loginLookup,undefined);
 assert.equal(rules.toolsV1,undefined);
});
