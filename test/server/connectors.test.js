import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';

import { AGENTS, splitArgs } from '../../src/server/connectors/agents.js';
import { connectorTools } from '../../src/server/connectors/tools.js';
import { createConnectors } from '../../src/server/connectors/index.js';
import { loadConfig } from '../../src/server/config.js';
import { buildTools, connectorBlock, tasksBlock } from '../../src/server/persona.js';
import { startApp, scratchSettings, settle } from '../helpers/app.js';
import { startXaiStub } from '../helpers/xai-stub.js';

const FAKE = fileURLToPath(new URL('../helpers/fake-agent.js', import.meta.url));

const wired = (extra = {}) => ({
  CONNECTORS: 'openclaw',
  OPENCLAW_COMMAND: `node "${FAKE}" openclaw`,
  ...extra,
});

async function until(ok, ms = 8000) {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = ok();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('nothing arrived in time');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('which agents are connected', () => {
  it('is nobody unless CONNECTORS says otherwise', () => {
    const config = loadConfig({});
    assert.deepEqual(config.tools.connectors, []);
    assert.equal(buildTools(config.tools).some((t) => t.name === 'dispatch_task'), false);
  });

  it('takes the ones it knows', () => {
    const { tools, connectors } = loadConfig({ CONNECTORS: 'openclaw' });
    assert.deepEqual(tools.connectors, ['openclaw']);
    assert.deepEqual(Object.keys(connectors.agents), ['openclaw']);
  });

  it('is the seed for the registry, which is what the panel then edits', () => {
    const connectors = createConnectors(loadConfig({
      CONNECTORS: 'openclaw',
      CONNECTOR_FILE: scratchSettings(),
    }));
    try {
      assert.deepEqual(connectors.agents, ['openclaw']);

      const off = connectors.configure({ agents: { openclaw: { enabled: false } } });
      assert.equal(off.ok, true);
      assert.deepEqual(connectors.agents, []);
      assert.deepEqual(connectors.tools, []);

      const on = connectors.configure({ agents: { openclaw: { enabled: true, mode: 'ambient' } } });
      assert.equal(on.ok, true);
      assert.deepEqual(connectors.agents, ['openclaw']);
      assert.ok(connectors.tools.some((t) => t.name === 'dispatch_task'));
    } finally {
      connectors.close();
    }
  });

  it('turns down a setting that would not work, and keeps what it had', () => {
    const connectors = createConnectors(loadConfig({
      CONNECTORS: 'openclaw',
      CONNECTOR_FILE: scratchSettings(),
    }));
    try {
      const bad = connectors.configure({ agents: { openclaw: { mode: 'yolo' } } });
      assert.equal(bad.ok, false);
      assert.match(bad.error, /no mode called yolo/);

      assert.equal(connectors.configure({ cwd: '/nowhere/at/all' }).ok, false);
      assert.equal(connectors.configure({ limit: 99 }).ok, false);
      assert.equal(connectors.configure({ agents: { cursor: { enabled: true } } }).ok, false);
      assert.deepEqual(connectors.agents, ['openclaw'], 'nothing changed');
    } finally {
      connectors.close();
    }
  });

  it('describes the agents it is switched off as well as on', () => {
    const connectors = createConnectors(loadConfig({ CONNECTOR_FILE: scratchSettings() }));
    try {
      const { agents, cwd } = connectors.settings();
      assert.deepEqual(agents.map((a) => a.name), ['openclaw']);
      assert.deepEqual(agents.map((a) => a.enabled), [false]);
      assert.deepEqual(agents[0].modes, ['isolated', 'ambient']);
      assert.equal(agents[0].command, 'openclaw');
      assert.equal(cwd, process.cwd());
    } finally {
      connectors.close();
    }
  });

  it('drops an agent it has never heard of rather than refusing to boot', () => {
    assert.deepEqual(loadConfig({ CONNECTORS: 'openclaw, cursor' }).tools.connectors, ['openclaw']);
    assert.deepEqual(loadConfig({ CONNECTORS: 'devin' }).tools.connectors, []);
  });

  it('defaults the agent to its own CLI and its narrower mode', () => {
    const { connectors } = loadConfig({ CONNECTORS: 'openclaw' });
    assert.deepEqual(connectors.agents.openclaw.command, ['openclaw']);
    assert.equal(connectors.agents.openclaw.mode, 'isolated');
    assert.equal(connectors.timeoutMs, 900_000);
    assert.equal(connectors.limit, 3);
  });

  it('lets the command be a whole command line, so the CLI can be wrapped', () => {
    const { connectors } = loadConfig({
      CONNECTORS: 'openclaw',
      OPENCLAW_COMMAND: 'docker exec -w "/work space" dev openclaw',
      OPENCLAW_ARGS: '--auth-env-only',
      OPENCLAW_MODEL: 'openai/gpt-5.6-sol',
    });
    assert.deepEqual(connectors.agents.openclaw.command,
      ['docker', 'exec', '-w', '/work space', 'dev', 'openclaw']);
    assert.deepEqual(connectors.agents.openclaw.extra, ['--auth-env-only']);
    assert.equal(connectors.agents.openclaw.model, 'openai/gpt-5.6-sol');
  });

  it('splits a command line the way a shell would, quotes included', () => {
    assert.deepEqual(splitArgs(''), []);
    assert.deepEqual(splitArgs(undefined), []);
    assert.deepEqual(splitArgs(`npx openclaw "two words" 'and more'`),
      ['npx', 'openclaw', 'two words', 'and more']);
  });
});

describe('the command openclaw is given', () => {
  it('runs one turn through agent exec, with JSON back', () => {
    const args = AGENTS.openclaw.args({
      task: 'add a retry',
      model: 'openai/gpt-5.6-sol',
      mode: 'isolated',
      extra: ['--thinking', 'high'],
      cwd: '/repo',
    });
    assert.deepEqual(args, [
      'agent', 'exec', 'add a retry',
      '--json',
      '--timeout', '0',
      '--cwd', '/repo',
      '--isolated',
      '--model', 'openai/gpt-5.6-sol',
      '--thinking', 'high',
    ]);
  });

  /** Its own deadline is off on purpose: the connector's time limit is the one
   *  the panel shows, and the one that actually kills the process. */
  it('takes its own deadline off, and lets an operator put one back', () => {
    const plain = AGENTS.openclaw.args({ task: 'go', model: '', mode: 'isolated', extra: [] });
    assert.deepEqual(plain.slice(0, 6), ['agent', 'exec', 'go', '--json', '--timeout', '0']);

    const theirs = AGENTS.openclaw.args({
      task: 'go', model: '', mode: 'isolated', extra: ['--timeout', '300'],
    });
    assert.deepEqual(theirs.slice(-2), ['--timeout', '300'], 'and theirs is the later flag');
  });

  it('only ignores the machine’s own config when the mode says so', () => {
    const isolated = AGENTS.openclaw.args({ task: 'go', model: '', mode: 'isolated', extra: [] });
    assert.ok(isolated.includes('--isolated'));

    const ambient = AGENTS.openclaw.args({ task: 'go', model: '', mode: 'ambient', extra: [] });
    assert.equal(ambient.includes('--isolated'), false);
  });

  it('hands it the workspace as a flag rather than trusting inheritance', () => {
    const args = AGENTS.openclaw.args({ task: 'go', model: '', mode: '', extra: [], cwd: '/work' });
    assert.deepEqual(args.slice(0, 8), [
      'agent', 'exec', 'go', '--json', '--timeout', '0', '--cwd', '/work',
    ]);
  });
});

describe('reading what an agent printed', () => {
  it('takes the final answer out of the envelope', () => {
    const stdout = JSON.stringify({
      ok: true, status: 'ok', final: 'four files changed', payloads: [{ text: 'four files changed' }],
    });
    assert.deepEqual(AGENTS.openclaw.parse(stdout, ''), { summary: 'four files changed' });
  });

  it('falls back to the payloads when there is no final text', () => {
    const stdout = JSON.stringify({ ok: true, status: 'ok', payloads: [{ text: 'tests pass' }] });
    assert.deepEqual(AGENTS.openclaw.parse(stdout, ''), { summary: 'tests pass' });
  });

  it('treats its own error envelope as a failure, and keeps what it said', () => {
    const failed = JSON.stringify({
      ok: false, status: 'error', final: 'got two files in', error: { message: 'model refused', kind: 'model' },
    });
    assert.deepEqual(AGENTS.openclaw.parse(failed, ''),
      { summary: 'got two files in', error: 'model refused' });

    const late = JSON.stringify({ ok: false, status: 'timeout', final: '' });
    assert.deepEqual(AGENTS.openclaw.parse(late, ''),
      { summary: '', error: 'it ran past its own deadline' });
  });

  it('reads it out of a stream of lines as happily as one document', () => {
    const stdout = [
      'a log line that is not JSON at all',
      '{"type":"progress","step":"reading the file"}',
      '{"ok":true,"status":"ok","final":"tests pass"}',
    ].join('\n');
    assert.deepEqual(AGENTS.openclaw.parse(stdout, ''), { summary: 'tests pass' });
  });

  it('keeps the plain output when the envelope is not there', () => {
    assert.deepEqual(AGENTS.openclaw.parse('done, I think\n', ''), { summary: 'done, I think' });
    assert.deepEqual(AGENTS.openclaw.parse('', 'no such model'), { summary: 'no such model' });
  });
});

describe('what the session is told', () => {
  it('says nothing about handing work over when nothing is connected', () => {
    assert.equal(connectorBlock([]), '');
    assert.equal(connectorBlock(undefined), '');
    assert.equal(tasksBlock([]), '');
  });

  it('names the agents it actually has, and what is already running', () => {
    assert.match(connectorBlock(['openclaw']), /You can hand work to OpenClaw/);
    assert.match(connectorBlock(['openclaw']), /dispatch_task/);

    const block = tasksBlock([
      { id: '1', agent: 'openclaw', status: 'running', task: 'add a retry', ran_for: '2m 0s' },
      { id: '2', agent: 'openclaw', status: 'done', task: 'fix the lint', ran_for: '30s', summary: 'one file' },
    ]);
    assert.match(block, /task 1, with openclaw, "add a retry" — running for 2m 0s/);
    assert.match(block, /task 2, with openclaw, "fix the lint" — done after 30s: one file/);
  });

  it('offers the three tools, and only the agents that are on', () => {
    const [dispatch, check, cancel] = connectorTools(['openclaw']);
    assert.deepEqual([dispatch.name, check.name, cancel.name],
      ['dispatch_task', 'check_task', 'cancel_task']);
    assert.deepEqual(dispatch.parameters.properties.agent.enum, ['openclaw']);
    assert.deepEqual(dispatch.parameters.required, ['task']);
    assert.deepEqual(cancel.parameters.required, ['id']);
    assert.deepEqual(connectorTools([]), []);
  });
});

describe('handing work over, end to end', () => {
  let xai;
  let app;
  let client;

  const outputs = () => xai.received()
    .filter((f) => f.type === 'conversation.item.create' && f.item?.type === 'function_call_output')
    .map((f) => ({ call_id: f.item.call_id, ...JSON.parse(f.item.output) }));

  const notes = () => xai.received()
    .filter((f) => f.type === 'conversation.item.create' && f.item?.type === 'message')
    .map((f) => f.item.content[0].text);

  const answerFor = (id) => until(() => outputs().find((o) => o.call_id === id));

  const callTool = (call_id, name, args) => xai.send({
    type: 'response.output_item.done',
    item: { type: 'function_call', call_id, name, arguments: JSON.stringify(args) },
  });

  before(async () => {
    xai = await startXaiStub();
    app = await startApp(wired({ XAI_REALTIME_URL: xai.address }));
    client = await app.openSocket();
    await client.waitFor('proxy.ready');
  });

  after(async () => {
    await app.close();
    await xai.close();
  });

  it('declares the tools and the block that explains them', () => {
    const [update] = xai.received();
    const named = update.session.tools.map((t) => t.name ?? t.type);
    assert.ok(named.includes('dispatch_task'), 'the model can hand work over');
    assert.match(update.session.instructions, /You can hand work to OpenClaw/);
  });

  it('dispatches, answers the call at once, and tells the page', async () => {
    callTool('c1', 'dispatch_task', { task: 'add a retry' });

    const answer = await answerFor('c1');
    assert.equal(answer.ok, true);
    assert.equal(answer.id, '1');
    assert.equal(answer.agent, 'openclaw');
    assert.equal(answer.status, 'running');

    const update = await client.waitFor('task.update');
    assert.equal(update.task.id, '1');
    assert.equal(update.task.status, 'running');
  });

  it('reports back in the person’s place once the agent is done', async () => {
    const note = await until(() => notes().find((text) => /task 1/.test(text)));
    assert.match(note, /^\[rock\]/);
    assert.match(note, /finished/);
    assert.match(note, /openclaw did: add a retry/);

    const at = xai.received().findIndex((f) => f.item?.content?.[0]?.text === note);
    assert.equal(xai.received()[at + 1].type, 'response.create', 'and asks for an answer');
  });

  it('has the whole story when it is asked for it', async () => {
    callTool('c2', 'check_task', { id: '1' });

    const answer = await answerFor('c2');
    assert.equal(answer.status, 'done');
    assert.match(answer.summary, /openclaw did: add a retry/);
    assert.match(answer.ran_for, /^\d+s$/);
  });

  it('says which task it is when there is no number', async () => {
    callTool('c3', 'check_task', {});

    const answer = await answerFor('c3');
    assert.deepEqual(answer.tasks.map((t) => t.id), ['1']);
  });

  it('calls a failed run a failure, and says what it printed', async () => {
    callTool('c4', 'dispatch_task', { task: 'make it fail' });
    await answerFor('c4');

    const note = await until(() => notes().find((text) => /task 2/.test(text)));
    assert.match(note, /failed/);
    assert.match(note, /the build is on fire/);
  });

  /** An envelope that says the run went wrong is a failure even though the CLI
   *  printed something perfectly well-formed. */
  it('believes the envelope when it says the run went wrong', async () => {
    callTool('c4b', 'dispatch_task', { task: 'refuse this one' });
    await answerFor('c4b');

    const note = await until(() => notes().find((text) => /task 3/.test(text)));
    assert.match(note, /failed/);
    assert.match(note, /no provider is configured/);
  });

  it('stops one that is still going, and keeps the number', async () => {
    callTool('c5', 'dispatch_task', { task: 'sleep on it' });
    const dispatched = await answerFor('c5');
    assert.equal(dispatched.status, 'running');

    callTool('c6', 'cancel_task', { id: dispatched.id });
    const cancelled = await answerFor('c6');
    assert.equal(cancelled.ok, true);

    const settled = await until(() => client.frames.find(
      (f) => f.type === 'task.update' && f.task.id === dispatched.id && f.task.status === 'cancelled',
    ));
    assert.match(settled.task.error, /stopped before it finished/);
  });

  it('refuses a number that was never handed out', async () => {
    callTool('c7', 'check_task', { id: '99' });
    const answer = await answerFor('c7');
    assert.equal(answer.ok, false);
    assert.match(answer.error, /no task 99/);

    callTool('c8', 'cancel_task', { id: '1' });
    const stale = await answerFor('c8');
    assert.equal(stale.ok, false);
    assert.match(stale.error, /already done/);
  });

  it('leaves the page’s own tools to the page', async () => {
    const before = outputs().length;
    callTool('c9', 'remember', { memory: 'drinks his coffee black' });
    await settle();
    assert.equal(outputs().length, before, 'the proxy answered nothing');
  });
});

describe('the picker in the composer', () => {
  let xai;
  let app;

  before(async () => {
    xai = await startXaiStub();
    app = await startApp(wired({ XAI_REALTIME_URL: xai.address }));
  });

  after(async () => {
    await app.close();
    await xai.close();
  });

  it('offers the agents that are on, over the API the page reads', async () => {
    const body = await (await app.get('/api/tasks')).json();
    assert.deepEqual(body.agents, ['openclaw']);
    assert.deepEqual(body.tasks, []);
  });

  it('sends the work to whichever one is picked, without a redial', async () => {
    const client = await app.openSocket();
    await client.waitFor('proxy.ready');

    client.send({ type: 'session.agent', agent: 'openclaw' });
    await settle();

    xai.send({
      type: 'response.output_item.done',
      item: {
        type: 'function_call',
        call_id: 'p1',
        name: 'dispatch_task',
        arguments: JSON.stringify({ task: 'take this one' }),
      },
    });

    const answer = await until(() => xai.received()
      .filter((f) => f.item?.type === 'function_call_output')
      .map((f) => JSON.parse(f.item.output))
      .find((o) => o.id));
    assert.equal(answer.agent, 'openclaw');
  });

  it('ignores a pick that is not a connected agent', async () => {
    const client = await app.openSocket();
    await client.waitFor('proxy.ready');
    client.send({ type: 'session.agent', agent: 'cursor' });
    await settle();

    assert.equal(xai.received().some((f) => f.type === 'session.agent'), false,
      'the frame never leaves the proxy');
  });

  it('stops a task from the panel, not only from the conversation', async () => {
    const client = await app.openSocket();
    await client.waitFor('proxy.ready');
    xai.send({
      type: 'response.output_item.done',
      item: {
        type: 'function_call',
        call_id: 'p3',
        name: 'dispatch_task',
        arguments: JSON.stringify({ task: 'sleep until stopped' }),
      },
    });

    const running = await until(() => xai.received()
      .filter((f) => f.item?.type === 'function_call_output')
      .map((f) => JSON.parse(f.item.output))
      .find((o) => o.status === 'running' && /sleep until stopped/.test(o.task ?? '')));

    const res = await fetch(`${app.origin}/api/tasks/${running.id}/stop`, { method: 'POST' });
    assert.equal(res.status, 200);

    const settled = await until(() => client.frames.find(
      (f) => f.type === 'task.update' && f.task.id === running.id && f.task.status === 'cancelled',
    ));
    assert.ok(settled, 'the page hears about it over the socket too');

    const stale = await fetch(`${app.origin}/api/tasks/${running.id}/stop`, { method: 'POST' });
    assert.equal(stale.status, 409);
  });
});

describe('a task that outlives the call it came from', () => {
  let xai;
  let app;

  before(async () => {
    xai = await startXaiStub();
    app = await startApp(wired({ XAI_REALTIME_URL: xai.address }));
  });

  after(async () => {
    await app.close();
    await xai.close();
  });

  it('is still there, and in the prompt, when the next call opens', async () => {
    const first = await app.openSocket();
    await first.waitFor('proxy.ready');
    xai.send({
      type: 'response.output_item.done',
      item: {
        type: 'function_call',
        call_id: 'd1',
        name: 'dispatch_task',
        arguments: JSON.stringify({ task: 'sleep through the redial' }),
      },
    });
    await until(() => xai.received().some((f) => f.item?.type === 'function_call_output'));

    first.ws.close();
    await settle();

    const second = await app.openSocket();
    const replayed = await second.waitFor('task.update');
    assert.equal(replayed.task.status, 'running');
    assert.equal(replayed.replay, true, 'and is marked as the catch-up it is');

    const update = xai.received().findLast((f) => f.type === 'session.update');
    assert.match(update.session.instructions, /sleep through the redial/);
  });

  /**
   * The board is refilled from these, so they have to arrive whatever the
   * status. The log is not: a task that finished two calls ago has already
   * been written down, and the page only knows that because of the mark.
   */
  it('is marked as old news when it settled before the call opened', async () => {
    const first = await app.openSocket();
    await first.waitFor('proxy.ready');
    xai.send({
      type: 'response.output_item.done',
      item: {
        type: 'function_call',
        call_id: 'd2',
        name: 'dispatch_task',
        arguments: JSON.stringify({ task: 'finish before the redial' }),
      },
    });
    const done = await until(() => first.frames.find(
      (f) => f.type === 'task.update' && f.task.status === 'done',
    ));
    assert.equal(done.replay, undefined, 'the one that actually happened is news');

    first.ws.close();
    await settle();

    const second = await app.openSocket();
    await second.waitFor('proxy.ready');
    await settle();

    const again = second.frames.filter((f) => f.type === 'task.update' && f.task.id === done.task.id);
    assert.equal(again.length, 1);
    assert.equal(again[0].task.status, 'done');
    assert.equal(again[0].replay, true);
  });
});

/**
 * Switching a connector off is what someone does when they want the agent to
 * stop. A task already running is a child process editing real files, and the
 * only two things that can reach it — the stop button and the model's own
 * cancel_task — must not go with the tool list.
 */
describe('a task whose agent is switched off underneath it', () => {
  it('can still be looked in on and stopped', async () => {
    const xai = await startXaiStub();
    const app = await startApp(wired({
      XAI_REALTIME_URL: xai.address,
      CONNECTOR_FILE: scratchSettings(),
    }));
    try {
      const client = await app.openSocket();
      await client.waitFor('proxy.ready');

      xai.send({
        type: 'response.output_item.done',
        item: {
          type: 'function_call',
          call_id: 'off1',
          name: 'dispatch_task',
          arguments: JSON.stringify({ task: 'sleep until stopped' }),
        },
      });

      const running = await until(() => xai.received()
        .filter((f) => f.item?.type === 'function_call_output')
        .map((f) => JSON.parse(f.item.output))
        .find((o) => o.status === 'running'));

      const off = await fetch(`${app.origin}/api/connectors`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agents: { openclaw: { enabled: false } } }),
      });
      assert.equal(off.status, 200);
      assert.deepEqual((await (await app.get('/api/tasks')).json()).agents, [],
        'nothing is on any more');

      const stopped = await fetch(`${app.origin}/api/tasks/${running.id}/stop`, { method: 'POST' });
      assert.equal(stopped.status, 200, 'the stop button still reaches it');

      const settled = await until(() => client.frames.find(
        (f) => f.type === 'task.update' && f.task.id === running.id && f.task.status === 'cancelled',
      ));
      assert.ok(settled, 'the agent actually went');
    } finally {
      await app.close();
      await xai.close();
    }
  });

  it('still has nowhere to send new work', async () => {
    const connectors = createConnectors({
      connectors: { agents: {}, file: scratchSettings() },
    });
    try {
      assert.match(connectors.run('dispatch_task', { task: 'anything' }).error,
        /no agent is switched on/);
      assert.match(connectors.run('cancel_task', { id: '1' }).error, /no task 1/);
      assert.deepEqual(connectors.run('check_task', {}).tasks, []);
    } finally {
      connectors.close();
    }
  });
});

