(function () {
    "use strict";

    var comb = require("comb"),
        hitch = comb.hitch,
        fs = require("fs"),
        path = require("path"),
        http = require("http"),
        cp = require('child_process'),
        express = require("express"),
        socket = require('socket.io'),
        gofigure = require("gofigure")({monitor:true, locations:[path.resolve(process.env.HOME, "./monitor"), path.resolve(__dirname, "../config")]}),
        config = gofigure.loadSync();


    gofigure.on("logging.monitor.level", function (level) {
        LOGGER.info("LEVEL changed to " + level);
        LOGGER.level = level;
    });


    comb.logger.configure(config.logging);
    var LOGGER = comb.logger("monitor");

    var Server = comb.define(null, {

        instance:{

            STARTED:false,

            constructor:function (options) {
                options = options || {};
                this.launched = {};
                this._logs = {};
                this.backLogSize = 2000;
                this._services = options.services || this._static.SERVICES;
                this._availLogs = options.logs || this._static.LOGS || [];
                this.host = options.host || this._static.HOST;
                this.port = options.port || this._static.PORT;
                this.basePath = options.basePath || this._static.BASE_PATH;
                gofigure.on("monitor.host", function (host) {
                    LOGGER.info("HOST changed to " + host);
                    this.host = host;
                    this.restartServer();
                }.bind(this));
                gofigure.on("monitor.port", function (port) {
                    LOGGER.info("HOST changed to " + port);
                    this.host = port;
                    this.restartServer();
                }.bind(this));
                gofigure.on("monitor.services", function (services) {
                    LOGGER.info("SERVICES changed to " + JSON.stringify(services));
                    this._cleanup();
                    this._services = services;
                    this.init();
                }.bind(this));
                gofigure.on("monitor.logs", function (logs) {
                    LOGGER.info("LOGS changed to " + logs);
                    this._cleanup();
                    this._availLogs = logs;
                    this.init();
                }.bind(this));
            },

            restartServer:function () {
                return comb.serial([
                    hitch(this, "stopServer"),
                    hitch(this, "startServer")
                ]);
            },


            startServer:function () {
                var ret = new comb.Promise();
                var expressApp = (this._server = express());
                var app = http.createServer(expressApp),
                    io = (this.io = socket.listen(app));
                io.set("resource", this.basePath + "/socket.io");
                io.set("log", false);
                expressApp.use(this.basePath, express["static"](path.resolve(__dirname, "../public")));
                this._route(expressApp, io);
                app.listen(this.port, this.host, hitch(this, function (err) {
                    if (err) {
                        LOGGER.error(err);
                        ret.errback(err);
                    } else {
                        LOGGER.info(comb.string.format("listening on %s:%s", this.host, this.port));
                        this.init();
                        ret.callback();
                        this.STARTED = true;
                    }
                }));

                return ret;
            },

            stopServer:function () {
                var ret = new comb.Promise();
                if (this.STARTED) {
                    this._server.close(function () {
                        LOGGER.info("Stopped server");
                        ret.callback();
                    });
                } else {
                    ret.callback();
                }
                return ret;
            },

            init:function () {
                this.__tailAvaiableLogs();
                this.__listenToProcessSignals();
            },

            __tailAvaiableLogs:function () {
                if (!this._tailingAvaiableLogs) {
                    this._availLogs.forEach(function (log) {
                        this._tail({path:log});
                    }, this);
                    this._tailingAvaiableLogs = true;
                }
            },

            __listenToProcessSignals:function () {
                if (!this._listeningToSignals) {
                    ["SIGHUP", "SIGKILL", "SIGTERM", "SIGTERM", "SIGSTOP"].forEach(function (term) {
                        process.on(term, hitch(this, "_stop"));
                    }, this);
                    this._listeningToSignals = true;
                }
            },

            _stop:function (code) {
                try {
                    this._cleanup();
                } catch (e) {
                    LOGGER.error(e);
                } finally {
                    process.exit();
                }
            },

            _cleanup:function (code) {
                var logs = this._logs, launched = this.launched;
                for (var i in logs) {
                    try {
                        LOGGER.debug("killing " + logs[i].process.pid);
                        logs[i].process.kill();
                    } catch (e) {
                        LOGGER.error(e);
                    }
                }

                for (i in launched) {
                    try {
                        LOGGER.debug("killing " + launched[i].process.pid);
                        launched[i].process.kill();
                    } catch (e) {
                        LOGGER.error(e);
                    }
                }
                this.lauched = {};
                this._tailingAvaiableLogs = false;

            },


            _route:function (app, io) {
                var actions = this._static.ACTIONS;
                actions.forEach(function (action) {
                    app.get([this.basePath, action].join("/"), hitch(this, function (req, res) {
                        comb.when(this[action](req.query)).both(hitch(this, function (data) {
                            res.send(data);
                        }));
                    }));
                }, this);

                io.sockets.on('connection', hitch(this, function (socket) {
                    actions.forEach(hitch(this, function (action) {
                        socket.on(action, hitch(this, function (data, fn) {
                            comb.when(this[action](data)).both(function (res) {
                                fn && fn(res);
                            });
                        }));
                    }));
                    socket.on("tail", hitch(this, function (options, fn) {
                        var p = this._tail(options, socket);
                        if (fn) {
                            p.then(function (data) {
                                fn(data);
                            }, function (data) {
                                fn(data);
                            });
                        }
                    }));

                    socket.on("stopTail", hitch(this, function (options, fn) {
                        try {
                            var ret = this._disconnectTail(options.path, socket);
                            if (fn) {
                                fn(ret);
                            }
                        } catch (e) {
                            if (fn) {
                                fn({error:e.stack});
                            }
                        }
                    }));

                    socket.on('disconnect', hitch(this, function () {
                        this._availLogs.forEach(function (log) {
                            this._disconnectTail(log, socket);
                        }, this);
                    }));
                }));
            },

            _checkStarted:function () {
                if (!this.STARTED) {
                    throw new Error("monitor not started");
                }
            },

            _monitor:function (n, name, options) {
                n.once("exit", hitch(this, function (code) {
                    this.emit("stop", {stopped:true, service:name, error:new Error("stopped with error code " + code).stack});
                    LOGGER.info("Process " + name + " exited with code " + code);
                    delete this.launched[service];
                    this.start(name, options);
                }));
            },

            _disconnectTail:function (path, socket) {
                var log = this._logs[path];
                if (log) {
                    var sockets = log.sockets, index = sockets.indexOf(socket);
                    if (index !== -1) {
                        sockets.splice(index, 1);
                    }
                }
                return {path:path, topic:log.topic};
            },

            _tail:function (options, socket) {
                var p = options.path, ret = new comb.Promise();
                if (p) {
                    if (this._logs[p]) {
                        ret.callback({path:p, topic:this._logs[p].topic});
                    } else {
                        var topic = p + "-tail";
                        try {
                            var log = this._logs[p] = {};
                            log.topic = topic;
                            var sockets = (log.sockets = []);
                            if (socket) {
                                sockets.push(socket);
                            }
                            var send = function (lines) {
                                lines = lines.toString(options.encoding || 'utf8').split("\n[").map(function (line, i) {
                                    return (i > 0 ? "[" : "") + line;
                                });
                                this.emit(topic, {lines:lines});
                            }.bind(this);
                            (function _tail() {
                                try {
                                    //get files
                                    cp.exec("ls " + p, function (err, res) {
                                        if (err) {
                                            LOGGER.error(err);
                                        } else {
                                            var tail = cp.spawn('tail', ['-F'].concat(res.replace("\n", " ").split(/\s+/)).filter(function (p) {
                                                return p;
                                            }), {setsid:true});
                                            tail.stdout.on('data', send);
                                            tail.stderr.on('data', hitch(LOGGER, "error"));
                                            log.process = tail;
                                            tail.on("exit", _tail);
                                        }
                                    });
                                } catch (e) {
                                    LOGGER.error(e);
                                }
                            })();
                            ret.callback({path:p, topic:topic});
                        } catch (e) {
                            ret.errback({path:p, topic:topic, error:e.stack});
                        }
                    }
                } else {
                    ret.errback({error:new Error("path is required").stack});
                }
                return ret;
            },

            emit:function (action, data) {
                this.io.sockets.emit(action, data);
            },


            start:function (service, options) {
                if (comb.isObject(service)) {
                    options = service;
                    service = service.service;
                }
                var ret = new comb.Promise(), res, launched = this.launched;
                try {
                    this._checkStarted();
                    if (service) {
                        if (!(service in launched)) {
                            var n;
                            if (service in this._services) {
                                n = cp.fork(require.resolve(this._services[service]), null, {env:process.env});
                            } else {
                                n = cp.fork(require.resolve(service), null, {env:process.env});
                            }
                            n.send({action:"start", options:options});
                            n.once("message", hitch(this, function (res) {
                                try {
                                    var retAction = "callback";
                                    res.service = service;
                                    if (res.started) {
                                        LOGGER.info("Started " + service);
                                    } else if (res.error) {
                                        LOGGER.error("Error staring " + service);
                                        LOGGER.error(res.error);
                                        retAction = "errback";
                                    }
                                    launched[service] = {process:n, started:new Date()};
                                    ret[retAction](res);
                                } catch (e) {
                                    LOGGER.error("Error starting " + service);
                                    LOGGER.error(e);
                                    ret.errback(res);
                                }
                                this.emit("start", res);
                            }));
                            if (options.monitor) {
                                this._monitor(n, service, options);
                            }
                        } else {
                            res = {started:true, service:service};
                            ret.callback(res);
                            this.emit("start", res);
                        }
                    } else {
                        throw new Error("service required");
                    }
                } catch (e) {
                    LOGGER.error("Error starting service");
                    LOGGER.error(e);
                    res = {started:false, service:service, error:e.stack};
                    ret.errback(res);
                    this.emit("start", res);
                }

                return ret;
            },

            stop:function (service, options) {
                if (comb.isObject(service)) {
                    options = service;
                    service = service.service;
                }
                var ret = new comb.Promise(), res, launched = this.launched;
                try {
                    this._checkStarted();
                    if (service) {
                        if (service in launched) {
                            var p = launched[service].process;
                            p.send({action:"stop", options:options});
                            p.once("message", hitch(this, function (res) {
                                try {
                                    var retAction = "callback";
                                    res.service = service;
                                    if (res.stopped) {
                                        LOGGER.info("Stopped " + service);
                                    } else if (res.error) {
                                        LOGGER.error("Error stopping " + service);
                                        LOGGER.error(res.error);
                                        retAction = "errback";
                                    }
                                    p.kill();
                                    delete launched[service];
                                    ret[retAction](res);
                                } catch (e) {
                                    LOGGER.error("Error stopping " + service);
                                    LOGGER.error(e);
                                    ret.errback(res);
                                }
                                this.emit("stop", res);
                            }));
                        } else {
                            res = {stopped:true, service:service};
                            ret.callback(res);
                            this.emit("stop", res);
                        }
                    } else {
                        throw new Error("service required");
                    }
                } catch (e) {
                    LOGGER.error("Error stopping service");
                    LOGGER.error(e);
                    res = {stopped:false, service:service, error:e.stack};
                    ret.errback(res);
                    this.emit("stop", res);
                }
                return ret;
            },

            restart:function (service, options) {
                if (comb.isObject(service)) {
                    options = service;
                    service = service.service;
                }
                var ret = new comb.Promise(), p, launched = this.launched;
                if (service in launched) {
                    p = comb.serial([
                        hitch(this, "stop", service, options),
                        hitch(this, "start", service, options)
                    ]);
                } else {
                    p = this.start(service, options);
                }
                var res = {service:service, restarted:true};
                p.then(comb.hitchIgnore(ret, "callback", res), hitch(ret, "errback")).both(comb.hitchIgnore(this, "emit", "restart", res));
                return ret;
            },

            status:function (service, options) {
                if (comb.isObject(service)) {
                    options = service;
                    service = service.service;
                }
                var ret = new comb.Promise(), launched = this.launched;
                try {
                    this._checkStarted();
                    if (service) {
                        if (service in launched) {
                            var svc = launched[service], n = svc.process;
                            n.send({action:"status", options:options});
                            n.once("message", hitch(this, function (res) {
                                res = res || {};
                                res.service = service;
                                if (res.error) {
                                    ret.errback(res);
                                } else {
                                    ret.callback(res);
                                }
                                this.emit("status", res);
                            }));
                        } else {
                            throw new Error("service not found");
                        }
                    } else {
                        return new comb.PromiseList(Object.keys(launched).map(hitch(this, function (k) {
                            return this.status(k, options);
                        })), true);
                    }
                } catch (e) {
                    LOGGER.error("Error gathering status");
                    LOGGER.error(e);
                    var res = {status:null, service:service, error:e.stack};
                    ret.errback(res);
                    this.emit("status", res);
                }
                return ret;
            },

            list:function () {
                return { running:Object.keys(this.launched)};
            },

            logs:function () {
                return { logs:this._availLogs};
            },

            services:function () {
                return {services:Object.keys(this._services)};
            },

            actions:function () {
                return  {actions:this._static.ACTIONS};
            }
        },

        static:{

            PORT:8088,
            BASE_PATH:"/monitor",
            HOST:"localhost",
            SERVICES:{},
            LOGS:[],
            ACTIONS:['start', 'stop', 'restart', 'status', 'list', 'services', "logs"],

            configure:function (config) {
                config = config || {};
                if (config.host) {
                    this.HOST = config.host;
                }
                if (config.port) {
                    this.PORT = config.port;
                }
                if (config.logs) {
                    this.LOGS = config.logs;
                }
                if (config.services) {
                    comb.merge(this.SERVICES, config.services);
                }
            },

            startServer:function (opts) {
                return new this(opts).startServer();
            },

            actions:function () {
                return {actions:this.ACTIONS};
            }
        }
    });

    Server.configure(config.monitor);


    exports.startServer = Server.startServer.bind(Server);
    exports.configure = Server.configure.bind(Server);

    Server.startServer();
})();



