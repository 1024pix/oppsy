const Os = require('os');
const Hapi = require('@hapi/hapi');

const Network = require('../lib/network');
const Utils = require('../lib/utils');
const Oppsy_test = require('../lib');

const { expect } = require('chai');
const chai = require('chai');
chai.use(require('chai-asserttype'));


describe('oppsy', function () {

    describe('constructor()', function () {

        it('is an event EventEmitter', function () {

            const opps = new Oppsy_test(new Hapi.Server(), {});
            expect(opps.emit).to.be.a.function();
            expect(opps.on).to.be.a.function();
        });
        it('creates a network monitor and a map of tasks', function () {

            const opps = new Oppsy_test(new Hapi.Server());
            expect(opps._networkMonitor).to.be.an.instanceof(Network);
            expect(opps._tasks).to.have.all.keys(['pscpu', 'osload', 'osmem', 'osup', 'psup', 'psmem', 'psdelay', 'requests', 'responseTimes', 'sockets']);
        });
    });

    describe('start()', function () {

        it('emits an "ops" event at the specified interval', function () {

            let count = 0;
            const host = Os.hostname();
            const opps = new Oppsy_test(new Hapi.Server());
            opps._tasks = {
                one: () => {

                    return 'foo';
                },
                two: async () => {

                    await Utils.timeout(40);

                    return 'bar';
                }
            };

            opps.on('ops', (data) => {

                count++;
                expect(data).to.equal({
                    one: 'foo',
                    two: 'bar',
                    host
                });
                if (count >= 2) {
                    opps.stop();
                }
            });

            return new Promise((resolve, reject) => {

                opps.on('stop', (err) => {

                    if (err) {
                        return reject(err);
                    }

                    return resolve();
                });

                opps.start(100);
            });
        });

        it('emits an error if one occurs during processing', function () {

            let count = 0;
            const host = Os.hostname();
            const opps = new Oppsy_test(new Hapi.Server());

            opps._tasks = {
                one: () => {

                    return 'foo';
                },
                two: () => {

                    return new Promise((resolve, reject) => {

                        if (count % 2 === 0) {
                            reject(new Error('there was an error'));
                        }

                        return resolve('bar');
                    });
                }
            };

            opps.on('ops', (data) => {

                count++;
                expect(data).to.equal({
                    one: 'foo',
                    two: 'bar',
                    host
                });
            });

            return new Promise((resolve) => {

                opps.on('error', (error) => {

                    expect(error).to.be.an.instanceof(Error);
                    expect(error.message).to.equal('there was an error');
                    opps.stop();

                    resolve();
                });

                opps.start(100);
            });
        });

        it('does not emit the event after it is stopped', async function () {

            let count = 0;
            const opps = new Oppsy_test(new Hapi.Server());

            opps._tasks = {
                one: () => {

                    return 'foo';
                }
            };
            opps.on('ops', () => {

                count++;
            });
            opps.start(100);
            opps.stop();

            await Utils.timeout(500);

            expect(count).to.equal(0);
        });
    });

    it('emits "ops" events with data', async function () {

        let _data = {};

        const opps = new Oppsy_test(new Hapi.Server());

        opps.on('ops', (data) => {

            _data = data;
        });
        opps.start(100);

        await Utils.timeout(500);

        expect(_data.requests).to.deep.equal({});
        expect(_data.responseTimes).to.deep.equal({});
        expect(_data.sockets).to.deep.equal({
            http: {
                total: 0
            },
            https: {
                total: 0
            }
        });
        expect(_data.osload).to.have.length(3);
        expect(_data.osmem).to.have.all.keys(['total', 'free']);
        expect(_data).to.have.all.keys(['osup', 'psup', 'psdelay', 'host', 'osmem', 'osload', 'pscpu', 'psmem', 'requests', 'responseTimes', 'sockets']);
        expect(_data.psmem).to.have.all.keys(['rss', 'heapTotal', 'heapUsed', 'arrayBuffers', 'external']);
        expect(_data.pscpu).to.have.all.keys(['user', 'system']);
    });
});
