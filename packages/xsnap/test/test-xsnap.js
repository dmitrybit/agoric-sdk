import test from 'ava';
import * as childProcess from 'child_process';
import * as os from 'os';
import { xsnap } from '../src/xsnap';

const importMetaUrl = `file://${__filename}`;

const decoder = new TextDecoder();
const encoder = new TextEncoder();

const xsnapOptions = {
  name: 'xsnap test worker',
  spawn: childProcess.spawn,
  os: os.type(),
  stderr: 'inherit',
  stdout: 'inherit',
};

function options() {
  const messages = [];
  async function handleCommand(message) {
    messages.push(decoder.decode(message));
    return new Uint8Array();
  }
  return { ...xsnapOptions, handleCommand, messages };
}

test('evaluate and issueCommand', async t => {
  const opts = options();
  const vat = xsnap(opts);
  await vat.evaluate(`issueCommand(ArrayBuffer.fromString("Hello, World!"));`);
  await vat.close();
  t.deepEqual(['Hello, World!'], opts.messages);
});

test('evaluate until idle', async t => {
  const opts = options();
  const vat = xsnap(opts);
  await vat.evaluate(`
    (async () => {
      issueCommand(ArrayBuffer.fromString("Hello, World!"));
    })();
  `);
  await vat.close();
  t.deepEqual(['Hello, World!'], opts.messages);
});

test('evaluate infinite loop', async t => {
  const opts = options();
  const vat = xsnap(opts);
  await t.throwsAsync(vat.evaluate(`for (;;) {}`), {
    message: 'xsnap test worker exited',
    instanceOf: Error,
  });
  await vat.close();
  t.deepEqual([], opts.messages);
});

// TODO: Reenable when this doesn't take 3.6 seconds.
test.skip('evaluate promise loop', async t => {
  const opts = options();
  const vat = xsnap(opts);
  await t.throwsAsync(
    vat.evaluate(`
    function f() {
      Promise.resolve().then(f);
    }
    f();
  `),
    {
      message: 'xsnap test worker exited',
      instanceOf: Error,
    },
  );
  await vat.close();
  t.deepEqual([], opts.messages);
});

test('evaluate and report', async t => {
  const opts = options();
  const vat = xsnap(opts);
  const result = await vat.evaluate(`(() => {
    const report = {};
    Promise.resolve('hi').then(v => {
      report.result = ArrayBuffer.fromString(v);
    });
    return report;
  })()`);
  await vat.close();
  const { reply } = result;
  t.deepEqual('hi', decoder.decode(reply));
});

test('evaluate error', async t => {
  const opts = options();
  const vat = xsnap(opts);
  await vat
    .evaluate(`***`)
    .then(_ => {
      t.fail('should throw');
    })
    .catch(_ => {
      t.pass();
    });
  await vat.terminate();
});

test('evaluate does not throw on unhandled rejections', async t => {
  const opts = options();
  // ISSUE: how to test that they are not entirely unobservable?
  // It's important that we can observe them using xsbug.
  // We can confirm this by running xsbug while running this test.
  for await (const debug of [false, true]) {
    const vat = xsnap({ ...opts, debug });
    t.teardown(() => vat.terminate());
    await t.notThrowsAsync(vat.evaluate(`Promise.reject(1)`));
  }
});

test('reject odd regex range', async t => {
  const opts = options();
  const vat = xsnap(opts);
  await vat
    .evaluate(
      `const FILENAME_FILTER = /^((?:.*[( ])?)[:/\\w-_]*\\/(packages\\/.+)$/;`,
    )
    .then(_ => {
      t.fail('should throw');
    })
    .catch(_ => {
      t.pass();
    });
  await vat.terminate();
});

test('accept std regex range', async t => {
  const opts = options();
  const vat = xsnap(opts);
  await vat.evaluate(
    `const FILENAME_FILTER = /^((?:.*[( ])?)[:/\\w_-]*\\/(packages\\/.+)$/;`,
  );
  t.pass();
  await vat.terminate();
});

