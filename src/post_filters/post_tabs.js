// =====================================
// Post Filter: Move/Copy To Tab
// =====================================
X.ready('post_tabs', function() {
    var tab_data = {};
    FX.add_option('always_show_tabs', {
        "section": "Advanced"
        , "title": "Always Show Tab List"
        , "description": "Always show the list of Tabs in the Control Panel, even if no posts have been moved to tabs yet."
        , "default": false
    });

    const visible_posts = tab => tab ? tab.post_count - tab.hide_count : 0;
    const normal_tab = name => name != 'All Posts' && name != '<Holding Tank>';
    const user_tab = name => normal_tab(name) && name != 'Filtered Feed';
    const select_first_occupied = (names, threshold) => names.find(name =>
        normal_tab(name) && visible_posts(tab_data.tabs[name]) >= threshold && (select_tab(tab_data.tabs[name]), true));

    // Post presence watcher:
    //
    // If we had posts loaded and then they disappeared, FB transitioned to
    // a different internal page.  Publish a 'posts/reset' signal so various
    // parts of SFx can reset.
    //
    // When the first post arrives on a newly reset page, try to decide which
    // post-tab to switch to.
    //
    // XXX This could dredge up a post which was hidden by something *else*,
    // like an ad blocker.  But hard to tell; getComputedStyle() won't help
    // since at the moment of evaluation *we* are potentially hiding the
    // post for not being in the current tab.
    var have_posts = false;
    const have_posts_watcher = function() {
        const have_posts_now = document.querySelector('[sfx_post]') != null;
        if (have_posts && !have_posts_now) {
            X.publish('posts/reset');  // FB cleared loaded posts
        }
        have_posts = have_posts_now;
        if (have_posts && tab_data.seek_initial) {         // Which tab should we start on?
            if (visible_posts(tab_data.selected_tab)) {        // The one we're already on?
                select_tab(tab_data.selected_tab);
            } else if (visible_posts(tab_data.tabs['Filtered Feed'])) {   // Filtered Feed?
                select_tab(tab_data.tabs['Filtered Feed']);
            } else {                                // First regular tab with visible posts
                select_first_occupied(tab_data.sorted(), 3);
            }
        }
    };
    const post_watcher_id = setInterval(have_posts_watcher, 0.5 * X.seconds);
    SFX.pose({ have_posts, have_posts_watcher, post_watcher_id, });

    const std_tabname = (name) => (typeof name == 'string' && name.length) ? name : '[nameless]';
    SFX.port({ std_tabname, }); // for post_filters.js

    // `always_show_tabs' means to show all static tab names at startup time;
    // otherwise, tabs are added when a post is first filtered to them.
    var tab_staticnames = [];
    const collect_static_tabs = function() {
        if (FX.option('filters_enabled') && FX.option('always_show_tabs')) {
            Object.values(FX.storage('filters') || []).forEach(filter =>
                X.isObject(filter) && filter.enabled && Object.values(filter.actions || []).forEach(action =>
                    X.isObject(action) &&
                    (action.action == "copy-to-tab" || action.action == "move-to-tab") &&
                    action.tab && !action.tab.match(/\$(\d+|\{[0-9a-z_:]+\})/) &&
                    SFX.pushy(tab_staticnames, std_tabname(action.tab))));
        }
    };
    collect_static_tabs();
    SFX.pose({ collect_static_tabs, tab_staticnames, });

    var tab_index, tabs_creating, tabs_created;
    const repopulate_tabs = function () {
        X('[class*=sfx_filter_tab_]').forEach(post => {
            post.classList.forEach(function(aClass) {
                if (/^sfx_filter_tab_(\d+)$/.test(aClass)) {
                    adj_counts(RegExp.$1, X(post), 1);
                }
            });
        });
    };
    SFX.pose({ repopulate_tabs, });
    const reset_tabs = function () {
        tab_data = {
            tab_count: 0, // tabs['name'].number counter
            tabs: {},     // .name        display name (and index within tabs{})
                          // .order       sorting name (a few are special and sort differently)
                          // .number      this tab's posts have CSS class 'sfx_filter_tab_%d'
                          // .selected    true if this is the selected tab
                          // .post_count  how many posts in this tab
                          // .read_count  how many of those are marked 'Read'
                          // .hide_count  how many are 'Read' or hidden by a filter
            selected_tab: null,   // points to the tab for which (tabs['name'].selected == true)
            seek_initial: true,   // have we figured out yet which tab to focus on?
            seek_permalink: true, // we'll refocus if a permalink post is received
            sorted: () => Object.keys(tab_data.tabs).sort((a, b) => (tab_data.tabs[a].order < tab_data.tabs[b].order) ? -1 : 1),
            cp_requested: false,  // Has tab creation asked to show the CP since this reset?
        };
        tab_index = [];   // maps tabs[tab_index[N]].number == N; tab_index[N] = tabs[tab_index[N]].name
        tabs_creating = false;
        tabs_created = false;
        have_posts = false;
        SFX.pose({ tab_data, tab_index, });
        if (FX.option('always_show_tabs')) {
            create_tab_container().then(() => X.publish('cp/always_show'));
        }
        repopulate_tabs();
    };

    const adj_counts = function (tabnum, $post, what) {
        const tab = tab_data.tabs[tab_index[tabnum]];
        if (!tab) {
            return X.support_note('adj_counts', `post ${$post[0].id} in unknown tab number ${tabnum}`);
        }

        // 'Read' & 'filtered' aren't tracked separately because then
        // 5 'Read' + 5 'filtered' in a tab could mean 5 posts which
        // are both -- or 5 of each.  We need to know how many are visible.
        //
        // A numeric 'what' means a new post: set both of its states.
        // 'R' and 'F' mean an existing post changed only one state.
        // Both can affect the 'hide' count, but only if not already hidden
        // for the other reason.  Only 'R' can change the 'Read' count.

        const is_read = $post[0].classList.contains('sfx_post_read');
        const is_filt = $post[0].classList.contains('sfx_filter_hidden');
        const num = /\d/.test(what);

        if (num)                         { tab.post_count += what; }
        if (num && is_read)              { tab.read_count += what; }
        if (num && (is_read || is_filt)) { tab.hide_count += what; }
        if (what == 'R')                 { tab.read_count += (is_read ? 1 : -1); }
        if (what == 'R' && !is_filt)     { tab.hide_count += (is_read ? 1 : -1); }
        if (what == 'F' && !is_read)     { tab.hide_count += (is_filt ? 1 : -1); }
    };

    // Update tab counts when a post is hidden/unhidden because user,
    // filter, or saved data change its 'Read' status
    X.subscribe(['post/hide_read', 'post/unhide_read'], function(msg, data) {
        const $post = data.$post;
        const is_read = (msg === 'post/hide_read');
        const message = `${is_read ? 'M' : 'Unm'}arked 'Read' by: ${data.actor}`;
        X.publish('log/postdata', { $post, message, });
        // If it's being marked 'Read' in a popup, keep it visible (with border / user styling)
        if (is_read && $post.hasClass('sfx_popup_post')) {
            X.publish('log/postdata', { $post, message: 'Keep visible since post is in comment viewer popup' });
            $post.addClass(' sfx_show_read');
        }
        $post[0].classList.forEach(function(aClass) {
            if (/^sfx_filter_tab_(\d+)$/.test(aClass)) {
                adj_counts(RegExp.$1, $post, 'R');
            }
        });
    });

    // Update tab counts when a post is hidden/unhidden because of filter action
    X.subscribe(['post/hide_filt', 'post/unhide_filt'], function(msg, data) {
        const message = `${msg == 'post/hide_filt' ? 'H' : 'Unh'}idden by: ${data.actor}`;
        X.publish('log/postdata', { $post: data.$post, message, });
        data.$post[0].classList.forEach(function(aClass) {
            if (/^sfx_filter_tab_(\d+)$/.test(aClass)) {
                adj_counts(RegExp.$1, data.$post, 'F');
            }
        });
    });

    const remove_from_tabs = function($post, opt = {}) {
        $post[0].classList.forEach(function(aClass) {
            // Don't remove from tab 0 'All Posts' unless specified
            if (/^sfx_filter_tab_(\d+)$/.test(aClass) && (Number(RegExp.$1) || opt.all_posts)) {
                adj_counts(RegExp.$1, $post, -1);
                $post.removeClass(aClass);
            }
        });
    };

    // Update tab counts when a post is removed from DOM by FB
    X.subscribe('post/remove_dom', function(msg, data) {
        X.publish('log/postdata', { $post: data.$post, message: 'Removed from DOM by FB', });
        remove_from_tabs(data.$post, { all_posts: true, });
    });

    // Move posts from <Holding Tank> to Filtered Feed if they didn't get moved elsewhere
    X.subscribe('post/filtered', function(msg, data) {
        if (data.$post.hasClass('sfx_filter_tab_1')) {
            data.$post.removeClass('sfx_filter_tab_1');
            adj_counts(1, data.$post, -1);
            add_to_tab('Filtered Feed', data.$post, 'Moved', 'end of filtering');
        }
        // Switch to the tab the first permalink post is filtered to
        if (tab_data.seek_permalink && data.$post.hasClass('sfx_permalink_post')) {
            tab_data.sorted().filter(name => normal_tab(name)).find(name => {
                if (data.$post.hasClass(`sfx_filter_tab_${tab_data.tabs[name].number}`)) {
                    tab_data.seek_permalink = false;
                    // We only need to switch if the proposed tab is not already selected;
                    // also don't need to switch if this post is already in the current tab.
                    // Without that test, we might needlessly switch between tabs in which
                    // this post resides, e.g. from a group-specific tab to 'Filtered Feed'.
                    if (name != tab_data.selected_tab.name &&
                        !data.$post.hasClass(`sfx_filter_tab_${tab_data.selected_tab.number}`)) {
                            select_tab(tab_data.tabs[name]);
                            X.publish('log/postdata', { $post: data.$post, message:
                                `Switched to tab '${name}' to expose this permalink post`, });
                    }
                    return true;
                }
            });
        }
    });

    SFX.selected_tab_selector = '';
    const select_tab = function(tab) {
        tab_data.seek_initial = false;
        if (tab_data.selected_tab != tab) {
            if (tab_data.selected_tab) {
                tab_data.selected_tab.selected = false;
            }
            tab_data.selected_tab = tab;
            tab.selected = true;
            SFX.selected_tab_selector = `.sfx_filter_tab_${tab.number}`;
            X.css(`[sfx_post]:not(.sfx_filter_tab_${tab.number}):not(.sfx_popup_post) { display: none; }`, 'sfx_filter_tabselect');
            X.publish('filter/tab/scroll_to_top');
        }
    };

    // 'Mark All Read - Next' moves circularly to next occupied tab (skipping All Posts & <Holding Tank>)
    X.subscribe("filter/tab/next", function (/* msg, data */) {
        const names = tab_data.sorted();
        const sdx = names.findIndex(name => tab_data.tabs[name].selected);
        select_first_occupied([...names.slice(sdx + 1), ...names.slice(0, sdx)], 1);
    });

    const create_tab_container_dom = function() {
        if (X.find(`.${SFX.instance} [id=sfx_cp_filter_tabs]`)) {
            return;
        }
        X.publish("cp/section/add", {
            "name": 'Filter Tabs <span class="sfx_count">(unread / total)</span>'
            , "id": "sfx_cp_filter_tabs"
            , "order": 50
            , "help": "The Filtered Feed shows the filtered view of the feed, with posts removed that have been moved to tabs.\n\nThe All Posts view shows every post in the feed, even if it has been filtered to a tab."
        });
        const html = FX.oneLineLtrim(`
            <div class="sfx_cp_tabs" style="max-height:60vh;overflow:auto;">
                <div v-for="tab in tabs | orderBy 'order'" v-if="tab.name!='<Holding Tank>'" class="sfx_filter_tab" v-bind:class="{'sfx_tab_selected':tab.selected,'sfx_tab_occupied':(tab.post_count>tab.read_count)}" @click="select_tab(tab)">
                    {{tab.name}}&#32;
                    <span class="sfx_count">
                        (
                        <span class="sfx_unread_count" v-if="tab.read_count>0">
                            {{tab.post_count-tab.read_count}}/
                        </span>
                        {{tab.post_count}})
                    </span>
                </div>
            </div>
        `);
        const methods = {
            select_tab,
        };
        // Wait until the section is added before adding the content
        X.when(`.${SFX.instance} [id=sfx_cp_filter_tabs]`, function() {
            // Tabs subsection might already exist
            if (!X.find(`.${SFX.instance} .sfx_cp_tabs`)) {
                    template(`.${SFX.instance} [id=sfx_cp_filter_tabs]`, html, tab_data, methods);
            }
        });
    };

    var pending_create, pending_resolve;

    const create_tab_container = async function() {
        if (!pending_create) {
            // We Promise to call 'resolve' later, which we stash in 'pending_resolve'
            pending_create = new Promise(resolve => (pending_resolve = resolve));
        }
        if (tabs_creating) {
            // All callers but the first just immediately get the Promise
            return pending_create;
        }
        tabs_creating = true;
        create_tab_container_dom();
        X.when(`.${SFX.instance} [id=sfx_cp_filter_tabs]`, function() {
            // the tab container has been created: create initial tabs
            create_tab('All Posts', 'a');
            create_tab('<Holding Tank>', 'b');
            select_tab(create_tab('Filtered Feed', 'c'));
            tab_data.seek_initial = true;
            tab_staticnames.forEach(name => create_tab(name));
            tabs_created = true;
            // and inform any who are waiting for the promised container
            pending_resolve && pending_resolve();
            tabs_creating = pending_create = pending_resolve = null;
        });
    };

    const create_tab = function(tabname, letter) {
        tabname = std_tabname(tabname);
        if (!tab_data.tabs[tabname]) {
            const number = tab_data.tab_count++;
            // Sort special tabs to the top
            const order = `${letter || 'z'}-${tabname}`;
            Vue.set(tab_data.tabs, tabname, { name: tabname, order, number, selected: false, post_count: 0, read_count: 0, hide_count: 0, });
            tab_index[number] = tabname;
            if (!tab_data.cp_requested && user_tab(tabname)) {
                tab_data.cp_requested = true;
                X.publish('cp/show');
            }
        }
        return tab_data.tabs[tabname];
    };

    const add_to_tab = function(tabname, $post, action, actor) {
        if (!tabs_created) {
            // Recursive call will be invoked when the container is created
            create_tab_container().then(() => add_to_tab(tabname, $post, action, actor));
            return;
        }
        const tab = create_tab(tabname);
        const tabClass = 'sfx_filter_tab_' + tab.number;
        if (!$post.hasClass(tabClass)) {
            $post.addClass(tabClass);
            adj_counts(tab.number, $post, 1);
            X.publish('log/postdata', { $post, message: `${action} to tab '${tabname}' by: ${actor}` });
        }
    };

    // Service for ourselves and others: scroll to first visible post in visible tab
    X.subscribe('filter/tab/scroll_to_top', function ( /* msg, data */ ) {
        X(SFX.selected_tab_selector).each(function( /* this */ ) {
            if (this.getBoundingClientRect().height) {
                this.scrollIntoView(true);
                setTimeout(() => window.scrollBy(0, -150), 0.2 * X.seconds);
                return false;
            }
        });
    });

    // When a post is filtered into a new tab, move it
    X.subscribe(["filter/tab/move", "filter/tab/copy"], function (msg, data) {
        var action = 'Copied';
        if (msg == "filter/tab/move") {
            remove_from_tabs(data.post);
            action = 'Moved';
        }
        add_to_tab(data.tab, data.post, action, data.actor);
    });

    // When a post is first added, it belongs to 'All Posts' and '<Holding Tank>'
    // Add to 'All Posts' last, as it controls when to start filtering
    X.subscribe_backlog('post/add', function (msg, data) {
        const $post = data.$post;
        add_to_tab('<Holding Tank>', $post, 'Added', 'initial post processing');
        add_to_tab('All Posts', $post, 'Added', 'initial post processing');
    });

    X.subscribe_backlog('posts/reset', reset_tabs);
    reset_tabs();
});
