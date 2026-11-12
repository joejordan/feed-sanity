// =====================================
// Control Panel operations
// =====================================
X.ready( 'control_panel', function() {
    FX.add_option('control_panel_x', {"hidden": true, "default": 0});
    FX.add_option('control_panel_y', {"hidden": true, "default": 50});
    FX.add_option('control_panel_right', {"hidden": true, "default": false});
    FX.add_option('control_panel_bottom', {"hidden": true, "default": false});
    FX.add_option('reset_control_panel_position', {"title": ' Control Panel', "section": "Advanced", "description": "Reset the position of the Control Panel to the upper left", "type": "action", "action_text": "Find Control Panel", "action_message": "cp/reset_position"});

    var control_panel_created, control_panel_displayed, control_panel_always = false;

    SFX.cp_selector = `[id=sfx_control_panel].${SFX.instance}`;
    var data;
    var reset = function () {
        X(SFX.cp_selector).remove();
        data = {
            "sections": []
        };
        control_panel_created = false;
        control_panel_displayed = false;
        SFX.pose({ cp_sections: data.sections,
                   cp_created: control_panel_created,
                   cp_displayed: control_panel_displayed,
                   cp_always: control_panel_always,
                });
    };
    reset();

    const close_cp = function () {
        control_panel_always = false;
        X.publish('cp/hide');
    };

    // Reset the position
    X.subscribe("cp/reset_position", function () {
        if (!control_panel_displayed) {
            X.publish('cp/show');
        } else if (!data.sections.length) {
            bubble_note(
                FX.oneLineLtrim(`
                    No posts have yet been filtered to a Social Fixer tab.<br>
                    The Control Panel will appear if a post is filtered.<br><br>
                    The following options turn on the CP permanently:<br><br>
                    - General > Mark All Read / Undo<br>
                    - Advanced > Always Show Tab List
                `), {title: 'No posts filtered yet', close: true});
        } else {
            FX.option('control_panel_x', null, false);
            FX.option('control_panel_y', null, false);
            FX.option('control_panel_right', null, false);
            FX.option('control_panel_bottom', null, false);
            X.storage.save("options");
            position_control_panel(null, null, false);
        }
    });

    // Add a SECTION
    X.subscribe("cp/section/add", function (msg, section_data) {
        if (!data.sections.some(sect => sect.id == section_data.id)) {
            create_control_panel();
            section_data.order = section_data.order || 999;
            // {"name", "id", "help", "order"}
            data.sections.push(section_data);
        }
    });
    X.subscribe('cp/hide', () => ((control_panel_displayed = false), X(SFX.cp_selector).hide()));
    X.subscribe('cp/show', () => ((control_panel_displayed = true),  X(SFX.cp_selector).show()));
    X.subscribe('cp/always_show', () => ((control_panel_always = true), X.publish('cp/show')));

    var create_control_panel = function () {
        if (control_panel_created || X.find(SFX.cp_selector)) {
            return;
        }

        // Don't create the control panel on some pages
        if (/\/memories\//.test(location.href) || /\/messages\//.test(location.href)) {
            return;
        }

        control_panel_created = true;

        var html = FX.oneLineLtrim(`<div id="sfx_control_panel" class="${SFX.instance}" style="display:none">
                <div class="sfx_cp_header" v-tooltip="{icon:false,content:'The Social Fixer Control Panel (CP) may contain filter tabs and controls such as Mark All Read &amp; Undo. Click X to disable associated features and hide it. Drag to move.',delay:750}"><span @click="close_cp" class='sfx_cp_close_button'>X</span>SFX Control Panel</div>
                <div class="sfx_cp_data">
                    <div class="sfx_cp_section" v-for="section in sections | orderBy 'order'">
                        <div class="sfx_cp_section_label" v-tooltip="{content:section.help,position:'right',delay:300}">{{{section.name}}}</div>
                        <div class="sfx_cp_section_content" id="{{section.id}}"></div>
                    </div>
                </div>
            </div>
            `);
        var actions = { close_cp };
        template(document.body, html, data, actions).ready(function () {
            // Position it
            position_control_panel(null, null, false);

            // Make it draggable
            X.draggable(SFX.cp_selector, function (el, x, y) {
                position_control_panel(x, y, true);
            });
        });
        if (control_panel_always) {
            X.publish('cp/show');
        }
    };
    var position_control_panel = function (x, y, save) {
        var $cp = X(SFX.cp_selector);
        if (!$cp.length) {
            return;
        }
        var right = FX.option('control_panel_right');
        var bottom = FX.option('control_panel_bottom');
        var snap_tolerance = 15;
        var reposition = false;
        if (typeof x == "undefined" || x == null || typeof y == "undefined" || y == null) {
            // Re-position it with saved options
            x = +FX.option('control_panel_x');
            y = +FX.option('control_panel_y');
            reposition = true;
        }
        var h = $cp[0].offsetHeight;
        var w = $cp[0].offsetWidth;

        // Constrain it to the screen
        if (x < 1) {
            x = 1;
        }
        if (!reposition) {
            right = (window.innerWidth && x + w > (window.innerWidth - snap_tolerance)); // Off the right side, snap it to the right
        }
        if (y < 40) {
            y = 40;
        }
        if (!reposition) {
            bottom = (window.innerHeight && y + h > (window.innerHeight - snap_tolerance)); // Off the bottom, snap to bottom
        }

        // Position it
        if (right) {
            $cp.css({'right': 0, 'left': ''});
        }
        else {
            $cp.css({'left': x, 'right': ''});
        }
        if (bottom) {
            $cp.css({'bottom': 0, 'top': ''});
        }
        else {
            $cp.css({'top': y, 'bottom': ''});
        }

        // Persist the control panel location
        if (false !== save) {
            FX.option('control_panel_x', x, false);
            FX.option('control_panel_y', y, false);
            FX.option('control_panel_right', right, false);
            FX.option('control_panel_bottom', bottom, false);
            X.storage.save("options");
        }
    };
    // On window resize, make sure control panel is on the screen
    X(window).resize(function () {
        position_control_panel();
    });
    // When the page unloads to navigate, remove the control panel
    X.subscribe_backlog('posts/reset', reset);
});
