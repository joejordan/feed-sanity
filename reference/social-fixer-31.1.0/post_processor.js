X.ready('post_processor', async function() {
    const theater_mode_comments_selector = [
        '.S2F_fldr_col [role=main] ~ [role=complementary].S2F_bg_surf > .S2F_just_spbt',
    ].join(',');
    const new_post_selector = [
        '[role=article]:not(.S2F_pos_rel)',
        // News Feed posts with [aria-posinset]:
        '[aria-posinset]',
        // News Feed posts without [aria-posinset]:
        'div[aria-describedby].S2F_outl_none:not(.S2F_disp_infl):not(.S2F_zi_0):not(.S2F_pos_rel)',
        // 'Reels' permalink posts:
        'div.S2F_disp_flex.S2F_fldr_row.S2F_pos_rel.S2F_hei_100.S2F_alini_cent.S2F_just_cent',
        // 'Theater mode' comments:
        theater_mode_comments_selector,
    ].join(',');
    const popup_contained_post_selector = [
        '[class*="-mode"].S2F_pos_rel [aria-labelledby] *',
    ].join(',');
    const popup_post_container_selector = [
        '[aria-labelledby]',
    ].join(',');
    const new_post_verifier = 'a[aria-label]';
    const mkt_post_selector = [
        '[data-pagelet*=Marketplace] .S2F_disp_cont .S2F_vis_vis.S2F_flex_shr1.S2F_flex_0px[style*=width]',
        '.S2F_alinc_flst.S2F_fldr_row.S2F_just_flst.S2F_flex_wrap > .S2F_vis_vis.S2F_flex_shr1.S2F_flex_0px[style*=width]',
    ].join(',');
    const mkt_post_verifier = 'a[role=link]';
    const old_post_selector = '[sfx_post]';

    var pending_reset_check = true;
    var log = X.logger('post_processor');

    var sfx_post_id = 1;
    var max_posts = 10;
    var post_count = 0;

    FX.add_option('max_post_load_count', {
        section: 'Advanced',
        title: 'Post Loading Pause',
        description: 'How many posts to load before pausing.  To save memory, Facebook clears posts from the top of the page as you scroll down.  Pausing allows you to view posts in Social Fixer filter tabs before they get cleared.',
        type: 'text',
        default: max_posts,
        live: (val) => (max_posts = val || max_posts)
    });

    // When the page is first loaded, scan it for posts that exist as part of the static content
    // and also watch for new nodes to be installed
    FX.on_content_loaded(function () {
        // Notice and handle removed posts
        FX.on_content_removed(function ($dom) {
            $dom.probe('[sfx_post]:not(.sfx_removing)').forEach(post =>
                X.publish('post/remove_dom', { id: post.id, sfx_id: post.getAttribute('sfx_id'), $post: X(post).addClass('sfx_removing'), })
            );
        });
        // Find and handle inserted posts
        FX.on_content_inserted(function (o) {
            // If the inserted node lives within a <form> then it's in
            // the reaction part of the post, we don't need to re-process
            if (o.closest('form').length) {
                return;
            }
            find_and_process_posts(o);
        });
        // is there a race condition between startup of the above watcher, and this whole-doc scan?
        find_and_process_posts(X(document.body));
    });

    const do_reset_check = function() {
        if (pending_reset_check) {
            if (X(old_post_selector).length == 0) {
                post_count = 0;
                sfx_post_id = 1;
                X.pubsub_clear_backlog('post/add');
                X.pubsub_clear_backlog('posts/reset');
                X.publish('posts/reset');
            }
            pending_reset_check = false;
        }
    };

    var post_selector = new_post_selector, post_verifier = new_post_verifier;
    X.subscribe_backlog('context/ready', function() {
        if (FX.context.type == 'marketplace') {
            post_selector = mkt_post_selector;
            post_verifier = mkt_post_verifier;
        } else {
            post_selector = new_post_selector;
            post_verifier = new_post_verifier;
        }
        find_and_process_posts(X(document.body));
    });

    const sanity = function() {
        const $post = X(this);
        // Don't re-add posts we've already added!
        if ($post.is(old_post_selector)) {
            return false;
        }
        // If the post has an aria-posinset attribute, we know it's legit
        if ($post.attr('aria-posinset')) {
            return true;
        }
        // If it has a parent post, this is a comment or embedded article
        if ($post.parents('[sfx_post],[aria-posinset],[role=article]').length) {
            return false;
        }
        // Don't let the empty 'loading' posts in the News Feed trick us
        if (!this.textContent && $post.find('[role=progressbar]').length) {
            return false;
        }
        // Reconfirm with page-type-specific verifier
        return !!this.querySelector(post_verifier);
    };

    // This allows us to get our bearings in the late-2022 / early-2023
    // 'new, degraded' post comments popup.  It might later be used for
    // other similar things.
    const find_post_root = function(post) {
        const $post = X(post);
        if ($post.is(popup_contained_post_selector)) {
            const $popup = $post.nearby(popup_post_container_selector);
            $popup.addClass('sfx_popup_post');
            return $popup[0];
        }
        return post;
    };

    // Find and identify posts within any DOM element
    // This is fired at document load, and any time content is inserted.
    const find_and_process_posts =
        container => container.probe(post_selector)     // X.fn.probe, returns Z
                              .filter(sanity)           // X.fn.filter, returns Z
                              .toArray()                // X.fn.toArray, returns Array
                              .map(find_post_root)      // Array.prototype.map, returns Array
                              .forEach(process_post);   // Array.prototype.forEach

    // Do the initial processing of a post and mark it as being seen by SFx
    async function process_post(post) {
        do_reset_check();
        const id = post.id || (post.id = 'sfx_post_' + sfx_post_id);
        post.setAttribute('sfx_post', sfx_post_id); // Mark this post as seen
        X.publish('log/postdata', {id, message: `processing post id=${id}, sfx_post=${sfx_post_id}`});
        // We store the post's unique FB object ID -- if available -- as its 'sfx_id'
        // Asynchronous; eventually triggers filtering etc.
        get_post_id(X(post), id).then(function(sfx_id) {
            post.setAttribute('sfx_id', sfx_id);
            X.publish('log/postdata', {id, message: 'Calling post/add'});
            X.publish('post/add', { id, selector: '#' + id, sfx_id, $post: X(post), });
        });
        sfx_post_id++;  // Global count during the current page load
        post_count++;   // Local count up to the user-set paging limit

        // If we have processed too many posts, pause here
        if (post_count >= max_posts) {
            pause_infinite_scroll();
        }
    }
    SFX.pose({ post_selector, post_verifier, find_and_process_posts, process_post, });

    // The pager on main (fb/search/top/?q=...) and post
    //                   (fb/search/posts/?q=...) search result pages
    const search_pager_selector = [
        '[role=feed] div.S2F_wid_1.S2F_hei_1:empty',
    ].join(',');

    const find_infinite_scroll_triggers = function() {
        // This algorithm finds the pager on News Feeds, and many
        // other page types.  When it works, it generally returns
        // 2 empty divs; hiding the 1st (or both) stops the feed.
        var $proposed = X('.suspended-feed').closest('.S2F_ovfa_n').parent().children(':empty');
        if (!$proposed.length) {
            // This algorithm finds the pager on main (fb/search/top/?q=...)
            // and post (fb/search/posts/?q=...) search result pages.
            $proposed = X(search_pager_selector).parent();
        }
        return $proposed;
    };

    const pause_infinite_scroll = function() {
        // Find the DIVs that trigger infinite scroll
        // Luckily it stops working if it's display:none
        var $infinite_scroll_triggers = find_infinite_scroll_triggers();
        log(`Max post count (${max_posts}) reached. Loaded ${post_count}. Trying to prevent infinite scroll.`);
        if (!$infinite_scroll_triggers.length) {
            // We don't know what to do here, so don't screw anything up. Exit nicely.
            log("Couldn't identify infinite scroll triggers definitively. Aborting.");
            return;
        }
        $infinite_scroll_triggers.addClass('sfx_scroll_pause');
        var pager = X(`[id=sfx-feed-pager].${SFX.instance}`);
        try {
            if (!pager.length) {
                pager = X(`<div id="sfx-feed-pager" class="sfx_info sfx-pager ${SFX.instance}" style="cursor:pointer;"><b>Post Loading Paused &ndash; Social Fixer ${SFX.version}</b><br><b><u>Click to continue loading</u></b> about <input class="sfx_input" type="number" min="1" value="${max_posts}" style="width:7ch;" size="4" sfx-option="max_post_load_count"> more posts.<br></div>`);
                FX.attach_options(pager);
                pager.find('input').click(function () {
                    // Don't bubble up to pager
                    return false;
                });
                pager.click(function () {
                    pager.remove();
                    X('.sfx_scroll_pause').removeClass('sfx_scroll_pause');
                    post_count = 0;
                });
            }
            // Make sure the pager is at the end and visible
            X('.sfx_scroll_pause').last().after(pager);
        } catch (e) {
            alert(e);
        }
        // Hide shimmering 'posts loading' indicator while paused
        const feed_is_loading_selector = [
            '.suspended-feed ~ [role=article]',
        ].join(',');
        X(feed_is_loading_selector).addClass('sfx_scroll_pause');
    };
    SFX.pose({ find_infinite_scroll_triggers, pause_infinite_scroll, });

    // When navigating, check if we need to reset post count
    FX.on_page_unload(function () {
        pending_reset_check = true;
    });

    // Send FB-recognizable pointer events: they are ignored if the
    // screen & client coordinates are zero.  The sfx_event property
    // is for the benefit of mark_read.js.
    const FB_pointer_event = {
        bubbles: true,
        screenX:100, screenY:100,
        clientX:100, clientY:100,
    };
    function FB_pointerover(el) {
        // eslint-disable-next-line no-undef
        var event = new PointerEvent('pointerover', FB_pointer_event);
        event.sfx_event = true;
        el.dispatchEvent(event);
    }
    function FB_pointerout(el) {
        // eslint-disable-next-line no-undef
        var event = new PointerEvent('pointerout', FB_pointer_event);
        event.sfx_event = true;
        el.dispatchEvent(event);
    }

    const timestamp_selector = [
        'span[id] a.S2F_font_400[role=link][tabindex="0"]:not([href*="/user/"])',
        'span[id] a.S2F_col_tx2[role=link][tabindex="0"]:not([href*="/user/"])',
    ].join(',');
    const insights_selector = [
        'a[href*="/post_insights/"].S2F_alini_stre.S2F_bb_dark.S2F_fldr_row',
    ].join(',');
    const mediaset_selector = [
        'a.S2F_trans_n',             // : some ads, some media posts with no text
        '.S2F_alini_stre > a.S2F_disp_inlb', // : some profile pic changes
    ].join(',');
    const Alt = true;
    const found_ids = {
        // Marketplace Buy/sell item ID
            B: { count: 0, msg: 'found by marketplace Buy/sell item ID', selector: mkt_post_verifier,
                 test: () => (FX.context.type == 'marketplace'), Alt, },
        // Event IDs 'Person is interested in [event]'
            E: { count: 0, msg: 'found by event-ID', selector: 'a[href*="/events/"]:not([href*="/create/"])', Alt, },
        // Donation IDs 'Person is collecting donations for [donation]'
            D: { count: 0, msg: 'found by donate-ID', selector: 'a[href*="/donate/"]', Alt, },
        // 'Post insights' (seen by group admins) have embedded post IDs
            N: { count: 0, msg: 'found by post insights', selector: insights_selector, Alt, },
        // Comments on a post have embedded post IDs
            C: { count: 0, msg: 'found by comment link', selector: '[sfx_post] ul a[href*="comment_id="]:not([aria-hidden=true])', Alt, },
        // Media in some posts which otherwise have no IDs
            S: { count: 0, msg: 'found by mediaset-ID', selector: mediaset_selector, Alt, },
        // ID from page URL (permalink page)
            V: { count: 0, msg: 'found by page URL', },
        // URL extracted from JS structures
            U: { count: 0, msg: 'found by JS-URL', selector: 'a', },
        // ID extracted from JS structures
            I: { count: 0, msg: 'found by JS-ID-1', },
            J: { count: 0, msg: 'found by JS-ID-2', selector: '.S2F_oflx_hid.S2F_btl_rad0', },
            K: { count: 0, msg: 'found by JS-ID-3', },
        // Last gasp: mouse over the permalink to force it to be actualized
            M: { count: 0, msg: 'found by mouseover', selector: timestamp_selector, },
        // Mouseover failed due to no timestamp element
            T: { count: 0, msg: 'not found: no timestamp', fail: true, track: [], },
        // Mouseover failed due to no permalink in the timestamp element
            P: { count: 0, msg: 'not found: no permalink', fail: true, track: [], },
    };
    const id_mines = [
        { selector: '.S2F_bt_divid,.S2F_mb_6', path: 'edb,id', },
        { selector: 'div.S2F_flgr_1',          path: 'stI', },
        { selector: 'div.S2F_flgr_1',          path: 'tent', },
        { selector: 'div.S2F_flgr_1',          path: 'edb.*D', },
        { selector: 'div',                     path: 'dere,__id', },
        { selector: 'div',                     path: 'edb,id', },
        { selector: 'div',                     path: 'erS,edb.*D', },
        { selector: 'div',                     path: 'tor,t_i', }, // last: sometimes pulls up old post IDs
    ];

    function found_id(method, id, post_id) {
        if (!post_id || post_id === '0') {
            post_id = null;
        }
        if (post_id || found_ids[method].fail) {
            found_ids[method].fail ? found_ids[method].count-- : found_ids[method].count++;
            'track' in found_ids[method] && found_ids[method].track.push([id, X('#'+id), X('#'+id)[0].outerHTML]);
            X.support_note('post ID methods', Object.entries(found_ids).map(e => e[0] + ':' + e[1].count).join(', '));
            X.publish('log/postdata', {id, message: 'ID ' + found_ids[method].msg});
        }
        return post_id;
    }

    const get_coded_id = str => {
        if (Number(str)) return str;
        if (/(ZmVlZGJhY2[a-zA-Z0-9+/]*=*)/.test(str)) {
            str = atob(RegExp.$1);
            if (/dback:(\d+)/.test(str)) return RegExp.$1;
        }
    };

    const emb_id_eac = $post => {
        let ret;
        id_mines.some(({ selector, path }) => {
            $post.probe(selector).toArray().some(el => {
                id_mine = SFX.frefpath(el, 'eac.*ibe,etu,end.*rop', path);
                ret = get_coded_id(id_mine);
                return !!ret;
            });
            return !!ret;
        });
        return ret;
    };

    function emb_id($post, id, post_id) {
        if ((post_id = emb_id_eac($post)) && found_id('K', id, post_id)) {
            return post_id;
        }
        for (var a of Array.from($post.find(found_ids['J'].selector))) {
            const c = a.children[0];
            const fb_id = SFX.frefpath(c,'eac.*ibe,hil,hil,hil,pen.*ops,edb','id');
            try {
                post_id = atob(fb_id).replace(/\D*/,'');
                if (Number(post_id) && found_id('J', id, post_id)) {
                    return post_id;
                }
            } catch(e) { e; }
        }
        for (a of Array.from($post.find(found_ids['U'].selector))) {
            const o = SFX.fref(SFX.fref(a.parentElement, /eac.*ibe/).child, /end.*rop/);
            const U = SFX.fref(o, /tor.*rl$/);
            const I = SFX.fref(o, /^_*a+d.?id$/i);
            if ((post_id = (/www.facebook.com/.test(U) && found_id('U', id, extract_post_id_from_url(U)))) ||
                (post_id = /^\d{6,}(?:|:\d{1,2})$/.test(I) && found_id('I', id, `-${I}`))) {
                    return post_id;
            }
        }
        return null;
    }

    function url_id($post, id, post_id) {
        if ((post_id = extract_post_id_from_url(location.href)) && found_id('V', id, post_id)) {
            return post_id;
        }
        return null;
    }

    function alt_id($post, id, post_id) {
        // These are ordered in intentional precedence, best to worst
        // Don't combine to a single find() without implementing precedence...
        for (const [letter, method] of Object.entries(found_ids)) {
            if (method.Alt && (!method.test || method.test($post))) {
                for (var a of Array.from($post.find(method.selector))) {
                    if ((post_id = found_id(letter, id, extract_post_id_from_url(a.href)))) {
                        return post_id;
                    }
                }
            }
        }
        return null;
    }

    const possible_href = href => href && href !== '#' && href !== location.href + '#';

    async function get_post_id_internal($post, id) {
        // eslint-disable-next-line no-async-promise-executor
        return new Promise(async function(resolve) {
            var post_id = null;
            // Embedded data methods 1st, as they are fast and give the best IDs
            if ((post_id = emb_id($post, id, 0))) {
                return resolve(post_id);
            }
            // Direct examination of page URL 2nd, in case of a detectable permalink
            if ((post_id = url_id($post, id, 0))) {
                return resolve(post_id);
            }
            // Alternate URL methods 3rd, as they are cheap and consistent
            if ((post_id = alt_id($post, id, 0))) {
                return resolve(post_id);
            }
            // Timestamp scraping last, as it's slow and dangerous
            var timestamp;
            var did_mouseover = false;
            $post.addClass('sfx_touch');
            for (var tries = 0; tries < 40 && (timestamp || tries < 5); ++tries) {
                if (!timestamp) {
                    X.publish('log/postdata', {id, message: `Look for timestamp (${tries})`});
                }
                timestamp = $post.find(found_ids['M'].selector)[0];
                if (timestamp) {
                    var href = possible_href(timestamp.href) ? timestamp.href : timestamp.getAttribute('href');
                    if (possible_href(href)) {
                        X.publish('log/postdata', {id, message: `Found href '${href}' (${tries})`});
                        if ((post_id = found_id('M', id, extract_post_id_from_url(href)))) {
                            break;
                        }
                    }
                    if ([0,1,3,5,8,11,15,20,25,31,39].includes(tries)) {
                        // Trigger a hover over the timestamp on the post
                        // This will switch the href from '#' or stub URL to the real URL
                        did_mouseover = true;
                        FB_pointerover(timestamp);
                        const adverb = possible_href(href) ? 'better ' : '';
                        X.publish('log/postdata', {id, message: `Triggering mouseover to find ${adverb}href (${tries})`});
                        FB_pointerout(timestamp);
                    }
                }
                await X.sleep(0.2);
                // Try these again: they sometimes wake up after a while, and they're cheap
                if ((post_id = emb_id($post, id, 0))) {
                    break;
                }
            }
            if (did_mouseover) {
                FB_pointerout(timestamp);
                X.publish('log/postdata', {id, message: 'Triggering mouseout'});
            }
            setTimeout(() => $post.removeClass('sfx_touch'));
            if (!post_id) {
                found_id(timestamp ? 'P' : 'T', id, null);
            }
            resolve(post_id);
        });
    }

    // Extract the unique Facebook ID from a post / comment / reply link.
    // Returns null if no ID found.
    function extract_post_id_from_url(url) {
        // 2021-11-20: permalink IDs are long strings of digits, some with
        // 1-2 digits appended ':45' (a subsidiary ID).  Some places we
        // read IDs from embed those into a longer string of the form
        // 'digits:digits:...:ID', e.g. '1111:22222:333:12345:67', from
        // which we extract ID '12345:67'.  We then remove the ':digits'
        // part, which relates to some sub-post thing we don't attend to.
        //
        // These regular expressions are ordered to extract more reliable
        // patterns first, falling back to less safe ones when the better
        // ones fail.  The series is reliable for all current forms of
        // post timestamp permalinks, although there are forms found
        // elsewhere on FB which it may not handle.
        //
        // Uses the URL() constructor to decompose URLs into usable bits.

        const myURL = new URL(url, location.origin + location.pathname);

        let groupID = '';
        if (/\/groups\/(\d+)($|\/)/.test(myURL.pathname)) {
            groupID = RegExp.$1;
        }

        // URL forms that definitely aren't IDs
        if (
             // profile.php leads to a user profile, not a post
                /\/profile\.php/.test(myURL.href) ||
             // /groups/$GROUP/user/$ID: user's group resume, not a permalink
                /\/groups\/[^/]*\/user\//.test(myURL.pathname) ||
             // /donate/$ID/?.*fundraiser_source=feed: fundraiser ID, not a post ID
                (/\/donate\/[\d:]{6,}\/$/.test(myURL.pathname) && /fundraiser_source=feed/.test(myURL.search)) ||
           0) {
                return null;
        }

        // URL forms that might contain IDs in opaque encoded forms
        if (/[/?&=](pfbid0[1-9A-HJ-NP-Za-km-z]{20,75}l)\b/.test(myURL.href)) {
            // These base58-encoded forms first appeared in 2022 and we don't
            // yet know how to decode them to a proper FBID.  For now, use them
            // as opaque 'token' IDs.  See fb.com/5688526481166523 (please solve
            // the crypto puzzle!)
            return RegExp.$1;
        }

        if (/comment_id=((?:Y29|Q09|Q29)[A-Za-z0-9]{20,75}[=%3Dd]{0,12})(?:$|&)/.test(myURL.search)) {
            try {
                const decoded = atob(decodeURIComponent(RegExp.$1)).toLowerCase();
                // This will be in the format 'comment:123456_7890123', where
                // the numbers are postID_commentID.
                if (/comment:(\d{6,})[:_]/.test(decoded)) {
                    return RegExp.$1;
                }
            } catch(err) {
                // ignore, don't care, this just wasn't the way to get this post's ID
            }
        }

        // URL forms that might contain IDs
        if ((
             // /some/thing/{posts,permalink,video,stories,marketplace/item}/$ID[:digit][/] in path
                /\/(?:posts|permalink|video|stories|marketplace\/item)\/(\d{6,}(?:|:\d{1,2}))(?:$|\/)/.test(myURL.pathname) ||
             // /watch/?v=$ID
                (myURL.pathname == '/watch/' && /\bv=(\d{6,})/.test(myURL.search)) ||
             // ...permalink[=:]$ID[:digit], ...multi_permalinks[=:]$ID[:digit]; may be in search
                /permalinks?[=:](\d{6,}(?:|:\d{1,2}))(?:$|\D)/.test(myURL.href) ||
             // {fbid,post_id}[=:]$ID[:digit] anywhere in URL, including search & hash
                /(?:fbid|post_id)[=:](\d{6,}(?:|:\d{1,2}))(?:$|\D)/.test(myURL.href) ||
             // pcb.$ID[:digit] anywhere in URL, including search & hash
                /\Wpcb\.(\d{6,}(?:|:\d{1,2}))(?:$|\D)/.test(myURL.href) ||
             // /some/thing/$ID[:digit][/], /some/thing/whatever+digits:$ID[:digit][/]
                (/(?:\d:|\/)(\d{6,}(?:|:\d{1,2}))\/?$/.test(myURL.pathname) && RegExp.$1 != groupID) ||
             // ...[=:]$ID[:digit] ending any pathname component
                (/[=:/](\d{6,}(?:|:\d{1,2}))(?:$|\/)/.test(myURL.pathname) && RegExp.$1 != groupID) ||
             // ...[=:]$ID[:digit] anywhere in URL
                /[=:](\d{6,}(?:|:\d{1,2}))(?:$|\D)/.test(myURL.href) ||
             // set=[...]a.$ID in ?search args: master URLs of entire photo sets
                /set=[^&?/]*a\.(\d{6,}(?:|:\d{1,2}))/.test(myURL.search) ||
           0) && /^(\d+:?\d{0,2})$/.test(RegExp.$1)) {
                return RegExp.$1.replace(/:.*/,'');
        }
        return null;
    }

    async function get_post_id($post, id) {
        try {
            return get_post_id_internal($post, id).then(function(sfx_id) {
                sfx_id = (!sfx_id || sfx_id === '0') ? 'no-ID' : sfx_id.replace(/:.*/,'');
                if ((RegExp(`(^|\\D)${sfx_id}(\\D|$)`).test(decodeURIComponent(location.href))) ||
                    ($post.is(theater_mode_comments_selector))) {
                    X.publish('post/permalink', { $post, id, sfx_id, actor: 'post processor', });
                }
                X.publish('log/postdata', {id, message: 'get_post_id=' + sfx_id});
                return sfx_id;
            });
        } catch(e) {
            X.publish('log/postdata', {id, message: 'get_post_id failed: ' + e.toString()});
            return 'no-ID';
        }
    }
    SFX.pose({ extract_post_id_from_url, get_post_id, found_ids, });
});