test('bigint map key', async t => {
  const opts = options();
  const vat = xsnap(opts);
  t.teardown(() => vat.terminate());
  await vat.evaluate(`
    const send = it => issueCommand(ArrayBuffer.fromString(JSON.stringify(it)));
    const store = new Map([[1n, "abc"]]);
    send(store.get(1n))
  `);
  t.deepEqual(opts.messages, ['"abc"']);
});

test('keyword in destructuring', async t => {
  const opts = options();
  const vat = xsnap(opts);
  t.teardown(() => vat.terminate());
  await vat.evaluate(`
    const send = it => issueCommand(ArrayBuffer.fromString(JSON.stringify(it)));
    const { default: d, in: i } = { default: 1, in: 2 };
    send({ d, i })
  `);
  t.deepEqual(opts.messages, ['{"d":1,"i":2}']);
});

test('idle includes setImmediate too', async t => {
  const opts = options();
  const vat = xsnap(opts);
  await vat.evaluate(`
    const send = it => issueCommand(ArrayBuffer.fromString(it));
    setImmediate(() => send("end of crank"));
    Promise.resolve("turn 2").then(send);
    send("turn 1");
  `);
  await vat.close();
  t.deepEqual(['turn 1', 'turn 2', 'end of crank'], opts.messages);
});

test('print - start compartment only', async t => {
  const opts = options();
  const vat = xsnap(opts);
  await vat.evaluate(`
    const send = it => issueCommand(ArrayBuffer.fromString(it));
    print(123);
    try {
      (new Compartment()).evalate('print("456")');
    } catch (_err) {
      send('no print in Compartment');
    }
  `);
  await vat.close();
  t.deepEqual(['no print in Compartment'], opts.messages);
});

test('run script until idle', async t => {
  const opts = options();
  const vat = xsnap(opts);
  await vat.execute(new URL('fixture-xsnap-script.js', importMetaUrl).pathname);
  await vat.close();
  t.deepEqual(['Hello, World!'], opts.messages);
});

test('issueCommand is synchronous inside, async outside', async t => {
  const messages = [];
  async function handleCommand(request) {
    const number = +decoder.decode(request);
    await Promise.resolve(null);
    messages.push(number);
    await Promise.resolve(null);
    return encoder.encode(`${number + 1}`);
  }
  const vat = xsnap({ ...xsnapOptions, handleCommand });
  await vat.evaluate(`
    const response = issueCommand(ArrayBuffer.fromString('0'));
    const number = +String.fromArrayBuffer(response);
    issueCommand(ArrayBuffer.fromString(String(number + 1)));
  `);
  await vat.close();
  t.deepEqual([0, 2], messages);
});

test('deliver a message', async t => {
  const messages = [];
  async function handleCommand(message) {
    messages.push(+decoder.decode(message));
    return new Uint8Array();
  }
  const vat = xsnap({ ...xsnapOptions, handleCommand });
  await vat.evaluate(`
    function handleCommand(message) {
      const number = +String.fromArrayBuffer(message);
      issueCommand(ArrayBuffer.fromString(String(number + 1)));
    };
  `);
  await vat.issueStringCommand('0');
  await vat.issueStringCommand('1');
  await vat.issueStringCommand('2');
  await vat.close();
  t.deepEqual([1, 2, 3], messages);
});

test('receive a response', async t => {
  const messages = [];
  async function handleCommand(message) {
    messages.push(+decoder.decode(message));
    return new Uint8Array();
  }
  const vat = xsnap({ ...xsnapOptions, handleCommand });
  await vat.evaluate(`
    function handleCommand(message) {
      const number = +String.fromArrayBuffer(message);
      return ArrayBuffer.fromString(String(number + 1));
    };
  `);
  t.is('1', (await vat.issueStringCommand('0')).reply);
  t.is('2', (await vat.issueStringCommand('1')).reply);
  t.is('3', (await vat.issueStringCommand('2')).reply);
  await vat.close();
});

