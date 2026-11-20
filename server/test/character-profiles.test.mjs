import test from 'node:test';
import assert from 'node:assert/strict';
import {createTestApp} from './helpers.mjs';

test('only the owner can read or update their character text, including after a retry', async () => {
  const app = await createTestApp();
  const owner = await app.register('owner@example.com');
  const other = await app.register('other@example.com');
  const path = '/api/v1/characters/abc', list = '/api/v1/characters';
  const write = (token, body) => app.call(path, {method:'PUT', token, body});
  const body = {name:'星野', persona:'喜欢观察夏天的云。'};
  assert.equal((await write(undefined, body)).status, 401);
  assert.equal((await write(owner.accessToken, {...body, apiKey:'fixture'})).status, 400);
  assert.equal((await write(owner.accessToken, {...body, glb:'fixture'})).status, 400);
  assert.equal((await write(owner.accessToken, body)).status, 200);
  assert.equal((await write(owner.accessToken, body)).status, 200);
  assert.deepEqual((await app.call(list, {token:other.accessToken})).data.characters, []);
  await write(other.accessToken, {...body, name:'海边'});
  assert.deepEqual((await app.call(list, {token:owner.accessToken})).data.characters, [{id:'abc', ...body}]);
});