describe('a task nobody stops', () => {
  it('is stopped for them, and says so', async () => {
    const xai = await startXaiStub();
    const app = await startApp(wired({ XAI_REALTIME_URL: xai.address, CONNECTOR_TIMEOUT: '0.4' }));
    try {
      const client = await app.openSocket();
      await client.waitFor('proxy.ready');
      xai.send({
        type: 'response.output_item.done',
        item: {
          type: 'function_call',
          call_id: 'e1',
          name: 'dispatch_task',
          arguments: JSON.stringify({ task: 'sleep forever' }),
        },
      });

      const settled = await until(() => client.frames.find(
        (f) => f.type === 'task.update' && f.task.status === 'timeout',
      ));
      assert.match(settled.task.error, /time limit/);
    } finally {
      await app.close();
      await xai.close();
    }
  });
});

describe('too much at once', () => {
  it('is turned down rather than queued', async () => {
    const xai = await startXaiStub();
    const app = await startApp(wired({ XAI_REALTIME_URL: xai.address, CONNECTOR_LIMIT: '1' }));
    try {
      const client = await app.openSocket();
      await client.waitFor('proxy.ready');

      const call = (id, task) => xai.send({
        type: 'response.output_item.done',
        item: { type: 'function_call', call_id: id, name: 'dispatch_task', arguments: JSON.stringify({ task }) },
      });

      call('f1', 'sleep on the first one');
      call('f2', 'sleep on the second one');

      const answers = await until(() => {
        const found = xai.received()
          .filter((f) => f.item?.type === 'function_call_output')
          .map((f) => JSON.parse(f.item.output));
        return found.length === 2 ? found : null;
      });

      assert.equal(answers[0].ok, true);
      assert.equal(answers[1].ok, false);
      assert.match(answers[1].error, /already running/);
    } finally {
      await app.close();
      await xai.close();
    }
  });
});

