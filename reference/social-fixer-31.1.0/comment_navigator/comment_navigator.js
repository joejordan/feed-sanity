// Comment Navigator for 2020 New Layout
//
// This is significantly better at expanding comments, and has a better
// user interface including realtime abort.
//
// However, it entirely lacks the 'highlight comments newer than' feature,
// as FB have made comment timestamps impossible to work with.

X.ready('comment_navigator_nl', function() {
    const title = 'Comment Navigator';
    FX.add_option('navigator_order', {title, description: "Try to set comment order to (e.g. 'All' or 'New')", type: 'text', default: ''});
    FX.add_option('navigator_watch', {title, description: 'Follow Comment Navigator while expanding', default: false, });
    FX.add_option('navigator_avoid', {title, description: 'Words to avoid clicking', type:'text', default:'\\bhide\\b'});
    FX.add_option('navigator_close_wait', {hidden: true, default: 15, });
    X.publish('post/action/add', {section: 'wrench', label: 'Expand Comments', order: 10, message: 'post/action/expand'});
    X.subscribe('post/action/expand', (msg, data) => expand_post(data.id));

    // A freshly displayed post may have no comments visible, just a '123 Comments' button
    const comment_exposer_selector = [
        '[role=button][aria-expanded=false] > .S2F_font_400',
        '[role=button][id] > .S2F_font_400',
    ].join(',');

    // Once comments are displayed, some posts have a widget to select comment
    // order, like 'All Comments', 'Most Recent', or 'Top Comments'
    const order_widget_selector = [
        '[role=button].S2F_disp_inl .S2F_alini_cent.S2F_va_mid',
    ].join(',');

    // Parent node which includes the name of the current sort order
    const order_widget_parent = [
        '[role=button]',
    ].join(',');

    // Differentiate individual menu items within the order widget
    const order_menuitem_selector = [
        '[role=menu] [role=menuitem] .S2F_col_tx1',
    ].join(',');

    // Count comments currently displayed (info only)
    const comment_selector = [
        '[role=article]',
    ].join(',');

    // The main event!  These are the various buttons which will fully expand a post.
    const expander_selector = [
        // 'See More'
        '[dir=auto] .S2F_col_tx1.S2F_font_600.S2F_touch_man[role=button]:not(.S2F_alini_stre)',
        // 'N [more] comments/replies'
        ':not(.S2F_left_0)+[role=button].S2F_col_tx2 > span > [dir]',
    ].join(',');
    // This filters out some false matches like '3 others' and 'See Translation'
    const expander_rejector = [
        'h2 *',
        'h3 *',
        'h4 *',
        'h5 *',
        'strong *',
    ].join(',');

    // A specific and then a generic fallback for the popup's close box
    const popup_closebox_selector_1 = [
        '.S2F_bg_bt2.S2F_bbl_rad50[role=button]',
    ].join(',');
    const popup_closebox_selector_2 = [
        '[aria-label][role=button]',
    ].join(',');

    var exp_serial = 1;
    const exps = {};
    SFX.pose({ expand_comments_data: exps, });

    const exp_done = function(exp) {
        if (exp.state != 'FINISH') {
            exp.state = 'FINISH';
            exp.$note.remove();
            // Activate the post body so ESC will close popup
            exp.$post.click();
            delete exps[exp.serial];
        }
    };

    const exp_reacts_to_esc = function() {
        Object.values(exps).forEach(exp => {
            X.publish('esc/prevent');
            if (exp.state == 'EXPAND') {
                show_stats(exp, 'TIMER', 'red');
                progress(exp, 'ESC pressed, stopping comment expansion');
            } else {
                exp_done(exp);
            }
        });
    };
    X.subscribe('esc/pressed', exp_reacts_to_esc);

    const exp_reacts_to_new_post = function(msg, data) {
        if (!data || !data.$post || data.$post[0].getRootNode() != document) {
            return;
        }
        Object.values(exps).forEach(exp => {
            if (exp.$post.attr('sfx_id') == data.sfx_id) {
                if (exp.popup_seen) {
                    // Multiple popups; close this new one
                    var $close = data.$post.find(popup_closebox_selector_1);
                    if (!$close.length) {
                        $close = data.$post.find(popup_closebox_selector_2);
                    }
                    if (!$close.length) {
                        progress(exp, 'CANNOT FIND CLOSE BOX of excess popup');
                        progress(exp, 'You will have to close it manually');
                    } else {
                        progress(exp, 'Closing excess popup');
                        $close.first().click();
                    }
                    return;
                }
                exp.popup_seen = true;    // For rest of expansion: close excess popups
                exp.popup_popped = true;  // For the moment: retry expose & order menu
                progress(exp, 'Moving expansion to comments popup');  // Logs in parent post's Post Data
                exp.$orig_post = exp.$post;
                exp.$post = data.$post;
                exp.dom_id = data.id;
                exp.patience += 2.0;
                progress(exp, 'Now expanding in the comments popup');   // Logs in popup post's Post Data
            }
        });
    };
    X.subscribe_backlog('post/add', exp_reacts_to_new_post);

    const run_time = (exp => ((performance.now() - exp.start) / X.seconds).toFixed(3));

    const progress = function(exp, message) {
        message = message.replace(/[ ><\s]+/g, ' ');
        exp.$log.scrollingAppend(`<br><span style="color:${exp.color}">${run_time(exp)} ${message}</span>`);
        X.publish('log/postdata', {id:exp.dom_id, message});
    };

    const show_stats = function(exp, new_state, new_color) {
        if (new_state) exp.state = new_state;
        if (new_color) exp.color = new_color;
        exp.comments = exp.$post.find(comment_selector).length;
        const ret = `${run_time(exp)}s, ${exp.clicks} clicks, ${exp.comments} comments -- ${exp.state}`;
        exp.$stats.text(ret).css('color', exp.color);
        return ret;
    };

    const enclick = function(exp, button, msg) {
        const button_text = button.innerText;
        const $button = X(button);
        if ((FX.option('navigator_avoid') && RegExp(FX.option('navigator_avoid'), 'i').test(button_text))) {
            if (!$button.hasClass('sfx_click_avoided')) {
                $button.addClass('sfx_click_avoided');
                progress(exp, `Avoiding '${button_text}' as directed`);
            }
            return false;
        }
        if (!msg && button_text) {
            msg = `Clicking '${button_text}'`;
        }
        progress(exp, msg);
        $button.click();
        ++exp.clicks;
        show_stats(exp);
        return true;
    };

    const display_expand = function(exp) {
        const content = X(FX.oneLineLtrim(`
            <label>
                <h2 style="position:absolute;top:calc(2.1rem * var(--sfx_ui_scale));right:calc(0.5rem * var(--sfx_ui_scale))">
                    Close after&nbsp;
                    <input class="sfx_input" type="number" min="0" value="${FX.option('navigator_close_wait')}" style="width: calc(1.75rem * var(--sfx_ui_scale));" sfx-option="navigator_close_wait">
                    s
                </h2>
            </label>
            <label>
                <h2 style="position:absolute;top:calc(2.8rem * var(--sfx_ui_scale));right:calc(0.7rem * var(--sfx_ui_scale));">
                    Follow expansion
                    <input class="sfx_input" type="checkbox" value="${FX.option('navigator_watch')}" sfx-option="navigator_watch">
                </h2>
            </label>
            <div class='sfx_expander_stats'></div>
            <div class='sfx_expander_ui'></div>
        `));
        const title = `Social Fixer: Expanding post ${exp.dom_id}`;
        // Handle our own ESC processing: 1st ESC stops expanding, 2nd ESC closes window
        exp.$note = bubble_note(content, {title, position:'top_right', no_esc:true, close:true, callback:function() { exp_done(exp); }});
        exp.$note.find('.sfx_sticky_note_close')
                 .css({ width: 'auto', height: 'auto', })
                 .addClass('sfx_button')
                 .text('ESC to stop');
        FX.attach_options(exp.$note);
        exp.$log = exp.$note.find('.sfx_expander_ui');
        exp.$stats = exp.$note.find('.sfx_expander_stats');
        progress(exp, `Begin expanding post ${exp.dom_id}`);
        show_stats(exp);
    };

    // 'func' should return 0 for condition not met;
    // nonzero for met, and that value will be returned;
    // returning -1 means failure, caller should just return.
    // if msg exists, condition not met is considered a failure
    const try_for = async function(exp, patience, func, msg) {
        var result;
        do {
            if (exp.state != 'EXPAND') return -1;
            if ((result = func())) return result;
            await X.sleep(0.2);
            patience -= 0.201;
        } while (patience > 0);
        if (!(result = func())) {
            if (msg) {
                progress(exp, msg);
                return -1;
            }
        }
        return result;
    };

    const expose_comments = async function(exp) {
        const $comment_exposer = exp.$post.find(comment_exposer_selector);
        if (!exp.comments && $comment_exposer.length) {
            enclick(exp, $comment_exposer[0], `Clicking '${$comment_exposer[0].innerText}' to expose post comments`);
            exp.patience = 1.0;
        } else {
            progress(exp, 'Comments are already visible');
        }
    };

    const choose_order = async function(exp) {
        const my_patience = exp.patience + 0.1;
        const order_request = FX.option('navigator_order').trim();
        if (!order_request) {
            return progress(exp, 'No specific comment order is requested');
        }
        const order_regexp = new RegExp(order_request, 'i');
        var $order_menu = [];
        exp.patience = 0;
        if (-1 == await try_for(exp, my_patience,
            () => ($order_menu = exp.$post.find(order_widget_selector).closest(order_widget_parent)).length,
            'No comment order menu found')) return;
        if ($order_menu[0].innerText.match(order_regexp)) {
            progress(exp, `Order '${$order_menu[0].innerText}' already matches '${order_request}'`);
            return;
        }
        if (!enclick(exp, $order_menu[0], `Clicking order menu (currently '${$order_menu[0].innerText}')`)) {
            return;
        }
        var $menuitems = X([]);
        if (-1 == await try_for(exp, 0.5,
            () => (($menuitems = X(order_menuitem_selector)).length))) return;
        var clicked = false;
        $menuitems.each(function() {
            const menuitem = this.innerText;
            if (menuitem.match(order_regexp)) {
                if (enclick(exp, this, `Menu item '${menuitem}' matches '${order_request}', clicking`)) {
                    clicked = true;
                    exp.patience = 2.0;
                    return false; // Break each()
                }
            } else {
                progress(exp, `Menu item '${menuitem}' does not match '${order_request}', skipping`);
            }
            return true; // Continue each()
        });
        if (!clicked) {
            enclick(exp, $order_menu[0], `Clicking order menu to put it away`);
        }
    };

    // Returns expand_cycle so cycle count can be consistent across popups
    const expand_comments = async function(exp) {
        var cycle_patience = 1.0;
        var expand_cycle = 0;
        var expand_count = true;
        const activity = [];
        const max_flails = 5;
        var expanders, prev_expanders = [];
        while (expand_count && exp.state == 'EXPAND' && !exp.popup_popped) {
            var my_patience = exp.patience;
            exp.patience = 0;
            expand_count = 0;
            if (-1 == await try_for(exp, cycle_patience + my_patience, function() {
                my_patience = 0;
                expanders = exp.$post.find(expander_selector).not(expander_rejector);
                if (expanders.length == 0 && expand_cycle > 2) {
                    // No expanders early can mean we're waiting for exposure or
                    // change of order.  Later it always means 'done' since the
                    // expander buttons stay present until their action is done.
                    return -1;
                }
                if (expanders.length == prev_expanders.length &&
                    (expanders.toArray().every((ex,idx) => ex == prev_expanders[idx]))) {
                        return 0; // Nothing changed
                }
                prev_expanders = expanders;
                return expanders.length;
            })) break;
            ++expand_cycle;
            show_stats(exp);
            progress(exp, `Cycle ${expand_cycle + exp.saved_cycles}, expanding: ${expanders.length} (${exp.comments} comments visible)`);
            for (const expander of expanders.toArray()) {
                if (exp.state == 'EXPAND' && expander.getRootNode() == document && enclick(exp, expander, '')) {
                    ++expand_count;
                    X(expander).addClass('sfx_clicked');
                    if (FX.option('navigator_watch')) {
                        expander.scrollIntoView(false);
                    }
                    if (exp.popup_popped) {
                        progress(exp, 'Popup popped up, restarting expansion');
                        return expand_cycle;
                    }
                    await X.sleep(0.1);
                }
            }
            show_stats(exp);
            activity[expand_cycle] = exp.comments + expand_count;
            // Go slower if nothing is happening; '50 more comments' takes a while, no point in hammering.
            if (activity[expand_cycle - 1] == activity[expand_cycle]) {
                cycle_patience = Math.min(cycle_patience + 0.5, 8.0);
            }
            // Give up completely if too many cycles have gone by with no changes.
            if (activity[expand_cycle - max_flails] == activity[expand_cycle]) {
                show_stats(exp, 'FB STALL', 'red');
                progress(exp, `cycle ${expand_cycle}, no activity in ${max_flails} cycles, stopping`);
                exp.color = 'green';
                progress(exp, `(you can use Expand Comments again to keep trying)`);
            }
        }
        return expand_cycle;
    };

    const expand_post = async function(dom_id) {
        var exp = {
            dom_id,
            start: performance.now(),
            $post: X('#' + dom_id),
            state: 'EXPAND',
            serial: exp_serial,
            patience: 0,
            clicks: 0,
            comments: 0,
            color: 'black',
            saved_cycles: 0,
        };
        exps[exp_serial++] = exp;
        display_expand(exp);
        do {
            exp.popup_popped = false;
            await expose_comments(exp);
            await choose_order(exp);
            exp.saved_cycles += await expand_comments(exp);
        } while (exp.popup_popped);
        if (exp.state == 'EXPAND') {
            progress(exp, show_stats(exp, 'DONE', 'green'));
        }
        exp.$note.find('.sfx_sticky_note_close').text('ESC to close');
        progress(exp, `ESC to close, or auto-close in ${FX.option('navigator_close_wait')} seconds`);
        exp.$post.find('.sfx_clicked').removeClass('sfx_clicked');
        if (exp.$orig_post) {
            exp.$orig_post.find('.sfx_clicked').removeClass('sfx_clicked');
        }
        if (FX.option('navigator_watch')) {
            exp.$post[0].scrollIntoView(true);
            setTimeout(() => window.scrollBy(0, -150));
        }
        X.sleep(FX.option('navigator_close_wait') || 0.5).then(function() {
            if (exp.$note.probe(':hover,:active,:focus').length) {
                show_stats(exp, 'WAIT', 'red');
                progress(exp, 'Wait for user interaction -- ESC to close');
            } else {
                exp_done(exp);
            }
        });
    };
});
