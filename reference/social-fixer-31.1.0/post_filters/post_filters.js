// =====================================================
// Apply Filters to posts when they are added or updated
// =====================================================
// Filters depend on options, so wait until they load
X.ready('post_filters', function() {
    FX.add_option('filters_enabled', {"section": "Filters", "hidden": true, "default": true});
    FX.add_option('filters_enabled_pages', {"section": "Filters", "hidden": true, "default": false});
    FX.add_option('filters_enabled_groups', {"section": "Filters", "hidden": true, "default": false});
    FX.add_option('filters_forced_processing_delay', {"type":"number", "section":"Advanced", "title":"Post Filter Force Delay", "description":"The time in ms after which post filtering will be forced even if all the content is not yet available", "default": 1 * X.seconds});
    FX.add_option('filter_forced_visible_style', {section: 'Advanced', title: 'Post Filter Visible Style', description: 'CSS style to be applied to filtered posts which have been clicked visible', type: 'text', default: 'border:2px dashed blue;', live: style => X.css(`.sfx_filter_hidden > :not(.sfx_filter_hidden_note) { ${style} }`, 'sfx_filter_visible_css')});

    FX.add_option('hide_posts_text', {"hidden":true, "type":"textarea", "section":"Hide Posts", "title":"Hide Posts Keywords", "default":""});
    FX.add_option('hide_posts_show_hidden_message', {"hidden":true, "section":"Hide Posts", "title":"Show hidden post message", "default":true});
    FX.add_option('hide_posts_show_match', {"hidden":true, "section":"Hide Posts", "title":"Show Matching Text", "default":true});
    FX.add_option('hide_posts_partial', {"hidden":true, "section":"Hide Posts", "title":"Match Partial Words", "default":true});
    FX.add_option('hide_posts_case_sensitive', {"hidden":true, "section":"Hide Posts", "title":"Case Sensitive", "default":false});
    FX.add_option('hide_posts_caption', {hidden:true, section:'Hide Posts', title:'Caption', default:true});
    const reveal_str = ' -- Click to reveal post';
    const rehide_str = ' -- Click to rehide post';

    const sfx_post_data = {};
    const sfx_filter_trace = {};
    SFX.pose({ sfx_post_data, sfx_filter_trace, });
    var filter_trace_reset_time = performance.now();
    const filter_trace = function (id, message) {
        const t1 = performance.now();
        var t0 = sfx_filter_trace[id] ? sfx_filter_trace[id][0] : t1;
        if (!sfx_filter_trace[id] || t0 < filter_trace_reset_time) {
            t0 = t1;
            sfx_filter_trace[id] = [t0];
            filter_trace(id, `Filter log for ID ${id} starts at page time ${(t0 / X.seconds).toFixed(6)}`);
        }
        sfx_filter_trace[id].push(((t1 - t0) / X.seconds).toFixed(6) + ' ' + message);
    };
    X.subscribe("log/filter", function (msg, data) {
        filter_trace(data.id, data.message);
    });
    X.subscribe_backlog('posts/reset', () => (filter_trace_reset_time = performance.now()));

    // Convert a string such that converting it to a RegExp makes a
    // RegExp which searches for that exact string with no special
    // meanings.  Code from github.com/tc39/proposal-regex-escaping/.
    function regexp_escape_literal(regex_str) {
        return regex_str.replace(/[\\^$*+?.()|[\]{}]/g, '\\$&');
    }

    var group_link_selector = "h4 a[href*='/groups/']";

    const init_post_filters = function() {
      FX.on_options_load(function () {
        X.unsubscribe(init_post_filters);
        var FORCED_PROCESSING_DELAY = +FX.option('filters_forced_processing_delay');

        var show_filtering_disabled_message_displayed = false;
        var show_filtering_disabled_message = function () {
            if (show_filtering_disabled_message_displayed) {
                return;
            }
            show_filtering_disabled_message_displayed = true;
            var msg = "By default, post filtering only affects the main Newsfeed.<br>You can change this in Options if you wish.";
            context_message("filter_disabled_message", msg, {"title": "Post Filtering Disabled"});
        };
        FX.on_page_unload(function () {
            show_filtering_disabled_message_displayed = false;
        });

        var filters = X.clone(FX.storage('filters'));

        // If there are any "Hide Posts" keywords defined, create a filter to hide them
        var hide_posts_text = (FX.option('hide_posts_text') || '').trim();
        if (hide_posts_text) {
            var keywords = regexp_escape_literal(hide_posts_text).split(/\s*\n\s*/);
            var keywords_regex = "(" + keywords.join('|') + ")";
            if (!FX.option('hide_posts_partial')) {
                keywords_regex = "(?:^|\\b|\\W)" + keywords_regex + "(?:\\W|\\b|$)";
            }
            var modifier = FX.option('hide_posts_case_sensitive') ? 'I' : 'i';
            var show_note = FX.option('hide_posts_show_hidden_message');
            const note = 'Post Hidden by keyword' + (FX.option('hide_posts_show_match')?': $1':'');
            var filter = {
                "match": "ALL",
                "enabled": true,
                "stop_on_match": true,
                "rules": [
                    {
                        target: FX.option('hide_posts_caption') ? 'any+image' : 'any',
                        "operator": "matches",
                        "condition": {
                            "text": keywords_regex,
                            "modifier": modifier
                        }
                    }
                ],
                "actions": [
                    {
                        "action": "hide",
                        "show_note": show_note,
                        custom_note: note + reveal_str,
                        custom_nyet: note + rehide_str,
                    }
                ],
                "title": "Hide Posts"
            };
            filters.unshift(filter);
        }

        const decide_filter_post_internal = function (post, dom_id) {
            const cuz = (why, ret) => (filter_trace(dom_id, 'Not filtering post because ' + why), ret || false);
            // If the post has already been properly filtered, don't do anything
            if (post.attr('sfx_filtered')) {
                if (!sfx_post_data[dom_id].already_msgd) {
                    cuz('it was already filtered');
                    sfx_post_data[dom_id].already_msgd = true;
                }
                return 'already';
            }

            if (!post || !post[0]) {
                return cuz("it apparently doesn't exist");
            }

            // If there are no child nodes or content, then this is a shell - don't do anything yet
            if (!post[0].childNodes || post[0].childNodes.length==0 || !post.innerText()) {
                return cuz('it is still being downloaded', 'notyet');
            }
            // On permalink pages, don't filter until we've decided if this post is named in the link
            if (FX.context.type == 'permalink' && !post.hasClass('sfx_mr_checked')) {
                return cuz('it is not yet checked for permalink status', 'notyet');
            }
            // Filtering before inserted into All Posts & Filtered Feed can cause wrong tab residency
            if (!post.hasClass('sfx_filter_tab_0')) {
                return cuz('it is not yet added to initial tabs', 'notyet');
            }

            // Special handling for SFx Support Groups
            // 1. Posts in News or Groups Feed -- add 'sfx_support_post' class
            //    for possible styling (previously used to hide Reply links)
            if (FX.context.type != 'groups' || FX.context.id == 'feed') {
                var group_hovercard = post.find(group_link_selector).last();
                var group_href = group_hovercard.attr('href') || '';
                var group_linkname = group_href.replace(/.*\/groups\/([^/]*).*/,'$1');
                if (FX.sfx_support_groups.includes(group_linkname))
                    post.addClass('sfx_support_post');
            }
            // 2. Posts within a Support Group -- add 'sfx_support_post' class
            //    and disable filtering.  Filtering intentionally not blocked on
            //    News or Groups Feed, as notifications will still get through.
            if (FX.context.type == 'groups' && FX.sfx_support_groups.includes(FX.context.id)) {
                post.addClass('sfx_support_post');
                if (FX.option('filters_enabled_groups') && !FX.option('support_groups_allow_filters')) {
                    context_message('filter_disabled_in_support_message', FX.oneLineLtrim(`
                        Social Fixer automatically disables filtering in its<br>
                        Support Groups because the problem you're trying to<br>
                        solve might hide the solution you're looking for.`),
                        { title: 'Post Filtering Disabled' });
                    return cuz('filtering is automatically disabled in Social Fixer Support Groups');
                }
            }

            if (!FX.option('filters_enabled')) {
                return cuz('<b>Options &gt; Filters &gt; Post Filtering</b> is OFF');
            }

            if (!filters || !filters.length) {
                return cuz('there are no filters');
            }

            // Don't filter on timelines (including Pages) if that's disabled
            if (FX.context.type == "profile" && !FX.option('filters_enabled_pages')) {
                show_filtering_disabled_message();
                return cuz('<b>Options &gt; Filters &gt; Filter on Pages/Timelines</b> is OFF');
            }

            // Don't filter in Groups if that's disabled
            if (FX.context.type == "groups" && !FX.option('filters_enabled_groups')) {
                show_filtering_disabled_message();
                return cuz('<b>Options &gt; Filters &gt; Filter in Groups</b> is OFF');
            }

            filter_trace(dom_id, 'decide_filter_post() says to filter');
            return true;
        };

        const filtering_complete = function (post) {
            post.attr('sfx_filtered','true');
            X.publish('post/filtered', { $post: post, });
        };

        const decide_filter_post = function (post, dom_id, tries_left) {
            const decision = decide_filter_post_internal(post, dom_id);
            if (decision == true) {
                return true;
            }
            if (decision == 'notyet') {
                return tries_left > 0 ? 'notyet' : 'forced';
            }
            if (decision == false && !post.attr('sfx_filtered')) {
                filter_trace(dom_id, 'Not filtering because decide_filter_post() says not to');
                // Some static don't-filter condition: mark already filtered
                filtering_complete(post);
            }
            // decision == false or 'already': don't filter
            return false;
        };

        var filter_post = function (msg, data, tries_left) {
            if (typeof tries_left === 'undefined') {
                tries_left = 5; // XXX arbitrary, revisit
            }
            const post = data.$post;
            var dom_id = data.id;
            var sfx_id = data.sfx_id;

            var post_data = sfx_post_data[dom_id] = {sfx_id, dom_id, id: dom_id, next_filter: 0};

            const proceed = decide_filter_post(post, dom_id, tries_left);
            if (proceed == false) {
                return false;
            }

            // FILTER THE POST!
            // ================
            const result =
                  (proceed == 'notyet') ? undefined
                : (proceed == 'forced') ? apply_filters(post, post_data, filters, true)
                /* proceed ==  true  */ : apply_filters(post, post_data, filters, false);
            if (result !== undefined) {
                // Filtering is complete, whether or not anything happened
                filtering_complete(post);
            } else {
                // Couldn't apply filters; try again after a delay
                filter_trace(dom_id, 'apply_filters() says to try again later');
                setTimeout(function() {
                    filter_trace(dom_id, 'filter_post() ready to try again');
                    if (post.attr('sfx_filtered')) {
                        filter_trace(dom_id, 'Nevermind, it got sfx_filtered in the meantime');
                        return;
                    }
                    filter_post(msg, data, tries_left - 1);
                },FORCED_PROCESSING_DELAY);
            }
        };

        // Filter all posts so [sfx_filtered] attribute is universal;
        // and to allow on-the-fly enabling
        X.subscribe_backlog('post/add', filter_post);

      });
    };
    X.subscribe_backlog('context/ready', init_post_filters);

    // This is an X().filter( function ): receives a DOM element as 'this'
    var filter_out_comments = function() {
        return !X(this).is('[sfx_post] [role=article] *');
    };

    const found_gns = {
        P: { count: 0, msg: 'page-wide group insignia' },
        A: { count: 0, msg: 'group self-link aria-label' },
        T: { count: 0, msg: 'group name text in post' },
    };

    function found_gn(method, id, group_name) {
        if (group_name) {
            found_gns[method].count++;
            X.support_note('group name methods', Object.entries(found_gns).map(e => e[0] + ':' + e[1].count).join(', '));
            filter_trace(id, `Group name '${group_name}' found by ${found_gns[method].msg}`);
        }
        return group_name || null;
    }

    const gn_selector_1 = [
        "[role=main] h1 a.S2F_font_700[href*='/groups/']:not([href*='/user/'])",
        "[role=main] h2 a.S2F_font_700[href*='/groups/']:not([href*='/user/'])",
    ].join(',');
    const gn_selector_2 = [
        "a.S2F_col_tx1[aria-label][href*='/groups/']:not([href*='/user/'])",
    ].join(',');
    const gn_rejector_2 = [
        '.S2F_bb_1pxdiv', // divider indicates an embedded post 'shared' by the main post
    ].join(',');
    const gn_selector_3 = [
        "h3 a.S2F_col_tx1.S2F_font_600[href*='/groups/']:not([href*='/user/'])",
        "h4 a.S2F_col_tx1.S2F_font_600[href*='/groups/']:not([href*='/user/'])",
    ].join(',');

    const found_aus = {
        G: { count: 0, msg: 'general Hx B/STRONG element', },
        L: { count: 0, msg: 'first viable link', },
     };

    function found_au(method, id, author_name) {
        if (author_name) {
            found_aus[method].count++;
            X.support_note('author name methods', Object.entries(found_aus).map(e => e[0] + ':' + e[1].count).join(', '));
            filter_trace(id, `Author name '${author_name}' found by ${found_aus[method].msg}`);
        }
        return author_name || null;
    }

    const au_selector_1 = [
        "a.S2F_disp_inl:not([aria-hidden])",
        "img",  // as a stopping point
    ].join(',');
    const au_selector_4a = [
        "h2",
        "h3",
        "h4",
    ].join(',');
    const au_selector_4b = [
        "b",
        "strong",
    ].join(',');
    const au_selector_4x = [
        "a[href*='/groups/'][href*='/user/']",
    ].join(',');

    const content_selector_1 = [
        '.S2F_font_400.S2F_col_tx1 > .S2F_mb_0.S2F_ow_bw',
    ].join(',');
    const content_selector_2 = [
        '[style*="text-align"]',
    ].join(',');

    const app_selector_1 = [
        "a[data-appname]",
    ].join(',');
    const app_selector_2 = [
        "a.S2F_col_tx2.S2F_font_400[href*='/games/']",
        ".S2F_ch1_none ~ a.S2F_col_tx2",
    ].join(',');

    // Extract parts of the post that can be filtered on
    // NOTE: If a part can't be found (so its match is undefined), set the value as null.
    // If it is found but has no value, then set the value as empty string
    var extract = {
        "author": function (o, data) {
            data.authorContent = [];
            data.author = null;
            // This works for most posts, and avoids picking up 'Joe Bloggs likes BS&S'
            // when BS&S is the post author...
            data.author || o.find(au_selector_4a).find(au_selector_4b).each(function() {
                if (!X(this).is(au_selector_4x) &&
                    (data.author = found_au('G', o[0].id, this.innerText))) {
                    // Store a reference to the author link itself
                    data.authorContent = [this];
                    return false;
                }
            });
            // This works almost everywhere, but may pick up some unintended header metadata
            data.author || o.find(au_selector_1).each(function() {
                // Author will not be after the first 'img' element
                if (X(this).is('img')) {
                    return false;  // Stop searching the post
                }
                if (
                    // Blank text is useless
                        !this.innerText ||
                    // relative link: only DOM node's .href includes current host
                        !/www\.facebook\.com\//.test(this.href) ||
                    // These aren't valid author links
                        /\/(?:help|reel|media|photo|album|video|posts|hashtag|marketplace)\//.test(this.href) ||
                    // Special formula for a valid author link in a Group post
                        /\/groups\//.test(this.href) && !/\/user\//.test(this.href) ||
                    // end-of-alternation
                        false)
                {
                    return true;   // Continue examining other matches
                }
                if ((data.author = found_au('L', o[0].id, this.innerText))) {
                    // Store a reference to the author link itself
                    data.authorContent = [this];
                    return false;  // Got it!
                }
            });
            return data.author;
        },
        "group": function (o, data) {
            data.group = null;
            // 1. Group name from page surrounds, on group-specific pages
            //    XXX this should be cached, updated by a posts/reset subscription
            data.group || X(gn_selector_1).each(function() {
                if ((data.group = found_gn('P', o[0].id, this.innerText))) return false;
            });
            // 2. Most group posts have the group name embedded in an aria-label
            data.group || o.find(gn_selector_2).each(function() {
                if (!X(this).parents(gn_rejector_2).length &&
                    (data.group = found_gn('A', o[0].id, this.getAttribute('aria-label')))) return false;
            });
            // 3. Most group posts also have the group name in a readable text
            data.group || o.find(gn_selector_3).each(function() {
                if ((data.group = found_gn('T', o[0].id, this.innerText))) return false;
            });
            return data.group;
        },
        "page": function (o, data) {
            data.page = null;
            if (data.author === undefined) {
                extract_post_data(o, data, 'author');
            }
            if (data.authorContent && data.authorContent[0]) {
                const $header = X(data.authorContent[0].childNodes[0]).closest('h2,h4');
                $header.find('*').each(function() {
                    // This is ultra-horrible, but it works for the moment...
                    if (SFX.frefpath(this,/eac.*rop/,'children','props','children','props','entity','__typename') == 'Page') {
                        data.page = data.author;
                        return false;
                    }
                });
            }
            return data.page;
        },
        "link_url": function (post, data) {
            data.link_url = [];
            post.find('a[href*="facebook.com/l.php?u="]')
                .filter(filter_out_comments)
                .forEach(function(link) {
                    var dissect_url = X(link).attr('href').match(/facebook.com.l.php.u=([^&]*)/);
                    if (dissect_url && dissect_url.length > 1) {
                        SFX.pushy(data.link_url, decodeURIComponent(dissect_url[1]));
                    }
                });
            data.link_url.length || (data.link_url = null);
            return data.link_url;
        },
        "link_text": function (post, data) {
            data.link_text = [];
            post.find('a[href*="facebook.com/l.php?u="]')
                .filter(filter_out_comments)
                .forEach(function(link) {
                    SFX.pushy(data.link_text, X(link).text());
                });
            data.link_text.length || (data.link_text = null);
            return data.link_text;
        },
        "all_content": function (o, data) {
            var nodeFilter_obj = {
                acceptNode: function(node) {
                    if (node.nodeName == '#text') {
                        return NodeFilter.FILTER_ACCEPT; // Include this node's text
                    } else if (node.nodeType == node.ELEMENT_NODE &&
                         (node.tagName == 'FORM' ||                         // Skip the comment area
                           X(node).is('[sfx_post] [role=article]') ||       // Skip individual comments
                           (/^\s*Facebook\s*$/.test(node.textContent) &&    // Skip 'Facebook Facebook' crap
                            X(node).is('.S2F_disp_none')))) {
                        return NodeFilter.FILTER_REJECT; // Skip node and don't visit its children
                    }
                    return NodeFilter.FILTER_SKIP;       // Skip node and *do* visit its children
                }
            };
            data.all_content = o.innerText(nodeFilter_obj);
            if (!/\S/.test(data.all_content)) {
                data.all_content = extract_post_data(o, data, 'content');
                if (/\S/.test(data.all_content)) {
                    data.all_content += ' [via ${content}]';
                }
            }
            return data.all_content;
        },
        "content": function (post, data) {
            // Store a reference to all userContent areas, in case we need to manipulate them (replace text, etc)
            data.userContent = [];
            data.content = [];
            let $content_els = post.find(content_selector_1);
            if (!$content_els.length) {
                $content_els = post.find(content_selector_2);
            }
            $content_els
                .filter(filter_out_comments)
                .forEach(function(el) {
                    data.userContent.push(el);
                    data.content.push(X(el).innerText());
                });
            data.content = data.content.join('\n');
            return data.content;
        },
        "action": function (o, data) {
            const postText = X.getNodeVisibleText(o[0]) || X.getNodeVisibleText(o[0].lastChild);
            data.action = postText.replace(/[\n\u00b7].*/s,'');
            data.actionContent = [];
            if (data.action) {
                // Find the innermost element which contains the found text
                X(o[0].lastChild).find('*').each(function() {
                    const elemText = this.innerText || '';
                    if (elemText.length <= 2 * data.action.length) {
                        if (elemText.indexOf(data.action) == 0) {
                            // Store it as a reference to the action content
                            data.actionContent = [this];
                        } else if (data.actionContent) {
                            // 1st element *after* the action in traversal order
                            return false;
                        }
                    }
                });
            }
            return data.action;
        },
        "app": function (o, data) {
            data.app = null;
            var app;
            app || (app = o.find(app_selector_1).attr('data-appname'));
            app || o.find(app_selector_2).each(function() {
                return (!(app = this.innerText));
            });
            if (app) {
                data.app = app;
            }
            return data.app;
        },
        "image": function (post, data) {
            data.image = [];
            post.find('img[alt]')
                .filter(filter_out_comments)
                .forEach(function(img) {
                    SFX.pushy(data.image, X(img).attr('alt'));
                });
            data.image.length || (data.image = null);
            return data.image;
        },
        "hashtag": function (post, data) {
            data.hashtag = [];
            post.find("a[href*='/hashtag/']")
                .filter(filter_out_comments)
                .forEach(function(a) {
                    a.innerText[0] == '#' && SFX.pushy(data.hashtag, a.innerText.slice(1));
                });
            data.hashtag.length || (data.hashtag = null);
            return data.hashtag;
        },
    };
    SFX.port({ filter_extract_field: extract, }); // for mark_read.js
    SFX.pose({ filter_extract_field: extract, });

    // Util method to replace text content in text nodes
    function replaceText(rootNode, find, replace) {
        var children = rootNode.childNodes;
        for (var i = 0; i < children.length; i++) {
            var aChild = children[i];
            if (aChild.nodeType == 3) {
                var storedText = '';
                // If the parent node has an attribute storing the text value, check it to see if it's changed.
                // This is a method to prevent text replace actions from triggering another mutation event and repeatedly changing the same text.
                // This really only happens if the replace text is a superset of the find text.
                if (aChild.parentNode) {
                    storedText = aChild.parentNode.getAttribute('sfx_node_text') || '';
                }
                var nodeValue = aChild.nodeValue;
                if (nodeValue != storedText) {
                    var newVal = nodeValue.replace(find, replace);
                    if (newVal != nodeValue) {
                        aChild.nodeValue = newVal;
                        aChild.parentNode.setAttribute('sfx_node_text', newVal);
                    }
                }
            }
            else {
                replaceText(aChild, find, replace);
            }
        }
    }

    // Run filters to take actions on a post
    function apply_filters(post, data, filters, force_processing) {
        if (force_processing) {
            post.attr('sfx_filtered_forced', true);
        }
        if (!filters || filters.length == 0) {
            return false;
        }
        var match = false;
        filter_trace(data.id, `BEGIN Filtering (next_filter=${data.next_filter + 1})`);
        if (force_processing) {
            filter_trace(data.id, `Force filtering enabled`);
        }
        for (; data.next_filter < filters.length; data.next_filter++) {
            var filter = filters[data.next_filter];
            if (!X.isObject(filter)) {
                filter_trace(data.id, `Filter #${data.next_filter + 1} is empty, skipping`);
                continue;
            }
            if (filter.enabled === false) {
                filter_trace(data.id, `Filter #${data.next_filter + 1} (${filter.title}) Disabled`);
                continue;
            }
            const actor = `Filter #${data.next_filter + 1} (${filter.title})`;
            filter_trace(data.id, actor);
            var result = apply_filter(post, data, filter, actor, force_processing);
            if (typeof result=="undefined") { // Some rules could not be executed
                filter_trace(data.id, `END Filtering because a condition could not be tested yet.`);
                match = undefined;
                break;
            }
            if (result) {
                match = true;
                if (filter.stop_on_match) {
                    filter_trace(data.id, `Filter processing stopped because "Stop on Match" is active`);
                    break;
                }
            }
        }
        if (force_processing && match === undefined) {
            match = false;
        }
        if (match !== undefined) {
            filter_trace(data.id, `END Filtering. Filtered=${match}`);
        }
        return match;
    }

    // Extract one type of data from a post, to filter against
    function extract_post_data(post,extracted_data,type) {
        // If it's already been extracted in this run of filtering, return it
        if (typeof extracted_data[type]!="undefined") {
            return extracted_data[type];
        }
        if (typeof extract[type] != 'function') {
            return (extracted_data[type] = `\${${type}}`);
        }
        return extract[type](post, extracted_data);
    }

    // Execute a single filter on a post
    function apply_filter(post, data, filter, actor, force_processing) {
        if (!filter || !filter.rules || !filter.rules.length || !filter.actions) {
            return false;
        }
        var all_match = true;
        var any_match = false;
        var abort = false;
        // XXX Should be applied at input time so user sees the change
        // XXX May break legit pipe matchers: /foo\||bar/ or /bar|foo\|/
        // XXX Any other fun-yet-fixable mistakes users like to make?
        function fix_regexp_mistakes(regex_str) {
            return regex_str
                         .replace(/^\s*\|/,'')   // Leading pipe
                         .replace(/\|\|+/g,'|')  // Double (or more) pipes
                         .replace(/\|\s*$/,'')   // Trailing pipe
            ;
        }
        filter.rules.forEach(function (rule) {
            if (abort || !X.isObject(rule) || !rule.condition) {
                return;
            }
            var condition_text, regex, results;
            var regex_str, modifier;
            try {
                if (any_match && "ANY" === filter.match) {
                    return; // Already matched a condition
                }
                if (!all_match && "ALL" === filter.match) {
                    return; // Already failed on one rule, don't continue
                }
                var match = false;
                const not = /^not_/.test(rule.operator || '') || !!rule.not;
                const operator = (rule.operator || '').replace(/not_/, '');
                const NOT = not ? 'NOT ' : '';

                // The "selector" rule isn't text-based, special case to handle first
                if ("contains_selector" == operator) {
                    const dequote = str => str.replace(/^(["'`])(.*)\1$/,'$2');
                    filter_trace(data.id, ` -> Looking for ${NOT}selector: ${rule.condition.text}`);
                    var contains = null;
                    var vcontains = null;
                    var hid_within = null;
                    var condition = rule.condition.text.
                        replace(/:contains\((.+?)\)\s*$/, function(_, m) {
                            contains = dequote(m);
                            return '';
                        }).
                        replace(/:has-visible-text\((.+?)\)\s*$/, function(_, m) {
                            vcontains = dequote(m);
                            return '';
                        }).
                        replace(/:hidden-within\((.+?)\)\s*$/, function(_, m) {
                            hid_within = dequote(m) + ' *';
                            return '';
                        });
                    var found = false;
                    var selector_matches = [];
                    try {
                        selector_matches = post.find(condition).filter(filter_out_comments);
                    } catch(e) {
                        filter_trace(data.id, ' -----> Selector lookup failed:');
                        filter_trace(data.id, ' -----> ' + e);
                    }

                    if (selector_matches.length > 0) {
                        if (contains || vcontains) {
                            regex = new RegExp(contains || vcontains);
                            selector_matches.each(function() {
                                results = (contains ? X(this).innerText() : X.getNodeVisibleText(this)).match(regex);
                                if (results) {
                                    found = true;
                                    filter_trace(data.id, " ---> Matched Text: '" + RegExp.lastMatch + "'");
                                }
                                data.regex_match = results;
                                return !found;  // stop .each() when found
                            });
                        } else if (hid_within) {
                            selector_matches.each(function() {
                                X(this).parents(hid_within).each(function() {
                                    // Should this check for anything else -- font size 0, etc.?
                                    if (X(this).css('display') == 'none') {
                                        found = true;
                                    }
                                    return !found;  // stop inner .each() when found
                                });
                                return !found;  // stop outer .each() when found
                            });
                            filter_trace(data.id, ` ---> ${found ? '':'not'} found hidden within`);
                        } else {
                            found = true;
                        }
                    }

                    if ( (found && !not) || (!found && not) ) {
                        match = true;
                    }
                    filter_trace(data.id, ` ---> ${match ? 'match!' : 'no match'}`);
                }
                else if ("day"==rule.target) {
                    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
                    var dayList = dayNames.filter((name, dow) => rule.condition['day_' + dow]).join(', ');
                    filter_trace(data.id, ` -> Looking for day(s) of week: ${dayList}`);
                    var dow = (new Date()).getDay();
                    if (rule.condition["day_"+dow]) {
                        match = true;
                    }
                    filter_trace(data.id, ` ---> Day of week is ${dayNames[dow]} - ${match ? 'match!' : 'no match'}`);
                }
                else if ("age"==rule.target) {
                    //var post_time = extract_post_data(post, data, 'post_time');
                    filter_trace(data.id, ` -> Looking for post age ${rule.operator} ${rule.condition.value} ${rule.condition.units == 'h' ? 'hours' : 'days'}`);
                    var post_time = (post.find('abbr[data-utime]').first().attr('data-utime') || 0) * X.seconds;
                    if (post_time) {
                        var check = rule.condition.value;
                        if (rule.condition.units=='h') { check *= X.hours; }
                        if (rule.condition.units=='d') { check *= X.days; }
                        var age = X.now() - post_time;
                        if (rule.operator=="gt" && (age>check)) {
                            match = true;
                        }
                        else if (rule.operator=="lt" && (age<check)) {
                            match = true;
                        }
                        filter_trace(data.id, ` ---> Post age is ${age}ms and must be ${rule.operator} ${check}ms - ${match ? 'match!' : 'no match'}`);
                    } else {
                        filter_trace(data.id, ` ---> Can't detect post time stamp - no match`);
                    }
                }
                // The rest are content selector rules
                else {
                    // If the regex has a leading or trailing | it will match everything - prevent that
                    condition_text = (rule.matcher == 'str')
                        ? `(${regexp_escape_literal(rule.condition.text)})`
                        : fix_regexp_mistakes(rule.condition.text);
                    var target = "";
                    if (rule.target == 'any' || rule.target == 'any+image') {
                        target = extract_post_data(post, data, 'all_content');
                        if (rule.target == 'any+image') {
                            var caption = extract_post_data(post, data, 'image');
                            target = [target, caption].flat().join(' ');
                        }
                    }
                    else {
                        target = extract_post_data(post, data, rule.target);
                    }
                    if (typeof target=="undefined") {
                        if (force_processing) {
                            // Act like target's empty so /^$/ matches successfully
                            filter_trace(data.id, ` ---> Rule target doesn't exist in post: ${rule.target}; no match`);
                            target = null;
                        }
                        else {
                            filter_trace(data.id, ` -----> Rule target doesn't exist (yet): ${rule.target}; defer filtering until later`);
                            abort = true;
                            return;
                        }
                    }
                    regex_str = null;
                    modifier = (rule.condition.modifier === 'I') ? '' : 'i'; // default is ignore case
                    if (target == null) {
                        filter_trace(data.id, ` -----> Rule target ${rule.target} is null: not trying to match`);
                        match = false;
                    } else if ('equals' == operator) {
                        regex_str = '^(?:' + condition_text + ')$';
                    } else if ('contains' == operator && rule.match_partial_words) {
                        regex_str = condition_text;
                    } else if ('contains' == operator) {
                        regex_str = '(?:^|\\b|\\W)(?:' + condition_text + ')(?:\\W|\\b|$)';
                    } else if ('startswith' == operator) {
                        regex_str = '^(?:' + condition_text + ')';
                    } else if ('endswith' == operator) {
                        regex_str = '(?:' + condition_text + ')$';
                    } else if ('matches' == operator) {
                        regex_str = condition_text;
                        modifier = (rule.condition.modifier || '').replace(/I/, ''); // default is no modifiers
                    } else {
                        filter_trace(data.id, ` -----> Rule operator '${rule.operator}' is invalid: no match`);
                        match = false;
                    }
                    if (regex_str !== null) {
                        regex = new RegExp(regex_str, modifier);
                        filter_trace(data.id, ` -> Testing ${NOT}\${${rule.target}}.match(${regex.toString()})`);
                        if (Array.isArray(target)) {
                            target.every(str => (results = regex.exec(str)) == null);
                        } else {
                            results = regex.exec(target);
                        }
                        if (not) {
                            match = (results == null);
                            filter_trace(data.id, match ? ' ---> NOT present (match succeeds)' :
                                                          ` ---> Found Text: '${RegExp.lastMatch}' (match fails)`);
                        } else {
                            match = (results != null);
                            filter_trace(data.id, match ? ` ---> Matched Text: '${RegExp.lastMatch}'` :
                                                          ' ---> no match');
                        }
                        data.regex_match = results;
                    }
                }
                if (match) {
                    any_match = true;
                }
                else if (all_match) {
                    all_match = false;
                }
            } catch (e) {
                filter_trace(data.id, " -----> ERROR: " + e.message);
            }
        });

        if (abort) {
            return; // undefined
        }

        // Were enough rules satisfied to execute the actions?
        if (!any_match || (filter.match == "ALL" && !all_match)) {
            return false;
        }

        // Filter matched! Execute the actions
        filter.actions.forEach(function (action) {
            apply_action(post, data, action, filter, actor);
        });

        // Filter matched
        return true;
    }

// Apply a single filter action to a post
    function apply_action(post, data, action, filter, actor) {
        const ACTION = '==:ACTION:==';
        var css_target;
        if (!X.isObject(action)) {
            filter_trace(data.id, `${ACTION} action is empty, doing nothing`);
        }
        else if ("class" == action.action) {
            css_target = action.selector ? post.find(action.selector) : post;
            filter_trace(data.id, `${ACTION} applying CSS class '${action.content}'`);
            css_target.addClass(action.content);
        }
        else if ("css" == action.action) {
            css_target = action.selector ? post.find(action.selector) : post;
            var rules = (action.content || '').split(/\s*;\s*/);
            filter_trace(data.id, `${ACTION} applying CSS '${action.content}'`);
            rules.forEach(function (rule) {
                var parts = rule.split(/\s*:\s*/);
                if (parts && parts.length > 1) {
                    css_target.css(parts[0], parts[1]);
                }
            });
        }
        else if ("replace" == action.action) {
            filter_trace(data.id, `${ACTION} replacing '${action.find}' with '${action.replace}'`);
            const replace_regex = new RegExp(action.find, 'gi');
            ['author','action','content','all_content'].forEach(field =>
                extract_post_data(post, data, field) &&
                    (data[field] = data[field].replace(replace_regex, action.replace)));
            data.authorContent.concat(data.actionContent).concat(data.userContent).forEach(content =>
                replaceText(content, replace_regex, action.replace));
        }
        else if ("hide" == action.action) {
            if (never_hide(post)) { return; }
            if (!post.hasClass('sfx_filter_hidden')) {
                post.addClass("sfx_filter_hidden");
                // Control actual visibility of the post, and adjust tab 'Hide' counts
                X.publish('post/hide_filt', { $post: post, actor, });
                filter_trace(data.id, `${ACTION} hiding post`);
                add_filter_hidden_note(filter, action, post, data);
            } else {
                filter_trace(data.id, `${ACTION} would have hidden post (was already hidden)`);
            }
        }
        else if ("unhide" == action.action) {
            if (post.hasClass('sfx_filter_hidden')) {
                post.find('.sfx_filter_hidden_note').remove();
                post.removeClass("sfx_filter_hidden");
                // Control actual visibility of the post, and adjust tab 'Hide' counts
                X.publish('post/unhide_filt', { $post: post, actor, });
                filter_trace(data.id, `${ACTION} unhiding post`);
            } else {
                filter_trace(data.id, `${ACTION} would have unhidden post (was not hidden)`);
            }
        }
        else if ("read" == action.action) {
            if (!post.hasClass('sfx_post_read')) {
                // Save that post is now 'Read', adjust visibility & tab 'Read' counts
                X.publish('post/mark_read', { post, sfx_id: data.sfx_id, save: true, filter: true, actor, });
                filter_trace(data.id, `${ACTION} marking post 'Read'`);
            } else {
                filter_trace(data.id, `${ACTION} would have marked post 'Read' (was already 'Read')`);
            }
        }
        else if ("unread" == action.action) {
            if (post.hasClass('sfx_post_read')) {
                // Save that post is now 'Unread', adjust visibility & tab 'Read' counts
                X.publish('post/mark_unread', { post, sfx_id: data.sfx_id, save: true, filter: true, actor, });
                filter_trace(data.id, `${ACTION} unmarking post 'Read'`);
            } else {
                filter_trace(data.id, `${ACTION} would have unmarked post 'Read' (was not 'Read')`);
            }
        }
        else if ("move-to-tab" == action.action ||
                 "copy-to-tab" == action.action) {
            var tab_name = SFX.std_tabname(regex_replace_vars(action.tab, data.regex_match, post, data));
            filter_trace(data.id, `${ACTION} ${action.action} '${tab_name}'`);
            X.publish(`filter/tab/${action.action.slice(0,4)}`, { tab: tab_name, post, data, actor, });
        }
    }

    function regex_replace_vars(str, matches, post, data) {
        if (typeof str !== 'string') {
            return '';
        }
        return str.replace(/\$(\d+|\{[0-9A-Za-z_]+(?::[^{}]*)?\})/g, function(m) {
            const var_ref = /* { */ m.replace(/\${?([^}]+)}?/, '$1');
            var [param, max_len, joiner, colon] = var_ref.split(':');
            if (joiner == '' && colon == '') {
                // handles '${all:20::}' to generate 'match1:match2'
                // (but not more complex joiners containing ':', sorry)
                joiner = ':';
            }
            var ret_str = '';
            if (matches && matches[param] != undefined) {
                ret_str = matches[param];
            } else if (matches && param == 'any') {
                // first parenthetical expression which caught anything
                ret_str = matches.slice(1).find((str) => str);
            } else if (matches && param == 'all') {
                // all parenthetical expressions which caught anything, joined
                ret_str = matches.slice(1).join(joiner);
            } else {
                ret_str = extract_post_data(post, data, param);
                if (Array.isArray(ret_str)) {
                    ret_str = ret_str.join(',');
                }
            }
            ret_str = typeof ret_str === 'string' ? ret_str : '';
            if (Number.isInteger(Number(max_len))) {
                ret_str = ret_str.slice(0, max_len);
            }
            return ret_str;
        });
    }

    function never_hide($post) {
        if ($post.find('a[href*="/socialfixer/"]').length) {
            return true; // Never hide posts from Social Fixer!
        }
        return false;
    }

    const commit_atrocity = function(note) {
        // Starting around 2021-12-10, the DOM of the first post is getting
        // rewritten some time after initial load, deleting the note text &
        // moving the rest of the post structure inside the note, i.e.:
        //
        // <div role="article">
        //     <div class="sfx_filter_hidden_note">NOTE</div>
        //     <div rest-of-post>...</div>
        // </div>
        //
        // becomes:
        //
        // <div role="article">
        //     <div class="sfx_filter_hidden_note">
        //         <div rest-of-post>...</div>
        //     </div>
        // </div>
        //
        // Thus if the first post in the feed is one we try to hide, the post
        // isn't hidden, but gets framed in our 'post is hidden' decorations.
        //
        // Use a mutation observer to bludgeon this to death...
        const first_note_observer = new MutationObserver(function(records) {
            for (const record of records || []) {
                // Move the added child (entire post contents) back to the parent
                for (const add of record.addedNodes || []) {
                    add.nodeType != note.TEXT_NODE && note.parentNode.append(add);
                }
                // Dredge our removed child text node out and reattach it
                for (const rem of record.removedNodes || []) {
                    rem.nodeType == note.TEXT_NODE && note.append(rem);
                    X.support_note('hidden_note','2021-12 layout derangement bug handled');
                }
            }
            first_note_observer.disconnect();
        });
        first_note_observer.observe(note, { childList: true });
    };

    const add_filter_hidden_note = function(filter, action, post, data) {
        const is_permalink = post.hasClass('sfx_permalink_post');
        const is_popup = post.hasClass('sfx_popup_post');
        if (!action.show_note && !is_permalink && !is_popup) {
            return;
        }
        // If it's the target of a permalink or in a popup, force it initially visible
        if (is_permalink || is_popup) {
            filter_trace(data.id,
                      is_popup ? 'Post is in popup: make initially visible'
                : is_permalink ? 'Post named in permalink: make initially visible'
                               : 'What a surprise'
            );
            post.addClass('sfx_filter_hidden_show');
        }
        const tooltip =
            FX.option('disable_tooltips') ?
                                 ''
                    : is_popup ? ` title="It is visible here because it's in a comment viewing popup"`
                : is_permalink ? ` title="It is initially visible here because this page's address mentions it"`
                               : ' title="To remove these hidden-post notes, edit Hide Posts or per-filter settings"';
        const css = action.css ? ` style="${action.css}"` : '';
        const note_text = (action.custom_note
            ? regex_replace_vars(action.custom_note, data.regex_match, post, data)
            : `Post hidden by filter "${filter.title}"${reveal_str}`);
        const nyet_text = (action.custom_nyet
            ? regex_replace_vars(action.custom_nyet, data.regex_match, post, data)
            : `Post was hidden by filter "${filter.title}"${rehide_str}`);
        const $note = X(FX.oneLineLtrim(`
            <div class="sfx_filter_hidden_note"${css}${tooltip}>
                <span class="sfx_filter_hider_note">${note_text}</span>
                <span class="sfx_filter_hider_nyet">${nyet_text}</span>
            </div>
        `));
        $note.on('click', function () {
            post.toggleClass('sfx_filter_hidden_show');
        });
        if (post.attr('sfx_post') == 1) {
            commit_atrocity($note[0]);
        }
        post.prepend($note);
    };
    // Add actions to the post action tray
    X.publish('post/action/add', {"section": "filter", "label": "Edit Filters", "message": "menu/options", "data": {"section": "Filters"}});
    X.publish('post/action/add', {"section": "filter", "label": "Filter Debugger", "message": "post/action/filter/debug"});
    X.subscribe('post/action/filter/debug', function (msg, data) {
        function stringify_leaf(obj) {
            if (typeof obj === 'function') {
                return '"[function]"';
            }
            try {
                return JSON.stringify(obj, null, 3);
            } catch(err) {
                if (/circular/.test(err)) {
                    return '"[circular]"';
                } else {
                    return `"[ERR: ${err}]"`;
                }
            }
        }
        function stringify_obj(obj) {
            return '{\n    ' + Object.keys(obj)
             .filter(key => obj[key] !== undefined)
             .map(key => `"${key}":${stringify_leaf(obj[key])}`)
             .join(',\n    ') + '\n}';
        }
        const $post = X('#' + data.id);
        Object.keys(extract).forEach(field => extract_post_data($post, sfx_post_data[data.id], field));
        var data_content = stringify_obj(sfx_post_data[data.id], null, 3);
        data_content = data_content ? data_content.replace(/\n/g, '<br>') : 'No Data';
        var trace = sfx_filter_trace[data.id];
        var trace_content = 'No Trace';
        if (trace) {
            trace_content = trace.slice(1)
                .map(str => X.htmlEncode(str))
                .join('<br>')
                .replace(/&lt;b&gt;/g, '<b>')
                .replace(/&lt;\/b&gt;/g, '</b>')
            ;
        }
        var content = FX.oneLineLtrim(`
            <div>This popup gives details about how this post was processed for filtering.</div>
            <div class="sfx_bubble_note_subtitle">Filtering Trace</div>
            <div class="sfx_bubble_note_data">${trace_content}</div>
            <div class="sfx_bubble_note_subtitle">Raw Extracted Post Data</div>
            <div class="sfx_bubble_note_data">${data_content}</div>
        `);
        bubble_note(content, {"position": "top_right", "title": "Post Filtering Debug", "close": true});
    });
});
