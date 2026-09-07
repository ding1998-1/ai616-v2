import test from 'node:test';
import assert from 'node:assert/strict';
import { recordingRequest, withDeadline } from './recordingRequest.mjs';

test('a stalled operation releases the save UI with a retryable error', async () => {
  await assert.rejects(withDeadline(() => new Promise(() => {}), 10), /超时/);
});

test('an explicit server error is preserved', async () => {
  const failure = new Error('Permission denied');
  await assert.rejects(withDeadline(() => Promise.reject(failure), 100), error => error === failure);
});

test('timeout also aborts a stalled response body and a retry can succeed', async () => {
  const original = globalThis.fetch;
  let signal;
  try {
    globalThis.fetch = async (_, options) => {
      signal = options.signal;
      return { text: () => new Promise(() => {}) };
    };
    await assert.rejects(recordingRequest('/recording', {}, 10), /超时/);
    assert.equal(signal.aborted, true);
    globalThis.fetch = async () => new Response('{"success":true}', { status: 200 });
    assert.deepEqual(await (await recordingRequest('/recording')).json(), { success: true });
  } finally {
    globalThis.fetch = original;
  }
});

test('permission failures remain visible to the caller', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('{"detail":"Forbidden"}', { status: 403 });
    const response = await recordingRequest('/recording');
    assert.equal(response.status, 403);
    assert.equal((await response.json()).detail, 'Forbidden');
  } finally {
    globalThis.fetch = original;
  }
});
