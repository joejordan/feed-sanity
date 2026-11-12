const SFX = {
    version: '31.1.0',
    buildtype: 'web_extension',
    releasetype: '',
    userscript_agent: undefined,
    user_agent: 'Browser: ' + navigator.userAgent,
    instance: 'sfx_' + ((1 + Math.random()) * (36**6)).toString(36).replace(/^1|\..*/g, ''),
};
SFX.badge_sel = '[id=sfx_badge].' + SFX.instance;
const GMinfo = typeof GM !== 'undefined' ? GM.info : typeof GM_info !== 'undefined' ? GM_info : null;
if (SFX.buildtype == 'userscript') {
   SFX.userscript_agent = (!GMinfo ? "unknown-userscript-manager v:unknown" :
      (GMinfo.scriptHandler || "Greasemonkey") + " v:" + (GMinfo.version || "unknown"));
   if (GMinfo && GMinfo.script && GMinfo.script.version) {
      SFX.version = GMinfo.script.version;
   }
}
if (SFX.releasetype) SFX.version = `${SFX.releasetype} ${SFX.version}`;
if (!SFX.extension_id && typeof browser !== 'undefined' && browser.runtime) SFX.extension_id = browser.runtime.id;
if (!SFX.extension_id && typeof chrome !== 'undefined' && chrome.runtime) SFX.extension_id = chrome.runtime.id;
[
    [ 'betterfacebook@mattkruse.com',     'Firefox',             'Firefox Browser Add-ons' ],
    [ 'd63d1fd3ea8a01224c4baf7c2ce65d59', 'Firefox',             'Firefox Browser Add-ons via Orion Browser' ],
    [ 'bhaooomeolkdacolgpkfbfookhomkbei', 'Edge',                'Microsoft Edge Add-ons' ],
    [ 'gbhlbkifncomjccjcdjokniojhnojmcn', 'Chrome (beta build)', 'Google Chrome Web Store (beta)' ],
    [ 'ifmhoabcaeehkljcfclfiieohkohdgbb', 'Chrome',              'Google Chrome Web Store' ],
    [ 'inficfabgpfjiegjgnhmjdagmhlmakoo', 'Opera',               'Opera addons' ],
    [ 'safari',                           'Safari',              'Mac App Store' ],
    [ 'userscript',                       'Userscript',          SFX.userscript_agent ],
                                                                 // e.g. 'Tampermonkey v:4.13.6136'
    [ 'default',                          'Unknown',             `${SFX.extension_id} from an unknown source` ],
].find(ident => {
    if (SFX.extension_id == ident[0] || SFX.buildtype == ident[0] || ident[0] == 'default') {
        SFX.extension_build_target = ident[1];
        SFX.extension_store_name = ident[2];
        if (ident[1] == 'Userscript') {
            SFX.extension_id = (GMinfo && GMinfo.script) ? GMinfo.script.name : 'Unknown';
        }
        return true;
    }
});
SFX.buildstr = `${SFX.version} (${SFX.buildtype}, ${SFX.extension_store_name})`;

SFX.is_sfx_element = el => (
    (el = X(el)[0]) && (
        /^sfx_/.test(el.id) ||
        Array.from(el.classList).some(cl => /^sfx_/.test(cl))
    )
);

SFX.Ctrl = (/Macintosh|Mac OS X/.test(SFX.user_agent)) ? 'Command' : 'Ctrl';

// If running as a Web Extension, communicate with the background script
// to perform ajax fetches which are not blocked by CORS / CORB.
if (SFX.buildtype !== 'userscript' && typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.sendMessage === 'function') {
    SFX.ajax_cor = function(urlOrObject, callback) {
        const do_callback = function(response) {
            const headers = {};
            const xhr = response.xhr || {};
            if (response.type != 'load') {
                return callback(response.type, xhr.status, headers);
            }
            xhr.responseHeaders && xhr.responseHeaders.split(/\r?\n/).forEach(function (header) {
                const val = header.split(/\s*:\s*/, 2);
                headers[val[0].toLowerCase()] = val[1];
            });
            callback(xhr.responseText, xhr.status, headers);
        };
        const request = {
            method: urlOrObject.method || 'GET',
            timeout: urlOrObject.timeout || 5.0 * X.seconds,
            url: urlOrObject.url || urlOrObject,
        };
        if (!request.url) {
            alert('Invalid parameter passed to ajax_cor');
            return callback(null);
        }
        chrome.runtime.sendMessage({
            sfx: true,
            call: 'ajax_cor',
            request,
        }, do_callback);
    };
} else {
    SFX.ajax_cor = (urlOrObject, callback) => callback('no background script, use X.ajax()', urlOrObject);
}

