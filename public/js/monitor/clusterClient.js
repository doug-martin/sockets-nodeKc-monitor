// Require the xhr module
define(["dojo/_base/declare", "dojo/_base/array", "dojo/_base/lang", "dojo/_base/connect", "dojo/_base/Deferred"], function (declare, array, lang, connect, Deferred) {
    var mixin = lang.mixin;

    var ACTIONS = ['start', 'stop', 'restart', 'status', 'list', 'services', "logs"];

    var socket = io.connect(window.location.origin, {resource:"monitor/socket.io"});
    socket.on('stop', function (data) {
        console.log(data);
        connect.publish(data.service + "-stopped", data);
    });

    socket.on('start', function (data) {
        console.log(data);
        connect.publish(data.service + "-started", data);
    });

    socket.on('restart', function (data) {
        console.log(data);
        connect.publish(data.service + "-restarted", data);
    });

    var getRequest = function (action, service, options) {
        var ret = mixin({}, options || {});
        service && (mixin(ret, {service:service}));
        return ret;
    };

    var makeRequest = function (action, service, options) {
        var ret = new Deferred();
        socket.emit(action, getRequest(action, service, options), function (res) {
            if (res.error) {
                ret.errback(res);
            } else {
                ret.callback(res);
            }
        });
        return ret;
    };

    var ret = {};
    array.forEach(ACTIONS, function (action) {
        ret[action] = function (service, options) {
            return makeRequest(action, service, options);
        };
    });
    var tailed = [];
    ret.tail = function (path, options) {
        options = options || {};
        options.path = path;
        var ret = new Deferred();
        socket.emit("tail", options, function (topic) {
            if (topic.error) {
                ret.errback(topic);
            } else {
                try {
                    if (tailed.indexOf(topic.topic) == -1) {
                        socket.on(topic.topic, function (data) {
                            connect.publish(topic.topic, data);
                        });
                        tailed.push(topic.topic);
                    }
                    ret.callback(topic);
                } catch (e) {
                    console.error(e.stack);
                }
            }
        });
        return ret;

    };

    ret.stopTail = function (path, options) {
        options = options || {};
        options.path = path;
        var ret = new Deferred();
        socket.emit("stopTail", options, function (topic) {
            if (topic.error) {
                ret.errback(topic);
            } else {
                try {
                    ret.callback(topic);
                } catch (e) {
                    console.error(e.stack);
                }
            }
        });
        return ret;
    }
    return ret;
});
