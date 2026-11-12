// =========================================================
// Hide parts of the page
// =========================================================
X.ready( 'hide', function() {
// Add an Option to trigger the popup in case people don't find it in the wrench menu
    FX.add_option('hide_parts_of_page',
        {
            "section": "General",
            "title": 'Hide Things',
            "description": 'Under the Wrench menu you will find an item to "Hide/Show Parts of the Page". Use this to hide or show different parts of the page that Social Fixer knows how to process. You can also access this functionality using the button to the right.',
            "type": "action",
            "action_message": "options/close,hide/on",
            "action_text": "Hide Things"
        }
    );
    FX.add_option('hide_parts_of_page_custom',
        {
            "section": "Debug",
            "title": 'Custom Hideables',
            "description": 'Define a custom JSON structure to be used instead of the server-side JSON for hideables.',
            "type": "textarea",
            "default":""
        }
    );
    FX.add_option('hide_parts_custom_merge',
        {
            "section": "Debug",
            "title": 'Merge Custom & Standard Hideables',
            "description": "Use both the server-side and custom hideables JSON.",
            "default": true,
        }
    );

    FX.on_options_load(function () {
        var menu_item = {"html": 'Hide/Show Parts of the Page', "message": "hide/on", "tooltip": "Select which parts of the page you want to hide so they never show up."};
        X.publish("menu/add", {"section": "actions", "item": menu_item});

        var hiddens = FX.storage('hiddens');
        if (!X.isObject(hiddens) && !X.isArray(hiddens)) {
            hiddens = {};
        }

        var resolve = function (hideable) {
            var o = X(hideable.selector);
            return (o.length && hideable.parent) ? o.nearby(hideable.parent) : o;
        };

        //  Two ways to hide things:
        // (1) Pure CSS if the hideable has no parent, or
        // (2) by watching for DOM insertions
        const dehide_prefix = 'html:not(.sfx_hide_show_all) ';
        var hiddens_with_parents, parented_selectors;
        var set_css_rules = function () {
            var parentless_selectors = [];
            hiddens_with_parents = [];
            parented_selectors = [];
            for (var id in hiddens) {
                var hidden = hiddens[id];

                if (!hidden.parent) {
                    // (1)
                    // Make hider selectors 'foo,bar' work with dehide_prefix
                    hidden.selector.split(',').forEach(sel =>
                        sel.length && parentless_selectors.push(`${dehide_prefix}${sel} /* sfx_hider_${hidden.id} */`));
                } else {
                    // (2)
                    hiddens_with_parents.push(hidden);
                    parented_selectors.push(hidden.selector);
                }
            }
            if (parentless_selectors.length > 0) {
                X.css(`${parentless_selectors.join(',\n')} { display:none !important; }`, 'sfx_hideables');
            }
            parented_selectors = parented_selectors.join(',');
        };
        set_css_rules();
        // Watch for DOM insertions and check for things to hide
        FX.on_content(function (o) {
            if (X(parented_selectors, o).length) {
                hiddens_with_parents.forEach(function (hidden) {
                    X(hidden.selector, o).nearby(hidden.parent).addClass(`sfx_hide_hidden sfx_hider_${hidden.id}`);
                });
            }
        });
        // Finishing function.  hide/off is expensive, don't do it on every ESC!
        const hide_show_finish = function() {
            const $ui = X('#sfx_hide_show_ui');
            if ($ui.length) {
                X.publish('hide/off');
                X.publish('esc/prevent');
                $ui.remove();
            }
        };
        X.subscribe('esc/pressed', hide_show_finish);

        X.subscribe("hide/on", function () {
            // Display the bubble popup

            // Chars used (no HTML entities for these):
            // U+25E4 ◤ (none) BLACK UPPER LEFT TRIANGLE
            // U+25E5 ◥ (none) BLACK UPPER RIGHT TRIANGLE
            // U+25E3 ◣ (none) BLACK LOWER LEFT TRIANGLE
            // U+25E2 ◢ (none) BLACK LOWER RIGHT TRIANGLE
            // Chars not used (mismapped HTML entities; plus, solids look better):
            // U+25F8 ◸ &ultri; UPPER LEFT TRIANGLE
            // U+25F9 ◹ &urtri; UPPER RIGHT TRIANGLE
            // U+25FA ◺ &lltri; LOWER LEFT TRIANGLE
            // U+25FF ◿ (none)  LOWER RIGHT TRIANGLE
            // U+22BF ⊿ &lrtri; RIGHT TRIANGLE (entity mapped to wrong codepoint)

            var content = X(FX.oneLineLtrim(`
                    <div class="sfx_hide_bubble">
                        <span id="sfx_hide_bubble_TL" style="position:absolute; top:0; left:5px; font-size:calc(0.75rem * var(--sfx_ui_scale));" data-hover="hider-tooltip" data-hider-title="Move to top left" data-hider-delay="650">&#x25E4;</span>
                        <span id="sfx_hide_bubble_TR" style="position:absolute; top:0; right:5px; font-size:calc(0.75rem * var(--sfx_ui_scale));" data-hover="hider-tooltip" data-hider-title="Move to top right" data-hider-delay="650">&#x25E5;</span>
                        <span id="sfx_hide_bubble_BL" style="position:absolute; bottom:0; left:5px; font-size:calc(0.75rem * var(--sfx_ui_scale));" data-hover="hider-tooltip" data-hider-title="Move to bottom left" data-hider-delay="650">&#x25E3;</span>
                        <span id="sfx_hide_bubble_BR" style="position:absolute; bottom:0; right:5px; font-size:calc(0.75rem * var(--sfx_ui_scale));" data-hover="hider-tooltip" data-hider-title="Move to bottom right" data-hider-delay="650">&#x25E2;</span>
                        <div class="sfx_hide_bubble_instructions">Mouse over <span style="background-color:#CFC">green shaded</span> areas to see their names; click to hide them.  (Shaded area may be offset from the item it will hide.)</div>
                        <div class="sfx_hide_bubble_instructions">To unhide items, click <span class="mark_read_markit sfx_hide_checkmark">&nbsp;&nbsp;&nbsp;</span><b>Show Hidden Items</b>, then click <span style="background-color:#FCC">red shaded</span> areas.</div>
                        <div class="sfx_hide_bubble_instructions">We update Social Fixer with new hideable areas as Facebook changes. To report new items, post a screenshot (with <span class="mark_read_markit sfx_hide_checkmark">&nbsp;&nbsp;&nbsp;</span><b>Show Hidden Items)</b> onto the <a href="https://SocialFixer.com/support/" target="_blank">Support Group</a>. We need to see <b><i>where</i></b> on the page.</div>
                        <span><input type="button" class="sfx_button sfx_button_done" style="margin:4px" value="Done Hiding"></span>
                        <span style="float:right">
                            <label data-hover="hider-tooltip" data-hider-title="So you can unhide them" data-hider-delay="1000"><input type="checkbox" class="sfx_button sfx_button_show">Show Hidden Items</label>
                            <br><label data-hover="hider-tooltip" data-hider-title="Shrink this box" data-hider-delay="1000"><input type="checkbox" class="sfx_button sfx_button_inst">Hide Instructions</label>
                        </span>
                    </div>
                `));

            var popup = bubble_note(content, {position: 'top_right', style: 'min-height:0', title: 'Hide/Show Parts of the Page', id: 'sfx_hide_show_ui', no_esc: true});
            popup.find('.sfx_button_done').click(hide_show_finish);
            popup.find('.sfx_button_show').click(function (/* event */) {
                X('html').toggleClass('sfx_hide_show_all');
            });
            popup.find('.sfx_button_inst').click(function (/* event */) {
                popup.find('.sfx_hide_bubble_instructions,.sfx_bubble_note_title').toggle();
            });
            popup.find('#sfx_hide_bubble_TL').click(function (/* event */) {
                popup.css({'top': 0, 'bottom': 'auto', 'left': 0, 'right': 'auto'});
            });
            popup.find('#sfx_hide_bubble_TR').click(function (/* event */) {
                popup.css({'top': 0, 'bottom': 'auto', 'left': 'auto', 'right': 0});
            });
            popup.find('#sfx_hide_bubble_BL').click(function (/* event */) {
                popup.css({'top': 'auto', 'bottom': 0, 'left': 0, 'right': 'auto'});
            });
            popup.find('#sfx_hide_bubble_BR').click(function (/* event */) {
                popup.css({'top': 'auto', 'bottom': 0, 'left': 'auto', 'right': 0});
            });

            var hider_title = function (idx) {
                const hidden = !!hiddens[hideables[idx].id];
                return `Click to ${hidden ? 'Unhide' : 'Hide'}:\n\n'${X.sanitize(hideables[idx].name)}'`;
            };

            var show_hideables = function (hideables, warn_server) {
                if (warn_server) {
                    var json_url = 'https://matt-kruse.github.io/socialfixerdata/hideable.json';
                    popup.find('.sfx_bubble_note_title').append(FX.oneLineLtrim(`
                        <div style="color:red; outline: 2px solid red; margin: 2px; padding: 3px;">
                            Can't access Hide/Show data on:<br>
                            <a href="${json_url}">${json_url}</a><br>
                            Is it blocked by the browser, an extension, or your firewall?
                        </div>`));
                }
                if (!hideables || hideables.length == 0) {
                    return;
                }
                X('html').addClass('sfx_hide_show_all');
                hideables.forEach(function (hideable, hideable_idx) {
                    resolve(hideable).forEach(el => {
                        const $el = X(el);
                        // make it overflow:visible for measurement
                        $el.addClass('sfx_hide_show_overflow');
                        var rect = el.getBoundingClientRect();
                        $el.removeClass('sfx_hide_show_overflow');
                        var h = rect.height;
                        var w = rect.width;
                        if (!h || !w) {
                            hideable.hollow = true;
                            return;
                        }
                        hideable.filled = true;
                        h = Math.max(h, 20);
                        w = Math.max(w, 20);
                        var position = ($el.css('position') == 'absolute' && $el.parent().css('position') == 'relative') ? 'position:relative;' : '';
                        var tooltip = `data-hover="hider-tooltip" data-hider-title="${hider_title(hideable_idx)}"`;
                        if (h > 500) {
                            tooltip += ` data-tooltip-position="${(rect.left > 200) ? 'left' : 'right'}";`;
                        }
                        var classes = 'sfx_hide_frame' + (!hiddens[hideable.id] ? '' : ' sfx_hide_frame_hidden sfx_hide_hidden');
                        var font_size = Math.min(h, window.innerHeight) / 1.5;
                        var styles = `width:${w}px;height:${h}px;font-size:${font_size}px;line-height:${h}px;display:${$el.css('display')};${position}`;
                        var wrapper = X(`<span ${tooltip} class="${classes}" style="${styles}" sfx_hider_id="${hideable.id}">X</span>`);

                        wrapper.click(function (target) {
                            target.preventDefault();
                            target.stopPropagation();
                            var hiding = !hiddens[hideable.id];
                            resolve(hideable).toggleClass("sfx_hide_hidden", hiding);
                            if (hiding) {
                                hiddens[hideable.id] = hideable;
                            } else {
                                delete hiddens[hideable.id];
                            }
                            // Update tooltip & classes for all of this hider's wrappers
                            X(`[sfx_hider_id="${hideable.id}"]`)
                                .toggleClass("sfx_hide_frame_hidden sfx_hide_hidden", hiding)
                                .attr('data-hider-title', hider_title(hideable_idx));
                            set_css_rules();
                        });
                        $el.before(wrapper);
                    });
                });
                X('html').removeClass('sfx_hide_show_all');
                // Note any old-layout hiders which are still effective
                X.support_note('Hide/Show old layout hideables',
                               hideables.filter(oh => oh.filled && oh.id < 10000).map(oh => oh.id).join(', '));
                // Note any hiders which find only zero-size ('hollow') elements
                X.support_note('Hide/Show hollow hideables',
                               hideables.filter(hh => hh.hollow && !hh.filled).map(hh => hh.id).join(', '));
            };
            var hide_parts_of_page_custom = FX.option('hide_parts_of_page_custom');
            var hide_parts_custom_merge = FX.option('hide_parts_custom_merge');

            var hideables = [];
            if (hide_parts_of_page_custom) {
                try {
                    var json = JSON.parse(hide_parts_of_page_custom);
                    if (json && json.hideables && json.hideables.length) {
                        hideables = json.hideables;
                        if (!hide_parts_custom_merge) {
                            return show_hideables(hideables, false);
                        }
                    }
                } catch(e) {
                    alert("ERROR Parsing custom JSON: "+e.toString());
                }
            }
            // hideable.json contains 'hideables': name[0] = filename, name[1] = struct name
            /* subscriptions.js: */ /* global update_subscribed_items */
            update_subscribed_items(['hideable', 'hideables', 'hiddens'], hiddens, function (subscriptions) {
                var warn_server = true;
                (Object.values(subscriptions) || []).forEach(function (server_item) {
                    if (!X.isObject(server_item)) {
                        return;
                    }
                    warn_server = false;      // Got at least one record from the server
                    var already_have = false;
                    hideables.forEach(function (hideable_item) {
                        if (hideable_item.id == server_item.id) {
                            already_have = true;
                        }
                    });
                    if (!already_have) {
                        hideables.push(server_item);
                    }
                });
                SFX.pose({ hiddens, hideables, resolve_hideable: resolve, });
                show_hideables(hideables, warn_server);
            });
        });

        X.subscribe("hide/off", function () {
            X('html').removeClass('sfx_hide_show_all');
            X('.sfx_hide_frame').remove();
            // Persist hidden areas
            X.storage.save('hiddens', hiddens, function () {
                set_css_rules();
            });
        });

        // Update subscribed hiders in the background every so often
        X.task('update_hider_subscriptions', 4 * X.hours, function () {
            update_subscribed_items(['hideable', 'hideables', 'hiddens'], hiddens, function(_, dirty) {
                if (dirty) {
                    set_css_rules();
                }
            });
        });
    });
});
