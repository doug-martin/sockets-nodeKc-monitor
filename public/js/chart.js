(function (window) {
    "use strict";
    var d3;
    if (window.hasOwnProperty("d3")) {
        d3 = window.d3;
    } else {
        throw new Error("d3 required");
    }
    if (!window.hasOwnProperty("LineChart")) {
        var margin = {top:10, right:10, bottom:20, left:40},
                width = 500, height = 300,
                chartWidth = width - margin.left - margin.right,
                chartHeight = height - margin.top - margin.bottom;
        //converts a name to a propername
        // someName => SomeName
        var properName = function (name) {
            return [name.charAt(0).toUpperCase(), name.substr(1)].join("");
        };

        //get a default setter name for a property
        //someName => _setSomeNameAttr
        var getSetterName = function (name) {
            return ["_set", properName(name), "Attr"].join("");
        };

        //get a default getter name for a property
        //someName => _getSomeNameAttr
        var getGetterName = function (name) {
            return ["_get", properName(name), "Attr"].join("");
        };

        //tests if an object is a property
        var isArray = function (it) {
            return it && (it instanceof Array || typeof it === "array"); // Boolean
        };

        //tests if something is a string
        var isString = function (it) {
            return it && (it instanceof String || typeof it === "string"); // Boolean
        };

        //tests if something is an object
        var isObject = function (obj) {
            var undef;
            return obj !== null && obj !== undef && "object" === typeof obj;
        };

        //tests if something is a hash
        var isHash = function (obj) {
            var ret = isObject(obj);
            return ret && Object === obj.constructor;
        };

        //returns a function that will be passed in the arguments provided
        //after the function
        //var partial = partial(function(a,b,c){return a + b + c;}, 1,2,3);
        //partial() => 6
        var partial = function (cb) {
            var args = Array.prototype.slice.call(arguments).slice(1);
            return function () {
                cb.apply(this, args);
            };
        };

        //Binds a function to a particular scope as well as currying the passed in arguments
        var bind = function (scope, cb) {
            if (isString(cb)) {
                cb = scope[cb];
            }
            var args = Array.prototype.slice.call(arguments).slice(2);
            return function () {
                cb.apply(scope, args);
            };
        };

        //Flips a boolena value
        //this.flag = false;
        //flipBit(this, "flag");
        //this.flag => true;
        var flipBit = function (scope, prop) {
            return function () {
                scope[prop] = !scope[prop];
            };
        };

        //removed duplicates from an array
        var removeDups = function (arr) {
            if (isArray(arr)) {
                var ret = arr.reduce(function (a, b) {
                    if (a.indexOf(b) === -1) {
                        return a.concat(b);
                    } else {
                        return a;
                    }
                }, []);
                return ret;
            }
        };


        /**
         * Line chart object.
         * @param {DOMElement} node the node to attach the chart to
         * @param {Object} [options={}] options to set on the object
         * @constructor
         */
        var LineChart = function (node, options) {
            var thisOpts = this.options = {
                margin:margin,
                width:width,
                createLegend:true,
                height:height,
                chartWidth:chartWidth,
                chartHeight:chartHeight,
                chartClass:"chart",
                lines:[],
                xScale:d3.scale.linear(),
                yScale:d3.scale.linear(),
                showDots:true,
                dotRadius:3.5,
                data:[]
            };
            this.hovering = false;
            this.__graphNode = node;
            this.__minChartValue = 0;
            this.__maxChartValue = 0;
            this.__lines = {};
            this.__graph = null;
            this.set(options);

        };

        LineChart.prototype = {
            /**@lends LineChart.prototype*/

            /**
             * Sets properties on the chart.
             * @param {String|Object} key if the key is an object then each key value pair will be set
             * on the chart.
             * @param [value] if the key is a string then this is the value that will be set for the property
             * @return {LineChart} this for chaining
             */
            "set":function (key, value) {
                if (isHash(key)) {
                    //loop through the hash and set the value on the Line chart
                    for (var i in key) {
                        if (i in key) {
                            this.set(i, key[i]);
                        }
                    }
                } else {
                    //get all the arguments
                    var args = Array.prototype.slice.call(arguments);
                    //look up a possible setter function
                    var setterFunc = this[getSetterName(key)] || this[key];
                    //if the setter function exists call it
                    if ("function" === typeof setterFunc) {
                        setterFunc.apply(this, args.slice(1));
                    } else {
                        //otherwise just set it to the options hash
                        this.options[key] = value;
                    }
                }
                return this;
            },

            /**
             * Gets the value for the specified key.
             *
             * @param {String} key the value to get
             * @return {*} the value of the key.
             */
            "get":function (key) {
                //look up a possible getter function
                var getterFunc = this[getGetterName(key)], ret;
                //if it exists call it
                if ("function" === typeof getterFunc) {
                    ret = getterFunc();
                } else {
                    //otherwise get the value from the options hash
                    ret = this.options[key];
                }
                return ret;
            },

            _setMarginAttr:function (margin) {
                var opts = this.options;
                //set the margin
                opts.margin = margin;
                //recalculate the chartwidth and chartHeigth
                opts.chartWidth = opts.width - margin.left - margin.right;
                opts.chartHeight = opts.height - margin.top - margin.bottom;
                //call rerender with false to prevent the creation of the chart
                this.rerender(false);
            },

            _setHeightAttr:function (height) {
                var opts = this.options;
                //set the height
                opts.height = height;
                //recalculate the chartHeight
                opts.chartHeight = height - margin.top - margin.bottom;
                //call rerender with false to prevent the creation of the chart
                this.rerender(false);
            },

            _setWidthAttr:function (width) {
                var opts = this.options;
                //set the width
                opts.width = width;
                //recalculate the chartHeight
                opts.chartWidth = width - margin.left - margin.right;
                //call rerender with false to prevent the creation of the chart
                this.rerender(false);
            },

            _setLinesAttr:function (lines) {
                //set our lines
                this.options.lines = this.options.lines.concat(lines);
                //call rerender with false to prevent the creation of the chart
                this.rerender(false);
            },


            data:function (data) {
                if (data) {
                    //set the data
                    this.options.data = data;
                    //if we have a chart refresh it
                    if (this.__chart) {
                        this._refreshChart();
                    }
                }
                return this;
            },

            _setDataAttr:function () {
                //alias for data
                return this.data.apply(this, arguments);
            },

            __rerender:function () {
                //clear the chart and then render it with our data
                this.clear().render();
                return this;
            },

            /**
             * Rerenders the chart.
             *
             * @param {Boolean} [createIfNotCreated=false] if you set to true then if the chart has not been previously
             * created then create it.
             * @return {*}
             */
            rerender:function (createIfNotCreated) {
                createIfNotCreated = !!createIfNotCreated;
                if (this.__chart) {
                    this.rerender();
                } else if (createIfNotCreated) {
                    this.render();
                }
                return this;
            },

            /**
             * Clears the chart from the dom
             * @return {LineChart} this LineChart for chaining
             */
            clear:function () {
                this.graphNode.remove("svg");
                return this;
            },


            /**
             * Renders the chart
             * @return {LineChart} returns the line chart for chaining
             */
            render:function () {
                if (this.__chart) {
                    this.clear();
                }
                var opts = this.options, margin = opts.margin;
                //get and set our graphNode
                var graphNode = this.graphNode = d3.select(this.__graphNode);
                var g = this.__chart = graphNode
                    //append an svg element to the node
                        .append("svg")
                        .datum([])
                    //set the chartClass defaults to 'chart'
                        .attr("class", opts.chartClass)
                    //set the width and heigth
                        .attr("width", opts.width)
                        .attr("height", opts.height)
                    //setup listeners to prevent updating while hovering
                        .on("mouseover", flipBit(this, "hovering"))
                        .on("mouseout", bind(this, function () {
                    flipBit(this, "hovering")();
                    this._refreshChart();
                }))
                    //append a group element for out chart
                        .append("g")
                    //traslate it down to give us our margin
                        .attr("transform", "translate(" + margin.left + "," + margin.top + ")");

                //creat all meta elements for the chart
                this._createChartTitle()
                        ._createAxes()
                        ._createLinePaths()
                        ._refreshChart()
                        ._createLegend();

                return this;
            },

            _createLegend:function () {
                var opts = this.options, g = this.__chart, lines = opts.lines, thisLines = this.__lines, y = opts.margin.top + 10, w = opts.chartWidth + 5;
                if (opts.createLegend) {
                    var l = lines.length;
                    //lopp through the lines and create the corresponding elements
                    for (var i = 0; i < l; i++) {
                        var line = lines[i];
                        g.append("text")
                                .attr("x", w / 4)
                                .attr("y", y + 10)
                                .text(properName(line.name));

                        g.append("rect")
                                .attr("x", w / 2 + 20)
                                .attr("y", y + 5)
                                .attr('class', line.cssLineClass || "line")
                                .attr("height", 2)
                                .attr("width", 40);
                        y += 10;
                    }


                }
                return this;
            },

            _createLinePaths:function () {
                var opts = this.options, g = this.__chart, lines = opts.lines, thisLines = this.__lines, line;
                for (var i in lines) {
                    if (lines.hasOwnProperty(i)) {
                        line = lines[i];
                        //create the line element for rendering later
                        thisLines[line.name] = g.append("path")
                                .attr("class", line.cssLineClass || "line");

                    }
                }
                return this;
            },

            _createChartTitle:function () {
                var g = this.__chart, opts = this.options, margin = opts.margin;
                if (opts.title) {
                    //chrate the title
                    g.append("text")
                            .text(opts.title)
                        //move it to the center of the chart
                            .attr("transform", "translate(" + opts.chartWidth / 2 + "," + margin.top / 2 + ")")
                            .attr('align', 'center')
                        //set the css class of the title
                            .attr("class", opts.titleClass || "chartTitle");

                }
                return this;
            },

            _createAxes:function () {
                var g = this.__chart, opts = this.options;
                //create the xAxis
                this._xAxis = g.append("g")
                        .attr("class", "x axis")
                        .attr("transform", "translate(0," + opts.chartHeight + ")");
                //create the yAxis
                this._yAxis = g.append("g")
                        .attr("class", "y axis");
                return this;
            },

            _refreshChart:(function () {

                //helper function for dot mouse overs
                var mouseOver = function (point) {
                    //get a d3 reference to this dot
                    var circle = d3.select(this),
                    //get current dot radius
                            r = circle.attr("r");
                    //listen to the mouse out to shrink back down
                    circle.on("mouseout", partial(mouseOut, r))
                        //create our grow transtition
                            .transition()
                            .delay(0)
                            .duration(50)
                            .attr("r", r * 2);
                    //add the title to the dot
                    circle.append("svg:title")
                            .text(point.y);
                    //.append("text").text();
                };

                //helperfunction for mouse outs
                var mouseOut = function (r) {
                    //shrink it back down tot he original size
                    d3.select(this).transition()
                            .delay(0)
                            .duration(50)
                            .attr("r", r);
                };

                //helper function for placing the data point dots on the chart
                var placeDots = function (g, clas, data, radius, x, y) {
                    //places dots for the current data
                    g.selectAll("." + clas).remove();
                    g.selectAll(".dot ." + clas)
                            .remove()
                            .data(data)
                            .enter()
                        //create a circle
                            .append("circle")
                        //append the dot class
                            .attr("class", "dot " + clas)
                        //set the x/y placement functions
                            .attr("cx", x)
                            .attr("cy", y)
                        //set the radius of the dot
                            .attr("r", radius)
                        //create the mouseover effect
                            .on("mouseover", mouseOver);
                };

                //the final return function for refreshing the chart data
                return function () {
                    //if we aren't hovering rerender, this helps when hovering over
                    //a chart dot and the refresh is called a lot,(i.e new data every 1000ms)
                    if (!this.hovering) {
                        var opts = this.options,
                                data = this.options.data,
                                combinedData = [],
                                lines = opts.lines,
                                lineLength = lines.length,
                                g = this.__chart;
                        //aggregate all data points
                        for (var i = 0; i < lineLength; i++) {
                            //get the data line
                            var currLine = data[lines[i].name];
                            if (currLine) {
                                combinedData = combinedData.concat(currLine);
                            }
                        }
                        //remove all duplicate values
                        combinedData = removeDups(combinedData);
                        //create an xEtend and yExtend for our x/y functions
                        var xExtent = d3.extent(combinedData, function (d) {
                            return d.x;
                        });
                        var yExtent = d3.extent(combinedData, function (d) {
                            return d.y;
                        });
                        var min = yExtent[0], max = yExtent[1];
                        //this gets our min and max values so we
                        //can shift values accordingly to save room for the legend
                        if (min < this.__minChartValue) {
                            this.__minChartValue = yExtent[0];
                        }
                        if (max > this.__maxChartValue) {
                            this.__maxChartValue = yExtent[1];
                        }
                        //get a span to add the the top and bottom values
                        //if min and max are the same then just center the lines
                        var factor = (max - min) || max;
                        min = this.__minChartValue - factor;
                        //creat the scales.
                        var y = this.y = opts.yScale
                                        .domain([min < 0 ? 0 : min, this.__maxChartValue + factor])
                                        .range([opts.chartHeight, 0]),
                                x = this.x = opts.xScale
                                        .domain(xExtent)
                                        .range([0, opts.chartWidth]);
                        //create a new  line to to be used as the base for each of our data lines
                        var line = d3.svg.line()
                            //if an interpolation is defined then use it otherwise
                            //default to linear.
                                .interpolate(opts.lineInterpolation || "linear")
                            //set the default tension
                                .tension(0.2)
                            //add
                                .x(function (d, i) {
                                    //allow for single values
                                    return x("x" in d ? d.x : i);
                                })
                                .y(function (d) {
                                    //allow for single values
                                    return y("y" in d ? d.y : d);
                                });

                        //create the x/y axes
                        this._xAxis.call(d3.svg.axis()
                                .scale(x)
                                .orient("bottom"));

                        this._yAxis.call(d3.svg.axis()
                                .scale(y)
                                .orient("left"));

                        //create our lines
                        var thisLines = this.__lines, showDots = opts.showDots;
                        for (i in lines) {
                            if (lines.hasOwnProperty(i)) {
                                var lLine = lines[i], name = lLine.name, cssClass = lLine.cssDotClass;
                                var dataLine = data[name], path = thisLines[name];
                                //use the line function created above to define the
                                //path to be placed on the previously created line path
                                path.attr("d", line(dataLine));
                                if (showDots) {
                                    //if we are to show dots show them.
                                    placeDots(g, cssClass, dataLine, opts.dotRadius || 3.5, line.x(), line.y());
                                }
                            }
                        }
                    }
                    return this;
                };

            })()
        };
        window.LineChart = LineChart;
    }


})(window);