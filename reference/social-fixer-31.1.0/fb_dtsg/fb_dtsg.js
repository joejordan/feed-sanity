// Collect anti-CSRF token (DTSG) as early as possible.

// (a) determine if we in fact 'got' dtsg (is it non-blank?);
// (b) issue proclamations if so (FX.dtsg & 'fb_dtsg/ready');
// (c) inform the caller by returning a boolean
const got_dtsg = function(fb_dtsg, technique, count) {
    count == count || 0;
    if (!FX.dtsg && fb_dtsg) {
        FX.dtsg = fb_dtsg;
        X.publish('fb_dtsg/ready', { fb_dtsg, technique, count, });
        return true;
    }
    return false;
};

FX.dtsg || setTimeout(function() {

// 1. embedded script code found on many pages (give it some time to load first)

    const DTSG_capture = '"([A-Z][-_a-z0-9A-Z]{11,65}:[\\d:]{11,19})"';
    const DTSG_REs = [
        { how: 'script:initd3', re: RegExp('DTSGInitData",.{0,150}async_get_token":' + DTSG_capture), },
    ];
    Array.from(X('script')).find(script =>
        /dtsg/i.test(script.textContent) && DTSG_REs.some(RE =>
            (script.textContent.match(RE.re) && got_dtsg(RegExp.$1, RE.how))));

// 2. Call FB internal API
// window.requireLazy() must be called in the root window
// scope; we also have to wait until that function exists!

    FX.dtsg ||
        (X.subscribe('fb_dtsg/eject', (msg, data) => got_dtsg(data.fb_dtsg, data.technique, data.count)),
         X.inject(function() {
            const got_dtsg_inj = function(fb_dtsg, technique, count) {
                count == count || 0;
                if (fb_dtsg) {
                    // cross-scope X.publish('fb_dtsg/eject', { fb_dtsg, technique, count, });
                    window.postMessage({
                        sfx: true,
                        pagecontext: true,
                        message: { event: 'fb_dtsg/eject', data: { fb_dtsg, technique, count, }, },
                    }, '*');
                    return true;
                }
                return false;
            };
            var got_it = false;
            var called_fb = false;
            // Allow us to cancel after FB monkey-patch in their timer implementation
            const clearInterval = window.clearInterval;
            var cycle_count = 1;
            const gather_dtsg = function() {
                if (!called_fb && window.requireLazy) {
                    called_fb = true;
                    window.requireLazy(['invariant','DTSGInitData'], function(x, DTSG_module) {
                        if (DTSG_module && DTSG_module.async_get_token) {
                            got_it = got_dtsg_inj(DTSG_module.async_get_token, 'requireLazy()', cycle_count);
                        }
                    });
                }
                if (got_it || ++cycle_count > 20) {
                    clearInterval(gather_dtsg.interval);
                    if (!got_it) {
                        got_dtsg_inj('failed', 'All techniques');
                    }
                }
            };
            gather_dtsg.interval = setInterval(gather_dtsg, 0.5 * 1000);
        }));
}, 1000);
