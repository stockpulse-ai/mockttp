import _ = require("lodash");
import * as http from 'http';
import portfinder = require('portfinder');
import request = require("request-promise-native");

import { Mockttp, getLocal } from "../../..";
import {
    expect,
    nodeOnly,
    getDeferred,
    Deferred
} from "../../test-utils";
import { isLocalIPv6Available } from "../../../src/util/socket-util";

const INITIAL_ENV = _.cloneDeep(process.env);

nodeOnly(() => {
    describe("Mockttp when used as an intercepting HTTP proxy for calling localhost", function () {

        let server: Mockttp;
        let remoteServer = getLocal();

        beforeEach(async () => {
            await remoteServer.start();
            await remoteServer.forAnyRequest().thenCallback((request) => {
                return {
                    status: 200,
                    body: request.remoteIpAddress
                };
            });

        });

        afterEach(async () => {
            await server.stop();
            await remoteServer.stop();
            process.env = INITIAL_ENV;
        });

        describe("with a default config", () => {

            beforeEach(async () => {
                server = getLocal();
                await server.start();
                await server.forGet(remoteServer.url).thenPassThrough();
                process.env = _.merge({}, process.env, server.proxyEnv);
            });

            it("should use local address 127.0.0.1 or ::1", async () => {
                let response = await request.get(remoteServer.url);
                expect(response).to.be.oneOf(["127.0.0.1", "::1"]);
            });
        });

        describe("with a local address set for pass through", () => {
            let localAddress = '127.0.0.2';

            beforeEach(async () => {
                server = getLocal();
                await server.start();
                await server.forGet(remoteServer.url).thenPassThrough({localAddress});
                process.env = _.merge({}, process.env, server.proxyEnv);
            });

            it("should use that local address", async () => {
                let response = await request.get(remoteServer.url);
                expect(response).to.be.oneOf([`::ffff:${localAddress}`, localAddress]);
            });
        });

        describe("with the local address ::1 set for pass through", () => {

            beforeEach(async () => {
                server = getLocal();
                await server.start();
                await server.forAnyRequest().thenPassThrough({localAddress: '::1'});
                process.env = _.merge({}, process.env, server.proxyEnv);
            });

            describe("with an IPv6-only remote server", () => {
                if (!isLocalIPv6Available) return;

                let ipV6Port: number;
                let ipV6Server: http.Server;
                let requestReceived: Deferred<void>;

                beforeEach(async () => {
                    requestReceived = getDeferred<void>()
                    ipV6Port = await portfinder.getPortPromise();
                    ipV6Server = http.createServer((_req, res) => {
                        requestReceived.resolve();
                        res.writeHead(200);
                        res.end(_req.socket.remoteAddress);
                    });

                    return new Promise<void>((resolve, reject) => {
                        ipV6Server.listen({host: '::1', family: 6, port: ipV6Port}, resolve);
                        ipV6Server.on('error', reject);
                    });
                });

                afterEach(() => new Promise<void>((resolve, reject) => {
                    ipV6Server.close((error) => {
                        if (error) reject();
                        else resolve();
                    });
                }));

                it("should use local address ::1", async () => {
                    // Localhost here will be ambiguous - we're expecting Mockttp to work it out
                    let response = await request.get(`http://localhost:${ipV6Port}`);
                    await requestReceived;

                    expect(response).to.equal("::1");
                });

            });
        });

        describe("with the local address set to 127.0.0.2 for pass through", () => {

            beforeEach(async () => {
                server = getLocal();
                await server.start();
                await server.forAnyRequest().thenPassThrough({localAddress: '127.0.0.2'});
                process.env = _.merge({}, process.env, server.proxyEnv);
            });

            describe("with an IPv4-only remote server", () => {
                let ipV4Port: number;
                let ipV4Server: http.Server;
                let requestReceived: Deferred<void>;

                beforeEach(async () => {
                    requestReceived = getDeferred<void>()
                    ipV4Port = await portfinder.getPortPromise();
                    ipV4Server = http.createServer((_req, res) => {
                        requestReceived.resolve();
                        res.writeHead(200);
                        res.end(_req.socket.remoteAddress);
                    });

                    return new Promise<void>((resolve, reject) => {
                        ipV4Server.listen({ host: '127.0.0.1', family: 4, port: ipV4Port }, resolve);
                        ipV4Server.on('error', reject);
                    });
                });

                afterEach(() => new Promise<void>((resolve, reject) => {
                    ipV4Server.close((error) => {
                        if (error) reject();
                        else resolve();
                    });
                }));

                it("should use local address 127.0.0.2", async () => {
                    // Localhost here will be ambiguous - we're expecting Mockttp to work it out
                    let response = await request.get(`http://localhost:${ipV4Port}`);
                    await requestReceived;

                    expect(response).to.equal("127.0.0.2");
                });

            });
        });
    });
});
