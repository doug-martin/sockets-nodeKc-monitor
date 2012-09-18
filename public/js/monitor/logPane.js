define([
    "dojo/_base/lang",
    "dojo/_base/connect",
    "dojo/_base/declare",
    "dijit/layout/ContentPane",
    "dijit/_Templated",
    "dijit/_WidgetsInTemplateMixin",
    "dojo/dom-attr", // domClass.replace
    "dojo/dom-class", // domClass.replace
    "dojo/dom-style", // domClass.replace
    "dojo/query",
    "dojo/dom-geometry",
    "./clusterClient",
    "dojo/text!./templates/logPane.html",
    "dijit/form/Select"],
        function (lang, connect, declare, ContentPane, _Templated, _WidgetTemplated, domAttr, cssAttr, dojoStyle, query, domGeom, client, template) {

            var LEVEL_REGEXP = /(ALL|DEBUG|ERROR|TRACE|FATAL|WARN|INFO)/i;
            var SPACE_REGEXP = /\s{1}/g;

            var formatLogs = function (lines, level) {
                return lines.map(
                        function (line) {
                            line = line.replace(SPACE_REGEXP, "&nbsp;");
                            var match = line.match(LEVEL_REGEXP);
                            if (match && match.length >= 2) {
                                var levelCss = [match[1].toLowerCase(), "LogLine"].join("");
                                return ["<div class='logLine ", levelCss, level && level != match[1] ? " dijitHidden" : "", "'>", line, "</div>"].join("");
                            } else {
                                return ["<div class='logLine'>", line, "</div>"].join("");
                            }
                        }).join("")
            };

            return declare([ContentPane, _Templated, _WidgetTemplated], {

                path:"",
                topic:false,
                history:500,
                _lastLine:0,
                widgetsInTemplate:true,
                templateString:template,


                _showLogs:function (lines) {
                    var domNode = this.contentNode;
                    this.contentNode.focus();
                    if (this.showing) {
                        if (lines) {
                            domNode.innerHTML += [formatLogs(lines, this.level)].join("");
                        } else {
                            var lines = this.lines;
                            domNode.innerHTML = [formatLogs(lines, this.level)].join("");
                        }
                    }
                    this.domNode.scrollTop = this.domNode.scrollHeight;
                },


                constructor:function () {
                    this.lines = [];
                },

                _errorHandler:function (e) {
                    console.error(e.stack);
                },

                postCreate:function () {
                    this.inherited(arguments);
                    cssAttr.add(this.domNode, "logPane");
                    dojoStyle.set(this.toolbar, "top", domGeom.position(this.domNode).x + 120 + "px");
                },

                startup:function () {
                    this.inherited(arguments);
                    this.set("path", this.path);
                },

                onShow:function () {
                    this.inherited(arguments);
                    this.showing = true;
                    this._showLogs();
                    this._tail();
                },

                onHide:function () {
                    this.inherited(arguments);
                    this.showing = false;
                    this._showLogs();
                    this._tail();

                },

                _applyFilter:function (level) {
                    if (this.level) {
                        query(["div:not(.", this.level.toLowerCase(), "LogLine)"].join(""), this.contentNode).style("display", "none");
                        query(["div:.", this.level.toLowerCase(), "LogLine"].join(""), this.contentNode).style("display", "block");
                    } else {
                        query("div:.logLine", this.contentNode).style("display", "block");
                    }
                },

                _tail:function () {
                    if (this._started && this.showing && this.path) {
                        if(this._tailSubscribe){
                            this.unsubscribe(this._tailSubscribe);
                        }
                        client.tail(this.path).then(lang.hitch(this, function (topic) {
                            try {
                                var lastUpdate = +(new Date);
                                this._tailSubscribe = this.subscribe(topic.topic, function (data) {
                                    var lines = (this.lines = this.lines.concat(data.lines)), l = lines.length, h = this.history;
                                    if (l > h) {
                                        var dif = l - h;
                                        lines.splice(0, dif);
                                        this._lastLine = h - dif;
                                    }
                                    if (this.showing) {
                                        clearTimeout(this._showLogTimeout);
                                        if (((+new Date) - lastUpdate) > 500) {
                                            lastUpdate = +(new Date);
                                            this._showLogs();
                                        } else {
                                            this._showLogTimeout = setTimeout(lang.hitch(this, function () {
                                                lastUpdate = +(new Date);
                                                this._showLogs();
                                            }), 100)
                                        }
                                    }
                                });
                            } catch (e) {
                                this._errorHandler(e);
                            }
                        }), this._errorHandler);
                    }
                },

                _setPathAttr:function (val) {
                    this._set("path", val);
                    this.set("title", val);
                },

                _setLevelAttr:function (level) {
                    if (level == "ALL") {
                        level = null;
                    }
                    this._set("level", level);
                    this._applyFilter();
                }
            });

        });