describe('where an agent actually works', () => {
  it('starts it in the workspace, and says so in the task rather than the agent', async () => {
    const xai = await startXaiStub();
    const app = await startApp(wired({ XAI_REALTIME_URL: xai.address, CONNECTOR_CWD: tmpdir() }));
    try {
      const client = await app.openSocket();
      await client.waitFor('proxy.ready');
      xai.send({
        type: 'response.output_item.done',
        item: {
          type: 'function_call',
          call_id: 'w1',
          name: 'dispatch_task',
          arguments: JSON.stringify({ task: 'say where you are' }),
        },
      });

      const dispatched = await until(() => xai.received()
        .filter((f) => f.item?.type === 'function_call_output')
        .map((f) => JSON.parse(f.item.output))
        .find((o) => o.cwd));
      assert.equal(dispatched.cwd, resolve(tmpdir()), 'the task carries the resolved workspace');

      const settled = await until(() => client.frames.find(
        (f) => f.type === 'task.update' && f.task.status === 'done',
      ));

      assert.match(settled.task.summary, new RegExp(`cwd=${resolve(tmpdir())}\\b`),
        'and that is the directory the process was started in');
      assert.match(settled.task.summary, new RegExp(`PWD=${resolve(tmpdir())}\\b`),
        'including PWD, which spawn does not update on its own');
      assert.match(settled.task.summary, /key=undefined/, 'and never our key');
    } finally {
      await app.close();
      await xai.close();
    }
  });
});

