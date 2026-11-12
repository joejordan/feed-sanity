// =========================================================
// External CSS
// =========================================================
X.ready( 'external_css', function() {
    // XXX This should have a 'Test' button to immediately request it,
    // report if it's (1) missing, (2) not HTTPS (or bad certificate
    // chain blah blah), or (3) not mime type text/css.
    // OR: automatically test whenever changed...
    FX.add_option('external_css_url', {"section": "Advanced", "type": "text", "title": 'External CSS url', "description": 'URL of external CSS to be included in the page.  NOTE: browser may require HTTPS, and that server presents MIME type text/css.', "default": ""});
    FX.on_options_load(function () {
        var url = X.sanitize(FX.option('external_css_url'));
        if (url) {
            X.when('head', function ($head) {
                $head.append(`<link id="sfx_external_css" rel="stylesheet" type="text/css" href="${url}">`);
            });
        }
    });
});
