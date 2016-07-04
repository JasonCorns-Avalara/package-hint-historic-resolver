import Ember from 'ember';
import { moduleFor, test } from 'ember-qunit';
import Pretender from 'pretender';
import cache from 'npm:memory-cache';

const {
  Service,
  RSVP: { all, Promise },
  run,
  get, set
} = Ember;

const config = Service.extend({
  limiterTime: 1
}).create();

let server;
let limiter;
let service;

moduleFor('service:request-cache', 'Integration | Service | request cache', {
  integration: true,
  beforeEach() {
    server = new Pretender();
    server.prepareBody = JSON.stringify;

    this.register('service:config', config, { instantiate: false });
    this.inject.service('config', { as: 'config' });

    // https://github.com/jquery/qunit/pull/919
    if (!limiter) {
      limiter = this.container.lookup('service:limiter');
    }

    service = this.subject();
  },
  afterEach() {
    server.shutdown();
    limiter.reset();
    cache.clear();
  }
});

function cacheRequest() {
  return new Promise((resolve, reject) => {
    run(() => {
      get(service, 'cacheRequest').perform('test-url').then(resolve).catch(reject);
    });
  });
}

test('gets cached data', function(assert) {
  assert.expect(1);

  cache.put('test-url', 12);

  return cacheRequest().then(data => {
    assert.strictEqual(data, 12);
  });
});

test('resolves data from request', function(assert) {
  assert.expect(1);

  server.get('http://test-host/api/test-url', () => {
    return [200, {}, [12]];
  });

  return cacheRequest().then(data => {
    assert.deepEqual(data, [12]);
  });
});

test('caches data from request', function(assert) {
  assert.expect(1);

  server.get('http://test-host/api/test-url', () => {
    return [200, {}, [12]];
  });

  return cacheRequest().then(() => {
    assert.deepEqual(cache.get('test-url'), [12]);
  });
});

test('doesn\'t cache data when request fails', function(assert) {
  assert.expect(1);

  server.get('http://test-host/api/test-url', () => {
    return [500, {}, {}];
  });

  return cacheRequest().catch(() => {
    assert.strictEqual(cache.get('test-url'), null);
  });
});

test('doesn\'t cache data when task cancels', function(assert) {
  assert.expect(1);

  run(() => {
    let task = get(service, 'cacheRequest').perform('test-url');

    task.cancel();

    task.catch(() => {
      assert.strictEqual(cache.get('test-url'), null);
    });
  });
});

test('second call uses cached data after queuing', function(assert) {
  assert.expect(1);

  server.get('http://test-host/api/test-url', () => {
    return [200, {}, [12]];
  });

  let promise1 = cacheRequest();
  let promise2 = cacheRequest();

  let didRunOnce;

  function handlePromise(promise) {
    return promise.then(data => {
      if (didRunOnce) {
        return assert.deepEqual(data, [12]);
      }

      // changing response value to verify the cached value is used
      server.get('http://test-host/api/test-url', () => {
        return [200, {}, [23]];
      });

      didRunOnce = true;
    });
  }

  return all([
    handlePromise(promise1),
    handlePromise(promise2)
  ]);
});

test('cache invalidates after given time', function(assert) {
  assert.expect(1);

  let cacheTime = 1;
  set(config, 'cacheTime', cacheTime);

  server.get('http://test-host/api/test-url', () => {
    return [200, {}, [12]];
  });

  return cacheRequest().then(() => {
    let timeCacheWasSet = Date.now();

    // eslint-disable-next-line no-empty
    while (Date.now() - timeCacheWasSet <= cacheTime) {}

    server.get('http://test-host/api/test-url', () => {
      return [200, {}, [23]];
    });

    return cacheRequest().then(data => {
      assert.deepEqual(data, [23]);
    });
  });
});

test('limits calls', function(assert) {
  assert.expect(1);

  let limiterTime = 100;
  set(config, 'limiterTime', limiterTime);

  server.get('http://test-host/api/test-url', () => {
    return [200, {}, [12]];
  });

  let timeLimiterWasStarted = Date.now();

  return cacheRequest().then(() => {
    cache.clear();

    return cacheRequest().then(() => {
      assert.ok(Date.now() - timeLimiterWasStarted > limiterTime);
    });
  });
});
