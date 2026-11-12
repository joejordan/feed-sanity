/*
 * This is a small library specific to Facebook functionality / extensions
 */
var FX = (function() {
    var css_queue = [];
    var on_page_load_queue = [];
    var on_page_unload_queue = [];
    var on_content_loaded_queue = [];
    var on_options_load_queue = [];
    var html_class_names = [];

    var fire_queue = function (arr, reset, arg) {
        if (!arr || !arr.length) {
            return;
        }
        arr.forEach(function (func) {
            try {
                func(arg);
            } catch(e) {
                console.log(e);
                console.log(e.toString());
                console.log(e.stack);
            }
        });
        if (reset) {
            arr.length = 0;
        }
    };

    // Monitor for hash change to detect when navigation has happened
    // TODO: Even for popups like photo viewer?!
    var page_transitioning = false;
    var page_transition = function() {
        if (page_transitioning) { return; } // Already initiated
        page_transitioning = true;
        // Fire the unload queue
        fire_queue(on_page_unload_queue);
        page_transitioning = false;
        fire_queue(on_page_load_queue);
    };
    // Monkey patch the pushState/replaceState calls in the main window to capture the event.
    // This will tell us if navigation happened that wasn't a full page reload
    // Detect changes through window.addEventListener(pushState|replaceState)
    var watch_history = function() {
        var _wr = function (type) {
            var orig = history[type];
            return function (state,title,url) {
                var url_change = (url && url!=location.href && !/theater/.test(url));
                var rv = orig.apply(this, arguments);
                if (url_change) {
                    var e = new Event(type);
                    e.arguments = arguments;
                    window.dispatchEvent(e);
                }
                return rv;
            };
        };
        window.history.pushState = _wr('pushState');
        window.history.replaceState = _wr('replaceState');
    };
    X.inject(watch_history);
    // Now listen for the state change events
    window.addEventListener("pushState",page_transition,false);
    window.addEventListener("replaceState",page_transition,false);

    // Facebook uses the HTML5 window.history.pushState() method to change url's in newer browsers.
    // Older browsers will use the hashchange approach
    window.addEventListener('hashchange',page_transition,false);
    window.addEventListener('popstate',page_transition,false);

    // Public API
    var fx = {};
    fx.css = function(css_text) {
        css_queue.push(css_text);
    };
    fx.css_dump = function() {
        if (css_queue.length==0) { return; }
        var css = css_queue.join('');
        X.css(css,'sfx_css');
    };

    // OPTIONS
    // -------
    // options : A hash of ALL available options, as defined by modules, along with default values
    fx.options = {};
    // is_options_loaded : Once options is loaded, this flag flips
    fx.is_options_loaded = false;
    fx.add_option = function(key,o) {
        o = o || {};
        o.key = key;
        o.type = o.type || 'checkbox';
        if (typeof o['default']=="undefined" && o.type=="checkbox") {
            o['default'] = false;
        }
        this.options[key] = o;
        if (typeof o.live == 'function') {
            fx.on_option_live(key, o.live);
        }
    };
    fx.option_default = function(key) {
        // If it's defined as an option, return the default value
        var opt = fx.options[key];
        if (typeof opt != 'undefined' && typeof opt['default'] != 'undefined') {
            return opt['default'];
        }
        // Default return null
        return null;
    };
    fx.option = function(key,value,save,callback) {
        // The defined option
        if (typeof value!="undefined") {
            // SET the value
            X.storage.set('options',key,value,function() {
                fx.fire_option_update(key,value);
                if (typeof callback=="function") {
                    callback();
                }
            },save);
            return value;
        }
        // GET the value
        // If it's defined in the storage layer, get that
        if (typeof X.storage.data.options!="undefined" && typeof X.storage.data.options[key]!="undefined") {
            return X.storage.data.options[key];
        }
        // Else if it's defined as an option, return the default value
        return fx.option_default(key);
    };
    // Attach event listeners to controls in the DOM to change Options
    fx.attach_options = function($dom) {
        $dom=X($dom);
        $dom.probe('*[sfx-option]').each(function(i,input) {
            var $input = X(input);
            if ($input.attr('sfx-option-attached')) { return; }
            var type = input.type;
            var option_key = $input.attr('sfx-option');
            if (!option_key || !fx.options[option_key]) { return; }
            var val = fx.option(option_key);
            $input.attr('sfx-option-attached','true');
            if (type=="checkbox") {
                // Checked by default?
                if (val) {
                    input.checked = true;
                }
                $input.click(function() {
                    val = !val;
                    fx.option(option_key,val);
                });
            }
            else if (type=="number") {
                if (val) {
                    input.value = val;
                }
                $input.change(function() {
                    fx.option(option_key,input.value);
                });
            }
            else {
                alert("FX.attach_options - Unhandled input type "+type);
            }
        });
    };
    fx.save_options = function(callback) {
        X.storage.save('options',null,callback);
    };
    fx.options_loaded = function(options) {
        fire_queue(on_options_load_queue,false,options);
        fx.css_dump();
        fx.html_class_dump();
        fx.is_options_loaded=true;
    };
    fx.on_options_load = function(func) {
        // If options are already loaded, just fire the func
        if (fx.is_options_loaded) {
            func();
        }
        else {
            on_options_load_queue.push(func);
        }
    };
    fx.on_option = function(option_name, value, func) {
        if (typeof value=="function") {
            func = value;
            value = true;
        }
        fx.on_options_load(function() {
            if (fx.option(option_name)==value) {
                func(fx.option(option_name));
            }
        });
    };
    var option_update_listeners = {};
    fx.on_option_update = function(option_name, func) {
        if (typeof option_update_listeners[option_name]=="undefined") { option_update_listeners[option_name]=[]; }
        option_update_listeners[option_name].push(func);
    };
    fx.fire_option_update = function(option_name,val) {
        var listeners = option_update_listeners[option_name];
        if (typeof listeners=="undefined") { return; }
        listeners.forEach(function(f) {
            f(val, option_name);
        });
    };
    fx.on_option_live = function(option_name, func) {
        if (Array.isArray(option_name)) {
            return option_name.forEach(opt => fx.on_option_live(opt, func));
        }
        fx.on_option_update(option_name, func);
        fx.fire_option_update(option_name, fx.option(option_name));
    };
    // Pass-through to non-option storage
    fx.storage = function(key) {
        return X.storage.data[key];
    };

    fx.add_html_class = function(name) {
        html_class_names.push(name);
        if (X.is_document_ready()) {
            fx.html_class_dump();
        }
    };
    fx.html_class_dump = function() {
        // Add HTML classes to the HTML tag
        if (html_class_names.length>0) {
            var h=document.getElementsByTagName('HTML')[0];
            h.className = (h.className?h.className:'') + ' ' + html_class_names.join(' ');
            html_class_names.length = 0;
        }
    };
    fx.on_page_load = function(func) {
        on_page_load_queue.push(func);
    };
    fx.on_page_unload = function(func) {
        on_page_unload_queue.push(func);
    };
    fx.on_content_loaded = function(func,isPriority) {
        if (fx.dom_content_loaded) {
            func();
        }
        else {
            if (isPriority) {
                on_content_loaded_queue.unshift(func);
            }
            else {
                on_content_loaded_queue.push(func);
            }
        }
    };
    fx.dom_content_loaded = false;
    fx.fire_content_loaded = function() {
        // Queue or Fire the DOMContentLoaded functions
        var content_loaded = function() {
            fx.dom_content_loaded = true;
            fx.html_class_dump();
            fire_queue(on_content_loaded_queue,true);
            fire_queue(on_page_load_queue);
            fx.html_class_dump();
        };
        if (X.is_document_ready()) {
            content_loaded();
        }
        else {
            window.addEventListener('DOMContentLoaded',function() {
                content_loaded();
            }, { capture: false, once: true });
        }
    };

    // Dynamic content insertion / removal
    fx.domNodeInsertedHandlers = [];
    fx.domNodeRemovedHandlers = [];
    fx.on_content_inserted = func => fx.domNodeInsertedHandlers.push(func);
    fx.on_content_removed = func => fx.domNodeRemovedHandlers.push(func);
    fx.on_content = function(func) {
        // Inserted content
        fx.on_content_inserted(func);
        // Static content on page load
        fx.on_content_loaded(function() {
            func(X(document.body));
        });
    };
    fx.on_selector = function(selector,func) {
        var f = function($o) {
            $o.probe(selector).forEach(function(item) {
                func(X(item));
            });
        };
        fx.on_content(f);
    };

    // Remove newlines & leading whitespace from a tagged template literal:
    //     var x = "?"; fx.oneLineLtrim(`foo${x} \n    bar`) ==> "foo? bar"
    // Trailing spaces are intentionally retained.
    //
    // Purpose: Facebook's HTML is all crammed together; do the same to ours,
    // while still allowing nice indented, readable HTML in our source.
    fx.oneLineLtrim = function(str) {
        return str.replace(/[\n\r]+\s*/g, '');
    };

    fx.sfx_support_groups = [
        'SocialFixerUserSupport',  // Previous Support group, trashed by FB in early 2020
        '412712822130938',         // -- in its numeric form
        'SocialFixerUsersSupport', // Current Support group since early 2020
        '413697228741798',         // -- in its numeric form
        '327097871787555',         // Social Fixer BETA Testers
    ];
    // Navigation Context
    fx.context = {"type":null, "id":null};
    fx.on_page_load(function() {
        if (fx.option('disabled')) {
            return;
        }

        var set_html_context = function () {
            X(document.documentElement).attr({
                sfx_url: window.location.pathname,
                sfx_context_type: fx.context.type,
                sfx_context_id: fx.context.id,
                sfx_context_permalink: fx.context.permalink,
            });
            X.support_note('sfx_context', `{ url: ${window.location.pathname}, type: ${fx.context.type}, id: ${fx.context.id}, permalink: ${fx.context.permalink} }`);
            if (fx.context.type == 'groups' && fx.sfx_support_groups.includes(fx.context.id)) {
                X('html').addClass('sfx_support_group');
            }
        };

        // https://www.facebook.com/foo/bar/baz?abc=def => ['foo','bar','baz']
        var context = window.location.pathname.replace(/^\/+|\/+$/g, '').split('/');

        if (!context || !context[0] || context[0] == 'home.php') {
            // facebook.com
            // facebook.com/home.php
            fx.context.type = "newsfeed";
            fx.context.id = null;
        } else if (context[0] == 'marketplace') {
            // facebook.com/marketplace => marketplace / ''
            // facebook.com/marketplace/you, etc. => marketplace / you
            // facebook.com/marketplace/category/electronics => marketplace / electronics
            fx.context.type = context[0];
            fx.context.id = (context[1] == 'category') ? context[2] : context[1];
        } else if (context[0] == 'messages') {
            // facebook.com/messages/t/$id
            // facebook.com/messages/[anything else] ==> id = null
            fx.context.type = "messages";
            fx.context.id = (context[1] == 't') ? context[2] : null;
        } else if (/messenger\.com$/.test(window.location.hostname)) {
            // messenger.com/t/$id
            // messenger.com/[anything else] ==> id = null
            fx.context.type = "messages";
            fx.context.id = (context[0] == 't') ? context[1] : null;
        } else if (context.length == 1 || context[1] == 'posts') {
            // facebook.com/$id
            // facebook.com/$id/posts  [ obsolete? ]
            fx.context.type = "profile";
            fx.context.id = context[0];
        } else if (context[0] == 'pg' && context[2] == 'posts') {
            // facebook.com/pg/$id/posts
            fx.context.type = "profile";
            fx.context.id = context[1];
        } else if (context[0] == 'groups') {
            // facebook.com/groups/$id/...
            fx.context.type = 'groups';
            fx.context.id = context[1];
            if (/^\d+$/.test(fx.context.id)) {
                // Collect the group's URL *name* when visited by *number*, e.g.
                // facebook.com/groups/412712822130938 => 'SocialFixerUserSupport'.
                // This ID is used to prevent filtering on SFx Support Groups, to
                // highlight the pinned post, and as a datum in the Support info.
                var group_href = X('a._5pcq[href^="/groups/"]').attr('href');
                if (group_href) {
                    // If href contains numeric ID, the Group's name *is* numeric
                    fx.context.id = group_href.split('/')[2];
                } else {
                    // Numeric ID and no posts have been loaded yet; try later.
                    // Might filter some posts on Support Groups; user should
                    // use Group's real name!  And pinned post highlighting may
                    // be delayed.  And 2s might not be long enough?
                    setTimeout(function () {
                        var group_href = X('a._5pcq[href^="/groups/"]').attr('href');
                        if (group_href) {
                            fx.context.id = group_href.split('/')[2];
                            set_html_context();
                        }
                    }, 2 * X.seconds);
                }
            }
        } else {
            // context.length >= 2
            // facebook.com/$type/$id
            fx.context.type = context[0];
            fx.context.id = context[1];
        }

        var query = window.location.search.replace(/^\?/, '');
        fx.context.permalink = (
            context[1] == 'posts' && /^\d/.test(context[2]) ||  // facebook.com/$user/posts/$id
            context[1] == 'posts' && /^pfbid0/.test(context[2]) ||  // facebook.com/$user/posts/pfbid$gibberish
            context[0] == 'permalink.php' ||        // facebook.com/permalink.php?story_fbid=$id
            /notif_id=/.test(query) ||              // facebook.com/media/set/?set=$id&...&notif_id=$id, etc.
            context[0] == 'groups' && (
                /view=permalink/.test(query) ||     // facebook.com/groups/$group?view=permalink&id=$id
                /multi_permalinks=/.test(query) ||  // facebook.com/groups/$group/?multi_permalinks=$id
                context[2] == 'posts' ||            // facebook.com/groups/$group/posts/$id
                context[2] == 'permalink'           // facebook.com/groups/$group/permalink/$id
            )
        );

        set_html_context();
        X.publish('context/ready');
        X.subscribe('context/changed', set_html_context);
    });

    // "Reflow" a news feed page when posts have been hidden/shown, so Facebook's code kicks in and resizes containers
    // 2018-10-18 Bela: this no longer appears to be necessary or helpful.
    // It clashes mightily with FB's de-duplication 'feature' (to hide their server-side bugs);
    // it also, somehow, makes scrolling through posts much slower, feels like it leaves the
    // memory manager in an unhappy state.
    // So, function remains for its callers, but does only the 'scroll_to_top' feature.

    fx.reflow = function(scroll_to_top) {
        if (scroll_to_top) {
            window.scrollTo(0, 3);
        }
    };

    fx.mutations_disabled = false;
    fx.disable_mutations = function() { fx.mutations_disabled=true; };
    fx.enable_mutations = function() { fx.mutations_disabled=false; };
    const ignoreTagNamesRegex = /^(?:SCRIPT|LINK|INPUT|BR|STYLE|META|IFRAME|AUDIO|EMBED)$/i;
    const ignoreClassNameRegex = /tooltipText/i;
    const ignoreParentClassNameRegex = /none_to_ignore_right_now/;
    const ignoreSfxIDsRegex = /sfx[-_]/;
    const ignoreSfxClassNameRegex = /sfx[-_]/;
    const ignoreMutation = node =>
        node.nodeType != 1 ||
        ignoreTagNamesRegex.test(node.tagName) ||
        ignoreClassNameRegex.test(node.className) ||
        (node.parentNode && ignoreParentClassNameRegex.test(node.parentNode.className));
    const ignoreInsertion = node =>
        ignoreMutation(node) ||
        ignoreSfxIDsRegex.test(node.id) ||
        ignoreSfxClassNameRegex.test(node.className);
    const ignoreRemoval = ignoreMutation;
    const domNodeInserted = node =>
        ignoreInsertion(node) ||
        fx.domNodeInsertedHandlers.some(handler => handler(X(node)));
    const domNodeRemoved = node =>
        ignoreRemoval(node) ||
        fx.domNodeRemovedHandlers.some(handler => handler(X(node)));
    const _observer = mutations =>
        fx.mutations_disabled ||
        mutations.forEach(mutation => {
            mutation.type === 'childList' && mutation.addedNodes.forEach(domNodeInserted);
            mutation.type === 'childList' && mutation.removedNodes.forEach(domNodeRemoved);
        });
    X(() => new MutationObserver(_observer).observe(document.body, { childList: true, subtree: true }));

    // Return the API
    // ==============
    return fx;
})();
