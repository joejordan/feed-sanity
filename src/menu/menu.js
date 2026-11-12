FX.add_option('disabled', {"hidden": true, "default":false});

X.beforeReady(function(options) {
	// Prevent modules from running until we decide if SFX is disabled, which we can't do until options are loaded
	if (!options) { return false; }
	if (typeof sfx_menu_style !== 'undefined') {
		X.css(sfx_menu_style, 'sfx_menu_style');
	}
	// Check to see if SFX is disabled
	if (FX.option('disabled')) {
		// If we're disabled, we still need to add the wrench
		SFX.buildstr += ' (DISABLED)';
		init_wrench(true);
		X.when(SFX.badge_sel, $badge => $badge.attr('sfx_notification_count', 'X'));
		FX.fire_content_loaded();
		return false;
	}
	if (typeof sfx_style !== 'undefined') {
		X.css(sfx_style, 'sfx_style');
	}
});
X.ready( 'menu', function() {
	init_wrench(false);
});
var init_wrench = function(disabled) {
	FX.add_option('badge_x', {"hidden": true, "default": -64});
	FX.add_option('badge_y', {"hidden": true, "default": 5});
	FX.add_option('reset_wrench_position', {"title": '  Wrench Menu', "section": "Advanced", "description": "If your wrench menu badge somehow gets positioned so you can't see it, click here to reset its position to the upper right corner.", "type": "action", "action_text": "Find Wrench Menu", "action_message": "menu/reset_position"});
	FX.add_option('news_alerts', {"title": 'Social Fixer News', "section": "Advanced", "description": "Check for official news or blog posts from the Social Fixer team so you don't miss out on updates, updated filters, important news, etc. (Estimated frequency is one post a week)", "default": true});
	var actions = {
		"add": function (section, menu_item) {
			data.sections[section].items.push(menu_item);
		}
		,"remove": function(section, menu_item) {
			var items = data.sections[section].items;
			for( var i = 0; i < items.length; i++){
				var existing_item = items[i];
				if (menu_item.message===existing_item.message) {
					items.splice(i, 1);
					i--;
				}
			}
		}
		, "click": function (message) {
			if (message) {
				X.publish(message);
			}
		}
		, "toggle": function () {
			var $badge = X(SFX.badge_sel);
			var $menu = $badge.find('[id=sfx_badge_menu]');
			if ($menu.css('display') == 'none') {
				$menu.css('visibility', 'hidden');
				$menu.show();
				// Figure out which direction to pop the menu
				var window_width = document.body.clientWidth || window.innerWidth;
				var window_height = window.innerHeight;
				var left = $badge[0].offsetLeft;
				var top = $badge[0].offsetTop;

				if (left <= window_width / 2) {
					$menu.addClass('right').removeClass('left');
				}
				else {
					$menu.addClass('left').removeClass('right');
				}

				if (top <= window_height / 2) {
					$menu.addClass('down').removeClass('up');
				}
				else {
					$menu.addClass('up').removeClass('down');
				}
				$menu.css('visibility', '');
			}
			else {
				$menu.hide();
			}
		}
		, "hide": function () {
			let cur_menu = X(`${SFX.badge_sel} [id=sfx_badge_menu]`);
			if (cur_menu[0].style.display !== 'none') {
				X.publish('esc/prevent');
				cur_menu.hide();
			}
		}
	};
	const update_total_notify = function (count) {
		X.publish('notify/set', {
			target: `.${SFX.instance} [id=sfx_unread_blog_count]`,
			parent_target: SFX.badge_sel,
			count, });
	};
	var data = {
		"sections": {
			"options": {
				"title": "Options",
				"items": [],
				"order": 1
			},
			"actions": {
				"title": "Actions",
				"items": [],
				"order": 2
			},
			"links": {
				"title": "Links",
				"items": [],
				"order": 3
			},
			"debug": {
				"title": "Debug",
				"items": [],
				"order": 4
			},
			"other": {
				"title": "Other",
				"items": [],
				"order": 5
			}
		},
		tips: !FX.option('disable_tooltips'),
	};
	var html = FX.oneLineLtrim(`
		<div id="sfx_badge" class="${SFX.instance}" @click.stop="toggle" v-tooltip="{content:'Drag to move Social Fixer wrench menu badge - ${SFX.buildstr}',delay:1500}">
			<div id="sfx_badge_menu">
				<div id="sfx_badge_menu_wrap">
					<div v-for="section in sections | orderBy 'order'" class="sfx_menu_section" id="sfx_menu_section_{{$key}}">
						<div v-if="section.items.length" class="sfx_menu_section_title">{{section.title}}</div>
						<div v-for="item in section.items" id="{{item.id}}" class="sfx_menu_item" @click="click(item.message);" title="{{tips ? item.tooltip : ''}}">
							<a v-if="item.url" href="{{item.url}}" target="{{item.target}}" class="sfx_menu_item_content" style="display:block;">{{{item.html}}}</a>
							<div v-else class="sfx_menu_item_content">{{{item.html}}}</div>
						</div>
					</div>
				</div>
			</div>
			<div id="sfx_badge_logo"></div>
		</div>
	`);

	var badge_greetings = function ($badge) {
		// If this is the first install, show the user where the badge is
		FX.on_options_load(function () {
			if (!FX.storage('stats').installed_on) {
				const position = (FX.option('badge_x') < 0) ? 'left' : 'right';
				const larr = position === 'right' ? '&larr; ' : '';
				const rarr = position === 'left'  ? ' &rarr;' : '';
				const note = sticky_note(SFX.badge_sel, position, larr + 'Social Fixer is installed! Start here' + rarr);
				X.storage.set('stats', 'installed_on', X.now());
				$badge[0].addEventListener('mouseover', () => note.remove(), { once: true });
			}
		});
	};

	var made_badge = false;

	var make_badge = function () {
		// Don't try if document body not yet created;
		// don't show on login page (or before we know whether it is one).
		// FUTURE: wrench might give menu noting that pre-login settings
		// apply only to the login page.  Users may wish to use Hide/Show
		// or Display Tweaks to improve the login page.  (In that event,
		// 'is installed!' banner should still defer until logged in.)
		if (!X.find('body') || !FX.isNonLoginPage) {
			return null;
		}

		// If the badge already exists for some reason, we have multiple SFx
		// instances running.  Despite the 'old' naming here, we don't know
		// which is 'newer' or 'better'.  Create our badge, leaving the other
		// one active.  Report it to the user (in sfx_collision.js), passing
		// version info between instances via their badge DOM attributes.
		var $old_badge = X('[id=sfx_badge]'), old_buildstr = null;
		if ($old_badge.length) {
			// other SFX's name (or older nameless, call it 'old')
			old_buildstr = $old_badge.attr('sfx_buildstr') || 'old';
		}

		// Attach the menu template to the DOM
		template("body", html, data, actions).ready(function () {
			position_badge('saved', null, false);
			X.draggable(SFX.badge_sel, function (el, x, y) {
				position_badge(x, y, true);
			});
		});
		var $new_badge = X(SFX.badge_sel);
		$new_badge.attr('sfx_buildstr', SFX.buildstr).attr('old_buildstr', old_buildstr);
		badge_greetings($new_badge);
		made_badge = true;
		return $new_badge;
	};

	/* eslint-disable no-mixed-spaces-and-tabs */
	// Try rapidly to make the badge appear as early as we can.
	var check_badge = function() {
		if (!made_badge &&			// Only make it once
		    check_badge.tries-- > 0) {		// Don't be a permanent burden
			if (FX.isNonLoginPage) {	// FX.isNonLoginPage is async
							// Never on the FB login page!
				make_badge('check_badge');
			}
			setTimeout(check_badge, check_badge.cadence * X.seconds);
		}
	};
	/* eslint-enable no-mixed-spaces-and-tabs */
	check_badge.cadence = 0.5;			// 2x a second
	check_badge.tries = 10 / check_badge.cadence;	// for max 10 seconds
	setTimeout(check_badge, check_badge.cadence * X.seconds);

	// This content_loaded call normally happens long after the
	// check_badge timer series has succeeded; it's just a suspender
	// to go with the belt.
	FX.on_content_loaded(() => made_badge || make_badge());

	const pb_log = X.logger('position_wrench');

	const position_badge = function (x, y, persist, is_retry = false) {
		if (!X('#sfx_style').length) {
			if (!is_retry) {
				pb_log('sfx_style     ', 'not ready: retry');
				return setTimeout(() => position_badge(x, y, persist, true), 0.2 * X.seconds);
			} else {
				pb_log('sfx_style     ', 'missing, giving up');
				X.support_note('position_badge', 'sfx_style was missing');
			}
		}
		var $badge = X(SFX.badge_sel);
		if (!$badge.length) {
			$badge = make_badge();
			if (!$badge) {
				pb_log('make_badge()  ', "didn't work");
				X.support_note('position_badge', "make_badge() didn't work");
				return;
			}
		}

		const window_width = document.body.clientWidth || window.innerWidth;
		const window_height = window.innerHeight;
		pb_log('document.body ', document.body.clientWidth, document.body.clientHeight);
		pb_log('window.inner  ', window.innerWidth, window.innerHeight);
		pb_log('window_size   ', window_width, window_height);

		if (x == 'saved') {
			// Re-position it with saved options
			x = FX.option('badge_x');
			y = FX.option('badge_y');
			pb_log('previous saved', x, y);
		}
		if (!Number.isInteger(x) || !Number.isInteger(y)) {
			x = FX.option_default('badge_x');
			y = FX.option_default('badge_y');
		}
		pb_log('integer check ', x, y);

		// Reconstitute from possible negative saved values
		x = (x < -window_width)  ? 0 : (x < 0) ? x + window_width  : x;
		y = (y < -window_height) ? 0 : (y < 0) ? y + window_height : y;
		pb_log('reconstituted ', x, y);

		// Make sure it's on the screen (+4px for badge notification indicator)
		const badge_size = $badge.offset();
		pb_log('badge_size    ', badge_size.width, badge_size.height);
		if (badge_size.width  < 5 || badge_size.width  > 100 ||
		    badge_size.height < 5 || badge_size.height > 100) {
			// width / height can be crazy before SFx CSS loads; if so,
			// force it to the default image's size (may still be wrong
			// if user is overriding it with CSS, but won't be way off)
			badge_size.width = badge_size.height = 34;
			pb_log('override size ', badge_size.width, badge_size.height);
		}
		x = Math.max(4, Math.min(x, window_width -  badge_size.width));
		y = Math.max(4, Math.min(y, window_height - badge_size.height));
		pb_log('kept on-screen', x, y);

		// Position it
		$badge.css({ left: x, top: y, });

		// Persist the badge location
		if (persist) {
			// If the position is on the right or bottom half of the window, store
			// it as a negative relative to the opposite edge.  This helps retain a
			// reasonable position if the window size is dragged larger or smaller.
			x = (x > window_width  / 2) ? x - window_width  : x;
			y = (y > window_height / 2) ? y - window_height : y;
			pb_log('values to save', x, y);
			FX.option('badge_x', x, false);
			FX.option('badge_y', y, false);
			X.storage.save("options");
		}
	};

	actions.add('links', {id: 'sfx_badge_menu_item_page', html: '<span id="sfx_unread_blog_count"></span>Social Fixer News/Blog', url: 'https://www.facebook.com/socialfixer', message: 'menu/news_clicked'});
	actions.add('links', {'html': 'Support Group', 'url': 'https://socialfixer.com/support/'});
	if (disabled) {
		actions.add('options', {'html': 'Social Fixer is <span style="color:red;font-weight:bold;">Disabled</span>.<br>Click here to Enable.</span>', 'message': 'menu/enable'});
		actions.add('other', {'html': 'Version ' + SFX.buildstr, 'message': 'menu/about_clicked'});
	}
	else {
		actions.add('options', {'html': 'Social Fixer Options <span style="font-size:calc(0.5rem * var(--sfx_ui_scale));color:#aaa;">(Ctrl+Shift+X)</span>', 'message': 'menu/options'});
		actions.add('links', {'html': 'Donate To Support Development', 'url': 'https://socialfixer.com/donate.html'});
		actions.add('other', {'html': 'Version ' + SFX.buildstr, 'message': 'menu/about_clicked'});
		actions.add('other', {'html': 'Disable Social Fixer', 'message': 'menu/disable'});
	}

	const open_disabled_menu = function() {
		// Reset badge position: menu we're opening must be visible
		X.publish('menu/reset_position');
		// Open menu (now at default position)
		return X.when(SFX.badge_sel, $badge => $badge.click());
	};

	// Keyboard shortcut to Options (enable-only menu when disabled)
	X(window).keyup(function(e) {
		// Opera & sometimes Firefox have Ctrl-Shift-X shortcuts,
		// so accept this without minding any extra modifiers.
		if (!e.ctrlKey || !e.shiftKey || (e.key != 'x' && e.key != 'X')) {
			return;
		}
		e.preventDefault();
		e.stopPropagation();
		if (disabled) {
			return open_disabled_menu();
		}
		// Re-display wrench in user's position (it sometimes disappears)
		// then open Options.  If harder reset desired, do it in Options.
		position_badge('saved', null, false);
		X.publish("menu/options");
	});

	// Listen for enable/disable
	X.subscribe('menu/disable', function() {
		if (confirm("This will disable all Social Fixer functionality, but the wrench will still appear so you can re-enable.\n\nThe page will be automatically refreshed after disabling.\n\nAre you sure you want to disable?")) {
			X.storage.set('options','disabled',true,function() {
				window.location.reload();
			});
		}
	});
	X.subscribe('menu/enable', function() {
		X.storage.set('options','disabled',false,function() {
			window.location.reload();
		});
	});

	// Listen for messages to add items to the menu
	X.subscribe_backlog('menu/add', function (msg, data) {
		actions.add(data.section, data.item);
	});
	// Listen for messages to REMOVE items from the menu
	X.subscribe('menu/remove', function (msg, data) {
		actions.remove(data.section, data.item);
	});

	X(window).click(actions.hide);
	X.subscribe('esc/pressed', actions.hide);
	window.addEventListener('resize', function () {
		position_badge('saved', null, true);
	});

	X.subscribe("menu/reset_position", function (/* msg, data */) {
		var undef;
		X.storage.set('options', {'badge_x': undef, 'badge_y': undef}, function () {
			position_badge('saved', null, true);
		});
	});

	// About
	X.subscribe('menu/about_clicked', function () {
		X.publish("menu/options", {"section": "About"});
	});

	// If disabled, don't check for blog posts; do respond to Options URL
	if (disabled) {
		if (/sfx_options=true/.test(location.href)) {
			open_disabled_menu();
		}
		return;
	}

	// NEWS CHECK
	// Check for Posts to the Social Fixer Page and alert if there are new ones
	FX.on_options_load(function () {
		X.task('news_alerts', 1 * X.seconds, function () {
			if (FX.option('news_alerts')) {
				X.when(`.${SFX.instance} [id=sfx_badge_menu_item_page]`, function ($item) {
					var now = X.now();
					X.storage.get('stats', {}, function (stats) {
						// Don't show the current blog entry when first installed;
						// wait for the next one -- nobody wants to install a thing
						// and it immediately starts bleating about its blog alerts!
						if (!stats || !stats.sfx_news_checked_on) {
							X.storage.set("stats", "sfx_news_checked_on", now, function () {
							});
						}
						else {
							X.ajax("https://matt-kruse.github.io/socialfixerdata/news.json", function (json) {
								if (!json || !json.news) {
									return;
								}
								var count = 0, title = null, main_href = null;
								const $link = $item.find('a');
								json.news.reverse().forEach(function (news) {
									// Oldest processed last, so href
									// points to oldest not-seen entry.
									if (news.time > stats.sfx_news_checked_on) {
										main_href = $link.attr('href');
										$link.attr('href', news.href);
										title = news.title;
										count++;
									}
								});
								update_total_notify(count);

								if (count>0) {
									// Add a "clear notification" link
									var $clear = X(`<div style="text-align:right;font-size:calc(0.55rem * var(--sfx_ui_scale));color:#777;" class="sfx_link sfx_clear_notification_link">clear notification</div>`);
									$clear.click(function () {
										$link.attr('href', main_href);
										clear_news_notification();
									});
									$item.before($clear);
								}
								if (count == 1 && title) {
									$item.find('.sfx_menu_item_content').append('<div class="sfx_news_title">' + X.sanitize(title) + '</div>');
								}
							});
						}
					});
				});
			}
		});
	});
	var clear_news_notification = function() {
		X.storage.set("stats", "sfx_news_checked_on", X.now(), function () {
			update_total_notify(0);
			X('.sfx_news_title,.sfx_clear_notification_link').remove();
		});
	};
	X.subscribe('menu/news_clicked', function (/* msg, data */) {
		// Clear when clicked
		clear_news_notification();
	});
};