function* count(end, start = 0, stride = 1) {
  for (; start < end; start += stride) {
    yield start;
  }
}

test('serialize concurrent messages', async t => {
  const messages = [];
  async function handleCommand(message) {
    messages.push(+decoder.decode(message));
    return new Uint8Array();
  }
  const vat = xsnap({ ...xsnapOptions, handleCommand });
  await vat.evaluate(`
    globalThis.handleCommand = message => {
      const number = +String.fromArrayBuffer(message);
      issueCommand(ArrayBuffer.fromString(String(number + 1)));
    };
  `);
  await Promise.all([...count(100)].map(n => vat.issueStringCommand(`${n}`)));
  await vat.close();
  t.deepEqual([...count(101, 1)], messages);
});

test('write and read snapshot', async t => {
  const messages = [];
  async function handleCommand(message) {
    messages.push(decoder.decode(message));
    return new Uint8Array();
  }

  const snapshot = new URL('fixture-snapshot.xss', importMetaUrl).pathname;

  const vat0 = xsnap({ ...xsnapOptions, handleCommand });
  await vat0.evaluate(`
    globalThis.hello = "Hello, World!";
  `);
  await vat0.snapshot(snapshot);
  await vat0.close();

  const vat1 = xsnap({ ...xsnapOptions, handleCommand, snapshot });
  await vat1.evaluate(`
    issueCommand(ArrayBuffer.fromString(hello));
  `);
  await vat1.close();

  t.deepEqual(['Hello, World!'], messages);
});

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

test('fail to send command to already-closed xsnap worker', async t => {
  const vat = xsnap({ ...xsnapOptions });
  await vat.close();
  await vat.evaluate(``).catch(err => {
    t.is(err.message, 'xsnap test worker exited');
  });
});

test('fail to send command to already-terminated xsnap worker', async t => {
  const vat = xsnap({ ...xsnapOptions });
  await vat.terminate();
  await vat.evaluate(``).catch(err => {
    t.is(err.message, 'xsnap test worker exited due to signal SIGTERM');
  });
});

test('fail to send command to terminated xsnap worker', async t => {
  const vat = xsnap({ ...xsnapOptions, meteringLimit: 0 });
  const hang = t.throwsAsync(vat.evaluate(`for (;;) {}`), {
    instanceOf: Error,
    message: /^(Cannot write messages to xsnap test worker: write EPIPE|xsnap test worker exited due to signal SIGTERM)$/,
  });

  await vat.terminate();
  await hang;
});

test('abnormal termination', async t => {
  const vat = xsnap({ ...xsnapOptions, meteringLimit: 0 });
  const hang = t.throwsAsync(vat.evaluate(`for (;;) {}`), {
    instanceOf: Error,
    message: 'xsnap test worker exited due to signal SIGTERM',
  });

  // Allow the evaluate command to flush.
  await delay(10);
  await vat.terminate();
  await hang;
});

test('normal close of pathological script', async t => {
  const vat = xsnap({ ...xsnapOptions, meteringLimit: 0 });
  const hang = vat.evaluate(`for (;;) {}`).then(
    () => t.fail('command should not complete'),
    err => {
      t.is(err.message, 'xsnap test worker exited due to signal SIGTERM');
    },
  );
  // Allow the evaluate command to flush.
  await delay(10);
  // Close must timeout and the evaluation command
  // must hang.
  await Promise.race([vat.close().then(() => t.fail()), hang, delay(10)]);
  await vat.terminate();
  await hang;
});

test('heap exhaustion: orderly fail-stop', async t => {
  const grow = `
  let stuff = '1234';
  while (true) {
    stuff = stuff + stuff;
  }
  `;
  for (const debug of [false, true]) {
    const vat = xsnap({ ...xsnapOptions, meteringLimit: 0, debug });
    t.teardown(() => vat.terminate());
    // eslint-disable-next-line no-await-in-loop
    await t.throwsAsync(vat.evaluate(grow));
  }
});
