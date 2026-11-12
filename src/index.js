/*
Social Fixer
(c) 2009-2023 Matt Kruse
https://SocialFixer.com/
*/

/*
 * Decide if we're supposed to be running at all.
 */
var prevent_running = false;

if (window.top != window.self ||                                      // We don't run in frames
    !location || /[?#&]no_sfx/.test(location.href) ||                 // URL keyword to disable
    /\/plugins\/|\/(l|ai|morestories)\.php$/.test(location.pathname)  // Avoid some FB features
   ) prevent_running = true;


// Extension API
var Extension = (function () {
    return {
        "storage": {
            "get": function (keys, def, callback, prefix) {
                var defaults = {};
                var defaults_with_prefix = {};
                var single = true;
                var p, ret2;
                if (typeof keys == "string") {
                    defaults[keys] = def;
                    defaults_with_prefix[prefix+keys] = def;
                }
                else {
                    single = false;
                    for (var i = 0; i < keys.length; i++) {
                        defaults[keys[i]] = def[i];
                        defaults_with_prefix[prefix+keys[i]] = def[i];
                    }
                }
                chrome.storage.local.get(defaults_with_prefix, function (ret) {
                    const err = chrome.runtime.lastError;
                    if (err) {
                        console.log('Browser error: ' + err.message);
                        callback(null, err);
                    }
                    else {
                        if (single) {
                            callback(ret[prefix+keys]);
                        } else {
                            // We have to return an object back without the prefix in the keys
                            if (ret) {
                              ret2 = {};
                              for (p in ret) {
                                ret2[p.replace(prefix, '')] = ret[p];
                              }
                              callback(ret2);
                            }
                            else {
                              callback(ret);
                            }
                        }
                    }
                });
            }
            ,
            "set": function (key, val, callback, prefix) {
                var values = {};
                values[prefix+key] = val;
                chrome.storage.local.set(values, function () {
                    const err = chrome.runtime.lastError;
                    if (err) {
                        console.log('Browser error: ' + err.message);
                        key = null;  // For callback
                        val = err;
                    }
                    if (typeof callback == "function") {
                        callback(key, val);
                    }
                });
            }
        },
        "ajax":function(urlOrObject,callback) {
            const xhrEventHandler = function (event) {
                const headers = {};
                if (event.type != 'load') {
                    return callback(event.type, xhr.status, headers);
                }
                xhr.getAllResponseHeaders().split(/\r?\n/).forEach(function (header) {
                    const val = header.split(/\s*:\s*/, 2);
                    headers[val[0].toLowerCase()] = val[1];
                });
                callback(xhr.responseText, xhr.status, headers);
            };
            const method = urlOrObject.method || 'GET';
            const timeout = urlOrObject.timeout || 5.0 * X.seconds;
            const url = urlOrObject.url || urlOrObject;
            if (!url) {
                alert("Invalid parameter passed to Extension.ajax");
                return callback(null);
            }
            var xhr = new XMLHttpRequest();
            xhr.timeout = timeout;
            ['load', 'error', 'abort', 'timeout'].forEach(event =>
                xhr.addEventListener(event, xhrEventHandler));
            xhr.open(method, url, true);
            xhr.send();
        },
    };
})();
try {
// This actually executes module code by firing X.ready()
var run_modules = function() {
	// This tells each module to run itself
	X.ready();
	// First add any CSS that has been built up
	FX.css_dump();
	// Queue or Fire the DOMContentLoaded functions
	FX.fire_content_loaded();
};

// Should we even run at all? (see target_header.js)
if (!prevent_running) {
	// Allow modules to delay early execution of modules (until prefs are loaded) by returning false from beforeReady()
	if (X.beforeReady()!==false) {
		run_modules();
	}

  // Load Options (async)
  var bootstrap = function() {
    X.storage.get(['options', 'filters', 'tweaks', 'hiddens', 'postdata', 'friends', 'stats', 'tasks', 'messages'], [{}, [], [], {}, {}, {}, {}, {}, {}], function (options,err) {
      if (err) {
        console.log("Social Fixer Preferences could not be loaded from storage.");
        console.log(err);
      }
      else if (X.beforeReady(options) !== false) {
        run_modules();
        FX.options_loaded(options);
      }
    });
  };

  // Find out who we are
	// ===================
  X.userid = X.cookie.get('c_user') || "anonymous";
  // Prefix stored pref keys with userid so multiple FB users in the same browser can have separate prefs
  X.storage.prefix = X.userid;
  bootstrap();

}

} catch(e) {
    console.log(e);
}
