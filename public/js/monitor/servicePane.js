define([
    "dojo/_base/declare",
    "dojo/_base/lang",
    "dijit/_Widget",
    "dijit/_Templated",
    "dojo/dom-attr", // domClass.replace
    "dojo/dom-class", // domClass.replace
    "./clusterClient",
    "dojo/text!./templates/servicePane.html"],
        function (declare, lang, _Widget, _Templated, domAttr, cssAttr, client, template) {
            var SPACE = ' ', DASH = "-",
                    PROPER_CONVERT_REGEXP1 = /([A-Z]+)(\d+|[A-Z][a-z])/g,
                    PROPER_CONVERT_REGEXP2 = /(\d+|[a-z])(\d+|[A-Z])/g,
                    PROPER_CONVERT_REPLACE = '$1 $2',
                    PROP_TEMPLATE = "<div style='margin-left:{pad}px;'><span class='key'>{name}</span> : <span class='val'>{val}</span></div>";
            var isArray = lang.isArray;
            var properName = function (str) {
                var ret = str;
                if (str) {
                    ret = str.replace(PROPER_CONVERT_REGEXP1, PROPER_CONVERT_REPLACE)
                            .replace(PROPER_CONVERT_REGEXP2, PROPER_CONVERT_REPLACE)
                            .replace(DASH, SPACE);
                    ret = ret.charAt(0).toUpperCase() + ret.substr(1);
                }
                return ret;
            };

            var deepMerge = (function () {
                var undef;

                var isUndefinedOrNull = function (it) {
                    return it !== null && it !== undef;
                };


                var isObject = function (obj) {
                    var undef;
                    return obj != null && obj != undef && typeof obj == "object";
                };

                var isHash = function (obj) {
                    var ret = isObject(obj);
                    return ret && obj.constructor === Object;
                };

                var _deepEqual = function (actual, expected) {
                    // 7.1. All identical values are equivalent, as determined by ===.
                    if (actual === expected) {
                        return true;

                    } else if (actual instanceof Date && expected instanceof Date) {
                        return actual.getTime() === expected.getTime();

                        // 7.3 If the expected value is a RegExp object, the actual value is
                        // equivalent if it is also a RegExp object with the same source and
                        // properties (`global`, `multiline`, `lastIndex`, `ignoreCase`).
                    } else if (actual instanceof RegExp && expected instanceof RegExp) {
                        return actual.source === expected.source &&
                                actual.global === expected.global &&
                                actual.multiline === expected.multiline &&
                                actual.lastIndex === expected.lastIndex &&
                                actual.ignoreCase === expected.ignoreCase;

                        // 7.4. Other pairs that do not both pass typeof value == 'object',
                        // equivalence is determined by ==.
                    } else if (typeof actual != 'object' && typeof expected != 'object') {
                        return actual == expected;

                        // 7.5 For all other Object pairs, including Array objects, equivalence is
                        // determined by having the same number of owned properties (as verified
                        // with Object.prototype.hasOwnProperty.call), the same set of keys
                        // (although not necessarily the same order), equivalent values for every
                        // corresponding key, and an identical 'prototype' property. Note: this
                        // accounts for both named and indexed properties on Arrays.
                    } else {
                        return objEquiv(actual, expected);
                    }
                };

                var objEquiv = function (a, b) {
                    if (isUndefinedOrNull(a) || isUndefinedOrNull(b))
                        return false;
                    // an identical 'prototype' property.
                    if (a.prototype !== b.prototype) return false;
                    //~~~I've managed to break Object.keys through screwy arguments passing.
                    //   Converting to array solves the problem.
                    if (isArguments(a)) {
                        if (!isArguments(b)) {
                            return false;
                        }
                        a = pSlice.call(a);
                        b = pSlice.call(b);
                        return _deepEqual(a, b);
                    }
                    try {
                        var ka = Object.keys(a),
                                kb = Object.keys(b),
                                key, i;
                    } catch (e) {//happens when one is a string literal and the other isn't
                        return false;
                    }
                    // having the same number of owned properties (keys incorporates
                    // hasOwnProperty)
                    if (ka.length !== kb.length)
                        return false;
                    //the same set of keys (although not necessarily the same order),
                    ka.sort();
                    kb.sort();
                    //~~~cheap key test
                    for (i = ka.length - 1; i >= 0; i--) {
                        if (ka[i] != kb[i])
                            return false;
                    }
                    //equivalent values for every corresponding key, and
                    //~~~possibly expensive deep test
                    for (i = ka.length - 1; i >= 0; i--) {
                        key = ka[i];
                        if (!_deepEqual(a[key], b[key])) return false;
                    }
                    return true;
                };

                var _deepMerge = function (target, source) {
                    var name, s, t;
                    for (name in source) {
                        s = source[name], t = target[name];
                        if (!_deepEqual(t, s)) {
                            if (isHash(t) && isHash(s)) {
                                target[name] = _deepMerge(t, s);
                            } else if (isHash(s)) {
                                target[name] = _deepMerge({}, s);
                            } else {
                                target[name] = s;
                            }
                        }
                    }
                    return target;
                };
                return function (obj, props) {
                    if (!obj) {
                        obj = {};
                    }
                    for (var i = 1, l = arguments.length; i < l; i++) {
                        _deepMerge(obj, arguments[i]);
                    }
                    return obj; // Object
                };
            })();


            var ServicePane = declare([_Widget, _Templated], {

                templateString:template,

                name:"",
                running:false,
                updateInterval:1000,
                maxDataPoints:20,
                count:0,


                constructor:function () {
                    this.__data = [];
                    this.__charts = [];
                },

                _formatStatus:function (status, level) {
                    var ret = [], level = level || 0;
                    if ("object" === typeof status) {
                        for (var i in status) {
                            ret.push(lang.replace(PROP_TEMPLATE, {pad:level * 10, name:properName(i), val:this._formatStatus(status[i], level + 5)}));
                        }
                        return ret.join("");
                    } else {
                        return status;
                    }

                },

                _toggleService:function () {
                    this[this.running ? "_stop" : "_start"]();
                },

                _start:function () {
                    client.start(this.name);

                },

                _restart:function () {
                    client.restart(this.name);
                },

                __getData:function (index) {
                    var ret = this.__data[index];
                    if (!ret) {
                        ret = this.__data[index] = {rss:[], heapUsed:[], heapTotal:[]};
                    }
                    return ret;
                },

                _status:function () {
                    var maxLength = this.maxDataPoints;
                    client.status(this.name).then(lang.hitch(this, function (res) {
                        var now = Date.now();
                        domAttr.set(this.statusNode, "innerHTML", res.status.map(function (data, index) {
                            var formatObj = deepMerge({process:{memoryUsage:{}}}, data);
                            if (formatObj.process) {
                                delete formatObj.process.memoryUsage;
                            }
                            var format = this._formatStatus(formatObj);
                            var chartData = this.__getData(index);
                            var mu = data.process.memoryUsage;
                            for (var i in mu) {
                                var dataArr = chartData[i];
                                dataArr.unshift({y:mu[i] / 1000000, x:now});
                            }
                            this.__refreshChart(index);

                            return format;
                        }, this).join("</br>"));
                        try {

                        } catch (e) {
                            console.log(e.stack);
                            throw e;
                        }
                    }), function (err) {
                        console.error(err);
                    });

                },

                _stop:function () {
                    client.stop(this.name);
                },

                __refreshChart:function (index) {
                    var chart = this.__charts[index];
                    if (!chart) {
                        this.__charts[index] = new LineChart(this.graphNode, {
                            title:"Memory Usage",
                            xScale:d3.time.scale(),
                            showDots:false,
                            lineInterpolation:"basis",
                            width:600,
                            height:500,
                            lines:[
                                {name:"rss", label:"Rss", cssLineClass:"rssLine", cssDotClass:"dotRss"},
                                {name:"heapTotal", label:"Heap Total", cssLineClass:"heapTotalLine", cssDotClass:"dotHeapTotal"},
                                {name:"heapUsed", label:"Heap Used", cssLineClass:"heapUsedLine", cssDotClass:"dotHeapUsed"}
                            ]
                        }).data(this.__getData(index)).render();
                    } else {
                        chart.data(this.__getData(index));
                    }
                    return this;
                },


                onShow:function () {
                    this.inherited(arguments);
                    this.showing = true;
                    this._monitor();
                },

                onHide:function () {
                    this.inherited(arguments);
                    this.showing = false;
                    this._monitor();
                },

                _monitor:function () {
                    clearInterval(this._updateTimeout);
                    if (this.running && this.showing) {
                        this._status();
                        this._updateTimeout = setInterval(lang.hitch(this, "_status"), this.updateInterval);
                    }
                    domAttr.set(this.statusNode, "innerHTML", "");

                },

                _setNameAttr:function (val) {
                    this._set("name", val);
                    var proper = properName(val);
                    this._set("title", proper);
                    domAttr.set(this.titleNode, "innerHTML", proper);
                    this.subscribe(val + "-started", function (data) {
                        this.set("running", data.started);
                    });
                    this.subscribe(val + "-stopped", function (data) {
                        this.set("running", !data.stopped);
                    });
                    this.subscribe(val + "-restarted", function (data) {
                        this.set("running", data.restarted);
                    });
                },

                _setRunningAttr:function (val) {
                    this._set("running", val);
                    cssAttr[val ? "add" : "remove"](this.domNode, "servicePaneRunning");
                    this._monitor();
                }
            });
            return ServicePane;

        });