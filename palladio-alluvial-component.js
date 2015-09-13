angular.module('palladioAlluvial', ['palladio', 'palladio.services'])
	.run(['componentService', function(componentService) {
		var compileStringFunction = function (newScope, options) {

			newScope.dimensions = newScope.dimensions ? newScope.dimensions : [];
			newScope.height = newScope.height ? newScope.height : 400;

			var compileString = '<div data-palladio-alluvial ';
			compileString += 'dimensions="dimensions" chart-height="height"></div>';

			return compileString;
		};

		componentService.register('alluvial', compileStringFunction);
	}])
	.directive('palladioAlluvial', function (palladioService, dataService) {
		return {
			scope : {
				dimensions: '=',
				chartHeight: '='
			},
			template : '<div id="main"></div>',
			link : {
				pre : function(scope, element) {

				},

				post : function(scope, element, attrs) {
					var margin = 5;
					var columnWidth = 20;
					var numValues = 30;

					var xfilter = dataService.getDataSync().xfilter;
					var dimKeys = scope.dimensions.map(function(d) { return d.key; });
					var dimensions = dataService.getDataSync().metadata.filter(function(d) {
						return dimKeys.indexOf(d.key) > -1;
					}).map(function(k) {
						return xfilter.dimension(function(d) { return d[k.key]; });
					});

					var countKey = dataService.getDataSync().metadata.filter(function (d) { return d.countable === true; })[0].key;

					var reducer = reductio().exception(function(d) { return d[countKey]; }).exceptionCount(true);
					var groups = dimensions.map(function(d) {
						return reducer(d.group())
							.order(function(d) { return d.exceptionCount; });
					});

					var linkKeys = [];
					dimKeys.forEach(function(d, i) {
						if(i < dimKeys.length-1) {
							linkKeys.push([d, dimKeys[i+1]]);
						}
					});
					var linkDimensions = linkKeys.map(function(k) {
						return xfilter.dimension(function(d) { return [d[k[0]], d[k[1]]]; });
					});
					var linkGroups = linkDimensions.map(function(d) {
						return reducer(d.group());
					});

					function addCounts(array) {
						return array.reduce(function(a,b) {
							return a + b.value.exceptionCount;
						}, 0);
					}

					function buildOffset(array, initial, attr, adj) {
						attr = attr ? attr : 'offset';
						adj = adj ? adj : 1;
						var offset = initial ? initial : 0;
						array.forEach(function(d) {
							d.value[attr] = offset;
							offset += d.value.exceptionCount * adj;
						});
						return array;
					}

					function buildOther(array, total) {
						var exceptionCount = addCounts(array);
						if(total-exceptionCount > 0) {
							array.pop(); // Remove last element so we have a constant # of elements
							array.push({
								key: "Other (generated)",
								value: {
									exceptionCount: total - addCounts(array),
								}
							});
						}
						return array;
					}

					var columnOffsetScale = d3.scale.linear()
							.domain([0, groups.length - 1])
							.range([0 + margin, 1000 - margin*2 - columnWidth]);

					var columnTotals, columnScales, dataGroups, linkMaps, dataLinks;

					var calcData = function() {
						columnTotals = groups.map(function(g) {
							return addCounts(g.all());
						});

						columnScales = columnTotals.map(function(d) {
							return d3.scale.linear()
								.domain([0,d])
								.range([0, scope.chartHeight - margin*2]);
						});

						dataGroups = groups.map(function(d, i) {
							var top = d.top(numValues);
							var length = top.length;
							return buildOffset(buildOther(top, columnTotals[i])).map(function(h) { h.index = i; h.length = length; return h; });
						});

						linkMaps = linkGroups.map(function() { return d3.map(); });
						linkGroups.forEach(function(g,i) {
							g.all().forEach(function(d) {
								linkMaps[i].set(d.key, d);
							});
						});

						dataLinks = linkGroups.map(function(d,i) {
							var startKeys = dataGroups[i].map(function(c) { return { key: c.key, value: c.value.exceptionCount, offset: c.value.offset }; });
							var endKeys = dataGroups[i+1].map(function(c) { return { key: c.key, value: c.value.exceptionCount, offset: c.value.offset }; });

							var links = [];

							startKeys.forEach(function(sk) {
								var nodeLinks = [];

								endKeys.forEach(function(ek) {
									// Not all possible links actually exist
									if(linkMaps[i].has([sk.key,ek.key])) {
										nodeLinks.push(linkMaps[i].get([sk.key,ek.key]));
									}
								});

								nodeLinks.sort(function(a,b) { return b.value.exceptionCount - a.value.exceptionCount; });
								var totalLinks = addCounts(nodeLinks);
								var adj = 1;
								if(totalLinks > sk.value) {
									adj = sk.value / totalLinks;
								}
								nodeLinks.forEach(function(d) { d.value.sAdj = adj; });

								buildOffset(nodeLinks, sk.offset, 'sOffset', adj);
								links = links.concat(nodeLinks);
							});

							endKeys.forEach(function(ek) {
								var nodeLinks = [];

								startKeys.forEach(function(sk) {
									if(linkMaps[i].has([sk.key, ek.key])){
										nodeLinks.push(linkMaps[i].get([sk.key,ek.key]));
									}
								});

								nodeLinks.sort(function(a,b) { return b.value.exceptionCount - a.value.exceptionCount; });

								var totalLinks = addCounts(nodeLinks);
								var adj = 1;
								if(totalLinks > ek.value) {
									adj = ek.value / totalLinks;
								}
								nodeLinks.forEach(function(d) { d.value.tAdj = adj; });

								buildOffset(nodeLinks, ek.offset, 'tOffset', adj);

								// Filter out links that are already recorded so we don't double-add.
								nodeLinks.filter(function(d) { return links.indexOf(d) !== -1; });

								links = links.concat(nodeLinks);
							});

							links.forEach(function(d) { d.index = i; });

							return links;
						});
					};

					calcData();

					element.height(scope.chartHeight);

					var nodes, links;
					
					var svg = d3.select(element[0]).append('svg');
					svg.attr('height', scope.chartHeight);
					svg.attr('width', '100%');

					var g = svg.append('g')
							.attr('transform', 'translate(5,5)');

					var columns = g.selectAll('.column')
							.data(dataGroups);

					columns.enter()
						.append('g')
							.attr('class', 'column');

					var linkColumns = g.selectAll('.link-column')
							.data(linkKeys);

					linkColumns.enter()
						.append('g')
							.attr('class', 'link-column');

					var curvature = 0.5;
					var linkWidth = columnOffsetScale(2) - columnOffsetScale(1) - columnWidth - 4;
					function link(d) {
						var x0 = 0,
							x1 = linkWidth,
							xi = d3.interpolateNumber(x0, x1),
							x2 = xi(curvature),
							x3 = xi(1 - curvature),
							sy0 = columnScales[d.index](d.value.sOffset),
							ty1 = columnScales[d.index+1](d.value.tOffset),
							sy2 = columnScales[d.index](d.value.sOffset) + columnScales[d.index](d.value.exceptionCount * d.value.sAdj)-1,
							ty3 = columnScales[d.index+1](d.value.tOffset) + columnScales[d.index+1](d.value.exceptionCount * d.value.tAdj)-1;
						return "M" + x0 + "," + sy0 +
							"C" + x2 + "," + sy0 +
							" " + x3 + "," + ty1 +
							" " + x1 + "," + ty1 +
							"L" + x1 + "," + ty3 +
							"C" + x3 + "," + ty3 +
							" " + x2 + "," + sy2 +
							" " + x0 + "," + sy2;
					}

					var nodeTip = d3.tip()
							.offset([-10, 0])
							.attr("class","d3-tip")
							.html(function(d){ return d.key + ' (' + d.value.exceptionCount + ')'; });

					var linkTipLeft = d3.tip()
							.offset(function(d) {
								if(columnScales[d.index+1](d.value.tOffset) < columnScales[d.index](d.value.sOffset)) {
									return [columnScales[d.index](d.value.sOffset)-columnScales[d.index+1](d.value.tOffset)-10, -(columnOffsetScale(1) - columnOffsetScale(0))/2 + columnWidth];
								} else {
									return [-10, -(columnOffsetScale(1) - columnOffsetScale(0))/2 + columnWidth];
								}
							})
							.attr("class","d3-tip")
							.html(function(d){ return d.key[0] + ' (' + d.value.exceptionCount + ')'; });

					var linkTipRight = d3.tip()
							.offset(function(d) {
								if(columnScales[d.index+1](d.value.tOffset) > columnScales[d.index](d.value.sOffset)) {
									return [columnScales[d.index+1](d.value.tOffset)-columnScales[d.index](d.value.sOffset)-10, (columnOffsetScale(1) - columnOffsetScale(0))/2 - columnWidth];
								} else {
									return [-10, (columnOffsetScale(1) - columnOffsetScale(0))/2 - columnWidth];
								}
							})
							.attr("class","d3-tip")
							.html(function(d){ return d.key[1] + ' (' + d.value.exceptionCount + ')'; });

					svg.call(nodeTip);
					svg.call(linkTipLeft);
					svg.call(linkTipRight);

					var update = function() {
						calcData();

						nodes = columns.selectAll('.node')
							.data(function(d, i) { return dataGroups[i].filter(function(d) { return d.value.exceptionCount > 0; }); },
									function(d, i) { return i + d.key; });
					
						nodes.enter()
							.append('rect')
								.attr('class', 'node')
								.attr('width', '20px')
								.attr('fill', '#dddddd')
								.on('mouseover', function(d) {
									nodeTip.show(d);
									d3.select(this)
										.attr('fill', '#bbbbbb');
									links.filter(function(l) {
										return l.index === d.index && l.key[0] === d.key;
									}).attr('fill', '#bbbbbb');
									links.filter(function(l) {
										return l.index === d.index-1 && l.key[1] === d.key;
									}).attr('fill', '#bbbbbb');
								})
								.on('mouseout', function(d) {
									nodeTip.hide(d);
									d3.select(this)
										.attr('fill', '#dddddd');
									links.filter(function(l) {
										return l.index === d.index && l.key[0] === d.key;
									}).attr('fill', '#dddddd');
									links.filter(function(l) {
										return l.index === d.index-1 && l.key[1] === d.key;
									}).attr('fill', '#dddddd');
								});

						nodes.exit().remove();

						links = linkColumns.selectAll('.link')
								.data(function(d, i) {
									return dataLinks[i].filter(function(d) { return d.value.exceptionCount > 0; });
								}, function(d, i) { return i + d.key.join(); });

						links.enter()
							.append('path')
								.attr('class', 'link')
								.style('opacity', "0.5")
								.attr('fill', '#dddddd')
							.on('mouseover', function(d) {
								linkTipLeft.show(d);
								linkTipRight.show(d);
								d3.select(this)
									.attr('fill', "#bbbbbb");
							})
							.on('mouseout', function(d) {
								linkTipLeft.hide(d);
								linkTipRight.hide(d);
								d3.select(this)
									.attr('fill', "#dddddd");
							});

						links.exit().remove();

						columns.attr('transform', function(d, i) { return 'translate(' + columnOffsetScale(i) + ',0)'; });

						linkColumns.attr('transform', function(d, i) { return 'translate(' + (columnOffsetScale(i)+columnWidth+2) + ',0)'; });

						nodes.transition()
								.attr('height', function(d, i) {
									if(d.value.exceptionCount > 0) {
										if(i < d.length-1) {
											return columnScales[d.index](d.value.exceptionCount)-1;
										} else {
											return columnScales[d.index](d.value.exceptionCount);
										}
									}
								})
							.transition()
								.attr('transform', function (d) { return 'translate(0,' + columnScales[d.index](d.value.offset) + ')'; });

						links.attr('d', link);
					};

					update();

					palladioService.onUpdate('alluvial', update);
				}
			}
		};
	});
