var XLib = function( args ) {
	args = args || {};

	// LOCAL CHANGE to prevent errors in Chrome:
	// -  !t.isImmediatePropagationStopped()
	// +  (!t.isImmediatePropagationStopped || !t.isImmediatePropagationStopped())
	// http://github.e-sites.nl/zeptobuilder/
	/*! Zepto 1.2.0 (generated with Zepto Builder) - zepto event - zeptojs.com/license */
	//     Zepto.js
	//     (c) 2010-2016 Thomas Fuchs
	//     Zepto.js may be freely distributed under the MIT license.

	/* eslint-disable */
	var Zepto = (function() {
		var undefined, key, $, classList, emptyArray = [], concat = emptyArray.concat, filter = emptyArray.filter, slice = emptyArray.slice,
			document = window.document,
			elementDisplay = {}, classCache = {},
			cssNumber = { 'column-count': 1, 'columns': 1, 'font-weight': 1, 'line-height': 1,'opacity': 1, 'z-index': 1, 'zoom': 1 },
			fragmentRE = /^\s*<(\w+|!)[^>]*>/,
			singleTagRE = /^<(\w+)\s*\/?>(?:<\/\1>|)$/,
			tagExpanderRE = /<(?!area|br|col|embed|hr|img|input|link|meta|param)(([\w:]+)[^>]*)\/>/ig,
			rootNodeRE = /^(?:body|html)$/i,
			capitalRE = /([A-Z])/g,

			// special attributes that should be get/set via method calls
			methodAttributes = ['val', 'css', 'html', 'text', 'data', 'width', 'height', 'offset'],

			adjacencyOperators = [ 'after', 'prepend', 'before', 'append' ],
			table = document.createElement('table'),
			tableRow = document.createElement('tr'),
			containers = {
				'tr': document.createElement('tbody'),
				'tbody': table, 'thead': table, 'tfoot': table,
				'td': tableRow, 'th': tableRow,
				'*': document.createElement('div')
			},
			readyRE = /complete|loaded|interactive/,
			simpleSelectorRE = /^[\w-]*$/,
			class2type = {},
			toString = class2type.toString,
			zepto = {},
			camelize, uniq,
			uniques,
			tempParent = document.createElement('div'),
			propMap = {
				'tabindex': 'tabIndex',
				'readonly': 'readOnly',
				'for': 'htmlFor',
				'class': 'className',
				'maxlength': 'maxLength',
				'cellspacing': 'cellSpacing',
				'cellpadding': 'cellPadding',
				'rowspan': 'rowSpan',
				'colspan': 'colSpan',
				'usemap': 'useMap',
				'frameborder': 'frameBorder',
				'contenteditable': 'contentEditable'
			},
			isArray = Array.isArray ||
				function(object){ return object instanceof Array }
		zepto.mogrify = selector => (typeof selector === 'string' && typeof SFX === 'object' && typeof SFX.gib_convert === 'function') ? SFX.gib_convert(selector) : selector
		zepto.matches = function(element, selector) {
			if (!selector || !element || element.nodeType !== 1) return false
			var matchesSelector = element.matches || element.webkitMatchesSelector ||
				element.mozMatchesSelector || element.oMatchesSelector ||
				element.matchesSelector
			selector = zepto.mogrify(selector)
			if (matchesSelector) return matchesSelector.call(element, selector)
			// fall back to performing a selector:
			var match, parent = element.parentNode, temp = !parent
			if (temp) (parent = tempParent).appendChild(element)
			match = ~zepto.qsa(parent, selector).indexOf(element)
			temp && tempParent.removeChild(element)
			return match
		}

		function type(obj) {
			return obj == null ? String(obj) :
			class2type[toString.call(obj)] || "object"
		}

		function isFunction(value) { return type(value) == "function" }
		function isWindow(obj)     { return obj != null && obj == obj.window }
		function isDocument(obj)   { return obj != null && obj.nodeType == obj.DOCUMENT_NODE }
		function isObject(obj)     { return type(obj) == "object" }
		function isPlainObject(obj) {
			return isObject(obj) && !isWindow(obj) && Object.getPrototypeOf(obj) == Object.prototype
		}

		function likeArray(obj) {
			var length = !!obj && 'length' in obj && obj.length,
				type = $.type(obj)

			return 'function' != type && !isWindow(obj) && (
					'array' == type || length === 0 ||
					(typeof length == 'number' && length > 0 && (length - 1) in obj)
				)
		}

		function compact(array) { return filter.call(array, function(item){ return item != null }) }
		function flatten(array) { return array.length > 0 ? $.fn.concat.apply([], array) : array }
		camelize = function(str){ return str.replace(/-+(.)?/g, function(match, chr){ return chr ? chr.toUpperCase() : '' }) }
		function dasherize(str) {
			return str.replace(/::/g, '/')
				.replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
				.replace(/([a-z\d])([A-Z])/g, '$1_$2')
				.replace(/_/g, '-')
				.toLowerCase()
		}
		// .uniq([1,2,3,1]) == [1,2,3] -- one instance of each value which appears
		uniq = function(array){ return filter.call(array, function(item, idx){ return array.indexOf(item) == idx }) }
		// .uniques([1,2,3,1]) == [2,3] -- only values which appear exactly once
		uniques = function(array){ return filter.call(array, function(item, idx){ return array.indexOf(item) == idx && array.indexOf(item, idx + 1) == -1}) }

		function classRE(name) {
			return name in classCache ?
				classCache[name] : (classCache[name] = new RegExp('(^|\\s)' + name + '(\\s|$)'))
		}

		function maybeAddPx(name, value) {
			return (typeof value == "number" && !cssNumber[dasherize(name)]) ? value + "px" : value
		}

		function defaultDisplay(nodeName) {
			var element, display
			if (!elementDisplay[nodeName]) {
				element = document.createElement(nodeName)
				document.body.appendChild(element)
				display = getComputedStyle(element, '').getPropertyValue("display")
				element.parentNode.removeChild(element)
				display == "none" && (display = "block")
				elementDisplay[nodeName] = display
			}
			return elementDisplay[nodeName]
		}

		function children(element) {
			return 'children' in element ?
				slice.call(element.children) :
				$.map(element.childNodes, function(node){ if (node.nodeType == 1) return node })
		}

		function Z(dom, selector) {
			var i, len = dom ? dom.length : 0
			for (i = 0; i < len; i++) this[i] = dom[i]
			this.length = len
			this.selector = selector || ''
		}

		// `$.zepto.fragment` takes a html string and an optional tag name
		// to generate DOM nodes from the given html string.
		// The generated DOM nodes are returned as an array.
		// This function can be overridden in plugins for example to make
		// it compatible with browsers that don't support the DOM fully.
		zepto.fragment = function(html, name, properties) {
			var dom, nodes, container

			// A special case optimization for a single tag
			if (singleTagRE.test(html)) dom = $(document.createElement(RegExp.$1))

			if (!dom) {
				if (html.replace) html = html.replace(tagExpanderRE, "<$1></$2>")
				if (name === undefined) name = fragmentRE.test(html) && RegExp.$1
				if (!(name in containers)) name = '*'

				container = containers[name]
				container.innerHTML = '' + html
				dom = $.each(slice.call(container.childNodes), function(){
					container.removeChild(this)
				})
			}

			if (isPlainObject(properties)) {
				nodes = $(dom)
				$.each(properties, function(key, value) {
					if (methodAttributes.indexOf(key) > -1) nodes[key](value)
					else nodes.attr(key, value)
				})
			}

			return dom
		}

		// `$.zepto.Z` swaps out the prototype of the given `dom` array
		// of nodes with `$.fn` and thus supplying all the Zepto functions
		// to the array. This method can be overridden in plugins.
		zepto.Z = function(dom, selector) {
			return new Z(dom, selector)
		}

		// `$.zepto.isZ` should return `true` if the given object is a Zepto
		// collection. This method can be overridden in plugins.
		zepto.isZ = function(object) {
			return object instanceof zepto.Z
		}

		// `$.zepto.init` is Zepto's counterpart to jQuery's `$.fn.init` and
		// takes a CSS selector and an optional context (and handles various
		// special cases).
		// This method can be overridden in plugins.
		zepto.init = function(selector, context) {
			var dom
			// If nothing given, return an empty Zepto collection
			if (!selector) return zepto.Z()
			// Optimize for string selectors
			else if (typeof selector == 'string') {
				selector = zepto.mogrify(selector)
				selector = selector.trim()
				// If it's a html fragment, create nodes from it
				// Note: In both Chrome 21 and Firefox 15, DOM error 12
				// is thrown if the fragment doesn't begin with <
				if (selector[0] == '<' && fragmentRE.test(selector))
					dom = zepto.fragment(selector, RegExp.$1, context), selector = null
				// If there's a context, create a collection on that context first, and select
				// nodes from there
				else if (context !== undefined) return $(context).find(selector)
				// If it's a CSS selector, use it to select nodes.
				else dom = zepto.qsa(document, selector)
			}
			// If a function is given, call it when the DOM is ready
			else if (isFunction(selector)) return $(document).ready(selector)
			// If a Zepto collection is given, just return it
			else if (zepto.isZ(selector)) return selector
			else {
				// normalize array if an array of nodes is given
				if (isArray(selector)) dom = compact(selector)
				// Wrap DOM nodes.
				else if (isObject(selector))
					dom = [selector], selector = null
				// If it's a html fragment, create nodes from it
				else if (fragmentRE.test(selector))
					dom = zepto.fragment(selector.trim(), RegExp.$1, context), selector = null
				// If there's a context, create a collection on that context first, and select
				// nodes from there
				else if (context !== undefined) return $(context).find(selector)
				// And last but no least, if it's a CSS selector, use it to select nodes.
				else dom = zepto.qsa(document, selector)
			}
			// create a new Zepto collection from the nodes found
			return zepto.Z(dom, selector)
		}

		// `$` will be the base `Zepto` object. When calling this
		// function just call `$.zepto.init, which makes the implementation
		// details of selecting nodes and creating Zepto collections
		// patchable in plugins.
		$ = function(selector, context){
			return zepto.init(selector, context)
		}

		function extend(target, source, deep) {
			for (key in source)
				if (deep && (isPlainObject(source[key]) || isArray(source[key]))) {
					if (isPlainObject(source[key]) && !isPlainObject(target[key]))
						target[key] = {}
					if (isArray(source[key]) && !isArray(target[key]))
						target[key] = []
					extend(target[key], source[key], deep)
				}
				else if (source[key] !== undefined) target[key] = source[key]
		}

		// Copy all but undefined properties from one or more
		// objects to the `target` object.
		$.extend = function(target){
			var deep, args = slice.call(arguments, 1)
			if (typeof target == 'boolean') {
				deep = target
				target = args.shift()
			}
			args.forEach(function(arg){ extend(target, arg, deep) })
			return target
		}

		// `$.zepto.qsa` is Zepto's CSS selector implementation which
		// uses `document.querySelectorAll` and optimizes for some special cases, like `#id`.
		// This method can be overridden in plugins.
		zepto.qsa = function(element, selector){
			selector = zepto.mogrify(selector)
			var found,
				maybeID = selector[0] == '#',
				maybeClass = !maybeID && selector[0] == '.',
				nameOnly = maybeID || maybeClass ? selector.slice(1) : selector, // Ensure that a 1 char tag name still gets checked
				isSimple = simpleSelectorRE.test(nameOnly)
			return (element.getElementById && isSimple && maybeID) ? // Safari DocumentFragment doesn't have getElementById
				( (found = element.getElementById(nameOnly)) ? [found] : [] ) :
				(element.nodeType !== 1 && element.nodeType !== 9 && element.nodeType !== 11) ? [] :
					slice.call(
						isSimple && !maybeID && element.getElementsByClassName ? // DocumentFragment doesn't have getElementsByClassName/TagName
							maybeClass ? element.getElementsByClassName(nameOnly) : // If it's simple, it could be a class
								element.getElementsByTagName(selector) : // Or a tag
							element.querySelectorAll(selector) // Or it's not simple, and we need to query all
					)
		}

		function filtered(nodes, selector) {
			return selector == null ? $(nodes) : $(nodes).filter(selector)
		}

		$.contains = document.documentElement && document.documentElement.contains ?
			function(parent, node) {
				return parent !== node && parent.contains(node)
			} :
			function(parent, node) {
				while (node && (node = node.parentNode))
					if (node === parent) return true
				return false
			}

		function funcArg(context, arg, idx, payload) {
			return isFunction(arg) ? arg.call(context, idx, payload) : arg
		}

		function setAttribute(node, name, value) {
			value == null ? node.removeAttribute(name) : node.setAttribute(name, value)
		}

		// access className property while respecting SVGAnimatedString
		function className(node, value){
			var klass = node.className || '',
				svg   = klass && klass.baseVal !== undefined

			if (value === undefined) return svg ? klass.baseVal : klass
			svg ? (klass.baseVal = value) : (node.className = value)
		}

		// "true"  => true
		// "false" => false
		// "null"  => null
		// "42"    => 42
		// "42.5"  => 42.5
		// "08"    => "08"
		// JSON    => parse if valid
		// String  => self
		function deserializeValue(value) {
			try {
				return value ?
				value == "true" ||
				( value == "false" ? false :
					value == "null" ? null :
						+value + "" == value ? +value :
							/^[\[\{]/.test(value) ? $.parseJSON(value) :
								value )
					: value
			} catch(e) {
				return value
			}
		}

		$.type = type
		$.isFunction = isFunction
		$.isWindow = isWindow
		$.isArray = isArray
		$.isObject = isObject
		$.isPlainObject = isPlainObject

		$.isEmptyObject = function(obj) {
			var name
			for (name in obj) return false
			return true
		}

		$.isNumeric = function(val) {
			var num = Number(val), type = typeof val
			return val != null && type != 'boolean' &&
				(type != 'string' || val.length) &&
				!isNaN(num) && isFinite(num) || false
		}

		$.inArray = function(elem, array, i){
			return emptyArray.indexOf.call(array, elem, i)
		}

		$.camelCase = camelize
		$.dasherize = dasherize
		$.trim = function(str) {
			return str == null ? "" : String.prototype.trim.call(str)
		}

		// plugin compatibility
		$.uuid = 0
		$.support = { }
		$.expr = { }
		$.noop = function() {}

		$.map = function(elements, callback){
			var value, values = [], i, key
			if (likeArray(elements))
				for (i = 0; i < elements.length; i++) {
					value = callback(elements[i], i)
					if (value != null) values.push(value)
				}
			else
				for (key in elements) {
					value = callback(elements[key], key)
					if (value != null) values.push(value)
				}
			return flatten(values)
		}

		$.each = function(elements, callback){
			var i, key
			if (likeArray(elements)) {
				for (i = 0; i < elements.length; i++)
					if (callback.call(elements[i], i, elements[i]) === false) return elements
			} else {
				for (key in elements)
					if (callback.call(elements[key], key, elements[key]) === false) return elements
			}

			return elements
		}

		$.grep = function(elements, callback){
			return filter.call(elements, callback)
		}

		$.cssProp = function(element, property, computedStyle) {
			let value = element.style[camelize(property)]
			if (value === undefined || /^($|inherit|initial|unset|revert)/i.test(value)) {
				value = (computedStyle || getComputedStyle(element)).getPropertyValue(dasherize(property))
			}
			return value
		}

		if (window.JSON) $.parseJSON = JSON.parse

		// Populate the class2type map
		$.each("Boolean Number String Function Array Date RegExp Object Error".split(" "), function(i, name) {
			class2type[ "[object " + name + "]" ] = name.toLowerCase()
		})

		// Define methods that will be available on all
		// Zepto collections
		$.fn = {
			constructor: zepto.Z,
			length: 0,

			// Because a collection acts like an array
			// copy over these useful array functions.
			forEach: emptyArray.forEach,
			reduce: emptyArray.reduce,
			push: emptyArray.push,
			sort: emptyArray.sort,
			splice: emptyArray.splice,
			indexOf: emptyArray.indexOf,
			concat: function(){
				var i, value, args = []
				for (i = 0; i < arguments.length; i++) {
					value = arguments[i]
					args[i] = zepto.isZ(value) ? value.toArray() : value
				}
				return concat.apply(zepto.isZ(this) ? this.toArray() : this, args)
			},

			// `map` and `slice` in the jQuery API work differently
			// from their array counterparts
			map: function(fn){
				return $($.map(this, function(el, i){ return fn.call(el, i, el) }))
			},
			slice: function(){
				return $(slice.apply(this, arguments))
			},

			ready: function(callback){
				// need to check if document.body exists for IE as that browser reports
				// document ready when it hasn't yet created the body element
				if (readyRE.test(document.readyState) && document.body) callback($)
				else document.addEventListener('DOMContentLoaded', function(){ callback($) }, { capture: false, once: true })
				return this
			},
			get: function(idx){
				return idx === undefined ? slice.call(this) : this[idx >= 0 ? idx : idx + this.length]
			},
			toArray: function(){ return this.get() },
			size: function(){
				return this.length
			},
			remove: function(){
				return this.each(function(){
					if (this.parentNode != null)
						this.parentNode.removeChild(this)
				})
			},
			each: function(callback){
				emptyArray.every.call(this, function(el, idx){
					return callback.call(el, idx, el) !== false
				})
				return this
			},
			filter: function(selector){
				if (isFunction(selector)) return this.not(this.not(selector))
				return $(filter.call(this, function(element){
					return zepto.matches(element, selector)
				}))
			},
			add: function(selector,context){
				return $(uniq(this.concat($(selector,context))))
			},
			is: function(selector){
				return this.length > 0 && zepto.matches(this[0], selector)
			},
			not: function(selector){
				var nodes=[]
				if (isFunction(selector) && selector.call !== undefined)
					this.each(function(idx){
						if (!selector.call(this,idx)) nodes.push(this)
					})
				else {
					var excludes = typeof selector == 'string' ? this.filter(selector) :
						(likeArray(selector) && isFunction(selector.item)) ? slice.call(selector) : $(selector)
					this.forEach(function(el){
						if (excludes.indexOf(el) < 0) nodes.push(el)
					})
				}
				return $(nodes)
			},
			has: function(selector){
				return this.filter(function(){
					return isObject(selector) ?
						$.contains(this, selector) :
						$(this).find(selector).size()
				})
			},
			eq: function(idx){
				return idx === -1 ? this.slice(idx) : this.slice(idx, + idx + 1)
			},
			first: function(){
				var el = this[0]
				return el && !isObject(el) ? el : $(el)
			},
			last: function(){
				var el = this[this.length - 1]
				return el && !isObject(el) ? el : $(el)
			},
			find: function(selector){
				var result, $this = this
				if (!selector) result = $()
				else if (typeof selector == 'object')
					result = $(selector).filter(function(){
						var node = this
						return emptyArray.some.call($this, function(parent){
							return $.contains(parent, node)
						})
					})
				else if (this.length == 1) result = $(zepto.qsa(this[0], selector))
				else result = this.map(function(){ return zepto.qsa(this, selector) })
				return result
			},
			// find, including the root node(s)
			probe: function(selector){
				return this.filter(function(){return $(this).is(selector)})
				           .add(this.find(selector));
			},
			closest: function(selector, context){
				var nodes = [], collection = typeof selector == 'object' && $(selector)
				this.each(function(_, node){
					while (node && !(collection ? collection.indexOf(node) >= 0 : zepto.matches(node, selector)))
						node = node !== context && !isDocument(node) && node.parentNode
					if (node && nodes.indexOf(node) < 0) nodes.push(node)
				})
				return $(nodes)
			},
			// closest, but not this node.  'close' would be totally misunderstood...
			nearby: function(selector, context){
				return this.parent().closest(selector, context);
			},
			parents: function(selector){
				var ancestors = [], nodes = this
				while (nodes.length > 0)
					nodes = $.map(nodes, function(node){
						if ((node = node.parentNode) && !isDocument(node) && ancestors.indexOf(node) < 0) {
							ancestors.push(node)
							return node
						}
					})
				return filtered(ancestors, selector)
			},
			// parents, including this node
			lineage: function(selector){
				selector = (selector == undefined) ? '*' : selector;
				return this.filter(function(){return $(this).is(selector)})
				           .add(this.parents(selector));
			},
			parent: function(selector){
				return filtered(uniq(this.pluck('parentNode')), selector)
			},
			children: function(selector){
				return filtered(this.map(function(){ return children(this) }), selector)
			},
			contents: function() {
				return this.map(function() { return this.contentDocument || slice.call(this.childNodes) })
			},
			siblings: function(selector){
				return filtered(this.map(function(i, el){
					return filter.call(children(el.parentNode), function(child){ return child!==el })
				}), selector)
			},
			empty: function(){
				return this.each(function(){ this.innerHTML = '' })
			},
			// `pluck` is borrowed from Prototype.js
			pluck: function(property){
				return $.map(this, function(el){ return el[property] })
			},
			show: function(){
				return this.each(function(){
					this.style.display == "none" && (this.style.display = '')
					if (getComputedStyle(this, '').getPropertyValue("display") == "none")
						this.style.display = defaultDisplay(this.nodeName)
				})
			},
			replaceWith: function(newContent){
				return this.before(newContent).remove()
			},
			wrap: function(structure){
				var func = isFunction(structure)
				if (this[0] && !func)
					var dom   = $(structure).get(0),
						clone = dom.parentNode || this.length > 1

				return this.each(function(index){
					$(this).wrapAll(
						func ? structure.call(this, index) :
							clone ? dom.cloneNode(true) : dom
					)
				})
			},
			wrapAll: function(structure){
				if (this[0]) {
					$(this[0]).before(structure = $(structure))
					var children
					// drill down to the inmost element
					while ((children = structure.children()).length) structure = children.first()
					$(structure).append(this)
				}
				return this
			},
			wrapInner: function(structure){
				var func = isFunction(structure)
				return this.each(function(index){
					var self = $(this), contents = self.contents(),
						dom  = func ? structure.call(this, index) : structure
					contents.length ? contents.wrapAll(dom) : self.append(dom)
				})
			},
			unwrap: function(){
				this.parent().each(function(){
					$(this).replaceWith($(this).children())
				})
				return this
			},
			clone: function(){
				return this.map(function(){ return this.cloneNode(true) })
			},
			hide: function(){
				return this.css("display", "none")
			},
			toggle: function(setting){
				return this.each(function(){
					var el = $(this)
						;(setting === undefined ? el.css("display") == "none" : setting) ? el.show() : el.hide()
				})
			},
			prev: function(selector){ return $(this.pluck('previousElementSibling')).filter(selector || '*') },
			next: function(selector){ return $(this.pluck('nextElementSibling')).filter(selector || '*') },
			html: function(html){
				return 0 in arguments ?
					this.each(function(idx){
						var originHtml = this.innerHTML
						$(this).empty().append( funcArg(this, html, idx, originHtml) )
					}) :
					(0 in this ? this[0].innerHTML : null)
			},
			text: function(text){
				return 0 in arguments ?
					this.each(function(idx){
						var newText = funcArg(this, text, idx, this.textContent)
						this.textContent = newText == null ? '' : ''+newText
					}) :
					(0 in this ? this.pluck('textContent').join("") : null)
			},
			attr: function(name, value){
				var result
				return (typeof name == 'string' && !(1 in arguments)) ?
					(0 in this && this[0].nodeType == 1 && (result = this[0].getAttribute(name)) != null ? result : undefined) :
					this.each(function(idx){
						if (this.nodeType !== 1) return
						if (isObject(name)) for (key in name) setAttribute(this, key, name[key])
						else setAttribute(this, name, funcArg(this, value, idx, this.getAttribute(name)))
					})
			},
			removeAttr: function(name){
				return this.each(function(){ this.nodeType === 1 && name.split(' ').forEach(function(attribute){
					setAttribute(this, attribute)
				}, this)})
			},
			prop: function(name, value){
				name = propMap[name] || name
				return (1 in arguments) ?
					this.each(function(idx){
						this[name] = funcArg(this, value, idx, this[name])
					}) :
					(this[0] && this[0][name])
			},
			removeProp: function(name){
				name = propMap[name] || name
				return this.each(function(){ delete this[name] })
			},
			data: function(name, value){
				var attrName = 'data-' + name.replace(capitalRE, '-$1').toLowerCase()

				var data = (1 in arguments) ?
					this.attr(attrName, value) :
					this.attr(attrName)

				return data !== null ? deserializeValue(data) : undefined
			},
			val: function(value){
				if (0 in arguments) {
					if (value == null) value = ""
					return this.each(function(idx){
						this.value = funcArg(this, value, idx, this.value)
					})
				} else {
					return this[0] && (this[0].multiple ?
							$(this[0]).find('option').filter(function(){ return this.selected }).pluck('value') :
							this[0].value)
				}
			},
			offset: function(coordinates){
				if (coordinates) return this.each(function(index){
					var $this = $(this),
						coords = funcArg(this, coordinates, index, $this.offset()),
						parentOffset = $this.offsetParent().offset(),
						props = {
							top:  coords.top  - parentOffset.top,
							left: coords.left - parentOffset.left
						}

					if ($this.css('position') == 'static') props['position'] = 'relative'
					$this.css(props)
				})
				if (!this.length) return null
				if (document.documentElement !== this[0] && !$.contains(document.documentElement, this[0]))
					return {top: 0, left: 0}
				var obj = this[0].getBoundingClientRect()
				return {
					left: obj.left + window.pageXOffset,
					top: obj.top + window.pageYOffset,
					width: Math.round(obj.width),
					height: Math.round(obj.height)
				}
			},
			css: function(property, value){
				if (arguments.length < 2) {
					var element = this[0]
					if (!element) return
					if (typeof property == 'string') {
						return $.cssProp(element, property)
					} else if (isArray(property)) {
						var props = {}
						var computedStyle = getComputedStyle(element, '')
						$.each(property, function(_, prop){
							props[prop] = $.cssProp(element, prop, computedStyle)
						})
						return props
					}
				}

				var css = ''
				if (type(property) == 'string') {
					if (!value && value !== 0)
						this.each(function(){ this.style.removeProperty(dasherize(property)) })
					else
						css = dasherize(property) + ":" + maybeAddPx(property, value)
				} else {
					for (key in property)
						if (!property[key] && property[key] !== 0)
							this.each(function(){ this.style.removeProperty(dasherize(key)) })
						else
							css += dasherize(key) + ':' + maybeAddPx(key, property[key]) + ';'
				}

				return this.each(function(){ this.style.cssText += ';' + css })
			},
			index: function(element){
				return element ? this.indexOf($(element)[0]) : this.parent().children().indexOf(this[0])
			},
			hasClass: function(name){
				if (!name) return false
				return emptyArray.some.call(this, function(el){
					return this.test(className(el))
				}, classRE(name))
			},
			addClass: function(name){
				if (!name) return this
				return this.each(function(idx){
					if (!('className' in this)) return
					classList = []
					var cls = className(this), newName = funcArg(this, name, idx, cls)
					newName.split(/\s+/g).forEach(function(klass){
						if (!$(this).hasClass(klass)) classList.push(klass)
					}, this)
					classList.length && className(this, cls + (cls ? " " : "") + classList.join(" "))
				})
			},
			removeClass: function(name){
				return this.each(function(idx){
					if (!('className' in this)) return
					if (name === undefined) return className(this, '')
					classList = className(this)
					funcArg(this, name, idx, classList).split(/\s+/g).forEach(function(klass){
						classList = classList.replace(classRE(klass), " ")
					})
					className(this, classList.trim())
				})
			},
			toggleClass: function(name, when){
				if (!name) return this
				return this.each(function(idx){
					var $this = $(this), names = funcArg(this, name, idx, className(this))
					names.split(/\s+/g).forEach(function(klass){
						(when === undefined ? !$this.hasClass(klass) : when) ?
							$this.addClass(klass) : $this.removeClass(klass)
					})
				})
			},
			scrollTop: function(value){
				if (!this.length) return
				var hasScrollTop = 'scrollTop' in this[0]
				if (value === undefined) return hasScrollTop ? this[0].scrollTop : this[0].pageYOffset
				return this.each(hasScrollTop ?
					function(){ this.scrollTop = value } :
					function(){ this.scrollTo(this.scrollX, value) })
			},
			scrollLeft: function(value){
				if (!this.length) return
				var hasScrollLeft = 'scrollLeft' in this[0]
				if (value === undefined) return hasScrollLeft ? this[0].scrollLeft : this[0].pageXOffset
				return this.each(hasScrollLeft ?
					function(){ this.scrollLeft = value } :
					function(){ this.scrollTo(value, this.scrollY) })
			},
			position: function() {
				if (!this.length) return

				var elem = this[0],
					// Get *real* offsetParent
					offsetParent = this.offsetParent(),
					// Get correct offsets
					offset       = this.offset(),
					parentOffset = rootNodeRE.test(offsetParent[0].nodeName) ? { top: 0, left: 0 } : offsetParent.offset()

				// Subtract element margins
				// note: when an element has margin: auto the offsetLeft and marginLeft
				// are the same in Safari causing offset.left to incorrectly be 0
				offset.top  -= parseFloat( $(elem).css('margin-top') ) || 0
				offset.left -= parseFloat( $(elem).css('margin-left') ) || 0

				// Add offsetParent borders
				parentOffset.top  += parseFloat( $(offsetParent[0]).css('border-top-width') ) || 0
				parentOffset.left += parseFloat( $(offsetParent[0]).css('border-left-width') ) || 0

				// Subtract the two offsets
				return {
					top:  offset.top  - parentOffset.top,
					left: offset.left - parentOffset.left
				}
			},
			offsetParent: function() {
				return this.map(function(){
					var parent = this.offsetParent || document.body
					while (parent && !rootNodeRE.test(parent.nodeName) && $(parent).css("position") == "static")
						parent = parent.offsetParent
					return parent
				})
			}
		}

		// for now
		$.fn.detach = $.fn.remove

		// Generate the `width` and `height` functions
		;['width', 'height'].forEach(function(dimension){
			var dimensionProperty =
				dimension.replace(/./, function(m){ return m[0].toUpperCase() })

			$.fn[dimension] = function(value){
				var offset, el = this[0]
				if (value === undefined) return isWindow(el) ? el['inner' + dimensionProperty] :
					isDocument(el) ? el.documentElement['scroll' + dimensionProperty] :
					(offset = this.offset()) && offset[dimension]
				else return this.each(function(idx){
					el = $(this)
					el.css(dimension, funcArg(this, value, idx, el[dimension]()))
				})
			}
		})

		function traverseNode(node, fun) {
			fun(node)
			for (var i = 0, len = node.childNodes.length; i < len; i++)
				traverseNode(node.childNodes[i], fun)
		}

		// Generate the `after`, `prepend`, `before`, `append`,
		// `insertAfter`, `insertBefore`, `appendTo`, and `prependTo` methods.
		adjacencyOperators.forEach(function(operator, operatorIndex) {
			var inside = operatorIndex % 2 //=> prepend, append

			$.fn[operator] = function(){
				// arguments can be nodes, arrays of nodes, Zepto objects and HTML strings
				var argType, nodes = $.map(arguments, function(arg) {
						var arr = []
						argType = type(arg)
						if (argType == "array") {
							arg.forEach(function(el) {
								if (el.nodeType !== undefined) return arr.push(el)
								else if ($.zepto.isZ(el)) return (arr = arr.concat(el.get()))
								arr = arr.concat(zepto.fragment(el))
							})
							return arr
						}
						return argType == "object" || arg == null ?
							arg : zepto.fragment(arg)
					}),
					parent, copyByClone = this.length > 1
				if (nodes.length < 1) return this

				return this.each(function(_, target){
					parent = inside ? target : target.parentNode

					// convert all methods to a "before" operation
					target = operatorIndex == 0 ? target.nextSibling :
						operatorIndex == 1 ? target.firstChild :
							operatorIndex == 2 ? target :
								null

					var parentInDocument = $.contains(document.documentElement, parent)

					nodes.forEach(function(node){
						if (copyByClone) node = node.cloneNode(true)
						else if (!parent) return $(node).remove()

						parent.insertBefore(node, target)
						if (parentInDocument) traverseNode(node, function(el){
							if (el.nodeName != null && el.nodeName.toUpperCase() === 'SCRIPT' &&
								(!el.type || el.type === 'text/javascript') && !el.src){
								var target = el.ownerDocument ? el.ownerDocument.defaultView : window
								target['eval'].call(target, el.innerHTML)
							}
						})
					})
				})
			}

			// after    => insertAfter
			// prepend  => prependTo
			// before   => insertBefore
			// append   => appendTo
			$.fn[inside ? operator+'To' : 'insert'+(operatorIndex ? 'Before' : 'After')] = function(html){
				$(html)[operator](this)
				return this
			}
		})

		zepto.Z.prototype = Z.prototype = $.fn

		// Export internal API functions in the `$.zepto` namespace
		zepto.uniq = uniq
		zepto.uniques = uniques
		zepto.deserializeValue = deserializeValue
		$.zepto = zepto

		return $
	})()

	// If `$` is not yet defined, point it to `Zepto`
	window.Zepto = Zepto
	window.$ === undefined && (window.$ = Zepto)
	//     Zepto.js
	//     (c) 2010-2016 Thomas Fuchs
	//     Zepto.js may be freely distributed under the MIT license.

	;(function($){
		var _zid = 1, undefined,
			slice = Array.prototype.slice,
			isFunction = $.isFunction,
			isString = function(obj){ return typeof obj == 'string' },
			handlers = {},
			specialEvents={},
			focusinSupported = 'onfocusin' in window,
			focus = { focus: 'focusin', blur: 'focusout' },
			hover = { mouseenter: 'mouseover', mouseleave: 'mouseout' }

		specialEvents.click = specialEvents.mousedown = specialEvents.mouseup = specialEvents.mousemove = 'MouseEvents'

		function zid(element) {
			return element._zid || (element._zid = _zid++)
		}
		function findHandlers(element, event, fn, selector) {
			event = parse(event)
			if (event.ns) var matcher = matcherFor(event.ns)
			return (handlers[zid(element)] || []).filter(function(handler) {
				return handler
					&& (!event.e  || handler.e == event.e)
					&& (!event.ns || matcher.test(handler.ns))
					&& (!fn       || zid(handler.fn) === zid(fn))
					&& (!selector || handler.sel == selector)
			})
		}
		function parse(event) {
			var parts = ('' + event).split('.')
			return {e: parts[0], ns: parts.slice(1).sort().join(' ')}
		}
		function matcherFor(ns) {
			return new RegExp('(?:^| )' + ns.replace(' ', ' .* ?') + '(?: |$)')
		}

		function eventCapture(handler, captureSetting) {
			return handler.del &&
				(!focusinSupported && (handler.e in focus)) ||
				!!captureSetting
		}

		function realEvent(type) {
			return hover[type] || (focusinSupported && focus[type]) || type
		}

		function add(element, events, fn, data, selector, delegator, capture){
			var id = zid(element), set = (handlers[id] || (handlers[id] = []))
			events.split(/\s/).forEach(function(event){
				if (event == 'ready') return $(document).ready(fn)
				var handler   = parse(event)
				handler.fn    = fn
				handler.sel   = selector
				// emulate mouseenter, mouseleave
				if (handler.e in hover) fn = function(e){
					var related = e.relatedTarget
					if (!related || (related !== this && !$.contains(this, related)))
						return handler.fn.apply(this, arguments)
				}
				handler.del   = delegator
				var callback  = delegator || fn
				handler.proxy = function(e){
					e = compatible(e)
					if (e.isImmediatePropagationStopped && e.isImmediatePropagationStopped()) return
					e.data = data
					var result = callback.apply(element, e._args == undefined ? [e] : [e].concat(e._args))
					if (result === false) e.preventDefault(), e.stopPropagation()
					return result
				}
				handler.i = set.length
				set.push(handler)
				if ('addEventListener' in element)
					element.addEventListener(realEvent(handler.e), handler.proxy, eventCapture(handler, capture))
			})
		}
		function remove(element, events, fn, selector, capture){
			var id = zid(element)
				;(events || '').split(/\s/).forEach(function(event){
				findHandlers(element, event, fn, selector).forEach(function(handler){
					delete handlers[id][handler.i]
					if ('removeEventListener' in element)
						element.removeEventListener(realEvent(handler.e), handler.proxy, eventCapture(handler, capture))
				})
			})
		}

		$.event = { add: add, remove: remove }

		$.proxy = function(fn, context) {
			var args = (2 in arguments) && slice.call(arguments, 2)
			if (isFunction(fn)) {
				var proxyFn = function(){ return fn.apply(context, args ? args.concat(slice.call(arguments)) : arguments) }
				proxyFn._zid = zid(fn)
				return proxyFn
			} else if (isString(context)) {
				if (args) {
					args.unshift(fn[context], fn)
					return $.proxy.apply(null, args)
				} else {
					return $.proxy(fn[context], fn)
				}
			} else {
				throw new TypeError("expected function")
			}
		}

		$.fn.bind = function(event, data, callback){
			return this.on(event, data, callback)
		}
		$.fn.unbind = function(event, callback){
			return this.off(event, callback)
		}
		$.fn.one = function(event, selector, data, callback){
			return this.on(event, selector, data, callback, 1)
		}

		var returnTrue = function(){return true},
			returnFalse = function(){return false},
			ignoreProperties = /^([A-Z]|returnValue$|layer[XY]$|webkitMovement[XY]$)/,
			eventMethods = {
				preventDefault: 'isDefaultPrevented',
				stopImmediatePropagation: 'isImmediatePropagationStopped',
				stopPropagation: 'isPropagationStopped'
			}

		function compatible(event, source) {
			if (source || !event.isDefaultPrevented) {
				source || (source = event)

				$.each(eventMethods, function(name, predicate) {
					var sourceMethod = source[name]
					event[name] = function(){
						this[predicate] = returnTrue
						return sourceMethod && sourceMethod.apply(source, arguments)
					}
					event[predicate] = returnFalse
				})

				event.timeStamp || (event.timeStamp = Date.now())

				if (source.defaultPrevented !== undefined ? source.defaultPrevented :
						'returnValue' in source ? source.returnValue === false :
						source.getPreventDefault && source.getPreventDefault())
					event.isDefaultPrevented = returnTrue
			}
			return event
		}

		function createProxy(event) {
			var key, proxy = { originalEvent: event }
			for (key in event)
				if (!ignoreProperties.test(key) && event[key] !== undefined) proxy[key] = event[key]

			return compatible(proxy, event)
		}

		$.fn.delegate = function(selector, event, callback){
			return this.on(event, selector, callback)
		}
		$.fn.undelegate = function(selector, event, callback){
			return this.off(event, selector, callback)
		}

		$.fn.live = function(event, callback){
			$(document.body).delegate(this.selector, event, callback)
			return this
		}
		$.fn.die = function(event, callback){
			$(document.body).undelegate(this.selector, event, callback)
			return this
		}

		$.fn.on = function(event, selector, data, callback, one){
			var autoRemove, delegator, $this = this
			if (event && !isString(event)) {
				$.each(event, function(type, fn){
					$this.on(type, selector, data, fn, one)
				})
				return $this
			}

			if (!isString(selector) && !isFunction(callback) && callback !== false)
				callback = data, data = selector, selector = undefined
			if (callback === undefined || data === false)
				callback = data, data = undefined

			if (callback === false) callback = returnFalse

			return $this.each(function(_, element){
				if (one) autoRemove = function(e){
					remove(element, e.type, callback)
					return callback.apply(this, arguments)
				}

				if (selector) delegator = function(e){
					var evt, match = $(e.target).closest(selector, element).get(0)
					if (match && match !== element) {
						evt = $.extend(createProxy(e), {currentTarget: match, liveFired: element})
						return (autoRemove || callback).apply(match, [evt].concat(slice.call(arguments, 1)))
					}
				}

				add(element, event, callback, data, selector, delegator || autoRemove)
			})
		}
		$.fn.off = function(event, selector, callback){
			var $this = this
			if (event && !isString(event)) {
				$.each(event, function(type, fn){
					$this.off(type, selector, fn)
				})
				return $this
			}

			if (!isString(selector) && !isFunction(callback) && callback !== false)
				callback = selector, selector = undefined

			if (callback === false) callback = returnFalse

			return $this.each(function(){
				remove(this, event, callback, selector)
			})
		}

		$.fn.trigger = function(event, args){
			event = (isString(event) || $.isPlainObject(event)) ? $.Event(event) : compatible(event)
			event._args = args
			return this.each(function(){
				// handle focus(), blur() by calling them directly
				if (event.type in focus && typeof this[event.type] == "function") this[event.type]()
				// items in the collection might not be DOM elements
				else if ('dispatchEvent' in this) this.dispatchEvent(event)
				else $(this).triggerHandler(event, args)
			})
		}

		// triggers event handlers on current element just as if an event occurred,
		// doesn't trigger an actual event, doesn't bubble
		$.fn.triggerHandler = function(event, args){
			var e, result
			this.each(function(i, element){
				e = createProxy(isString(event) ? $.Event(event) : event)
				e._args = args
				e.target = element
				$.each(findHandlers(element, event.type || event), function(i, handler){
					result = handler.proxy(e)
					if (e.isImmediatePropagationStopped && e.isImmediatePropagationStopped()) return false
				})
			})
			return result
		}

		// shortcut methods for `.bind(event, fn)` for each event type
		;('focusin focusout focus blur load resize scroll unload click dblclick '+
		'mousedown mouseup mousemove mouseover mouseout mouseenter mouseleave '+
		'pointerdown pointerup pointermove pointerover pointerout pointerenter pointerleave '+
		'change select keydown keypress keyup error').split(' ').forEach(function(event) {
			$.fn[event] = function(callback) {
				return (0 in arguments) ?
					this.bind(event, callback) :
					this.trigger(event)
			}
		})

		$.Event = function(type, props) {
			if (!isString(type)) props = type, type = props.type
			var event = document.createEvent(specialEvents[type] || 'Events'), bubbles = true
			if (props) for (var name in props) (name == 'bubbles') ? (bubbles = !!props[name]) : (event[name] = props[name])
			event.initEvent(type, bubbles, true)
			return compatible(event)
		}

	})(Zepto)
	/* eslint-enable */

	var x = Zepto;

	(function() {
		var counters={};
		x.call_counter = function(funcname, args) {
			args = args || "";
			var id = funcname+"("+args+")";
			counters[id] = (counters[id]||0) + 1;
			if (counters[id]%50===0) {
				x.log("X Calls ["+counters[id]+": "+id);
			}
		}
	})();

		// Zepto extensions
	x.fn.innerText = function(nodeFilter_obj, joiner) {
		if (!(0 in this)) { return null; }
		joiner = (typeof joiner == 'string') ? joiner : ' ';
		return x.map(this, function(el) {
			var node, text = [];
			var whatToShow = nodeFilter_obj ? NodeFilter.SHOW_ALL : NodeFilter.SHOW_TEXT;
			var walker = document.createTreeWalker(el, whatToShow, nodeFilter_obj, false);
			while ((node = walker.nextNode())) {
				text.push(node.nodeValue);
			}
			return text.join(joiner);
		}).join(joiner).replace(/\n+/g, joiner);
	};
	// Get the text content of only this node, not child nodes
	x.fn.shallowText = function(joiner) {
		if (!(0 in this)) { return null; }
		joiner = (typeof joiner == 'string') ? joiner : ' ';
		return x.map(this, function(el) {
			if (!el.childNodes) { return ''; }
			var text = [], children=el.childNodes;
			for (var i=0; i<children.length; i++) {
				var child = children[i];
				if (3===child.nodeType) {
					text.push(child.nodeValue);
				}
			}
			return text.join(joiner);
		}).join(joiner).replace(/\n+/g, joiner);
	};
	// web-ext: x.fn is not a DOM node; this is creating a member function for class 'Z'
	x.fn.outerHTML = function() {
		if (!(0 in this)) { return null; }
		return x('<div>').append(this[0].cloneNode(true)).html();
	};
	x.fn.tagHTML = function() {
		return x('<div>').append(this[0].cloneNode(false)).html().replace(/>.*/,'>');
	};
	x.fn.select = function(copy) {
		if (!(0 in this)) { return null; }
		var el = this[0];
		if (window.getSelection && document.createRange) { //Browser compatibility
			var s = window.getSelection();
			setTimeout(function(){
				var r = document.createRange();
				r.selectNodeContents(el);
				s.removeAllRanges();
				s.addRange(r);
				if (copy) {
					x.clipboard.copy();
				}
			},1);
		}
	};
	// Is the last direct child of this element visible?  Call on direct parent of
	// a dynamically growing list of elements.
	x.fn.isScrolledToBottom = function() {
		const $last_line = this.find('* > :not(:empty):last-of-type');
		if (!$last_line.length) return false;
		const llr = $last_line[0].getBoundingClientRect();
		return $last_line[0].contains(document.elementFromPoint(llr.left, llr.top));
	};
	// Make the last direct child element of a list visible by scrolling to the bottom.
	x.fn.scrollToBottom = function() {
		const $last_line = this.find('* > :not(:empty):last-of-type');
		$last_line.length && $last_line[0].scrollIntoView(false);
	};
	// Append to a scrolling element, then scroll downwards if the element was
	// already scrolled to bottom.  This allows a dynamically scrolling status
	// window which cooperates when the user wants to scroll backwards.
	x.fn.scrollingAppend = function(...appends) {
		var scrollIt = this.isScrolledToBottom();
		this.append(...appends);
		if (scrollIt) this.scrollToBottom();
	};

	// Are we running in the page context or extension context?
	x.pagecontext = args.pagecontext || false;

	// Set an attribute on an Object using a possible deeply-nested path
	// Stole this from lodash _.set(object, path, value)
	// eslint-disable-next-line
	x.set=(function(){var h='[object Array]',g='[object Function]',p='[object String]';var k=/\.|\[(?:[^[\]]*|(["'])(?:(?!\1)[^\n\\]|\\.)*?\1)\]/,m=/^\w*$/,l=/[^.[\]]+|\[(?:(-?\d+(?:\.\d+)?)|(["'])((?:(?!\2)[^\n\\]|\\.)*?)\2)\]/g;var o=/\\(\\)?/g;var q=/^\d+$/;function n(b){return b==null?'':(b+'')}function f(b){return!!b&&typeof b=='object'}var j=Object.prototype;var b=j.toString;var d=9007199254740991;function r(b,c){b=(typeof b=='number'||q.test(b))?+b:-1;c=c==null?d:c;return b>-1&&b%1==0&&b<c}function t(b,d){var c=typeof b;if((c=='string'&&m.test(b))||c=='number'){return true}if(e(b)){return false}var f=!k.test(b);return f||(d!=null&&b in i(d))}function v(b){return typeof b=='number'&&b>-1&&b%1==0&&b<=d}function i(b){return c(b)?b:Object(b)}function s(b){if(e(b)){return b}var c=[];n(b).replace(l,function(d,b,f,e){c.push(f?e.replace(o,'$1'):(b||d))});return c}var e=function(c){return f(c)&&v(c.length)&&b.call(c)==h};function w(d){return c(d)&&b.call(d)==g}function c(c){var b=typeof c;return!!c&&(b=='object'||b=='function')}function x(c){return typeof c=='string'||(f(c)&&b.call(c)==p)}function u(e,d,k){if(e==null){return e}var i=(d+'');d=(e[i]!=null||t(d,e))?[i]:s(d);var f=-1,h=d.length,j=h-1,b=e;while(b!=null&&++f<h){var g=d[f];if(c(b)){if(f==j){b[g]=k}else if(b[g]==null){b[g]=r(d[f+1])?[]:{}}}b=b[g]}return e}return u})();

	// Test if a property is defined.
	x.def=function(o) {
		return typeof o!="undefined";
	};

	// Simple Pub/Sub
	x.pubsub_handlers = {};
	x.pubsub_messages = {}; // A list of all messages
	x.pubsub_persists = {};
	x.publish = function(event, data) {
		// if (typeof republish!="boolean") { republish=true; }
		data = data || {};
		(x.pubsub_handlers[event] || []).forEach(function(f) {
			try {
				f.call(x,event,data);
			} catch(e) {
				console.log(`X.publish: ${e} when calling:`,{f},`( '${event}',`, data, ')',
				            { stack: e.stack.split('\n') });
			}
		});
		// If we are running in the page context, send a message back to the extension code
		// if (republish) {
		//	// Clone data before posting, to make sure that object references are not passed
		//	try {
		//		// If the data has refs to React elements, circular refs will cause this to fail. Ignore it.
		//		window.postMessage( {"sfx":true, "pagecontext":x.pagecontext, "message": { "event":event, "data":x.clone(data) } } , "*");
		//	}
		//	catch(e) { }
		// }
		// Store messages in case a subscriber later wants the backlog.  When
		// 1st subscriber appears, backlog will be discarded if they don't want
		// it; or delivered and retained if they do, as additional subscribers
		// are expected to have the same backlog preference.
		if (!(event in x.pubsub_persists) || x.pubsub_persists[event]) {
			x.pubsub_messages[event] || (x.pubsub_messages[event] = []);
			x.pubsub_messages[event].push({event, data});
		}
	};
	x.pubsub_clear_backlog = function(event) {
		delete x.pubsub_messages[event];
	};
	// TODO: Wildcard subscriptions?
	x.subscribe_internal = function(event, func, receive_past_messages) {
		var events = (typeof event=="string") ? [event] : event;
		events.forEach(function(ev) {
			if (typeof x.pubsub_handlers[ev]=="undefined") {
				x.pubsub_handlers[ev]=[];
			}
			x.pubsub_handlers[ev].push(func);
			if (!(ev in x.pubsub_persists)) {
				x.pubsub_persists[ev] = receive_past_messages;
				if (!receive_past_messages) {
					x.pubsub_clear_backlog(ev);
				}
			} else if (x.pubsub_persists[ev] != receive_past_messages) {
				console.log(`X.subscribe: subscribers to '${ev}' disagree about persistence!`);
			}
			// If past messages are requested, fire this function for each of the past messages
			if (receive_past_messages) {
				(x.pubsub_messages[ev] || []).forEach(function(msg) {
					func.call(x,msg.event,msg.data);
				});
			}
		});
	};
	x.subscribe = function(event, func) {
		x.subscribe_internal(event, func, false);
	};
	x.subscribe_backlog = function(event, func) {
		x.subscribe_internal(event, func, true);
	};
	x.unsubscribe = function(func) {
		Object.values(x.pubsub_handlers).forEach(handlers =>
			handlers.forEach((handler, idx) =>
				handler == func && delete handlers[idx]))
	};
	x.subscribe_once = function(event, func) {
		x.unsubscribe(func);
		x.subscribe(event, func);
	};
	// Allow for passing of messages between extension and page contexts, using window.postMessage
	window.addEventListener('message', function(event) {
		if (event.data.sfx && event.data.pagecontext != x.pagecontext &&
		    (event.source == window || event.source == window.unsafeWindow) &&
		    event.origin == location.origin) {
			// A message has been received from the other context
			x.publish(event.data.message.event, event.data.message.data, false);
		}
	});

	// A Generalized storage/persistence mechanism
	var ls = window.localStorage;
	x.storage = {
		"prefix":null,
		"data":{}, // keys are options, stats, etc
		"set":function(key,prop,val,callback,save) {
			// update stored value in memory
			if (typeof x.storage.data[key]=="undefined") {
				x.storage.data[key] = {};
			}
			var container = x.storage.data[key];
			// Single value set
			if (typeof prop!="object" && (typeof callback=="undefined"||typeof callback=="function"||callback==null)) {
				x.storage.set_or_delete(container,prop,val);
			}
			// Multiset
			else if (typeof prop=="object" && (typeof val=="undefined"||typeof val=="function")) {
				save=callback;
				callback = val;
				var prop2;
				for (prop2 in prop) {
					x.storage.set_or_delete(container,prop2,prop[prop2]);
				}
			}
			else {
			}
			if (false!==save) {
				x.storage.save(key, null, callback);
			}
			else if (typeof callback=="function") {
				callback(key,null);
			}
		},
		"set_or_delete":function(container,prop,val) {
			// Delete a value by setting it to undefined
			if (prop in container && typeof val=="undefined") {
				delete container[prop];
			}
			else {
				x.set(container, prop, val);
			}
		},
		"save":function(key,val,callback) {
			if (val==null && typeof x.storage.data[key]!="undefined") {
				val = x.storage.data[key];
			}
			else {
				x.storage.data[key] = val;
			}
			// persist
			Extension.storage.set(key, val, function (key, val, ret) {
				// post to localstorage to trigger updates in other windows
				var o = {"time": x.now(), "key": key};
				ls.setItem('x-storage', JSON.stringify(o));
				// Call the callback
				if (typeof callback == "function") {
					callback(key, val, ret);
				}
			}, (x.storage.prefix != null ? x.storage.prefix + '/' : ''));
		},
		"get":function(keys, defaultValue, callback, use_cache) {
			if (!!use_cache && typeof keys=="string" && typeof x.storage.data[keys]!="undefined") {
				if (typeof callback=="function") { return callback(x.storage.data[keys]); }
			}
			// TODO: Get multi values from cache!
			Extension.storage.get(keys, defaultValue, function(values,err) {
				var key, i;
				if (!err) {
					// Store the data in memory
					if (typeof keys == "string") {
						// Single value
						if (typeof x.storage.data[keys] == "undefined") {
							x.storage.update(keys, values);
						}
					} else {
						// Multi value
						for (i = 0; i < keys.length; i++) {
							key = keys[i];
							x.storage.update(key, values[key]);
						}
					}
				}
				if (typeof callback=="function") {
					callback(values,err);
				}
			}, (x.storage.prefix!=null?x.storage.prefix+'/':'') );
		},
		"refresh":function(key,callback) {
			if (typeof x.storage.data[key]!="undefined") {
				x.storage.get(key, null, callback, false);
			}
		}
		,"update":function(key,value) {
			x.storage.data[key] = value;
		}
	};
	// Use localStorage to communicate storage changes between windows and tabs.
	// Changes to localStorage trigger the 'storage' event in other windows on the same site.
	if (!x.pagecontext) {
		window.addEventListener('storage', function (e) {
			if ("x-storage"==e.key && e.newValue) {
				var json;
				try {
					json = JSON.parse(e.newValue); // {"time":123,"key":"key_name"}
					if (json.key) {
						x.storage.refresh(json.key, function(data) {
							// Publish a message
							x.publish("storage/refresh", {"key":json.key,"data":data});
						});
					}
				} catch(err) {
					console.log('storage event',e,'error',err,'json',json);
				}
			}
		},true);
	}

	// Sanitize HTML using the DOMPurify library, if available
	x.sanitize = function(html) {
		return (typeof DOMPurify!="undefined" ? DOMPurify.sanitize(html) : html);
	};
	x.fn.safe_html = function(html) {
		html = x.sanitize(html);
		return this.each(function(){ x(this).html(html); });
	};


	// http/ajax
	x.ajax = function(urlOrObject,callback) {
		// TODO: Allow for ajax from pagecontext
		Extension.ajax(urlOrObject,function(content,status,headers) {
			if (headers && /application\/json/.test(headers['content-type'])) {
				content = JSON.parse(content);
			}
			callback(content,status);
		});
	};

	x.ajax_dom = function(urlOrObject, callback) {
		x.ajax(urlOrObject, function(data) {
			var $dom = x('<div>');
			try {
				$dom.append(data);
			}
			catch(e) {}
			callback($dom);
		});
	};

	// css
	x.css = function(css,id) {
		x.when('head',function($head) {
			css = x.zepto.mogrify(css);
			var s;
			if (id) {
				s = document.getElementById(id);
				if (s) {
					if (css) {
						s.textContent = css;
					} else {
						x(s).remove();
					}
					return;
				}
			}
			s = document.createElement('style');
			s.textContent = css;
			if (id) {
				s.id=id;
			}
			$head.append(s);
		});
	};

	// function execution in a <script> block (in page context)
	x.inject = function(code,args,windowVar) {
		if (!document || !document.createElement || !document.documentElement || !document.documentElement.appendChild) { return false; }
		var s = document.createElement('script');
		s.type = 'text/javascript';
		args = JSON.stringify(args||{});
		var result = windowVar?'window.'+windowVar+'=':'';
		code = result+'('+code.toString()+')('+args+');';
		if (windowVar) {
			// Post a window notification saying this variable is now defined
			code += 'window.postMessage({"sfxready":"'+windowVar+'"} , "*");';
		}
		s.text = code;
		document.documentElement.appendChild(s);
		s.parentNode.removeChild(s);
		return true;
	};

	// POLLING
	// Call a function repeatedly until it doesn't throw an exception or returns non-false
	x.poll = function(func,interval,max){
		x.call_counter("poll",func.toString().substring(10));
		interval=interval||500;
		max=max||50;
		var count=0;
		var f=function(){
			if(count++>max){return;}
			try{
				if (func(count)===false){
					setTimeout(f,interval);
				}
			}
			catch(e){
				setTimeout(f,interval);
			}
		};
		f();
	};
	// A function that executes a function only when a selector returns a result
	x.when = function(selector, func, interval, max) {
		// Keep default from previous implementation, but now allow for limits
		interval = interval || 200;
		max = max || 999999999;
		x.poll(function() {
			x.call_counter("when", selector);
			var $results = x(selector);
			if ($results.length > 0) {
				func($results);
			} else {
				return false;
			}
		},interval,max);
	};

	// Cookies
	x.cookie = {
		'get':function(n) {
			try {
				return unescape(document.cookie.match('(^|;)?'+n+'=([^;]*)(;|$)')[2]);
			} catch(e) {
				return null;
			}
		},
		'set':function() {}
	};

	// Logging
	x.logs = [];
	x.log = function(){
		if (arguments && arguments.length>0) {
			// Default meta-data
			var data = {"module":null, "color":"black"};
			var i=0;
			var info = arguments[0];
			var args = [];
			if (typeof info=="object" && info!=null && (info.module||info.color)) {
				// Meta-data about the logging
				i=1;
				data.module = info.module || data.module;
				data.level = info.level || data.level;
				data.color = info.color || data.color;
			}
			for (; i < arguments.length; i++) {
				if (typeof arguments[i] == "object") {
					args.push(JSON.stringify(arguments[i], null, 3));
				}
				else if (typeof arguments[i]!="undefined") {
					args.push(arguments[i]);
				}
			}
			data.log = args;
			data.timestamp = (new Date()).getTime();
			data.uptime = performance.now();
			x.logs.push(data);
			x.publish("log/entry",data,false,false);
		}
	};
	// Get a module-specific logger for use in modules
	x.logger = function(label,props) {
		var info = props || {};
		info.module = label;
		return function(a,b,c,d,e,f,g) {
			x.log.call(x,info,a,b,c,d,e,f,g);
		}
	};
	x.alert = function(msg) {
		if (typeof msg=="object") { msg=JSON.stringify(msg,null,3); }
		alert(msg);
	};

	// A "bind" function to support event capture mode
	x.bind = function(el, ev, func, capture) {
		if (typeof capture != "boolean") {
			capture = false;
		}
		el = x(el)[0];
		if (el && el.addEventListener) {
			el.addEventListener(ev, func, capture);
		}
		return el;
	};
	x.capture = function(el,ev,func) {
		return x.bind(el,ev,func,true);
	};
	x.unbind = function(el, ev, func, capture) {
		if (typeof capture != "boolean") {
			capture = false;
		}
		el = x(el)[0];
		if (el && el.removeEventListener) {
			el.removeEventListener(ev, func, capture);
		}
		return null;
	};
	x.uncapture = function(el,ev,func) {
		return x.unbind(el, ev, func, true);
	};

	// A backwards-compatible replacement for the old QSA() function
	x.QSA = function(context,selector,func) {
		if (typeof selector=="function") {
			func=selector;
			selector=context;
			context=document;
		}
		x(selector,context).each(function() {
			func(this);
		});
	};

	// A util method to find a single element matching a selector
	x.find = function(selector) {
		var o = x(selector);
		return (o.length>0) ? o[0] : null;
	};

	// Find the real target of an event
	x.target = function(e,wrap){ var t=e.target; if (t.nodeType == 3){t=t.parentNode;} return wrap?x(t):t; };
	x.parent = function(el){ if(el&&el.parentNode) { return el.parentNode; } return null; };

	// A util method to clone a simple object
	x.clone = function(o) { if (!o) { return o; } return JSON.parse(JSON.stringify(o)); };

	// Some useful string methods
	x.match = function (str, regex, func) {
		if (typeof str != "string") {
			return null;
		}
		var m = str.match(regex);
		if (m && m.length) {
			if (typeof func == "function") {
				for (var i = regex.global ? 0 : 1; i < m.length; i++) {
					func(m[i]);
				}
				return m;
			} else {
				return m.length > 1 ? m[regex.global ? 0 : 1] : null;
			}
		}
		return null;
	};
	// Convert string to form suitable for display as HTML, without HTML semantic meaning
	x.htmlEncode = function(html) {
		const parent = document.createElement('span');
		parent.appendChild(document.createTextNode(html));
		return parent.innerHTML;
	};

	// Get a timestamp
	x.time = function() { return Date.now(); };
	x.now = x.time;
	x.today = function() {
		var d = new Date();
		return d.getFullYear()*10000 + (d.getMonth()+1)*100 + d.getDate();
	};
	// Express a timestamp as a relative time "ago"
	x.ago = function(when, now, shortened, higher_resolution) {
		now = now || x.now();
		if (typeof shortened!="boolean") { shortened=true; }
		var diff = "";
		var delta = (now - when);
		var seconds = delta / x.seconds;
		if (seconds < 60) {
			return "just now";
		}
		var days = Math.floor(delta / x.days);
		if (days > 0) {
			diff += days+" day"+(days>1?"s":"")+" ";
			delta -= (days*x.days);
		}

		var hours = Math.floor(delta / x.hours );
		if (hours>0 && (higher_resolution || !diff)) {
			diff += hours + " " + (shortened ? "hr" : "hours")+" ";
			delta -= (hours*x.hours);
		}

		var minutes = Math.floor(delta / x.minutes);
		if (minutes>0 && (!diff || (higher_resolution && days<1))) {
			diff += minutes + " " + (shortened ? "mins" : "minutes") + " ";
		}
		if (!diff) {
			diff = "a while ";
		}
		return diff+"ago";
	};

	// Recurring tasks execute only at certain intervals
	x.seconds = 1000;
	x.minutes = x.seconds * 60;
	x.hours = x.minutes * 60;
	x.days = x.hours * 24;
	x.task = function(key, frequency, callback, elsecallback) {
		// Internally store the state of each task in a user pref
		x.storage.get('tasks',{},function(tasks) {
			if (typeof tasks[key]=="undefined") {
				tasks[key] = {"run_on": null};
			}
			var t = tasks[key];
			var now = x.now();
			// If we are past due, update the task and execute the callback
			if (!t.run_on || ((t.run_on+frequency) < now)) {
				t.run_on = now;
				x.storage.set('tasks',key, t, function() {
					callback();
				});
			}
			else if (typeof elsecallback=="function") {
				elsecallback(t.run_on);
			}
		},true);
	};

	// Semver Compare
	x.semver_compare = function (a, b) {
		var pa = a.split('.');
		var pb = b.split('.');
		for (var i = 0; i < 3; i++) {
			var na = Number(pa[i]);
			var nb = Number(pb[i]);
			if (na > nb) return 1;
			if (nb > na) return -1;
			if (!isNaN(na) && isNaN(nb)) return 1;
			if (isNaN(na) && !isNaN(nb)) return -1;
		}
		return 0;
	};

	// UI methods to simulate user actions
	x.ui = {
		"click": function(selector,bubble) {
			if (typeof bubble != "boolean") {
				bubble = true;
			}
			x(selector).each(function() {
				var e = document.createEvent('MouseEvents');
				e.initEvent('click', bubble, true, window, 0);
				this.dispatchEvent(e);
			});
		},
		"keypress": function(selector,code,type) {
			type = type || "keypress";
			x(selector).each(function() {
				var e = document.createEvent('KeyboardEvent');
				if (typeof code == "string") {
					code = code.charCodeAt(0);
				}
				if (e.initKeyboardEvent) {
					e.initKeyboardEvent(type, true, true, window, code, null, null);
				}
				else if (e.initKeyEvent) {
					e.initKeyEvent(type, true, true, window, false, false, false, false, false, code);
				}
				this.dispatchEvent(e);
			});
		},
		"scroll":function(pixels,el) {
			var $el = x(el || window);
			var scrollTop = $el.scrollTop();
			if (typeof scrollTop=="number") {
				$el.scrollTop(scrollTop+pixels);
			}
		},
		"pointerover":function(el) {
			el.dispatchEvent(new PointerEvent('pointerover', {bubbles: true}));
		},
		"pointerout":function(el) {
			el.dispatchEvent(new PointerEvent('pointerout', {bubbles: true}));
		},

	};

	// Draggable Objects
	x.draggable = function(el,dragend) {
		var $el = x(el);
		el = $el[0];
		$el.attr('draggable',true);
		var $undraggables = $el.find('*[draggable="false"]');
		if ($undraggables.length>0) {
			$undraggables.css({'cursor': 'auto'}).mouseenter(function() {$el.attr('draggable',false);}).mouseleave(function(e) {$el.attr('draggable',true);});
		}
		x.capture($el,'dragstart',function(ev) {
			x.draggable.dragend = dragend;
			ev.dataTransfer.setData("text/plain",(el.offsetLeft - ev.clientX) + ',' + (el.offsetTop - ev.clientY));
			x.draggable.target = $el;
		});
	};
	x.draggable.target = null;
	x.draggable.dragend = null;
	x.draggable.handlers = {
		dragover: function(ev) {
			if (x.draggable.target) {
				ev.preventDefault();
				return false;
			}
		},
		drop: function(ev) {
			if (x.draggable.target) {
				const offset = ev.dataTransfer.getData('text/plain').split(',').map(str => parseInt(str ))
				const $el = x.draggable.target;
				x.draggable.target = null;
				if (!isNaN(offset[0]) && !isNaN(offset[1])) {
					ev.preventDefault();
					let style = getComputedStyle($el[0]);
					let left = Math.max(0, ev.clientX + offset[0]) - parseFloat(style.marginLeft);
					let top  = Math.max(0, ev.clientY + offset[1]) - parseFloat(style.marginTop);
					$el.css('inset', `${top}px auto auto ${left}px`);
					if (typeof x.draggable.dragend === 'function') {
						x.draggable.dragend($el,left,top);
					}
					return false;
				}
			}
		},
		dragend: () => (x.draggable.target = null),
	};
	Object.keys(x.draggable.handlers).forEach(ev => x.capture(window,ev,x.draggable.handlers[ev]));

	// Observe DOM Changes
	x.on_attribute_change = function(el,attr,callback) {
		(new MutationObserver(function(mutations) {
			mutations.forEach(function(mutation) {
				if (!attr || (mutation.attributeName==attr && el.getAttribute(attr)!=mutation.oldValue)) {
					callback(mutation.attributeName, mutation.oldValue, mutation.target[mutation.attributeName]);
				}
			});
		})).observe(el, {attributes: true, attributeOldValue: true});
	};
	x.on_childlist_change = function(el,callback) {
		(new MutationObserver(function(records) {
			for (var i=0; i<records.length; i++) {
				var r = records[i];
				if (r.type!=="childList" || !r.addedNodes || !r.addedNodes.length) { continue; }
				var added = r.addedNodes;
				for (var j=0; j<added.length; j++) {
					callback(added[j]);
				}
			}
		})).observe(el, { childList: true, subtree: true });
	};

	x.return_false = function(){return false;};

	x.is_document_ready = function() {
		if(document && document.readyState) { return (document.readyState=="interactive"||document.readyState=="complete"); }
		return (document && document.getElementsByTagName && document.getElementsByTagName('BODY').length>0);
	};

	// Notes to be emitted in any sort of Support report
	x.support_note = function(who, what) {
		if (typeof x.support_notes == "undefined") {
			x.support_notes = {};
		}
		if (what) {
		    x.support_notes[who] = { who, what, when: x.now() };
		} else {
		    delete x.support_notes[who];
		}
	};

	// X.getNodeVisibleText() and its utilities
	x.cram = str => /^\s+$/.test(str) ? ' ' : str.replace(/[\n\r\s]+/g, ' ');
	x.trim_cram = str => x.cram(str).trim();

	x.getContentValue = function(node,style) {
		if (!style || !style.content || style.content==='none') return '';
		var content = style.content || '';
		content=content.replace(/\s*attr\(([^)]+)\)\s*/g, function(x,m) {
			var a = node.getAttribute(m);
			return a ? '"' + a + '"' : '';
		});
		// Unquote quoted strings
		content = content.replace(/"(.*?[^\\])"/g,'$1');
		content = content.replace(/\\"/g,'"');
		content = content.replace(/^"(.*)"$/,'$1');
		if (!/inline/.test(style.display)) content = ' ' + content + ' ';
		return content;
	};

	x.getChildrenVisibleText = function(node, direction, display, flexDirection) {
		if (!node.childNodes || !node.childNodes.length) return '';
		const flex = /flex/.test(display);
		const grid = /grid/.test(display);
		const flexgrid = flex || grid;
		const row  = flexgrid && /row/.test(flexDirection);
		const col  = flexgrid && /column/.test(flexDirection);
		const rev  = (row || col) && /reverse/.test(flexDirection);
		const rtl  = !col && /rtl/.test(direction);
		const otherway = (!flexgrid && rtl) || (flex && row && (rev != rtl)) || (flex && col && rev);

		var val = [];
		node.childNodes.forEach(child => {
			const order = !flexgrid || ((child.nodeType == node.TEXT_NODE) ? -0.5 : getComputedStyle(child).order);
			val.push([order, x.getNodeVisibleText(child)]);
		});
		flexgrid && (val = val.sort((a,b) => a[0] - b[0]));
		otherway && (val = val.reverse());
		return val.map(a => a[1]).join('');
	};

	x.getNodeVisibleText = function(node, seen = []) {
		if (!node || (node.nodeType !== node.ELEMENT_NODE && node.nodeType !== node.TEXT_NODE)) {
			return '';
		}
		if (node.nodeType === node.TEXT_NODE) {
			return X.cram(node.nodeValue)
		}
		if (node.nodeName == 'use') {
			// Recursively call getNodeVisibleText(), protecting against infinite
			// loop.  Old comment said 'Revisit if FB Dept. Of Evil decide to
			// send us there', and sure enough, they came through -- goooo FBDOE!
			const use_target = document.querySelector(node.getAttribute('xlink:href'));
			return (seen.includes(use_target)
			        ? ''
			        : x.getNodeVisibleText(use_target, [...seen, use_target]));
		}
		// Make sure it's not hidden
		var tmp;
		const style = getComputedStyle(node);
		const tween = ((prop, min, max) =>
			style[prop] !== 'auto' && (tmp = parseFloat(style[prop])) > min && tmp < max);
		if (   'none' === style.display
		    || 'fixed' === style.position
		    || 'hidden' === style.visibility
		    || 'absolute' === style.position
		 // || !tween('left', -1000, 1500)
		 // || !tween('marginLeft', -1000, 1500)
		 // || !tween('right', -1500, 1000)
		    || tween('width', -Infinity, 2)
		    || tween('height', -Infinity, 2)
		    || tween('opacity', -Infinity, 0.1)
		    || tween('fontSize', -Infinity, 3.5)
		    || (style.lineHeight !== 'normal' && tween('lineHeight', -Infinity, 2))
		) {
			return '';
		}

		var val = '';

		// Get the :before content, if any
		val += x.getContentValue(node, getComputedStyle(node,"::before"));

		// Process child nodes, including text
		val += x.getChildrenVisibleText(node, style.direction, style.display, style.flexDirection);

		// Get the :after content, if any
		val += x.getContentValue(node, getComputedStyle(node,"::after"));

		// Add separation for block content
		if (!/inline/.test(style.display)) val = ' ' + val + ' ';

		return X.trim_cram(val)
	};

	x.clipboard = {
		// Copies whatever is passed or selected on screen
		copy: function(txt) {
			try {
				if (!txt) {
					txt = window.getSelection().toString();
				}
				if (!txt) {
					return;
				}
				if (navigator && navigator.clipboard) {
					return navigator.clipboard.writeText(txt);
				} else if (document.execCommand) {
					document.execCommand("copy");
				}
			} catch(e) {
				x.log("Could not copy text: "+e.toString());
			}
		}
	};

	// A "Ready" queue of functions to run once the event is triggered
	x.ready = (function() {
		const log = x.logger('X.ready');
		var queue=[];
		var ready=false;
		var fire = function(o) {
			try {
				log(`start: '${o.label}'`);
				o.func();
			} catch(e) {
				log(`ERROR: '${o.label}:'\n'${e}'`);
			}
		};
		return function(label,func) {
			if (typeof label === 'undefined') {
				// No arg passed, fire the queue
				ready = true;
				log(`firing ${queue.length} queued modules`);
				queue.forEach(fire);
				log(`${queue.length} modules started`);
				delete queue;
				return;
			}
			if (typeof label === 'function') {
				func = label;
				label = '[nameless]';
			}
			if (typeof func === 'function') {
				const o = { label, func, };
				ready ? fire(o) : queue.push(o);
			}
		};
	})();

	// beforeReady() allows modules to halt execution or do things before normal execution
	x.beforeReady = (function() {
		var i,queue=[];
		return function(f) {
			if (typeof f!="function") {
				// fire the queue
				for (i=0; i<queue.length; i++) {
					if (queue[i](f)===false) {
						return false;
					}
				}
			}
			else {
				queue.push( f );
			}
		};
	})();

	// A text-based query that can run methods, not just selectors
	x.query = function(q,run_funcs_for_each_element) {
		run_funcs_for_each_element = run_funcs_for_each_element || true;
		var i,j ;
		// If this query doesn't need special processings, just run it as a CSS selector
		//if (typeof q!="string" || !/\|/.test(q)) { return x(q); }
		var parts = q.split("|");
		var n = parts.length;
		var $els = x(parts[0]);
		var $collections = [];
		for (i=0; i<$els.length; i++) {
			$collections.push(x($els[i]));
		}
		var args=[];
		var part = null;
		for (i=1; i<n; i++) {
			args = [];
			part = parts[i];
			// Parse out function arguments
			part = part.replace(/\((.*?)\)/, function(m,m1) {
				args = (m1||'').split(/,/);
				return '';
			});
			if (typeof x.fn[part]!="function") { throw "Invalid X function: "+part; }
			if (run_funcs_for_each_element) {
				for (j=0; j<$collections.length; j++) {
					var $el = $collections[j];
					$collections[j] = x($el)[part].apply($el,args);
				}
			}
			else {
				$els = $els[part].apply($els, args);
			}
		}
		if (run_funcs_for_each_element) {
			return $collections;
		}
		return $els;
	};

	// Synchronously sleep for the specified number of seconds (fractions OK).
	// Usage: await X.sleep(3.5); -- waits 3.5s.
	// Caller function must be declared 'async'.
	x.sleep = async function(seconds) {
		await new Promise(resolve => setTimeout(resolve, seconds * x.seconds));
	};

	return x;
};
var X = XLib();
