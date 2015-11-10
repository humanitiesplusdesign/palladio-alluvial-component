angular.module('palladioAlluvial', ['palladio', 'palladio.services'])
	.run(['componentService', function(componentService) {
		var compileStringFunction = function (newScope, options) {

			newScope.dimensions = newScope.dimensions ? newScope.dimensions : [];
			newScope.height = newScope.height ? newScope.height : 400;
			newScope.countBy = newScope.countBy ? newScope.countBy : null;
			newScope.colorScale = newScope.colorScale ? newScope.colorScale : d3.scale.ordinal().range(['#aaaaaa']);

			var compileString = '<div data-palladio-alluvial ';
			compileString += 'dimensions="dimensions" chart-height="height" count-by="countBy" color-scale="colorScale"></div>';

			return compileString;
		};

		componentService.register('alluvial', compileStringFunction);
	}])
	.directive('palladioAlluvial', function (palladioService, dataService) {
		return {
			scope : {
				dimensions: '=',
				chartHeight: '=',
				countBy: '=',
				colorScale: '='
			},
			template : '<div id="main"></div>',
			link : {
				pre : function(scope, element) {

				},

				post : function(scope, element, attrs) {
					var margin = 5;
					var marginTop = 15;
					var columnWidth = 20;
					var numValues = 30;
					var headerSpace = 20;
					var nodeFill = '#aaaaaa';
					var nodeMouseOver = '#666666';
					var linkFill = '#dddddd';
					var linkMouseOver = '#999999';

					var highlightLocked = false;

					var xfilter = dataService.getDataSync().xfilter;
					var metadata = dataService.getDataSync().metadata;
					var dimKeys = scope.dimensions.map(function(d) { return d.key; });
					var dimDescs = scope.dimensions.map(function(d) { return d.description; });
					var dimensions = scope.dimensions.map(function(k) {
						return xfilter.dimension(function(d) { return d[k.key]; });
					});
					var highlightedDimension = null;

					var countKey = scope.countBy.key;

					var reducer = reductio().exception(function(d) { return d[countKey]; }).exceptionCount(true);
					var groups = dimensions.map(function(d) {
						return reducer(d.group())
							.order(function(d) { return d.exceptionCount; });
					});
					
					// Pre-assign the color scale domains
					groups.forEach(function(d) {
						d.top(Infinity).forEach(function(g) {
							scope.colorScale(g.key);
						});
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
								.range([0, scope.chartHeight - headerSpace - margin - marginTop]);
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

					var enclosure = svg.append('g')
							.attr('transform', 'translate(5,20)');

					var headers = enclosure.selectAll('.column-header')
							.data(dimDescs);
					headers.enter()
						.append('text')
							.attr('class', 'column-header')
							.text(function(d) { return d; })
							.style('font-size', '12px');

					// Do once everything is rendered - because reasons???
					setTimeout(function(){
						headers
							.attr('transform', function(d, i) {
								if(i === 0) {
									// First
									return 'translate(' + columnOffsetScale(i) + ',10)';
								} else if(i === dimDescs.length-1) {
									// Last
									return 'translate(' + (columnOffsetScale(i) - this.getBBox().width + columnWidth) + ',10)';
								} else {
									// Middle
									return 'translate(' + (columnOffsetScale(i) - this.getBBox().width/2 + columnWidth/2) + ',10)';
								}
							});
					},0);

					var g = enclosure.append('g')
							.attr('transform', 'translate(0,' + headerSpace + ')');

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

					var nodeTip = function() {
						return d3.tip()
							.offset([0, 0])
							.attr("class","d3-tip")
							.html(function(d){
								return d.key + ' (' + d.value.exceptionCount + ')<br />';
							});
					};

					var linkTipLeft = function() {
						return d3.tip()
							.offset(function(d) {
								return [(columnScales[d.index](d.value.sOffset)-columnScales[d.index+1](d.value.tOffset))/2, -(columnOffsetScale(1) - columnOffsetScale(0)) + columnWidth + 12];
							})
							.direction('e')
							.attr("class","d3-tip")
							.html(function(d){ return d.key[0] + ' (' + d.value.exceptionCount + ')'; });
					};

					var linkTipRight = function() {
						return d3.tip()
							.offset(function(d) {
								return [(columnScales[d.index+1](d.value.tOffset)-columnScales[d.index](d.value.sOffset))/2, (columnOffsetScale(1) - columnOffsetScale(0)) - columnWidth - 12];
							})
							.direction('w')
							.attr("class","d3-tip")
							.html(function(d){ return d.key[1] + ' (' + d.value.exceptionCount + ')'; });
					}

					function setLinkHighlight(d) {
						if(d.highlighted) {
							links.filter(function(l) {
								return l.index === d.index && l.key[0] === d.key;
							}).each(function(l) {
								l.highlighted = l.highlighted ? true : d.highlighted;
								l.linkTipRight.show(l, this); 
							});
							links.filter(function(l) {
								return l.index === d.index-1 && l.key[1] === d.key;
							}).each(function(l) {
								l.highlighted = l.highlighted ? true : d.highlighted;
								l.linkTipLeft.show(l, this);
							});	
						}
					}

					function unSetLinkHighlights(d) {
						links.filter(function(l) {
							return l.index === d.index && l.key[0] === d.key;
						}).each(function(l) {
							l.highlighted = false;
							l.linkTipRight.hide(l);
						});
						links.filter(function(l) {
							return l.index === d.index-1 && l.key[1] === d.key;
						}).each(function(l) {
							l.highlighted = false;
							l.linkTipLeft.hide(l);
						});
					}

					var update = function() {
						calcData();

						nodes = columns.selectAll('.node')
							.data(function(d, i) { return dataGroups[i].filter(function(d) { return d.value.exceptionCount > 0; }); },
									function(d) { return d.index + d.key; });
					
						nodes.enter()
							.append('rect')
								.attr('class', 'node')
								.attr('width', '20px')
								.on('mouseover', function(d) {
									d.nodeTip.show(d);
									if(!highlightLocked) {
										d.highlighted = true;
										setLinkHighlight(d);
									}
									update();
								})
								.on('mouseout', function(d) {
									// Hide in all cases except when this element is highlight-locked.
									if(!highlightLocked || highlightedDimension !== d.index || columnScales[d.index](d.value.exceptionCount) <= 10) {
										d.nodeTip.hide(d);
									}
									if(!highlightLocked) {
										d.highlighted = false;
										unSetLinkHighlights(d);
									}
									update();
								})
								.on('click', function(d) {
									highlightLocked = !highlightLocked;
									highlightedDimension = null;
									if(highlightLocked) {
										// Clear all other highlights and set this one on.
										nodes.each(function(n) {
											n.highlighted = false;
											// If in the locked dimension and large enough, turn on the tooltip
											if(n.index === d.index && columnScales[n.index](n.value.exceptionCount) > 10 && n.nodeTip) {
												n.nodeTip.show(n, this);
											}
										});
										links.each(function(n) { n.highlighted = false; });
										highlightedDimension = d.index;
									} else {
										// Clear all highlights and turn off all tooltips except this one
										nodes.each(function(n) {
											n.highlighted = false;
											if(n.nodeTip) n.nodeTip.hide(n);
										});
										links.each(function(n) {
											n.highlighted = false;
											n.linkTipRight.hide(n);
											n.linkTipLeft.hide(n);
										});
									}
									// Mouse will still be over the element, so leave highlighted.
									d.highlighted = true;
									if(d.nodeTip) d.nodeTip.show(d);
									setLinkHighlight(d);
									update();
								})
								.on('dblclick', function(d) {
									clearSelection();
									if(!d.filtered) {
										d.filtered = true;
										dimensions[d.index].filterExact(d.key);
									} else {
										d.filtered = false;
										dimensions[d.index].filterAll();
									}
									palladioService.update();
								})
								.each(function(d) {
									d.nodeTip = nodeTip();
									d3.select(this).call(d.nodeTip);
								});

						nodes.exit().each(function(d) { if(d.nodeTip) d.nodeTip.hide(d); }).remove();

						links = linkColumns.selectAll('.link')
								.data(function(d, i) {
									return dataLinks[i].filter(function(d) { return d.value.exceptionCount > 0; });
								}, function(d, i) { return d.key.join(); });

						links.enter()
							.append('path')
								.attr('class', 'link')
								.style('opacity', "0.5")
							.on('mouseover', function(d) {
								d.linkTipLeft.show(d);
								d.linkTipRight.show(d);
								if(!highlightLocked) {
									d.highlighted = true;
								}
								update();
							})
							.on('mouseout', function(d) {
								// Hide in all cases except when this element's dimension is highlight-locked.
								if(!highlightLocked || !d.highlighted) {
									d.linkTipLeft.hide(d);
									d.linkTipRight.hide(d);	
								}
								// We don't lock on tooltips when the dimension on that side is locked.
								if(highlightLocked && d.highlighted && highlightedDimension === d.index) {
									d.linkTipLeft.hide(d);
								}
								if(highlightLocked && d.highlighted && highlightedDimension === d.index+1) {
									d.linkTipRight.hide(d);
								}
								if(!highlightLocked) {
									d.highlighted = false;
								}
								update();
							})
							.each(function(d) {
								d.linkTipLeft = linkTipLeft();
								d.linkTipRight = linkTipRight();
								d3.select(this).call(d.linkTipLeft);
								d3.select(this).call(d.linkTipRight);
							});;

						links.exit().each(function(d) {
							if(d.linkTipLeft) d.linkTipLeft.hide(d);
							if(d.linkTipRight) d.linkTipRight.hide(d);
						}).remove();

						if(highlightLocked) {
							nodes.each(unSetLinkHighlights);
							nodes.each(setLinkHighlight);	
						}
						
						nodes.attr('fill', nodeFillColor);
						links.attr('fill', linkFillColor);

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
					
					function nodeFillColor(d) {
						return d.index === highlightedDimension ? scope.colorScale(d.key) : d.highlighted ? nodeMouseOver : nodeFill;
					}
					
					function linkFillColor(d) {
						if(d.highlighted) { 
							if(highlightedDimension !== null && d.index === highlightedDimension) {
								return scope.colorScale(d.key[0]);
							} else if(highlightedDimension !== null && d.index+1 === highlightedDimension) {
								return scope.colorScale(d.key[1]);
							} else {
								return linkMouseOver;	
							}
						} else {
							return linkFill;
						}
					}
					
					update();

					palladioService.onUpdate('alluvial', update);

					// From http://stackoverflow.com/a/880518/200576
					function clearSelection() {
						if(document.selection && document.selection.empty) {
							document.selection.empty();
						} else if(window.getSelection) {
							var sel = window.getSelection();
							sel.removeAllRanges();
						}
					}
				}
			}
		};
	});
