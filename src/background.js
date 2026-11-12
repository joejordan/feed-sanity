// At the time that I'm writing this, Manifest V2 is deprecated and
// Manifest V3 is experimental, and Google have almost completely
// destroyed their V2 docs, while Mozilla's seem incomplete, and anyway
// do not well cover the Chromium way of doing things.
//
// All the docs I can find say that browser.runtime.sendMessage() (used
// in the content script side ajax_cor() function) takes 1-3 arguments,
// none of which is a callback function, and returns a Promise.  Whereas
// some examples on the web show it taking two args, a message and a
// callback.  In actual fact I was unable to get a Promise back from it
// on Opera, regardless of whether I called chrome.runtime.sendMessage()
// or browser.runtime.sendMessage().  But the callback method *did*
// work, and furthermore also worked in Firefox.  So despite Mozilla's
// doc completely ignoring that this method exists, it's what I use.
//
// I got at least useful hints or background info from each of these:
//
// https://developer.mozilla.org/docs/Mozilla/Add-ons/WebExtensions/Content_scripts#one-off_messages
// https://stackoverflow.com/questions/4743540
// https://stackoverflow.com/questions/17246133
// https://stackoverflow.com/questions/32777310
// https://stackoverflow.com/questions/36371072
//
// This background script is initially used for just one thing: doing
// AJAX requests which, if run directly by the content script, would be
// blocked by CORS (or CORB?  Documentation on the distinctions and/or
// interactions between these is hard to find).  It is used by the
// web_extension family of packages and not by the Userscript, which
// instead relies on the Userscript manager's handling of such matters.
// (Safari: TBD.)
//
// This may very well be the wrong level of abstraction.  The single
// initial user of this is unread_messages.js.  It might be better to
// have the background script capture and parse the mbasic.fb page
// itself, then cache the resulting information ('you have 2 unread
// hidden messages') -- vs. needing to load an mbasic/messages page on
// every single interactive FB page load.  For future consideration.

const do_ajax_cor = async function(request) {
    return new Promise(resolve => {
        const xhrEventHandler = function (event) {
            resolve({
                request,
                type: event.type,
                xhr: {
                    status: xhr.status,
                    responseText: event.type == 'load' ? xhr.responseText : event.type,
                    responseHeaders: event.type == 'load' ? xhr.getAllResponseHeaders() : '',
                },
            });
        }
        var xhr = new XMLHttpRequest();
        try {
            xhr.open(request.method, request.url, true);
            xhr.timeout = request.timeout;
            ['load', 'error', 'abort', 'timeout'].forEach(event =>
                xhr.addEventListener(event, xhrEventHandler));
            xhr.send();
        } catch(e) {
            xhr = { status: e, };
            xhrEventHandler({ type: 'error', });
        }
    });
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.sfx && message.call == 'ajax_cor' && message.request) {
        do_ajax_cor(message.request).then(sendResponse);
        return true;  // tell onMessage that we'll resolve later
    }
    return false;     // we don't consume this message
});
