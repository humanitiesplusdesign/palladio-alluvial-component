angular.module('palladioAlluvial', ['palladio', 'palladio.services'])
	.run(['componentService', function(componentService) {
		var compileStringFunction = function (newScope, options) {

			var compileString = '<div data-palladio-alluvial ></div>';

			return compileString;
		};

		componentService.register('alluvial', compileStringFunction);
	}])
	.directive('palladioAlluvial', function (palladioService, dataService) {
		return {
			scope : {

			},
			template : '<div id="main">' +
						'<h3>IN DEVELOPMENT</h3>' +
						'<div></div>' +
					'</div>',
			link : {
				pre : function(scope, element) {
					

				},

				post : function(scope, element, attrs) {
					
				}
			}
		};
	});
