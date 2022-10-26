const Fs = require('fs');
const Http = require('http');
const Https = require('https');
const Stream = require('stream');

const Hapi = require('@hapi/hapi');

const Oppsy = require('../lib');
const Os = require('../lib/os');
const Process = require('../lib/process');
const Network = require('../lib/network');
const Utils = require('../lib/utils');

const { expect } = require('chai');
const chai = require('chai');
chai.use(require('chai-asserttype'));

describe('index', function () {
    it('handles onRequest errors', async function () {

        const server = new Hapi.Server();

        server.ext('onRequest', () => {

            throw new Error('foobar');
        });

        const oppsy = new Oppsy(server);
        oppsy.start(1000);
        await server.inject({
            method: 'GET',
            url: '/'
        });
    });
    describe('network', function () {

        it('reports on network activity', async function () {

            const server = new Hapi.Server({
                host: 'localhost'
            });

            server.route({
                options: {
                    log: {
                        collect: true
                    }
                },
                method: 'GET',
                path: '/',
                handler: () => {
                    return 'ok';
                }
            });

            const network = new Network(server);
            const agent = new Http.Agent({
                maxSockets: Infinity
            });

            await server.start();

            for (let i = 0; i < 20; ++i) {
                Http.get({
                    path: '/',
                    host: server.info.host,
                    port: server.info.port,
                    agent
                }, () => {
                });
            }

            await Utils.timeout(500);

            expect(network._requests[server.info.port].total).to.equal(20);
            expect(network._requests[server.info.port].statusCodes[200]).to.equal(20);
            expect(network._responseTimes[server.info.port]).to.have.all.keys([
                'count',
                'max',
                'total']
            );
        });

        it('resets stored statistics', async function () {

            const server = new Hapi.Server({
                host: 'localhost'
            });

            server.route({
                method: 'GET',
                path: '/',
                handler: () => {
                    return 'ok';
                }
            });

            const network = new Network(server);
            const agent = new Http.Agent({
                maxSockets: Infinity
            });

            await server.start();

            for (let i = 0; i < 10; ++i) {
                Http.get({
                    path: '/',
                    host: server.info.host,
                    port: server.info.port,
                    agent
                }, () => {
                });
            }

            await Utils.timeout(300);

            const port = server.info.port;

            expect(network._requests[port]).to.have.all.keys(['disconnects', 'statusCodes', 'total']);
            expect(network._requests[port].total).to.equal(10);
            expect(network._requests[port].statusCodes[200]).to.equal(10);

            expect(network._responseTimes[port]).to.have.all.keys(['count', 'max', 'total']);

            network.reset();

            expect(network._requests[port]).to.deep.equal({
                total: 0,
                disconnects: 0,
                statusCodes: {}
            });

            expect(network._responseTimes[port]).to.deep.equal({
                count: 0,
                total: 0,
                max: 0
            });
        });

        it('reports on socket information', async function () {

            const server = new Hapi.Server({
                host: 'localhost'
            });

            const upstreamsecure = new Hapi.Server({
                host: 'localhost',
                tls: {
                    key: Fs.readFileSync(process.cwd() + '/test/fixtures/server.key', {
                        encoding: 'utf8'
                    }),
                    cert: Fs.readFileSync(process.cwd() + '/test/fixtures/server.crt', {
                        encoding: 'utf8'
                    })
                }
            });

            const upstream = new Hapi.Server({
                host: 'localhost'
            });

            const upstreamRoute = {
                method: 'GET',
                path: '/',
                handler: async () => {

                    await Utils.timeout(500);

                    return 'ok';
                }
            };

            upstreamsecure.route(upstreamRoute);

            upstream.route(upstreamRoute);

            await upstreamsecure.start();
            await upstream.start();

            const httpAgent = new Http.Agent({
                maxSockets: Infinity
            });
            const httpsAgent = new Https.Agent({
                maxSockets: Infinity
            });
            const network = new Network(server, httpAgent, httpsAgent);

            server.route({
                method: 'GET',
                path: '/',
                handler: () => {

                    Https.get({
                        hostname: upstreamsecure.info.host,
                        port: upstreamsecure.info.port,
                        path: '/',
                        agent: httpsAgent,
                        rejectUnauthorized: false
                    });

                    Http.get({
                        hostname: upstream.info.host,
                        port: upstream.info.port,
                        path: '/',
                        agent: httpAgent,
                        rejectUnauthorized: false
                    });

                    return 'ok';
                }
            });

            server.route({
                method: 'GET',
                path: '/foo',
                handler: async () => {

                    await Utils.timeout(Math.floor(Math.random() * 10) + 1);

                    return 'ok';
                }
            });

            await server.start();

            for (let i = 0; i < 10; ++i) {
                Http.get({
                    path: '/',
                    host: server.info.host,
                    port: server.info.port,
                    agent: httpAgent
                });

                Http.get({
                    path: '/foo',
                    host: server.info.host,
                    port: server.info.port,
                    agent: httpAgent
                });
            }

            await Utils.timeout(300);

            const [response, sockets] = await Promise.all([
                network.responseTimes(),
                network.sockets()
            ]);

            const port = server.info.port;

            expect(sockets.http.total).to.be.at.least(10);
            expect(sockets.https.total).to.be.equal(10);

            expect(response[port].avg).to.be.at.least(1);
            expect(response[port].max).to.be.at.least(1);
        });

        it('tracks server disconnects', async function () {

            class TestStream extends Stream.Readable {
                constructor() {

                    super();
                }

                _read() {

                    if (this.isDone) {
                        return;
                    }

                    this.isDone = true;

                    setTimeout(() => {

                        this.push('Hello');
                    }, 10);

                    setTimeout(() => {

                        this.push(null);
                    }, 50);
                }
            }

            const server = new Hapi.Server({
                host: 'localhost'
            });

            server.route({
                method: 'POST',
                path: '/',
                handler: () => {

                    return new TestStream();
                }
            });

            const network = new Network(server);

            await server.start();

            const options = {
                hostname: server.info.host,
                port: server.info.port,
                path: '/',
                method: 'POST'
            };

            const req = Http.request(options, () => {
                req.destroy();
            });

            req.end('{}');

            await Utils.timeout(700);

            const result = await network.requests();

            const requests = {};
            requests[server.info.port] = {
                total: 1,
                disconnects: 1,
                statusCodes: {}
            };

            expect(result).to.deep.equal(requests);

            return server.stop();
        });

        it('does not throw if request.response is null', async function () {

            const server = new Hapi.Server({
                host: 'localhost'
            });

            server.route({
                method: 'GET',
                path: '/',
                handler: () => {
                    return 'ok';
                }
            });

            // force response to be null to mimic client disconnect
            server.events.on('response', (request) => {

                request.response = null;
            });

            const network = new Network(server);

            await server.start();

            new Promise((resolve) => {

                Http.get({
                    path: '/',
                    host: server.info.host,
                    port: server.info.port
                }, () => {

                    expect(network._requests[server.info.port]).to.have.all.keys(['total', 'disconnects', 'statusCodes']);
                    expect(network._requests[server.info.port].total).to.equal(1);
                    expect(network._requests[server.info.port].statusCodes).to.deep.equal({});
                    resolve();
                });
            });
        });
    });
    describe('os information', function () {

        describe('mem()', function () {

            it('returns an object with the current memory usage', async function () {

                const mem = await Os.mem();

                expect(mem).to.have.all.keys(['total', 'free']);
            });
        });
        describe('loadavg()', function () {

            it('returns an object with the current load average', async function () {

                const load = await Os.loadavg();

                expect(load).to.have.length(3);
            });
        });
        describe('uptime()', function () {

            it('returns an object with the current uptime', async function () {

                const uptime = await Os.uptime();

                expect(uptime).to.be.a.number();
                expect(uptime).to.greaterThan(0);
            });
        });
    });
    describe('process information', function () {

        describe('memory()', function () {

            it('passes the current memory usage to the callback', async function () {

                const mem = await Process.memoryUsage();

                expect(mem).to.have.all.keys(['arrayBuffers',
                    'external',
                    'heapTotal',
                    'heapUsed',
                    'rss']);
            });
        });

        describe('delay()', function () {

            it('passes the current event queue delay to the callback', async function () {

                const delay = await Process.delay();

                expect(delay).be.greaterThan(0);
            });
        });
    });
});