describe('setting the connectors up from the panel', () => {
  let xai;
  let app;
  const file = scratchSettings();

  const put = (patch) => fetch(`${app.origin}/api/connectors`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });

  before(async () => {
    xai = await startXaiStub();
    app = await startApp({ XAI_REALTIME_URL: xai.address, CONNECTOR_FILE: file });
  });

  after(async () => {
    await app.close();
    await xai.close();
  });

  it('opens with every agent known, all off, and no tools declared', async () => {
    const body = await (await app.get('/api/connectors')).json();
    assert.deepEqual(body.agents.map((a) => a.name), ['openclaw']);
    assert.deepEqual(body.agents.map((a) => a.enabled), [false]);

    const config = await (await app.get('/api/config')).json();
    assert.deepEqual(config.tools.connectors, []);
  });

  it('switches one on mid-call, and re-declares the tools to the model', async () => {
    const client = await app.openSocket();
    await client.waitFor('proxy.ready');
    const before = xai.received().filter((f) => f.type === 'session.update').length;

    const res = await put({ agents: { openclaw: { enabled: true, mode: 'isolated' } } });
    assert.equal(res.status, 200);

    const update = await until(() => {
      const all = xai.received().filter((f) => f.type === 'session.update');
      return all.length > before ? all.at(-1) : null;
    });
    assert.ok(update.session.tools.some((t) => t.name === 'dispatch_task'),
      'the model is told it can hand work over now, without a redial');
    assert.match(update.session.instructions, /You can hand work to OpenClaw/);

    const told = await client.waitFor('connectors.update');
    assert.deepEqual(told.agents, ['openclaw']);
  });

  it('saves it, so the next boot opens with the same setup', async () => {
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(saved.agents.openclaw.enabled, true);
    assert.equal(saved.agents.openclaw.mode, 'isolated');

    const next = await startApp({ CONNECTOR_FILE: file });
    try {
      const body = await (await next.get('/api/config')).json();
      assert.deepEqual(body.tools.connectors, ['openclaw']);
    } finally {
      await next.close();
    }
  });

  it('says what is wrong with a setting rather than taking it', async () => {
    const res = await put({ cwd: '/definitely/not/here' });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.match(body.error, /no directory/);

    const still = await (await app.get('/api/config')).json();
    assert.deepEqual(still.tools.connectors, ['openclaw'], 'the working setup is untouched');
  });

  it('never puts the command line in reach of the page', async () => {
    const res = await put({ agents: { openclaw: { command: 'rm -rf /' } } });
    assert.equal(res.status, 200);

    const body = await (await app.get('/api/connectors')).json();
    assert.equal(body.agents.find((a) => a.name === 'openclaw').command, 'openclaw');
  });

  /**
   * The panel can switch the last agent off between a dispatch going out and
   * the frame carrying it arriving. That call still has to come back with
   * something: a model waiting on its own tool waits for the whole call.
   */
  it('still answers a call that arrives after the last agent went off', async () => {
    const client = await app.openSocket();
    await client.waitFor('proxy.ready');

    assert.equal((await put({ agents: { openclaw: { enabled: false } } })).status, 200);
    await settle();

    xai.send({
      type: 'response.output_item.done',
      item: {
        type: 'function_call',
        call_id: 'gone',
        name: 'dispatch_task',
        arguments: JSON.stringify({ task: 'too late' }),
      },
    });

    const answer = await until(() => xai.received().findLast(
      (f) => f.item?.type === 'function_call_output' && f.item.call_id === 'gone',
    ));
    const output = JSON.parse(answer.item.output);
    assert.equal(output.ok, false);
    assert.match(output.error, /no agent is switched on/);
  });
});
