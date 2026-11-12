X.ready('unread_filtered_messages', function() {
    const name = 'unread_filtered_messages';
    const desc = 'Check For Filtered Chat';
    FX.add_option('check_unread_filtered_messages', {
        title: desc,
        description: 'Facebook Messenger does not alert you about chat messages from outside your network. Although mostly spam, there can be hidden gems. This feature alerts you about unread filtered chat messages.',
        default: true,
    });
    FX.on_option('check_unread_filtered_messages', function () {
        X.subscribe('unread_filtered_messages/visit', function() {
            const doSeq = (seq, idx = 0) => seq[idx] &&
                X.when(seq[idx].selector,
                       $result => (doSeq(seq, idx + 1), seq[idx].action($result)),
                       0.1 * X.seconds,
                       50); // nominally, stop trying after 5 seconds
            const action = $result => $result.first().click();
            const openSpamSeq = [
                // Top bar 'Chat lightning' button
                    { selector: '[role=banner] [role=navigation] [role=button] ~ [aria-hidden=true]', action, },
                // '...' Options button
                    { selector: '[role=dialog] [role=grid] [role=button].S2F_bg_trans:not(.S2F_bb_dark)', action, },
                // 'Message requests' item: this one is particularly weak, hits 3 buttons
                // of which 'requests' *happens* to be first, which will hopefully *hold*...
                    { selector: 'div[role=menuitem]:not([aria-haspopup])', action, },
                // 'Spam' tab
                    { selector: '[role=tab] ~ div[role=tab][aria-selected=false]', action, },
            ];
            doSeq(openSpamSeq);
        });
        X.subscribe_backlog('fb_dtsg/ready', function(msg, data) {
            const url = `https://mbasic.facebook.com/messages/?folder=other&fb_dtsg=${data.fb_dtsg}`;
            const ajax_strategies = [
                { ajax_func: SFX.ajax_cor, name: 'background script ajax', },
                { ajax_func: X.ajax, name: 'content script ajax', },
            ];
            SFX.pose({ unread_messages_data: ajax_strategies, });
            // X.support_note() saves last note per key: this records success or last failure
            // for easy access, while also keeping the full log for more detailed examination
            let last_msg = 'starting up';
            const logger = X.logger(name);
            const log = msg => (logger(msg), X.support_note(name, msg), (last_msg = msg));
            const add_menu_item = (tooltip, statement = 'You have unread filtered chat') =>
              X.publish('menu/add', {
                section: 'actions',
                item: {
                    html: `<span id="sfx_unread_jewel_count"></span><span>${statement}</span>`,
                    message: 'unread_filtered_messages/visit',
                    tooltip,
                },
              });
            // This calls itself recursively in what is effectively an async-chaining for loop
            const try_strat = function(idx) {
                const strat = ajax_strategies[idx];
                var count = 0, counted = false;
                strat.ajax_func && strat.ajax_func(url, function(ajax_result) {
                    strat.url = url;
                    strat.result = ajax_result;
                    if (typeof ajax_result !== 'string') {
                        log(`${strat.name}: non-string result ('${typeof ajax_result}')`);
                    } else if (ajax_result.length < 100) {
                        log(`${strat.name}: short result: '${ajax_result}'`);
                    } else if (!/<span/i.test(ajax_result)) {
                        log(`${strat.name}: result does not look like HTML`);
                    } else if (!/href.{1,40}messages\/\?folder/i.test(ajax_result)) {
                        log(`${strat.name}: result does not look like messages site`);
                    } else {
                        // Try to parse mbasic CSS & HTML directly
                        // Is the '.some_class { font-weight: bold; }' CSS still there?
                        var bold_matches = ajax_result.match(/\.([a-zA-Z0-9_]+)\s*{[^}]*font-weight[^:]*:{?[^};]*bold\s*;\s*{?}/);
                        if (bold_matches && bold_matches.length > 1) {
                            var bold_class = bold_matches[1];
                            // Filtered message subjects display as <h3 class="bb"> (normal) if 'read',
                            // class="ci" (bold) if 'unread'.  Count the '<h3 class="ci">' blocks.
                            // Except 'ci' is sometimes 'cj' or maybe something else?  So now we parse
                            // out the class, first.
                            bold_matches = ajax_result.match(RegExp(`<h3[^>]*class=.[^'"]*\\b${bold_class}\\b`, 'g'));
                            bold_matches && (count = bold_matches.length);
                            counted = true;
                            log(`succeeded by strategy '${strat.name} direct parsing'`);
                        } else {
                            log(`${strat.name}: class:bold CSS not found`);
                            try {
                                const $ajax_result = X(`<div>${ajax_result}</div>`);
                                X('body').append($ajax_result);
                                $ajax_result.find('h3 > a[href^="/messages"]').forEach(msg =>
                                    /[6-9]\d\d|[1-9]\d{3,}|bold/i.test(getComputedStyle(msg).fontWeight) && (count++));
                                $ajax_result.remove();
                                counted = true;
                                log(`succeeded by strategy '${strat.name} DOM injection'`);
                            } catch(e) {
                                log(`${strat.name}: DOM injection failed: '${e}'`);
                            }
                        }
                    }
                    // (counted && count == 0) is success, but don't want it in the badge menu!
                    if (count) {
                        add_menu_item(`Facebook Messenger does not alert you about chat messages from outside your network, so Social Fixer does! To turn this off: wrench > Options > ${desc}`);
                        X.publish('notify/set', {
                            target: `.${SFX.instance} [id=sfx_unread_jewel_count]`,
                            parent_target: SFX.badge_sel,
                            count, });
                    }
                    if (!counted && ajax_strategies[++idx]) {
                        // Still at least one strategy to try...
                        return try_strat(idx);
                    }
                    if (!counted && !ajax_strategies[idx]) {
                        // No strategies left, show failure in menu
                        add_menu_item(`Click to check (automated check failed: ${last_msg})`, desc);
                        console.log('SFx: unread_messages failed, debug data follows', { unread_messages_data: ajax_strategies, });
                    }
                });
            };
            try_strat(0);
        });
    });
});
