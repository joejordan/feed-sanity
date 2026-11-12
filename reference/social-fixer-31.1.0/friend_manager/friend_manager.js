X.ready('friend_manager', function() {
    FX.add_option('friend_tracker', {"title": 'Friend Manager', "description": "Enable Friend Manager (Friends List Tracker)", "default": true});

    FX.add_option('friend_tracker_alert_unfriend', {"hidden":true, "default": true});
    FX.add_option('friend_tracker_alert_unfriend_count', {"hidden":true, "default": 3});
    FX.add_option('friend_tracker_alert_refriend', {"hidden":true, "default": true});
    FX.add_option('friend_tracker_alert_name_change', {"hidden":true, "default": true});
    FX.add_option('friend_tracker_update_frequency', {"hidden":true, "default": 1 });

    var log = X.logger('friend_manager');

    // Load the friends pref
    var fm_friends = X.clone(FX.storage('friends'));
    var fm_alerts = [];
    var custom_fields = FX.option('friend_custom_fields');

    X.subscribe("friends/options", function(msg,d) {
        // Render the friends dialog content
        var sections = [
            {"key":"alerts", "name":"Alerts"}
            ,{"key":"options", "name":"Options"}
            ,{"key":"list", "name":"Friends List"}
            ,{"key":"details", "name":"Friend Details"}
            ,{"key":"data", "name":"Raw Data"}
        ];
        var dialog = FX.oneLineLtrim(`<div id="sfx_friend_dialog" class="sfx_dialog sfx-flex-column" style="transition: height .01s;">
	<div id="sfx_options_dialog_header" class="sfx_dialog_title_bar" style="cursor:move;" @click="collapse" v-tooltip="{content:'Click to window-shade, drag to move',position:'below'}">
		Friend Manager - Social Fixer ${SFX.version}
		<div id="sfx_options_dialog_actions" draggable="false" >
			<input draggable="false" type="button" class="sfx_button secondary" @click.stop="close" value="Close">
		</div>
	</div>
	<div id="sfx_options_dialog_body" class="sfx-flex-row" draggable="false">
		<div id="sfx_options_dialog_sections">
			<div v-for="section in sections" @click="select_section(section.key)" class="sfx_options_dialog_section {{selected_section==section.key?'selected':''}}">{{section.name}}</div>
		</div>
		<div id="sfx_options_dialog_content">
			<div class="sfx_options_dialog_content_section">
				<div v-show="selected_section=='options'" style="line-height:32px;">
					<div><sfx-checkbox key="friend_tracker_alert_unfriend"></sfx-checkbox> Track and alert when someone is not present on my Facebook Friends List</div>
					<div>Alert about absent friends after this many absences: <input class="sfx_input" type="number" min="1" max="99" v-model="uf_count" @change="update_uf_count()"/></div>
					<div><sfx-checkbox key="friend_tracker_alert_refriend"></sfx-checkbox> Track and alert when someone reappears on my Facebook Friends List</div>
					<div><sfx-checkbox key="friend_tracker_alert_name_change"></sfx-checkbox> Track and alert when a friend changes their name</div>
					<div>Check for Friends List changes after this many hours: <input class="sfx_input" type="number" min="1" max="999" v-model="frequency" @change="update_frequency()"/></div>
					<div>Update my Friends List and check for changes immediately: <input type="button" @click="check_now()" class="sfx_button" value="Check Now"></div>
				</div>
				<div v-show="selected_section=='alerts'" id="sfx_friend_alerts"></div>
				<div v-show="selected_section=='list'">
					<div v-if="!list_loaded">Loading...</div>
					<div v-if="list_loaded">
						<div style="margin-bottom:3px;">
                            <b>Filter: </b><input class="sfx_input" type="text" v-model="filter">
                            <br>
                            <span v-if="limit < 9999 && nfriends > nlimit">
                                <b>Page: </b>
                                <a @click.prevent="set_page(-1)" class="sfx_link">&lt;&lt;</a>
                                &nbsp;{{page+1}} of {{Math.trunc((nfriends + nlimit - 1) / nlimit)}}&nbsp;
                                <a @click.prevent="set_page(1)" class="sfx_link">&gt;&gt;</a>
                            </span>
                            <span v-else>
                                Showing all {{nfriends}} friends.
                            </span>
                            <b>&nbsp; Friends per page: </b>
                            &middot;&nbsp;
                            <template v-for="value in ['10','50','100','250','500','1000','all']">
                                <a @click.prevent="set_limit(value)" class="sfx_link" v-bind:class="{'sfx_button':(value==limit)}">{{value}}</a> &middot;&nbsp;
                            </template>
                        </div>
						<table class="sfx_data_table">
							<thead>
								<tr>
									<th>&nbsp;</th>
									<th class="sortable" @click="order('name')">Name</th>
									<th class="sortable" @click="order('first')">First</th>
									<th class="sortable" @click="order('last')">Last</th>
									<th class="sortable" @click="order('id')">ID</th>
									<th class="sortable" @click="order('tracker.status')">Status</th>
									<th v-for="field in custom_fields">{{field}}</th>
									<th class="sortable" @click="order('tracker.added_on')">Added</th>
								</tr>
							</thead>
							<tbody>
								<tr v-for="f in fm_friends | filterBy filter | orderBy orderkey sortorder | limitBy nlimit (page*nlimit)">
									<td @click="select_user(f.id)"><img src="{{f.photo}}" style="height:48px;width:48px;"></td>
									<td class="sfx_hover_link" style="font-weight:bold;" @click="select_user(f.id)">{{f.name}}</td>
									<td>{{f.first}}</td>
									<td>{{f.last}}</td>
									<td><a href="https://www.facebook.com/{{f.id}}">{{f.id}}</a></td>
									<td>{{f.tracker.status}}</td>
									<td v-for="field in custom_fields">{{f.data[field]}}</td>
									<td>{{f.tracker.added_on | date}}</td>
								</tr>
							</tbody>
						</table>
					</div>
				</div>
				<div v-show="selected_section=='details'">
					<div v-if="!selected_user">
						Click on a friend in the "List" section.
					</div>
					<div v-else>
						<a href="https://www.facebook.com/{{selected_user.id}}"><img src="{{selected_user.photo}}" style="float:left;margin-right:20px;"><span style="font-size:calc(0.72rem * var(--sfx_ui_scale));font-weight:bold;">{{selected_user.name}}</span></a>
						<br style="clear:both;">

						This section will be used for future functionality that will enhance your Friends List even more!

						<!--
						<b>Custom Fields</b> : Fields below are created by you and maintained in the Options tab. You can define any fields, and any value in those fields per user.
						<div v-for="field in custom_fields" style="margin:10px;border:1px solid #ccc;padding:10px;">
							<b>{{field}}</b>: <input v-model="selected_user.data[field]">
						</div>
						-->
					</div>
				</div>
				<div v-show="selected_section=='data'" style="white-space:pre;font-family:monospace;">{{fm_friends | json}}</div>
			</div>
		</div>
	</div>
</div>
`);
        var data = {
            "sections": sections
            ,"selected_section":"alerts"
            ,fm_friends
            ,nfriends: Object.keys(fm_friends).length
            ,"list_loaded":false
            ,"orderkey":"name"
            ,"sortorder":1
            ,"filter":""
            ,"selected_user":null
            ,"custom_fields":X.clone(custom_fields)
            ,"frequency":FX.option("friend_tracker_update_frequency")
            ,"uf_count":FX.option("friend_tracker_alert_unfriend_count")
            ,"limit":50
            ,"nlimit":50
            ,"page":0
        };
        if (d&&d.selected) {
            data.selected_section=d.selected;
        }
        // Count friends

        var actions = {
            "select_section": function (key) {
                this.selected_section = key;
                var self = this;
                if (key == "list") {
                    // Lazy load the list for better performance
                    setTimeout(function() {
                        Vue.nextTick(function () {
                            self.list_loaded = true;
                        });
                    }, 100);
                }
            },
            "select_user": function(id) {
                this.selected_user = fm_friends[id];
                this.select_section('details');
            },
            "order": function(key) {
                this.sortorder = (this.orderkey == key) ? -1 * this.sortorder : 1;
                this.orderkey = key;
            },
            "close": function() {
                X('#sfx_friend_dialog').remove();
            },
            "check_now": function() {
                X.publish("friends/update");
            },
            "update_frequency": function () {
                FX.option('friend_tracker_update_frequency', data.frequency, true);
            },
            "update_uf_count": function () {
                FX.option('friend_tracker_alert_unfriend_count', data.uf_count, true);
            },
            "set_limit": function(l) {
                this.limit = l;
                this.nlimit = l == 'all' ? 9999 : Number(l);
                this.page = 0;
            },
            "set_page": function(p) {
                this.page += p;
                if (this.page < 0) {
                    this.page = 0;
                }
            },
            "collapse": function () {
                X('#sfx_options_dialog_body').toggle();
            },
        };
        template(document.body, dialog, data, actions).ready(function () {
            X.draggable('#sfx_friend_dialog');
            Vue.nextTick(function() {
                find_alerts();
                render_alerts('just now', true, '#sfx_friend_alerts', 'sfx_friend_changes_fm');
                if (fm_alerts.length == 0) {
                    actions.select_section("list");
                }
            });
        });
    });

    var fb_dtsg;
    X.subscribe_backlog('fb_dtsg/ready', (msg, data) => {
        fb_dtsg = data.fb_dtsg;
        var fb_dtsg_status = 'succeeded';
        if (fb_dtsg === 'failed') {
            fb_dtsg_status = 'failed';
        }
        X.support_note('fb_dtsg', `${data.technique} ${fb_dtsg_status} after ${(performance.now() / X.seconds).toFixed(6)} seconds`);
    });

    const retrieve_friends = function(cb) {
        // This request now requires the anti-CSRF token
        if (!fb_dtsg) {
            log('retrieve_friends 0: no fb_dtsg');
            X.support_note('retrieve_friends:0', `fb_dtsg not found: [${fb_dtsg}]`);
            return cb(null);
        }
        var friends_url = FX.oneLineLtrim(`
            https://www.facebook.com/ajax/typeahead/first_degree.php
            ?viewer=${X.userid}
            &__user=${X.userid}
            &filter[0]=user
            &options[0]=friends_only
            &__a=1
            &lazy=0
            &t=${X.now()}
            &fb_dtsg_ag=${fb_dtsg}
        `);
        X.ajax(friends_url, function(content) {
            // This uses the browser console to take advantage of its structure explorer
            // -- and encapsulate as [{ object }] so the structures start out collapsed.
            if (typeof content !== 'string') {
                console.log('retrieve_friends:1: unexpected content type:', typeof content, [{ content, }]);
                X.support_note('retrieve_friends:1', `unexpected content type '${typeof content}' (see browser console)`);
                return cb(null);
            }
            try {
                var json = JSON.parse(content.replace(/^[^{}]*/, ''));
                if (!json || !json.payload || !json.payload.entries) {
                    console.log('retrieve_friends:2: unexpected JSON content:', [{ content, json, }]);
                    X.support_note('retrieve_friends:2', 'unexpected JSON content (see browser console)');
                    return cb(null);
                }
                return cb(json.payload.entries);
            } catch(e) {
                console.log('retrieve_friends:3: JSON.parse failed:', [{ error: e, content, json, }]);
                X.support_note('retrieve_friends:3', `JSON.parse failed: ${e} (see browser console)`);
                return cb(null);
            }
        });
    };

    const update_friends = function(cb) {

        // Retrieve Friends List
        var now = X.now();
        var empties = 0;
        var changes = 0;
        retrieve_friends(function(list) {
            if (list == null) {
                return cb(null);
            }

            var f, uid, sfx_friend;
            // For each friend, create the default record if needed
            for (f of list) {
                uid = f.uid;
                if (!Number(uid)) {
                    X.support_note('update_friends:1', 'non-numeric UID in FB data');
                    continue;
                }
                sfx_friend = fm_friends[uid];
                if (typeof sfx_friend == "undefined" || typeof sfx_friend.tracker == "undefined") {
                    sfx_friend = {
                        "id":f.uid
                        ,"name":f.text
                        ,"first":f.firstname
                        ,"last":f.lastname
                        ,"photo":f.photo
                        ,"tracker": {
                            "added_on":now
                            ,"status":"friend"
                            ,"updated_on":now
                            ,"acknowledged_on":null
                        }
                    };
                    fm_friends[uid] = sfx_friend;
                }
                // check for updated photo and name
                if (f.text != sfx_friend.name) {
                    sfx_friend.old_name = sfx_friend.name;
                    sfx_friend.name = f.text;
                    sfx_friend.first = f.firstname;
                    sfx_friend.last = f.lastname;
                    sfx_friend.dirty = true;
                }
                if (sfx_friend.photo != f.photo) {
                    // Do not report these as 'changes' to the user: they
                    // are almost always just CDN cache path differences;
                    // we can't distinguish them from actual new avatars.
                    sfx_friend.photo_dirty = true;
                    sfx_friend.photo = f.photo;
                }
                sfx_friend.checked_on = now;
                sfx_friend.tracker.missing_count = 0;
            }

            // Loop over friends to check for changes
            for (uid in fm_friends) {
                // Handle strange records due to some past bug
                if (!Number(uid)) {
                    X.support_note('update_friends:2', 'non-numeric UID in FT data');
                    delete fm_friends[uid];
                    X.storage.set("friends", uid, undefined, null, false);
                    continue;
                }

                f = fm_friends[uid];

                // Handle empty records due to some past bug
                if (!f.id || !f.tracker) {
                    ++empties;
                    f.id = uid;
                    f.tracker = f.tracker || {
                        added_on: now,
                        status: 'record missing',
                        updated_on: now,
                        acknowledged_on: null,
                    };
                    f.dirty = true;
                }
                var tracker = f.tracker;

                // NEW Friend
                if (tracker.added_on == now) {
                    f.dirty = true;
                }

                // RE-FRIENDED
                else if (now == f.checked_on && tracker.status != "friend") {
                    tracker.status = "refriend";
                    tracker.updated_on = now;
                    tracker.acknowledged_on = null;
                    f.dirty = true;
                }

                // REMOVED Friend
                // (Not found in new list, but they existed in old list)
                else if (now !== f.checked_on && (tracker.status == "friend" || tracker.status == "refriend")) {
                    tracker.missing_count = (tracker.missing_count) ? tracker.missing_count + 1 : 1;
                    if (tracker.missing_count >= FX.option('friend_tracker_alert_unfriend_count')) {
                        tracker.status = "unfriended";
                        tracker.updated_on = now;
                        tracker.acknowledged_on = null;
                        tracker.blocked = null;
                    }
                    f.dirty = true;
                }

                // Update this friend record?
                if (f.dirty || f.photo_dirty) {
                    f.dirty && changes++;
                    delete f.dirty;
                    delete f.photo_dirty;
                    X.storage.set("friends", uid, f, null, false);
                }
            }

            // Persist the updated Friends List
            if (changes) {
                X.storage.save('friends');
            }
            if (typeof cb == 'function') {
                cb({total:Object.keys(fm_friends).length, changes});
            }
            X.support_note('update_friends:3', `fr:${Object.keys(fm_friends).length} ls:${list.length} ch:${changes} em:${empties}`);
        });
    };

    const find_alerts = function() {
        fm_alerts.splice(0);

        for (var i in fm_friends) {
            var f = X.clone(fm_friends[i]);
            if (!f || !f.tracker) {
                continue;
            }
            var t = f.tracker;
            var upd = t.updated_on;
            var ack = t.acknowledged_on;

            // Unfriend
            if (t.status == 'unfriended' && (!ack || ack < upd) && FX.option('friend_tracker_alert_unfriend'))  {
                fm_alerts.push({type: 'unfriend', friend: f});
                // TODO: distinguish between unfriended, blocked, account
                // closed, in jail, whatever?  We used to try, but it was
                // inaccurate; and it started to trigger anti-bot guards.
            }
            // Re-friend
            if (t.status == 'refriend' && FX.option('friend_tracker_alert_refriend')) {
                fm_alerts.push({type: 'refriend', friend: f});
            }
            // name change
            if (f.old_name && FX.option('friend_tracker_alert_name_change')) {
                fm_alerts.push({type: 'name_change', friend: f});
            }
        }
    };

    const update_jewel_count = function() {
        X.publish('notify/set', {
            target: `.${SFX.instance} [id=sfx_friend_jewel_count]`,
            parent_target: SFX.badge_sel,
            count: fm_alerts.length, });
    };

    const notify_if_alerts_exist = function() {
        find_alerts();
        update_jewel_count();
    };

    const render_alerts = function(ago, show_header, appendTo, id) {
        try {
            X(`[id=${id}]`).remove();
            const data = {
                fm_alerts,
                ago,
                show_header,
            };
            const ok_one = function(alert) {
                const f = fm_friends[alert.friend.id];
                // Resolve based on the type of the alert
                if (alert.type == 'unfriend') {
                    f.tracker.acknowledged_on = X.now();
                } else if (alert.type == 'refriend') {
                    f.tracker.status = 'friend';
                } else if (alert.type == 'name_change') {
                    // no UI for name history, yet
                    if (!f.old_names) {
                        f.old_names = [];
                    }
                    f.old_names.push(f.old_name);
                    delete f.old_name;
                }
                // Update, don't persist
                X.storage.set('friends', f.id, f, null, false);
            };
            const persist = function() {
                update_jewel_count();
                X.storage.save('friends');
            };
            const actions = {
                ok: function(alert) {
                    ok_one(alert);
                    data.fm_alerts.splice(data.fm_alerts.indexOf(alert), 1);
                    persist();
                },
                ok_all: function () {
                    for (const alert of data.fm_alerts) {
                        ok_one(alert);
                    }
                    data.fm_alerts.splice(0);
                    persist();
                },
                settings: function () {
                    X.publish('friends/options', {selected: 'options'});
                },
            };
            const friend_alerts_html = FX.oneLineLtrim(`<div id="${id}">
    <div style="max-height:300px;overflow:auto;border-bottom:1px solid rgb(221,223,226);">
	<div v-if="show_header" style="padding:8px 12px 6px 12px;border-bottom:1px solid rgb(221,223,226);">
		<div style="float:right">
			<a @click.prevent="settings">Settings</a>
			<span v-if="fm_alerts.length" role="presentation"> &middot; </span>
			<a v-if="fm_alerts.length" @click.prevent="ok_all" style="font-weight:bold;">Okay All</a>
		</div>
		<div><span style="font-size:calc(0.6rem * var(--sfx_ui_scale));font-weight:bold;">Friend Changes</span> <span style="font-size:calc(0.55rem * var(--sfx_ui_scale));font-style:italic;">(via Social Fixer, updated {{ago}})</span></div>
	</div>
	<div v-for="a in fm_alerts | orderBy 'friend.tracker.updated_on' -1" style="padding:6px 12px;border-bottom:1px solid rgb(221,223,226);">
		<div style="float:right;height:50px;vertical-align:middle;line-height:50px;">
			<span @click="ok(a)" class="sfx_button light">Okay</span>
		</div>
		<img src="{{a.friend.photo}}" style="height:48px;margin-right:10px;display:inline-block;">
		<div style="display:inline-block;height:50px;overflow:hidden;">
			<template v-if="a.type=='name_change'">
				{{a.friend.old_name}}<br>
				is now known as<br>
				<a href="/{{a.friend.id}}" style="font-weight:bold;">{{a.friend.name}}</a><br>
			</template>
			<template v-if="a.type=='unfriend'">
				<a href="/{{a.friend.id}}" style="font-weight:bold;">{{a.friend.name}}</a><br>
				no longer appears on your Facebook Friends List. <span v-show="a.friend.removed" style="color:red;text-decoration:underline;cursor:help;" v-tooltip="This account is not available. This person has either disabled or removed their account, blocked you, or this is a result of a Facebook glitch (which is not uncommon). If they are still your friend but their profile is temporarily unavailable, they will appear as re-friended when it returns.">Account Not Found!</span><br>
				<i>{{a.friend.tracker.updated_on | ago}}</i>
			</template>
			<template v-if="a.type=='refriend'">
				<a href="/{{a.friend.id}}" style="font-weight:bold;">{{a.friend.name}}</a><br>
				is now on your Facebook Friends List again! <br>
				<i>{{a.friend.tracker.updated_on | ago}}</i>
			</template>
		</div>
	</div>
	<div v-if="fm_alerts.length==0" style="line-height:50px;vertical-align:middle;color:rgb(117,117,117);background-color:rgb(246,247,249);text-align:center;">
		No changes
	</div>
    </div>
</div>
`);
            template(appendTo, friend_alerts_html, data, actions);
        } catch (e) {
            alert(e);
        }
    };

    FX.on_options_load(function() {
        if (FX.option('friend_tracker')) {
        // Add wrench menu item
            X.publish('menu/add', {
                section: 'options',
                item: {
                    html: '<span class="count" id="sfx_friend_jewel_count"></span>Friend Manager',
                    message: 'friends/options',
                    tooltip: 'Track changes to your Facebook friends list',
                },
            });

            // Update Friends List and check for changes
            X.task('friend_update', FX.option('friend_tracker_update_frequency') * X.hours, function () {
                log("Time to check for Friends List changes");
                X.subscribe_backlog('fb_dtsg/ready', function () {
                    update_friends(notify_if_alerts_exist);
                });
            }, notify_if_alerts_exist);

            X.subscribe('friends/update', function () {
                update_friends(function (result) {
                    if (result===null) {
                        alert("Error retrieving or updating friends list");
                    } else {
                        notify_if_alerts_exist();
                        alert(`Update Complete.\n${result.total} friends and ${result.changes} changes.`);
                    }
                });
            });
        }
    });
});
