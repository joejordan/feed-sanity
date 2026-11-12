// =========================================================
// Force the main Newsfeed to the Most Recent view
// =========================================================
X.ready( 'most_recent', function() {
    FX.add_option('auto_switch_to_recent_stories', {"title": 'Automatically Switch to Most Recent view of the main Newsfeed', "description": "Facebook defaults to Top Posts. This option detects this view and automatically switches you to the chronological Most Recent view.", "default": false});
    FX.add_option('auto_switch_hide_message', {"section":"Advanced", "title": 'Hide Most Recent switch messages', "description": "When automatically switched to the Most Recent news feed, hide the message that appears to inform you of the switch.", "default": false});
    FX.add_option('redirect_home_links', {"section": "Advanced", "title": 'Redirect Home Links', "description": 'Try to keep links to the Home Page in your current view - Most Recent or Top Posts.', "default": true});
    const is_www = (host = location.host) => /(?:^|\.)facebook\.com$/.test(host) && !/^(?:m|mbasic|apps)\./.test(host);
    FX.on_options_load(function () {
        // Purpose: force 'Most Recent' when clicking 'f' and 'Home' buttons on FB
        if (FX.option('redirect_home_links')) {
            FX.on_content_loaded(function () {
                X.capture(document.body, 'mousedown', function (e) {
                    // Button 0 only, with no modifiers!
                    if (e.button || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) {
                        return;
                    }
                    var $e = X.target(e, true);
                    if (!$e.is('a')) {
                        $e = $e.closest('a');
                    }
                    const href = $e.attr('href');
                    const target = new URL(href, location);
                    if (is_www(target.host)        // only affect www.facebook.com
                        && target.pathname == '/'  // only links to the top of site
                        && href != '#'             // not JS-controlled links
                        && !target.search          // not links like '?filter=pages'
                    ) {
                        // Don't force Most Recent link if clicking "Back to Top Posts" which only exists in the Main container
                        // Force Top Posts instead
                        if ($e.closest('*[role="main"]').length) {
                            e.preventDefault();
                            e.stopPropagation();
                            location = 'https://www.facebook.com/?sk=h_nor&sfx_switch=true';
                        }
                        // This is a link from somewhere to the News Feed, so make sure it's a Most Recent link
                        else if (FX.option('auto_switch_to_recent_stories')) {
                            e.preventDefault();
                            e.stopPropagation();
                            location = 'https://www.facebook.com/?sk=h_chr&sfx_switch=true';
                        }
                    }
                });
            });
        }

        // Purpose: force 'Most Recent' when arriving at FB from wherever
        FX.on_content_loaded(function () {
            if (is_www() && FX.option('auto_switch_to_recent_stories')) {
                if (/[?&]sfx_switch=true/.test(location.search) && /sk=h_chr/.test(location.search)) {
                    if (!FX.option('auto_switch_hide_message')) {
                        const position = (FX.option('badge_x') < 0) ? 'left' : 'right';
                        const note = sticky_note(SFX.badge_sel, position, 'Auto-switched to Most Recent');
                        setTimeout(function () {
                            note.remove();
                        }, 3.0 * X.seconds);
                    }
                    return;
                }
                // Don't redirect URLs which ask for SFx options or any particular feed
                if (/[?&](?:sfx_options=true|sk=)/.test(location.search)) {
                    return;
                }
                // Only redirect if we're on root Facebook
                if (location.pathname != '/') {
                    return;
                }
                // Failsafe in case redirect doesn't cause reload
                setTimeout(function () {
                    X(document.body).css('opacity', '1');
                }, 2.0 * X.seconds);
                X(document.body).css('opacity', '.2');
                location.href = '/?sk=h_chr&sfx_switch=true';
            }
        });
    });
});
