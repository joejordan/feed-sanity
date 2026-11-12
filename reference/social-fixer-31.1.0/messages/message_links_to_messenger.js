// =========================================================
// For Message links to open Messenger instead of a chat box
// =========================================================
X.ready('message_links_to_messenger', function() {
    FX.add_option('messages_open_in_full_window',
        {
            title: 'Open Messages In Full Tab',
            description: 'Open Facebook chat conversations in their own full browser tabs instead of chat boxes at the bottom.',
            default: false,
        }
    );

    var event_target = null;

    const redirect_message_link = function(event) {
        // Allow loopback links when already in Messenger
        if (/\/messages($|\/)/.test(window.location.href) ||
                    /(^|\.)messenger\.com$/.test(window.location.hostname)) {
            return;
        }
        // don't act on buttons which are nested inside a message link
        var href = X.target(event, true).closest('[role=button],[href*="/messages/t/"]').attr('href');
        if (href && !/#$/.test(href)) {
            window.open(href);
            event.stopPropagation();
            event.preventDefault();
        }
    };

    FX.on_option_live('messages_open_in_full_window', function (enabled) {
        event_target = X.uncapture(event_target, 'click', redirect_message_link);
        if (enabled) {
            event_target = X.capture(document.documentElement, 'click', redirect_message_link);
        }
    });
});
