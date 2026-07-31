import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createHistory } from '../../src/client/history.js';

function fakeStorage({ cap = Infinity } = {}) {
  const map = new Map();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem(k, v) {
      if (String(v).length > cap) throw new Error('QuotaExceededError');
      map.set(k, String(v));
    },
    removeItem: (k) => map.delete(k),
  };
}

function ticker(start = 1_700_000_000_000) {
  let t = start;
  return () => (t += 1000);
}

function harness(options = {}) {
  const storage = options.storage ?? fakeStorage();
  return { storage, history: createHistory({ storage, now: ticker(), ...options }) };
}

const KEY = 'rock.history.v1';

describe('recording', () => {
  it('keeps both sides of the conversation in the order they were said', () => {
    const { history } = harness();
    history.begin({ model: 'grok-voice-latest', voice: 'rex' });
    history.append({ role: 'user', content: 'what are you?' });
    history.append({ role: 'assistant', content: 'granite.' });

    const [conversation] = history.conversations;
    assert.deepEqual(conversation.messages.map((m) => [m.role, m.content]), [
      ['user', 'what are you?'],
      ['assistant', 'granite.'],
    ]);
    assert.equal(conversation.model, 'grok-voice-latest');
    assert.equal(conversation.voice, 'rex');
  });

  it('writes a conversation nobody spoke in nowhere', () => {
    const { storage, history } = harness();
    history.begin({ voice: 'rex' });
    history.end();
    assert.equal(storage.getItem(KEY), null);
    assert.deepEqual(history.conversations, []);
  });

  it('drops a turn with nothing in it, and trims the rest', () => {
    const { history } = harness();
    history.begin();
    assert.equal(history.append({ role: 'user', content: '   ' }), null);
    assert.equal(history.append({ role: 'user', content: null }), null);
    history.append({ role: 'assistant', content: '  fine.  ' });
    assert.deepEqual(history.conversations[0].messages.map((m) => m.content), ['fine.']);
  });

  it('starts a conversation on its own for a turn that arrives without one', () => {
    const { history } = harness();
    history.append({ role: 'user', content: 'hello?' });
    assert.equal(history.conversations.length, 1);
    assert.ok(history.live);
  });

  it('separates one call from the next', () => {
    const { history } = harness();
    history.begin({ voice: 'rex' });
    history.append({ role: 'user', content: 'first' });
    history.end();
    history.begin({ voice: 'atlas' });
    history.append({ role: 'user', content: 'second' });

    assert.deepEqual(history.conversations.map((c) => c.voice), ['atlas', 'rex']);
  });

  it('ends idempotently, because every teardown path calls it', () => {
    const { history } = harness();
    history.begin();
    history.append({ role: 'user', content: 'hello' });
    assert.ok(history.end());
    assert.equal(history.end(), null);
    assert.equal(history.live, null);
    assert.equal(history.conversations.length, 1);
  });
});

describe('picking one back up', () => {
  function stored() {
    const { history, storage } = harness();
    history.begin({ voice: 'atlas' });
    history.append({ role: 'user', content: 'what are you?' });
    history.append({ role: 'assistant', content: 'granite.' });
    const [{ id }] = history.conversations;
    history.end();
    history.begin({ voice: 'rex' });
    history.append({ role: 'user', content: 'later' });
    history.end();
    return { history, storage, id };
  }

  it('hands back what was said in the one it reopens', () => {
    const { history, id } = stored();
    const earlier = history.resume(id);

    assert.equal(earlier.id, id);
    assert.deepEqual(earlier.messages.map((m) => m.content), ['what are you?', 'granite.']);
  });

  it('appends what is said next to that conversation, not a new one', () => {
    const { history, id } = stored();
    history.resume(id);
    history.append({ role: 'user', content: 'and now?' });

    assert.equal(history.live, id);
    assert.equal(history.conversations.length, 2);
    assert.deepEqual(history.conversations[0].messages.map((m) => m.content), [
      'what are you?',
      'granite.',
      'and now?',
    ]);
  });

  it('moves it to the top, where the live conversation belongs', () => {
    const { history, id } = stored();
    assert.deepEqual(history.conversations.map((c) => c.voice), ['rex', 'atlas']);
    history.resume(id);
    assert.deepEqual(history.conversations.map((c) => c.voice), ['atlas', 'rex']);
  });

  it('closes the conversation it was in first', () => {
    const { history, id } = stored();
    history.begin({ voice: 'leo' });
    history.append({ role: 'user', content: 'wait' });
    history.resume(id);

    assert.equal(history.live, id);
    assert.equal(history.conversations.filter((c) => c.voice === 'leo').length, 1);
  });

  it('survives the page: the reopened order is what was written', () => {
    const { history, storage, id } = stored();
    history.resume(id);
    const written = JSON.parse(storage.getItem(KEY));
    assert.equal(written.conversations[0].id, id);
  });

  it('says no to an id it does not have, and leaves the log alone', () => {
    const { history, id } = stored();
    history.begin({ voice: 'leo' });
    assert.equal(history.resume('nope'), null);
    assert.notEqual(history.live, id);
  });

  it('hands out turns the caller cannot edit from under us', () => {
    const { history, id } = stored();
    const earlier = history.resume(id);
    earlier.messages.push({ role: 'user', content: 'forged' });
    assert.equal(history.conversations[0].messages.length, 2);
  });
});

