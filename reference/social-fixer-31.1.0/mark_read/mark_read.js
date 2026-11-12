// =========================================================
// Add Post Action Icons, including Mark Read
// =========================================================
X.ready( 'mark_read', function() {
    FX.add_option('post_actions', {"title": 'Post Actions', "description": "Add actions to individual posts to Mark them as 'Read', etc.", "default": true});
    FX.add_option('show_mark_all_read', {"title": 'Mark All Read/Undo', "description": "Add a Mark All Read button and Undo button to the control panel to Mark all visible posts as 'Read' or undo Marking posts as 'Read'.", "default": false});
    FX.add_option('mark_all_read_next', {"section": "Advanced", "title": 'Mark All Read - Next', "description": "When Mark All Read is clicked and filter tabs are visible, automatically jump to the next tab with unread stories.", "default": true});
    FX.add_option('clear_cache', {"title": 'Clear "Mark Read" Story Data', "section": "Advanced", "description": "Clear all cached data about posts' 'Read' status. This will un-Mark all 'Read' posts!", "type": "action", "action_text": "Clear Data Now", "action_message": "cache/clear"});
    FX.add_option('clean_cache_frequency', {"title": '"Mark Read" Cache Cleaning Frequency', "section": "Advanced", "description": "Clean the cache of old story data every how many hours?", "type": "number", "default": 24});
    FX.add_option('clean_cache_age', {"title": '"Mark Read" Cache Cleaning Age', "section": "Advanced", "description": "When cleaning cached story data, clean post data that is this many days old.", "type": "number", "default": 28});
    FX.add_option('hide_mark_read_groups', {title: 'Mark Read', description: "Hide posts Marked as 'Read' when viewing Groups.", default: true});
    FX.add_option('hide_mark_read_pages', {title: 'Mark Read', description: "Hide posts Marked as 'Read' when viewing a Page or Timeline.", default: true});
    FX.add_option('mark_read_display_message', {title: 'Mark Read', description: "Show a note in place of posts hidden because they were Marked as 'Read'.", default: true});
    FX.add_option('mark_read_style', {section: 'Advanced', title: 'Mark Read Style', description: "CSS style to be applied to posts that are Marked as 'Read'.", type: 'text', default: 'outline:2px dashed red;', live: style => X.css(`.sfx_post_read > :not(.sfx_read_note) { ${style} }`, 'sfx_mark_read_css')});

    (function () {
        var postdata_log = {}; // Keyed by DOM id!
        SFX.pose({ postdata_log, });
        var postdata_reset_time = performance.now();
        const x_log = X.logger('postdata');
        const postdata_trace = function (id, message) {
            const t1 = performance.now();
            var t0 = postdata_log[id] ? postdata_log[id][0] : t1;
            if (!postdata_log[id] || t0 < postdata_reset_time) {
                t0 = t1;
                postdata_log[id] = [t0];
                postdata_trace(id, `Post log starts at page time ${(t0 / X.seconds).toFixed(6)}`);
            }
            postdata_log[id].push(((t1 - t0) / X.seconds).toFixed(6) + ' ' + message);
        };
        X.subscribe("log/postdata", function (msg, data) {
            const id = data.id || (data.$post ? `sfx_post_${data.$post.attr('sfx_post')}` : null);
            if (id) {
                postdata_trace(id, data.message);
            } else {
                x_log(`log from unknown post: '${data.message}'`);
            }
        });
        X.subscribe("log/postdata/get", function (msg, data) {
            if (typeof data.callback != "function") {
                return;
            }
            data.callback(postdata_log[data.id]);
        });
        X.subscribe_backlog('posts/reset', () => (postdata_reset_time = performance.now()));
    })();

    // Clear Cache
    X.subscribe("cache/clear", function (/* msg, data */) {
        X.storage.save("postdata", {}, function () {
            alert("Social Fixer: the list of 'Read' posts has been cleared");
        });
    });
    FX.on_options_load(function () {
        if (!FX.option('post_actions')) {
            return;
        }

        // Add an option to the wrench menu to toggle stories marked as read
        const menu_item = {html: "Show posts Marked as 'Read'", message: 'post/toggle_read_posts', tooltip: "Make posts which are Marked as 'Read' temporarily visible."};
        X.publish("menu/add", {"section": "actions", "item": menu_item});

        var show_read = false;
        X.subscribe("post/toggle_read_posts", function () {
            show_read = !show_read;
            menu_item.html = show_read ? "Hide posts Marked as 'Read'" : "Show posts Marked as 'Read'";
            X('.sfx_show_read').removeClass('sfx_show_read');
            if (!FX.option('mark_read_display_message')) {
                X('.sfx_read_note').remove();
            }
            X('html').toggleClass('sfx_hide_read', !show_read);
            FX.reflow();
        });
        X.subscribe_backlog('posts/reset', () => X('html').addClass('sfx_hide_read'));

        // Logic to handle post actions
        var postdata = FX.storage('postdata') || {};
        SFX.pose({ postdata, });

        // post_id must be a non-zero integer (trailing ':digits' stripped elsewhere)
        var legit_post_id = (post_id) => /^-?[1-9][0-9]*$|^pfbid0[1-9A-HJ-NP-Za-km-z]{20,75}l$/.test(post_id);

        // read_on is a date stamp: must be just digits
        // (could also check for plausible time range?)
        var legit_read_on = (read_on) => /^[0-9]+$/.test(read_on);

        // On a regular interval, clean out the postdata cache of old post data
        // Also do other data cleansing tasks here
        X.task('clean_postdata_cache', FX.option('clean_cache_frequency') * X.hours, function () {
            var post_id, cleaned_count = 0;
            if (!postdata) {
                return;
            }
            for (post_id in postdata) {
                var data = postdata[post_id];
                var read_on = data.read_on;
                var age = X.now() - read_on;
                var clean_me = 0;
                // Purge old items
                if (age > FX.option('clean_cache_age') * X.days) {
                    clean_me = 1;
                }
                if (!legit_post_id(post_id)) {
                    clean_me = 1;
                }
                if (!legit_read_on(data.read_on)) {
                    clean_me = 1;
                }
                // Left over from 742eb642d241b4521a79139a5146dc3205a3c83b
                if (data.last_updated) {
                    delete postdata[post_id].last_updated;
                    cleaned_count++;
                }
                if (clean_me) {
                    delete postdata[post_id];
                    cleaned_count++;
                }
            }
            // Save the postdata back to storage
            if (cleaned_count > 0) {
                X.storage.save("postdata", postdata);
            }
        });

        var init_postdata = function (id) {
            if (typeof postdata[id] == "undefined") {
                postdata[id] = {};
            }
            return postdata[id];
        };

        var mark_all_added = false;

        FX.on_content_loaded(function () {
            var action_data = {
                id: null,
                sfx_id: 'no-ID',
                $post: null,
                show: 'mark',
                filters_enabled: FX.option('filters_enabled'),
                wrench_items: [],
                filter_items: []
            };
            var actions = {
                "mark_unmark": function (e) {
                    var data = {"sfx_id": action_data.sfx_id};
                    data.dir = e.shiftKey ? "above"
                             : e.ctrlKey || e.altKey || e.metaKey ? "below"
                             : "post";
                    X.publish("post/mark_unmark", data);
                }
                , "action_menu_click": function (item) {
                    var key, data = {"id": action_data.id, "sfx_id": action_data.sfx_id};
                    if (item.data) {
                        for (key in item.data) {
                            data[key] = item.data[key];
                        }
                    }
                    X.publish(item.message, data);
                }
            };
            var html = FX.oneLineLtrim(`
            <div id="sfx_post_action_tray_container" class="${SFX.instance}" sfx_pai="pai_counter">
                <div id="sfx_post_action_tray">
                    <div v-if="show == 'mark'"   @click="mark_unmark($event)" class="mark_read_markit" v-tooltip="Social Fixer: Mark this post as 'Read', so it doesn't appear in your feed anymore. Shift+Click Marks as 'Read' all posts above here; ${SFX.Ctrl}+Click Marks here and below"></div>
                    <div v-if="show == 'temp'"   @click="mark_unmark($event)" class="mark_read_nomark" v-tooltip="Social Fixer: Temporarily hide this post (it may return on reload, as its Facebook post ID was not found)"></div>
                    <div v-if="show == 'unmark'" @click="mark_unmark($event)" class="mark_read_unmark" v-tooltip="Social Fixer: Un-Mark this post as 'Read', so it may show up in your feed again">X</div>
                    <div v-if="show == 'utmark'" @click="mark_unmark($event)" class="mark_read_unmark" v-tooltip="Social Fixer: Unhide this temporarily hidden post">X</div>
                    <div v-if="wrench_items.length>0" id="sfx_mark_read_wrench" class="mark_read_wrench" v-tooltip="Social Fixer: Post Actions"></div>
                    <div v-if="filter_items.length>0" id="sfx_mark_read_filter" class="mark_read_filter" v-tooltip="Social Fixer: Filtering"></div>
                </div>
                <div v-if="wrench_items.length>0" id="sfx_post_wrench_menu" class="sfx_post_action_menu">
                    <div v-for="item in wrench_items | orderBy 'order'" @click="action_menu_click(item)">{{item.label}}</div>
                </div>
                <div v-if="filter_items.length>0" id="sfx_post_filter_menu" class="sfx_post_action_menu">
                    <div v-for="item in filter_items | orderBy 'order'" @click="action_menu_click(item)">{{item.label}}</div>
                </div>
            </div>
            `);

            var undo = {
                posts_marked_read: []
            };
            // Make the post not visible, and increment tab 'Read' counts
            var hide_read_one = function ($post, actor) {
                if (!$post.hasClass('sfx_post_read')) {
                    if ((FX.context.type == 'groups' && !FX.option('hide_mark_read_groups')) ||
                        (FX.context.type == 'profile' && !FX.option('hide_mark_read_pages'))) {
                        return;
                    }
                    const messages = FX.option('mark_read_display_message');
                    const forced = !messages && $post.is('.sfx_once');
                    if (messages || forced) {
                        const author = SFX.filter_extract_field.author($post, {}) || '<unknown>';
                        var tooltip = '';
                        if (!FX.option('disable_tooltips')) {
                            const aside = forced
                                ? "It is visible here because this page's address mentions it"
                                : 'To remove these Read-post notes, see Options > General > Mark Read';
                            tooltip = ` title="This post may be hidden because it is Marked as 'Read'. Click to toggle visibility. (${aside})"`;
                        }
                        const $note = X(FX.oneLineLtrim(`
                            <div class='sfx_read_note'${tooltip}>
                                <span class='sfx_read_show'>Click to view 'Read' post by ${author}</span>
                                <span class='sfx_read_hide'>Click to hide 'Read' post by ${author}</span>
                            </div>
                        `));
                        $note.click(function() {
                            $post.toggleClass('sfx_show_read');
                            if (forced) {
                                $note.remove();
                            }
                        });
                        $post.removeClass('sfx_once').prepend($note);
                    }
                    $post.addClass('sfx_post_read');
                    X.publish('post/hide_read', { id: $post[0].id, $post, actor, });
                }
            };
            var hide_read = function ($post, actor) {
                // Loop since FB's feed sometimes burps out multiple copies of the same post.
                // Can't loop for no-ID posts as they are unrelated.
                const sfx_id = $post.attr('sfx_id');
                if (legit_post_id(sfx_id)) {
                    $post.hasClass('sfx_post_read') || X(`[sfx_id="${$post.attr('sfx_id')}"]`).forEach(post => {
                        hide_read_one(X(post), actor);
                    });
                } else {
                    hide_read_one($post, actor);
                }
            };
            // Make the post visible, and decrement tab 'Read' counts
            var unhide_read_one = function ($post, actor) {
                if ($post.hasClass('sfx_post_read')) {
                    $post.removeClass('sfx_post_read sfx_show_read');
                    $post.find('.sfx_read_note').remove();
                    X.publish('post/unhide_read', { id: $post[0].id, $post, actor, });
                }
            };
            var unhide_read = function ($post, actor) {
                // Loop since FB's feed sometimes burps out multiple copies of the same post.
                // Can't loop for no-ID posts as they are unrelated.
                const sfx_id = $post.attr('sfx_id');
                if (legit_post_id(sfx_id)) {
                    $post.hasClass('sfx_post_read') && X(`[sfx_id="${$post.attr('sfx_id')}"]`).forEach(post => {
                        unhide_read_one(X(post), actor);
                    });
                } else {
                    unhide_read_one($post, actor);
                }
            };
            const actors = {
                post:  'user click',
                all:   'Mark All Read',
                above: 'Mark All Read Above (Shift+Click)',
                below: `Mark All Read Below (${SFX.Ctrl}+Click)`,
                undo:  'Undo',
            };
            // Receive change of post 'Read' status: save whether it is now 'Read',
            // control visibility, and adjust tab counts
            X.subscribe(['post/mark_read','post/mark_unread'], function (msg, data) {
                const marking = (msg == 'post/mark_read');
                const $post = data.post || action_data.$post;
                if (marking == $post.hasClass('sfx_post_read')) {
                    return;
                }
                const sfx_id = data.sfx_id;
                const legit = legit_post_id(sfx_id);

                if (!data.filter) {
                    undo.posts_marked_read = [$post];
                    undo.mark = !marking;
                }

                if (legit) {
                    var pdata = init_postdata(sfx_id);
                    if (marking) {
                        pdata.read_on = X.now();
                        postdata[sfx_id] = pdata;
                    } else {
                        delete pdata.read_on;
                    }
                    X.storage.set('postdata', sfx_id, pdata, null, false !== data.save);
                } else if (marking) {
                    X.publish('log/postdata', { $post, message: `Marking [${$post[0].id}] temporarily read`, });
                }
                if (actors[data.actor || 'post']) data.actor = actors[data.actor || 'post'];
                (marking ? hide_read : unhide_read)($post, data.actor);
                update_action_tray($post);
                FX.reflow();
            });
            // Receive change of multiple posts' 'Read' statuses (all user-click
            // actions): save new 'Read' status, adjust visibility & tab counts
            X.subscribe(["post/mark_all_read", "post/mark_unmark"], function (msg, data) {
                if (typeof data.dir == "undefined") {
                    data.dir = "all";
                }
                var $curr_post = data.post || action_data.$post;
                var mark = (data.dir == "all") || !$curr_post || !$curr_post.hasClass('sfx_post_read');
                data.actor = data.dir;
                if (data.dir == "post") {
                    const sfx_id = $curr_post.attr('sfx_id');
                    const legit = legit_post_id(sfx_id);
                    const is_read = (legit && postdata[sfx_id] && postdata[sfx_id].read_on) ||
                                    (!legit && $curr_post.hasClass('sfx_post_read'));
                    X.publish(is_read ? 'post/mark_unread' : 'post/mark_read', data);
                    return;
                }
                var marked = 0;
                var not_marked = 0;
                var marking = (data.dir == "all" || data.dir == "above");
                var unmark_one = false;
                var posts = [];
                var pivot_post = $curr_post ? +$curr_post.attr('sfx_post') : null;
                if ($curr_post && data.dir == "above") {
                    // Any existing selection gets extended by shift-click,
                    // then distorted by hiding & reflow; just abolish it:
                    window.getSelection().removeAllRanges();
                    // and get the post we were on back onscreen:
                    setTimeout(function () {
                        $curr_post[0].scrollIntoView();
                    }, 0.15 * X.seconds);
                }
                X(SFX.selected_tab_selector).each(function () {
                    var $post = X(this);
                    var this_post = +$post.attr('sfx_post');
                    if (this_post == pivot_post) {
                        if (data.dir == "above") {
                            // Mark Read Above excludes the current post
                            marking = false;
                            // Must be on a 'Read' post to invoke Unmark,
                            // so it *includes* current post
                            if (!mark) {
                                unmark_one = true;
                            }
                        }
                        else if (data.dir == "below") {
                            // Mark Read Below includes the current post
                            marking = true;
                        }
                    }
                    if (!marking && !unmark_one) {
                        not_marked++;
                        return;
                    }
                    unmark_one = false;
                    if (mark != $post.hasClass('sfx_post_read')) {
                        posts.push($post);
                        var pub_msg = mark ? "post/mark_read" : "post/mark_unread";
                        var pub_data = {
                            sfx_id: $post.attr('sfx_id'),
                            save: false, // Don't persist until the end
                            post: $post,
                            actor: data.actor,
                        };
                        X.publish(pub_msg, pub_data);
                        marked++;
                    }
                });
                if (marked > 0) {
                    X.storage.save("postdata");
                    undo.posts_marked_read = posts;
                    undo.mark = !mark;
                    if (data.dir == "above" && !show_read) {
                        X.publish('filter/tab/scroll_to_top');
                    }
                }
                if (mark && not_marked == 0 && FX.option('mark_all_read_next')) {
                    X.publish("filter/tab/next");
                }
            });
            X.subscribe("post/undo_mark_read", function (/* msg, data */) {
                if (undo.posts_marked_read.length > 0) {
                    var undo_msg = undo.mark ? "post/mark_read" : "post/mark_unread";
                    undo.posts_marked_read.forEach(function ($post) {
                        var sfx_id = $post.attr('sfx_id');
                        X.publish(undo_msg, { sfx_id, save: false, post: $post, actor: 'undo', });
                    });
                    X.storage.save("postdata");
                    undo.posts_marked_read = [];
                    FX.reflow();
                }
                else {
                    alert("Nothing to Undo!");
                }
            });

            const pai_submenus = [
                { name: 'filter', },
                { name: 'wrench', },
            ];
            const hide_pai_submenus =
                () => pai_submenus.forEach(
                    sm => sm.shown && X(`.${SFX.instance} [id=sfx_post_${sm.name}_menu]`).hide((sm.shown = false))
                );
            SFX.pai_counter = 0;
            const add_post_action_tray = function ($post) {
                var tray;
                if ((tray = $post.find(`[id=sfx_post_action_tray_container].${SFX.instance}`)).length) {
                    return tray;
                }
                template(document.body, html.replace(/pai_counter/, ++SFX.pai_counter), action_data, actions);
                X(`[id=sfx_post_action_tray_container].${SFX.instance}:not([sfx_pai="${SFX.pai_counter}"])`).remove();
                pai_submenus.forEach(function (sm) {
                    X(`#sfx_mark_read_${sm.name}`).click(function(ev) {
                        ev.stopPropagation();
                        hide_pai_submenus();
                        X(`.${SFX.instance} [id=sfx_post_${sm.name}_menu]`).css('right', 50 - ev.offsetX + 'px')
                                    .css('top', 5 + ev.offsetY + 'px')
                                    .show((sm.shown = true));
                    });
                });
                return X(`[id=sfx_post_action_tray_container].${SFX.instance}`);
            };
            X(window).click(hide_pai_submenus);

            var move_action_tray_to_post = function ($post) {
                action_data.$post = $post;
                action_data.id = $post[0].id;
                const sfx_id = $post.attr('sfx_id');
                action_data.sfx_id = sfx_id;
                const legit = legit_post_id(sfx_id);
                const is_read = (legit && postdata[sfx_id] && postdata[sfx_id].read_on) ||
                                (!legit && $post.hasClass('sfx_post_read'));
                action_data.show = is_read && legit ? 'unmark' : is_read ? 'utmark' : legit ? 'mark' : 'temp';
                const tray = add_post_action_tray($post);
                hide_pai_submenus();
                if (FX.context.type == 'marketplace') {
                    // Marketplace 'posts' are fairly different
                    $post.prepend(tray);
                } else {
                    // Appending to a regular post's top level sometimes ends up mis-placed;
                    // its child works better, but we must skip children which we added
                    // (like 'post is hidden') for proper PAI placement.
                    var $append_to = $post.children().filter(function() {
                        return !SFX.is_sfx_element(this);
                    });
                    if (!$append_to.length) {
                        $append_to = $post.children();
                    }
                    $append_to.first().append(tray);
                }
            };
            SFX.pose({ move_action_tray_to_post, });

            // Change action tray checkmark-vs-X & tooltip
            // when the state of the post it's on changes;
            // or if it's the first post to wear the tray.
            var update_action_tray = function ($post) {
                if (action_data.id == null || action_data.id == $post[0].id) {
                    move_action_tray_to_post($post);
                }
            };

            var page_permalinks = [];
            var page_permalinks_only = false;
            const permalink_regex = /(?:fbid|permalink|multi_permalinks|posts|video|stories|marketplace\/item|view=permalink.*&id)[=/]([\d,]{6,})/;
            const detect_permalinks = function() {
                const matches = decodeURIComponent(window.location.href).match(permalink_regex);
                page_permalinks = (matches ? matches[1] : '').split(',');
                page_permalinks_only = /\/pfbid0/.test(window.location.pathname);
                SFX.pose({ page_permalinks, permalink_regex, detect_permalinks, });
            };
            X.subscribe_backlog('posts/reset', detect_permalinks);

            // Tag and record permalink posts, log who did it, and inform FX.context of changes
            X.subscribe('post/permalink', function (msg, data) {
                if (!data.$post.hasClass('sfx_permalink_post')) {
                    data.$post.addClass('sfx_permalink_post');
                    X.publish('log/postdata', { id: data.id, $post: data.$post, message: `Marked as permalink by ${data.actor}` });
                    if (!page_permalinks.includes(data.sfx_id)) {
                        page_permalinks.push(data.sfx_id);
                    }
                }
                if (!FX.context.permalink) {
                    FX.context.permalink = true;
                    X.publish('context/changed');
                }
            });

            // As posts arrive, tag those which saved data indicates are 'Read',
            // adjust tab 'Read' counts, tag permalinks, and add PAI triggering
            X.subscribe_backlog('post/add', function (msg, data) {
                const $post = data.$post;
                const sfx_id = data.sfx_id;
                var classes = 'sfx_mr_checked';

                // Tag all permalink target posts
                if (page_permalinks_only || page_permalinks.includes(sfx_id)) {
                    X.publish('post/permalink', { $post, id: '', sfx_id, actor: 'mark_read', });
                }
                // If it's already read, hide it
                if (legit_post_id(sfx_id) && postdata[sfx_id] && postdata[sfx_id].read_on) {
                    const is_popup = $post.hasClass('sfx_popup_post');
                    X.publish('log/postdata', {$post, message: `Post ID=${sfx_id} was read on ${postdata[sfx_id].read_on}`});
                    // If it's the target of a permalink or in a popup, show it (with border / user styling)
                    if (is_popup || page_permalinks_only || page_permalinks.includes(sfx_id)) {
                        X.publish('log/postdata', { $post, message:
                            is_popup ? 'Post is in comment viewer popup'
                                     : 'Post named in permalink: make initially visible'
                        });
                        classes += ' sfx_once sfx_show_read';
                    }
                    hide_read($post, 'previous user action');
                }
                $post.addClass(classes);
                // Tray has the wrong checkmark if moused over before ID resolved
                update_action_tray($post);

                // When the mouse moves over the post, add the post action tray
                $post.on('mouseenter', function (e) {
                    // Don't add it if it's already present.
                    // Also allow user control: adding PAI can be slow with
                    // many posts loaded.
                    // Not Shift- or Ctrl- as those are mark-all-above/below
                    // and might well be pressed 'on descent into' a post's
                    // prospective PAI.
                    if (e.altKey || e.metaKey || e.sfx_event || action_data.$post[0] == $post[0]) {
                        return;
                    }
                    move_action_tray_to_post($post);
                });
            });

            // Add the "Mark All Read" button to the control panel if necessary
            const add_mark_all = function () {
                if (!mark_all_added && FX.option('show_mark_all_read')) {
                    X.publish('cp/always_show');
                    mark_all_added = true;
                    X.publish("cp/section/add", {
                        "name": "Post Controller"
                        , "order": 10
                        , "id": "sfx_cp_post_controller"
                        , "help": "Act on all visible posts at once"
                    });
                    // Wait until that has been rendered before attaching to it
                    Vue.nextTick(function () {
                        // The content container will have been created by now
                        if (!X.find(`.${SFX.instance} [id=sfx_cp_post_controller]`)) {
                            // Unless CP isn't being displayed at all...
                            mark_all_added = false;
                            return;
                        }
                        var html = FX.oneLineLtrim(`
                            <div class="sfx_cp_mark_all_read" style="text-align:center;">
                                <input type="button" class="sfx_button" value="Mark All Read" @click="mark_all_read">
                                <input type="button" class="sfx_button" v-bind:disabled="!undo.posts_marked_read" value="Undo ({{posts_marked_read.length}})" @click="undo_mark_read">
                            </div>`);
                        var methods = {
                            mark_all_read: () => X.publish('post/mark_all_read'),
                            undo_mark_read: () => X.publish('post/undo_mark_read'),
                        };
                        template(`.${SFX.instance} [id=sfx_cp_post_controller]`, html, undo, methods);
                    });
                }
            };
            X.subscribe_backlog('posts/reset', (() => ((mark_all_added = false), add_mark_all())));
            add_mark_all();

            X.subscribe_backlog('post/action/add', function (msg, data) {
                if (data.section == "wrench") {
                    action_data.wrench_items.push(data);
                }
                else if (data.section == "filter") {
                    action_data.filter_items.push(data);
                }
            });

            X.publish('post/action/add', {"section": "wrench", "label": "Post Data", order: 40, "message": "post/action/postdata"});
            X.subscribe('post/action/postdata', function (msg, data) {
                var log = [];
                X.publish("log/postdata/get", {
                    "id": data.id, "callback": function (pdata) {
                        log = pdata;
                    }
                });
                log = log.slice(1).map(str => X.htmlEncode(str)).join('<br>');
                const data_content = (legit_post_id(data.sfx_id) && postdata[data.sfx_id]) ?
                                     JSON.stringify(postdata[data.sfx_id], null, 3) : '{}';
                const content = FX.oneLineLtrim(`
                    <div>This popup shows what Social Fixer remembers about this post.</div>
                    <div class="sfx_bubble_note_data">Post ID: ${data.sfx_id}<br>DOM ID: ${data.id}</div>
                    <div>Data stored for this post:</div>
                    <div class="sfx_bubble_note_data">${data_content}</div>
                    <div>Processing Log:</div>
                    <div class="sfx_bubble_note_data">${log}</div>
                `);
                // Remove the previous one, if it exists
                X('[id=sfx_post_data_bubble]').remove();
                bubble_note(content, {"position": "top_right", "title": "Post Data", "id": "sfx_post_data_bubble", "close": true});
            });
        });
    });
});