// 'fuzzy reference': fref(obj, /bc.*de/) finds obj.abc_xyz_def
SFX.fref = function (obj, kex) {
    for (var key of Object.keys(obj || {})) if (kex.test(key)) return obj[key];
    return {};
};
// 'fuzzy reference arguments' converts 'abc,de.*f' to [/abc/, /de.*f/]
// This allows powerful shorthand for fuzzy path lookups.
SFX.frefargs = (...keyargs) =>
    keyargs.flat(Infinity).map(keyarg =>
        keyarg instanceof RegExp ? keyarg : keyarg.split(',').map(str => new RegExp(str))
    ).flat(Infinity);
// 'fuzzy reference': frefpath(obj, /bc.*de/, 'foo') or frefpath('bc.*de,foo') finds obj.abc_xyz_def.foobar
SFX.frefpath = (obj, ...kex_arr) => SFX.frefargs(kex_arr).reduce((obj, kex) => SFX.fref(obj, kex), obj);

// This isn't a complete 'deep equals', but suffices for our purposes.
SFX.data_equals = function(obj, pbj) {
    if (obj === pbj) return true;
    if (obj === null || pbj === null ||
        typeof obj !== 'object' || typeof pbj !== 'object' ||
        Object.keys(obj).length != Object.keys(pbj).length) return false;
    return Object.keys(obj).every(key => SFX.data_equals(obj[key], pbj[key]));
};

// do [].push, if the item is truthy & not already in the array; returns the array
SFX.pushy = (arr, item) => ((item && !arr.includes(item) && arr.push(item)),arr);

// Bound and clamp a numeric value: returns val if in range, min or
// max if numerically out of range, or def if val isn't numeric at all.
// Strings which start with a digit are first converted with Number().
SFX.bound = (val, min, max, def) => {
    if (typeof val === 'string' && /^\d/.test(val)) val = Number(val);
    return (!Number.isFinite(val)) ? def : (val < min) ? min : (val > max) ? max : val;
}

// Export symbols for use by other SFx modules
SFX.port = ((vars) => Object.assign(SFX, vars));

// Allow debug exposure of internals when enabled (no UI to enable)
// This is for debugging in the field.  It is never enabled without
// Support interaction.

SFX.dbg = {};

// Harmlessly record references without actually exposing
SFX.pose = ((vars) => Object.assign(SFX.dbg, vars));
SFX.pose({ X, FX, SFX, });

// Actually expose the references, if the hidden option is set
X.ready('xpose_dbg', function() {
  FX.on_option_live('xpose_dbg', function(enabled) {
    if (!enabled) {
        return;
    }
    let exposee = { X, FX, SFX, SFX_dbg: SFX.dbg, };
    let global = window.unsafeWindow ||  // Userscript runners
                 window.globalThis   ||  // Browsers
                 window;                 // Old browsers

    // This exposes them in any browser and SFx packaging (extension / userscript)
    // The user can then manipulate them directly or right-click > Store as global
    console.log('Social Fixer debug data', exposee);

    // This potentially exposes them a bit more directly in some situations, making
    // globals 'X', 'FX', 'SFX', 'SFX_dbg' immediately accessible
    //
    // As of Tampermonkey version 4.16.6158, this also requires the following
    // setting to be enabled:
    //
    //     script's Settings > GM/FF > Add GM functions to this or window > On (or Auto)
    Object.assign(global, exposee);
  });
});

X.subscribe('sfx/debug', (msg, data) => FX.option('xpose_dbg', typeof data.on === 'boolean' ? data.on : !FX.option('xpose_dbg')));