describe('persistence', () => {
  it('reads back what an earlier page wrote', () => {
    const storage = fakeStorage();
    const first = createHistory({ storage, now: ticker() });
    first.begin({ voice: 'rex' });
    first.append({ role: 'user', content: 'remember this' });

    const second = createHistory({ storage, now: ticker() });
    assert.equal(second.conversations[0].messages[0].content, 'remember this');
  });

  it('ignores a value it did not write', () => {
    const storage = fakeStorage();
    storage.setItem(KEY, '{"version":99,"conversations":[{"nope":true}]}');
    assert.deepEqual(createHistory({ storage }).conversations, []);

    storage.setItem(KEY, 'not json at all');
    assert.deepEqual(createHistory({ storage }).conversations, []);
  });

  it('carries on in memory when storage refuses every write', () => {
    const storage = fakeStorage({ cap: 0 });
    const history = createHistory({ storage, now: ticker() });
    history.append({ role: 'user', content: 'still here' });
    assert.equal(history.conversations[0].messages[0].content, 'still here');
  });

  it('sheds the oldest conversations to stay under the limit', () => {
    const { history } = harness({ limit: 2 });
    for (const content of ['one', 'two', 'three']) {
      history.begin();
      history.append({ role: 'user', content });
      history.end();
    }
    assert.deepEqual(
      history.conversations.map((c) => c.messages[0].content),
      ['three', 'two'],
    );
  });

  it('sheds to stay under the byte budget too', () => {
    const { history } = harness({ budget: 400 });
    for (let i = 0; i < 12; i++) {
      history.begin();
      history.append({ role: 'assistant', content: `answer number ${i} `.repeat(4) });
      history.end();
    }
    const kept = history.conversations;
    assert.ok(kept.length > 0 && kept.length < 12, `kept ${kept.length}`);
    assert.match(kept[0].messages[0].content, /answer number 11/);
  });

  it('clears everything, including the call in progress', () => {
    const { storage, history } = harness();
    history.begin();
    history.append({ role: 'user', content: 'forget it' });
    history.clear();
    assert.deepEqual(history.conversations, []);
    assert.equal(storage.getItem(KEY), null);

    history.append({ role: 'user', content: 'after' });
    assert.deepEqual(history.conversations[0].messages.map((m) => m.content), ['after']);
  });

  it('removes one conversation by id', () => {
    const { history } = harness();
    history.begin();
    history.append({ role: 'user', content: 'keep' });
    history.end();
    history.begin();
    history.append({ role: 'user', content: 'drop' });
    const [live] = history.conversations;

    assert.equal(history.remove(live.id), true);
    assert.equal(history.remove('nothing-by-that-name'), false);
    assert.deepEqual(history.conversations.map((c) => c.messages[0].content), ['keep']);
    assert.equal(history.live, null);
  });
});

describe('subscribers', () => {
  it('tells the panel when there is something new to draw', () => {
    const { history } = harness();
    let calls = 0;
    const off = history.subscribe(() => calls++);

    history.begin();
    assert.equal(calls, 0, 'an empty conversation is not news');
    history.append({ role: 'user', content: 'hello' });
    history.end();
    history.clear();
    assert.equal(calls, 3);

    off();
    history.append({ role: 'user', content: 'unheard' });
    assert.equal(calls, 3);
  });

  it('hands out conversations the caller cannot edit from under us', () => {
    const { history } = harness();
    history.append({ role: 'user', content: 'mine' });
    history.conversations[0].messages.push({ role: 'user', content: 'theirs' });
    assert.equal(history.conversations[0].messages.length, 1);
  });
});
