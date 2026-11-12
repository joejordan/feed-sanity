X.ready('options', function() {
	/* subscriptions.js: */ /* global update_subscribed_items */
	/* subscriptions.js: */ /* global mark_subscribed_items */
	/* subscriptions.js: */ /* global retrieve_item_subscriptions */
	FX.add_option('show_filtering_tooltips', {"hidden":true, "default": true});

	FX.on_options_load(function () {
		// Update Tweaks and Filters in the background every so often
		X.task('update_filter_subscriptions', 4 * X.hours, function () {
			update_subscribed_items('filters', FX.storage('filters'));
		});
		X.task('update_tweak_subscriptions', 4 * X.hours, function () {
			update_subscribed_items('tweaks', FX.storage('tweaks'));
		});

		// Options Dialog
		var sections = [
			{'name': 'Search', 'description': 'Options with a title or description matching your search text (at least 3 characters) will appear below.'}
			, {'name': 'General', 'description': ''}
			, {'name': 'Hide Posts', 'description': ''}
			, {'name': 'Filters', 'description': ''}
			, {'name': 'Display Tweaks', 'description': ''}
			, {'name': 'Advanced', 'description': ''}
			, {'name': 'Experiments', 'description': 'These features are a work in progress, not fully functional, or possibly confusing to users.'}
			, {'name': 'Data', 'description': ''}
			, {'name': 'Support', 'url': 'https://matt-kruse.github.io/socialfixerdata/support.html', 'property': 'content_support'}
			, {'name': 'Donate', 'url': 'https://matt-kruse.github.io/socialfixerdata/donate.html', 'property': 'content_donate'}
			, {'name': 'About', 'url': 'https://matt-kruse.github.io/socialfixerdata/about.html', 'property': 'content_about'}
			, {'name': 'Debug', 'className':'sfx_debug_tab', 'description':`These are debugging tools to help developers and those needing support. These are not normal features. Play with them if you wish, or visit them if asked to by the Support Team.`}
		];
		var data = {
			"action_button": null
			, "show_action_buttons": true
			, "sections": sections
			, "filters": null
			, "show_filtering_tooltips": FX.option('show_filtering_tooltips')
			, "editing_meta": {}
			, "editing_filter": null
			, "filter_subscriptions": null
			, "tweak_subscriptions": null
			, "tweaks": null
			, "editing_tweak": null
			, "show_advanced": false
			, "options": FX.options
			, "user_options": ""
			, "user_options_message": null
			, "storage_size": JSON.stringify(X.storage.data).length
			, "supports_download_attribute": 'download' in document.createElement('a') // https://stackoverflow.com/a/12112905
			, "content_about": "Loading..."
			, "content_donate": "Loading..."
			, "sfx_option_show_donate": false
			, "content_support": "Loading..."
			, "support_notes": null
			, "searchtext":null
		};
		X.subscribe('menu/options', function (event, event_data) {
			if (!event_data) { event_data={}; }
			try {
				if (X('#sfx_options_dialog').length) {
					return;
				}

				// Prepare data for options dialog display.
				// We can't work on the real options object, in case the user cancels.
				// So we need to work on a copy, then overlay it when they save.

				// Convert the options into section-based options
				sections.forEach(function (section_object) {
					var sectionName = section_object.name;
					section_object.options = [];
					if (event_data.section) {
						section_object.selected = (event_data.section == sectionName);
					}
					else {
						section_object.selected = (sectionName == 'General');
					}
					for (var k in FX.options) {
						var opt = FX.options[k];
						if ((sectionName == 'General' && !opt.section) || (sectionName == opt.section)) {
							opt.newValue = opt.value = FX.option(opt.key);
							section_object.options.push(opt);
						}
						if (opt.title && opt.title==event_data.highlight_title) {
							opt.highlighted=true;
						}
					}

					section_object.options = section_object.options.sort(function (a, b) {
						var x = (a.title || "") + " " + (a.order || "") + " " + (a.description || "");
						var y = (b.title || "") + " " + (b.order || "") + " " + (b.description || "");
						if (x < y)
							return -1;
						if (x > y)
							return 1;
						return 0;
					});
				});

				const filters = Object.values(X.clone(X.storage.data['filters'] || [])).filter(el => !!el);
				data.filters = filters;

				const tweaks = Object.values(X.clone(X.storage.data['tweaks'] || [])).filter(el => !!el);
				data.tweaks = tweaks;

				if (X.support_notes) {
					data.support_notes = X.support_notes;
				}

				// Render the options dialog content
				var dialog = FX.oneLineLtrim(`<div id="sfx_options_dialog" class="sfx_dialog sfx-flex-column" style="transition: height .01s;">
	<div id="sfx_options_dialog_header" class="sfx_dialog_title_bar" style="cursor:move;" @click="collapse" v-tooltip="{content:'Click to window-shade, drag to move',position:'below'}">
		Social Fixer ${SFX.version}
		<div id="sfx_options_dialog_actions" v-if="show_action_buttons" draggable="false" >
			<input draggable="false" v-if="action_button=='done_editing_filter'" class="sfx_options_dialog_panel_button sfx_button" type="button" value="Done Editing Filter" @click.stop="close_filter">
			<input draggable="false" v-if="action_button=='done_editing_tweak'" class="sfx_options_dialog_panel_button sfx_button" type="button" value="Done Editing Tweak" @click.stop="close_tweak">
			<input draggable="false" v-if="!action_button" class="sfx_button" type="button" @click.stop="save" value="Save Changes">
			<input draggable="false" type="button" class="sfx_button secondary" @click.stop="cancel" value="Cancel">
		</div>
	</div>
	<div id="sfx_options_dialog_body" class="sfx-flex-row" draggable="false">
		<div id="sfx_options_dialog_sections">
			<template v-for="section in sections">
				<template v-if="section.name=='Search'">
					<div @click="select_section(section)" class="sfx_options_dialog_section {{section.selected?'selected':''}} {{section.className}}"><input class="sfx_input" style="width:90%;" placeholder="Search..." @keyup="search" v-model="searchtext"></div>
				</template>
				<template v-else>
					<div @click="select_section(section)" class="sfx_options_dialog_section {{section.selected?'selected':''}} {{section.className}}">{{section.name}}</div>
				</template>
			</template>
		</div>
		<div id="sfx_options_dialog_content">
			<div v-if="section.selected" v-for="section in sections" class="sfx_options_dialog_content_section">
				<template v-if="section.name=='Filters'">
					<div id="sfx_options_dialog_filters">
					    <div v-if="!editing_filter" class="sfx_options_dialog_filter_list">
					        <div class="">
					            <span class="sfx_button" style="float:right;background-color:green;" onclick="window.open('https://github.com/matt-kruse/SocialFixer/wiki/Post-Filtering#filter-list','SFX_FILTER_HELP','width=1024,height=600');"><b>[?]</b> Open Filter Help</span>
					            Post Filters let you hide posts, put them in tabs, or change their appearance based on their content. They execute in the order below for each post.
					            <br style="clear:both;">
					        </div>
					        <div class="sfx_option" style="margin:10px 10px;font-size:calc(0.7rem * var(--sfx_ui_scale));float:left;">
					            <input id="filters_enabled" type="checkbox" v-model="options.filters_enabled.newValue"/><label for="filters_enabled"></label> Post Filtering enabled
					        </div>
					        <div class="sfx_option" style="margin:10px 10px;font-size:calc(0.7rem * var(--sfx_ui_scale));float:left;">
					            <input id="filters_enabled_pages" type="checkbox" v-model="options.filters_enabled_pages.newValue"/><label for="filters_enabled_pages"></label> Filter on Pages/Timelines
					        </div>
					        <div class="sfx_option" style="margin:10px 10px;font-size:calc(0.7rem * var(--sfx_ui_scale));float:left;">
					            <input id="filters_enabled_groups" type="checkbox" v-model="options.filters_enabled_groups.newValue"/><label for="filters_enabled_groups"></label> Filter in Groups
					        </div>
					        <div class="sfx_options_dialog_panel_header" style="clear:both;">Active Filters</div>
					        <div>
					            <input type="button" class="sfx_button" value="Create A New Filter" @click="add_filter">
					        </div>
					        <table class="sfx_options_dialog_table">
					            <thead>
					            <tr>
					                <th>#</th>
					                <th>Title</th>
					                <th>Description</th>
					                <th style="text-align:center;">Actions</th>
					                <th style="text-align:center;">Stop On<br>Match</th>
					                <th style="text-align:center;">Enabled</th>
					            </tr>
					            </thead>
					            <tbody>
					            <tr v-for="filter in filters" v-bind:class="{'sfx_options_dialog_option_disabled':!filter.enabled}">
					                <td>{{$index + 1}}</td>
					                <td class="sfx_options_dialog_option_title">{{filter.title}}<span v-if="filter.id" style="font-weight:normal;font-style:italic;color:green;margin-top:5px;" v-tooltip="{content:'Click \\'x\\' to unsubscribe',delay:250}"> (Subscribed)</span></td>
					                <td class="sfx_options_dialog_option_description">
					                    {{filter.description}}
					                    <div v-if="filter.id && filter.subscription_last_updated_on" style="font-style:italic;color:#999;margin-top:5px;">Subscription last updated: {{ago(filter.subscription_last_updated_on)}}</div>
					                </td>
					                <td class="sfx_options_dialog_option_action" style="white-space:nowrap;">
					                    <span class="sfx_square_control" v-tooltip="Edit" @click="edit_filter(filter,$index)">&#9998;</span>
					                    <span class="sfx_square_control sfx_square_delete"  v-tooltip="Delete" @click="delete_filter(filter)">&times;</span>
					                    <span class="sfx_square_control" v-tooltip="Move Up (Hold Ctrl to move to top)" @click="up(filter, $event, $index)">&utrif;</span>
					                    <span v-if="$index<filters.length-1" class="sfx_square_control" v-tooltip="Move Down (Hold Ctrl to move to bottom)" @click="down(filter, $event, $index)">&dtrif;</span>
					                </td>
					                <td style="text-align:center;">
					                    <input id="sfx_stop_{{$index}}" type="checkbox" v-model="filter.stop_on_match"/><label for="sfx_stop_{{$index}}" data-tooltip-delay="100" v-tooltip="If a post matches this filter, don't process the filters that follow, to prevent it from being double-processed. For most situations, this should remain checked."></label>
					                </td>
					                <td style="text-align:center;">
					                    <input id="sfx_filter_{{$index}}" type="checkbox" v-model="filter.enabled"/><label for="sfx_filter_{{$index}}"></label>
					                </td>
					            </tr>
					            </tbody>
					        </table>

					        <div v-if="filter_subscriptions">
					            <div class="sfx_options_dialog_panel_header">Filter Subscriptions</div>
					            <div>The pre-defined filters below are available for you to use. These "Filter Subscriptions" will be automatically maintained for you, so as Facebook changes or more keywords are needed to match a specific topic, your filters will be updated without you needing to do anything!</div>
					            <table class="sfx_options_dialog_table">
					                <thead>
					                <tr>
					                    <th>Title</th>
					                    <th>Description</th>
					                    <th>Actions</th>
					                </tr>
					                </thead>
					                <tbody>
					                <tr v-for="filter in filter_subscriptions" v-bind:class="{'sfx_filter_subscribed':filter.subscribed}">
					                    <template v-if="version_check(filter)">
					                    <td class="sfx_options_dialog_option_title">{{filter.title}}<span v-if="filter.subscribed" style="font-weight:900;font-style:italic;color:green;margin-top:5px;" v-tooltip="{content:'To unsubscribe, click \\'x\\' in the Active Filters table above',delay:250}"> (Subscribed)</span></td>
					                    <td class="sfx_options_dialog_option_description">{{filter.description}}</td>
					                    <td class="sfx_options_dialog_option_action">
					                        <span class="sfx_square_add" v-tooltip="Add To My Filters" @click="add_subscription(filter)">+</span>
					                    </td>
					                    </template>
					                </tr>
					                </tbody>
					            </table>
					        </div>
					    </div>

					    <div v-if="editing_filter" class="sfx_options_dialog_panel">
					        <div style="float:right;">
					            <span class="sfx_button" style="background-color:green;" onclick="window.open('https://github.com/matt-kruse/SocialFixer/wiki/Post-Filtering#edit-filter','SFX_FILTER_HELP','width=1024,height=600');"><b>[?]</b> Open Filter Help</span>
					        </div>
					        <div class="sfx_panel_title_bar">
					            Edit Filter
					            <br style="clear:both;">
					        </div>
					        <div class="sfx_info" v-if="editing_filter.id">
					            This filter is a subscription, so its definition is stored on the SocialFixer.com server and updated automatically for you. If you wish to edit this filter, you can do so but it will "break" the subscription and your copy will be local and no longer updated automatically as Facebook changes.
					            <br><input type="button" class="sfx_button" value="Convert to local filter" @click="editing_filter.id=null"/>
					        </div>
					        <div class="sfx_label_value">
					            <div>Title:</div>
					            <div><input class="sfx_wide sfx_input" v-model="editing_filter.title" v-bind:disabled="editing_filter.id"/></div>
					        </div>
					        <div class="sfx_label_value">
					            <div>Description:</div>
					            <div><input class="sfx_wide sfx_input" v-model="editing_filter.description" v-bind:disabled="editing_filter.id"></div>
					        </div>
					        <div class="sfx_options_dialog_filter_conditions sfx_options_dialog_panel">
					            <div class="sfx_panel_title_bar">
					                IF ...
					                <br style="clear:both;">
					            </div>
					            <div v-for="rule in editing_filter.rules">
					                <div class="sfx-flex-row-container">
					                    <div><select v-if="$index>0" v-model="editing_filter.match" v-bind:disabled="editing_filter.id"><option value="ALL" data-tooltip-delay="100" v-tooltip="Choose whether all conditions must be met (AND) or if any of the conditions must be met (OR)">AND<option value="ANY">OR</select></div>
					                    <div><select v-model="rule.target" v-bind:disabled="editing_filter.id" data-tooltip-delay="100" v-tooltip="Which attribute of the post do you want to match on?\nSee the Filter Help for a full explanation of each type">
					                        <option value="any">Any Post Content</option>
					                        <option value="any+image">Post Text + Caption</option>
					                        <option value="content">Post Text Content</option>
					                        <option value="action">Post Action</option>
					                        <option value="author">Author</option>
					                        <option value="group">Group Posted In</option>
					                        <option value="page">Page Posted By</option>
					                        <option value="app">App/Game Name</option>
					                        <option value="link_url">Link URL</option>
					                        <option value="link_text">Link Text</option>
					                        <!--
					                        <option value="day">Day of the Week</option>
					                        <option value="age">Post Age</option>
					                        -->
					                        <option value="image">Photo Caption</option>
					                        <option value="hashtag">Any Hashtag</option>
					                    </select></div>
					                    <template v-if="rule.target=='day'">
					                        <div style="padding-left:10px;" data-tooltip-delay="100" v-tooltip="Choose which days of the week this filter should be active">
					                            is
					                            <input type="checkbox" class="normal" v-model="rule.condition.day_0" v-bind:disabled="editing_filter.id"> Sun
					                            <input type="checkbox" class="normal" v-model="rule.condition.day_1" v-bind:disabled="editing_filter.id"> Mon
					                            <input type="checkbox" class="normal" v-model="rule.condition.day_2" v-bind:disabled="editing_filter.id"> Tue
					                            <input type="checkbox" class="normal" v-model="rule.condition.day_3" v-bind:disabled="editing_filter.id"> Wed
					                            <input type="checkbox" class="normal" v-model="rule.condition.day_4" v-bind:disabled="editing_filter.id"> Thu
					                            <input type="checkbox" class="normal" v-model="rule.condition.day_5" v-bind:disabled="editing_filter.id"> Fri
					                            <input type="checkbox" class="normal" v-model="rule.condition.day_6" v-bind:disabled="editing_filter.id"> Sat
					                        </div>
					                    </template>
					                    <template v-if="rule.target=='age'">
					                        <div style="padding-left:10px;">
					                            is
					                            <select v-model="rule.operator" v-bind:disabled="editing_filter.id">
					                                <option value="gt">Greater Than</option>
					                                <option value="lt">Less Than</option>
					                            </select>
					                            <input class="sfx_input" type="number" min="1" style="width:40px;" v-model="rule.condition.value" size="3" v-bind:disabled="editing_filter.id">
					                            <select v-model="rule.condition.units" v-bind:disabled="editing_filter.id">
					                                <option value="h">Hours</option>
					                                <option value="d">Days</option>
					                            </select>
					                        </div>
					                    </template>
					                    <template v-if="rule.target!='day' && rule.target!='age'">
					                        <div>
					                            <input type="checkbox" class="normal" v-model="rule.not" v-bind:disabled="editing_filter.id"> NOT
					                        </div>
					                        <div>
					                            <select v-model="rule.operator" v-bind:disabled="editing_filter.id">
					                                <option value="contains">Contains</option>
					                                <option value="equals">Equals Exactly</option>
					                                <option value="startswith">Starts With</option>
					                                <option value="endswith">Ends With</option>
					                                <option value="matches">Matches Regex</option>
					                                <option v-if="rule.target=='any'" value="contains_selector">Matches CSS Selector</option>
					                            </select>
					                        </div>
					                        <div class="stretch" style="white-space:nowrap;">
					                            <span v-if="['matches',].includes(rule.operator)" style="margin-left:10px;font-weight:bold;">/</span>
					                            <input v-if="['contains','equals','startswith','endswith',].includes(rule.operator)" class="stretch sfx_input" v-on:focus="clear_test_regex" v-on:blur="test_regex" v-model="rule.condition.text" v-bind:disabled="editing_filter.id">
					                            <input v-if="['contains_selector',].includes(rule.operator)" class="stretch sfx_input" v-model="rule.condition.text" v-bind:disabled="editing_filter.id">
					                            <input v-if="['matches',].includes(rule.operator)" class="stretch sfx_input" v-model="rule.condition.text" style="max-width:70%;" v-bind:disabled="editing_filter.id">
					                            <div>
					                                <span style="white-space:normal;" v-if="'re'==rule.matcher && ['equals','contains',].includes(rule.operator)">word|or phrase|more of either|...</span>
					                            </div>
					                            <span v-if="['matches',].includes(rule.operator)" style="font-weight:bold;">/</span>
					                            <input class="sfx_input" v-if="['matches',].includes(rule.operator)" v-model="rule.condition.modifier" size="2" v-bind:disabled="editing_filter.id" data-tooltip-delay="100" v-tooltip="Regular Expression modifier, such as 'i' for case-insensitive">
					                            <template v-if="!['matches','contains_selector',].includes(rule.operator)">
					                                <select v-model="rule.condition.modifier" v-bind:disabled="editing_filter.id">
					                                    <option value="i">ignore case</option>
					                                    <option value="I">Match Case</option>
					                                </select>
					                                <select v-model="rule.matcher" v-bind:disabled="editing_filter.id">
					                                    <option value="re">Regular Expression</option>
					                                    <option value="str">Simple String Match</option>
					                                </select>
					                            </template>
					                            <span v-if="['contains',].includes(rule.operator)" style="white-space:nowrap;padding-left:5px;">
					                                <input type="checkbox" class="normal" v-model="rule.match_partial_words" v-bind:disabled="editing_filter.id" data-tooltip-delay="100" v-tooltip="Check this if you want the text to be a partial match. For example, if 'book' should also match 'Facebook'. If unchecked, only whole words will be matched.">
					                                <span v-if="(!editing_filter.id || rule.match_partial_words)"> Match partial words</span>
					                            </span>
					                            <span v-if="['matches',].includes(rule.operator)" class="sfx_link" @click="regex_test(rule.condition)" data-tooltip-delay="100" v-tooltip="Test your regular expression against text to make sure it matches as you expect."> [test]</span>
					                        </div>
					                    </template>
					                    <span v-if="editing_filter.rules.length>1" class="sfx_square_control sfx_square_delete" style="margin:0 10px;" v-tooltip="Delete" @click="delete_rule(rule)">&times;</span>
					                </div>
					            </div>
					            <div v-if="!editing_filter.id">
					                <input type="button" class="sfx_button" value="Add A Condition" @click="add_condition">
					            </div>
					        </div>
					        <div class="sfx_options_dialog_filter_actions sfx_options_dialog_panel">
					            <div class="sfx_panel_title_bar">... THEN</div>
					            <div class="sfx_info" v-if="editing_filter.id && editing_filter.configurable_actions && editing_filter.actions[0].action==''">
					                This Filter Subscription defines the rules above, but the action to take is up to you to define. When updated automatically, the rules above will be updated but your selected actions are personal to you.
					            </div>
					            <div class="sfx_info" v-if="editing_filter.id && editing_filter.configurable_actions && editing_filter.actions[0].action!=''">
					                The Actions to take when this filter subscription matches may be changed. If you change the actions, the criteria above will continue to be updated but your customized actions will not be over-written when the filter updates itself.
					            </div>
					            <div class="sfx-flex-row-container" v-for="action in editing_filter.actions">
					                <select v-model="action.action" v-bind:disabled="editing_filter.id && !editing_filter.configurable_actions" data-tooltip-delay="100" v-tooltip="If the conditions match, what action should be taken on the post?">
					                    <option value=""></option>
					                    <option value="hide">Hide post</option>
					                    <option value="unhide">Unhide post</option>
					                    <option value="read">Mark post 'Read'</option>
					                    <option value="unread">Unmark post 'Read'</option>
					                    <option value="css">Add CSS</option>
					                    <option value="class">Add CSS Class</option>
					                    <option value="replace">Replace text</option>
					                    <option value="move-to-tab">Move post to tab</option>
					                    <option value="copy-to-tab">Copy post to tab</option>
					                </select>
					                <span v-if="action.action=='hide'">
					                    <input type="checkbox" class="normal" v-model="action.show_note"  data-tooltip-delay="100" v-tooltip="This will leave a small note in your feed to let you know that a post was hidden." v-bind:disabled="editing_filter.id && !editing_filter.configurable_actions"> Show a note where the post would have been.
					                    <div v-if="action.show_note"> Optional Custom Reveal Note: <input class="sfx_input" v-model="action.custom_note" size="70" data-tooltip-delay="100" v-tooltip="Customize the click-to-reveal note text." style="margin-bottom:3px"></div>
					                    <div v-if="action.show_note"> Optional Custom Rehide Note: <input class="sfx_input" v-model="action.custom_nyet" size="70" data-tooltip-delay="100" v-tooltip="Customize the click-to-rehide note text."></div>
					                </span>
					                <span v-if="action.action=='css'">
					                    CSS: <input class="sfx_input" v-model="action.content" size="45" v-bind:disabled="editing_filter.id && !editing_filter.configurable_actions">
					                    To Selector: <input class="sfx_input" v-model="action.selector" size="25" data-tooltip-delay="100" v-tooltip="Apply the CSS to the element(s) specified by the selector. To target the whole post container, leave blank." v-bind:disabled="editing_filter.id && !editing_filter.configurable_actions">
					                </span>
					                <span class="stretch" v-if="action.action=='class'">
					                    Class: <input class="sfx_input" v-model="action.content" size="45" v-bind:disabled="editing_filter.id && !editing_filter.configurable_actions" data-tooltip-delay="100" v-tooltip="Add a class name. This is useful in conjunction with a Display Tweak to customize CSS">
					                    To Selector: <input class="sfx_input" v-model="action.selector" size="25" data-tooltip-delay="100" v-tooltip="Apply the class to the element(s) specified by the selector. To target the whole post container, leave blank." v-bind:disabled="editing_filter.id && !editing_filter.configurable_actions">
					                </span>
					                <span v-if="action.action=='replace'">
					                    Find: <input class="sfx_input" v-model="action.find" size="25" v-bind:disabled="editing_filter.id && !editing_filter.configurable_actions">
					                    Replace With: <input class="sfx_input" v-model="action.replace" size="25" v-bind:disabled="editing_filter.id && !editing_filter.configurable_actions">
					                </span>
					                <span v-if="action.action=='move-to-tab' || action.action=='copy-to-tab'">
					                    Tab Name: <input class="sfx_input" v-model="action.tab" size="45" v-bind:disabled="editing_filter.id && !editing_filter.configurable_actions">
					                </span>
					                <span v-if="editing_filter.actions.length>1" class="sfx_square_control sfx_square_delete" style="margin:0 10px;" v-tooltip="Delete" @click="delete_action(action)">&times;</span>
					            </div>
					            <div v-if="!editing_filter.id || editing_filter.configurable_actions">
					                <input type="button" class="sfx_button" value="Add An Action" @click="add_action">
					            </div>
					        </div>
					        <span data-tooltip-delay="100" v-tooltip="Directly move this filter to the given position number">
					            <input type="number" class="sfx_input" min="1" max="{{filters.length}}" v-model="editing_meta.new_number">Filter Order
					        </span>
					        <span data-tooltip-delay="100" v-tooltip="If a post matches this filter, don't process the filters that follow, to prevent it from being double-processed. For most situations, this should remain checked.">
					            <input type="checkbox" class="normal" v-model="editing_filter.stop_on_match">Stop On Match
					        </span>
					        <span data-tooltip-delay="100" v-tooltip="Should this filter be processed at all?">
					            <input type="checkbox" class="normal" v-model="editing_filter.enabled">Enabled
					        </span>
					        <div class="sfx_link" @click="show_advanced=!show_advanced" v-tooltip="{position:'above',content:'View the underlying JSON data structure for this filter. The filter can be edited manually here, or you can paste in filter code from someone else to copy their filter exactly.',delay:500}">{{show_advanced?"Hide Advanced Code &utrif;":"Show Advanced Code &dtrif;"}}</div>
					        <textarea v-if="show_advanced" style="width:90%;height:150px;font-size:calc(0.55rem * var(--sfx_ui_scale));font-family:monospace;" v-model="editing_filter | json+" v-bind:disabled="editing_filter.id"></textarea>
					    </div>
					</div>

				</template>
				<template v-if="section.name=='Data'">
					<div class="sfx_info">Here you can export all of Social Fixer's stored data, including options, filters, and which stories have been read. WARNING: Importing will overwrite your existing settings!</div>
					Total storage space used: {{storage_size | currency '' 0}} bytes<br><br>
					<input type="button" class="sfx_button" value="Save To File" @click="save_to_file()" v-if="supports_download_attribute"> <input type="button" class="sfx_button" value="Load From File" @click="load_from_file()"> <input type="button" class="sfx_button" value="Reset All Data" @click="reset_data()"><br><br>
					<input type="button" class="sfx_button" value="Export To Textbox" @click="populate_user_options()"> <input type="button" class="sfx_button" value="Import From Textbox" @click="import_data_from_textbox()">
					<br><br>
					<div v-if="user_options_message" class="sfx_info">{{user_options_message}}</div>
					<textarea id="sfx_user_data" v-model="user_options|json" style="width:95%;height:50vh;font-family:courier new,monospace;font-size:calc(0.55rem * var(--sfx_ui_scale));"></textarea>
				</template>
				<template v-if="section.name!='Filters'">
					<div v-if="section.description" style="margin-bottom:15px;">{{section.description}}</div>
					<table class="sfx_options_dialog_table">
						<tr v-for="opt in section.options | filterBy !opt.hidden" v-if="!opt.hidden" class="{{opt.highlighted?'sfx_options_dialog_option_highlighted':''}}">
							<td class="sfx_options_dialog_option_title {{($index==0 || section.options[$index-1].title!=opt.title)?'':'repeat'}}">{{{opt.title | highlight searchtext}}}</td>
							<td class="sfx_options_dialog_option_description">{{{opt.description | highlight searchtext}}}
								<input class="sfx_input" v-if="opt.type=='text'" v-model="opt.newValue" style="display:block;width:{{opt.width || '50%'}};"/>
								<input class="sfx_input" v-if="opt.type=='number'" type="number" min="{{opt.min||1}}" max="{{opt.max||999}}" v-model="opt.newValue"/>
								<textarea v-if="opt.type=='textarea'" v-model="opt.newValue" style="display:block;width:95%;height:100px;"></textarea>
							</td>
							<td class="sfx_options_dialog_option_action">
								<template v-if="opt.type=='checkbox'">
									<input id="sfx_option_{{opt.key}}" class="sfx_input" type="checkbox" v-model="opt.newValue"/><label for="sfx_option_{{opt.key}}"></label>
								</template>
								<template v-if="opt.type=='link'">
									<input type="button" data-href="{{opt.url}}" onclick="window.open(this.getAttribute('data-href'));" class="sfx_button" value="GO!">
								</template>
								<template v-if="opt.type=='action'">
									<input type="button" @click="message(opt.action_message)" class="sfx_button" value="{{opt.action_text}}">
								</template>
							</td>
						</tr>
					</table>

					<!-- Custom Section Displays -->
					<template v-if="section.name=='Hide Posts'">
						<b>Easily hide posts from your feed by keyword or phrase.</b>
						<br><br>
						Just enter each keyword or phrase you want to hide on a separate line in the text box. Any post containing one of those words will be hidden, and a small note will be shown in its place. To have more control over filtering, advanced post filtering can be setup in the "Filters" tab.
						<br><br>
						<input type="checkbox" class="normal" v-model="options.hide_posts_show_hidden_message.newValue"> Show a note in place of hidden posts in the news feed
						<br>
						<input type="checkbox" class="normal" v-model="options.hide_posts_show_match.newValue"> Show the word or phrase that matched in the hidden-post note
						<br>
						<input type="checkbox" class="normal" v-model="options.hide_posts_partial.newValue"> Match partial words (example: "the" will also match "them")
						<br>
						<input type="checkbox" class="normal" v-model="options.hide_posts_case_sensitive.newValue"> Match Case
						<br>
						<input type="checkbox" class="normal" v-model="options.hide_posts_caption.newValue"> Also match photo captions
						<br>
						Hide posts with these keywords or phrases (each on its own line):<br>
						<textarea v-model="options.hide_posts_text.newValue" style="width:80%;height:150px;"></textarea>

					</template>
					<template v-if="section.name=='Display Tweaks'">
						<div v-if="!editing_tweak">
						    <div class="">
						        Display Tweaks are small snippets of CSS which change the appearance of the page. They can do anything from changing colors and fonts to hiding parts of the page or completely changing the layout. Advanced users can add their own tweaks, but most users will want to select some from the list of available Tweaks.
						    </div>
						    <div class="sfx_option" style="margin:10px 0;font-size:calc(0.7rem * var(--sfx_ui_scale));"><input id="tweaks_enabled" type="checkbox" v-model="options.tweaks_enabled.newValue" @change="show_current_tweaks()"/><label for="tweaks_enabled"></label> Tweaks enabled</div>
						    <div>
						        <input type="button" class="sfx_button" value="Create A New Tweak" @click="add_tweak">
						    </div>
						    <div v-if="tweaks.length" class="sfx_options_dialog_panel_header">Active Tweaks</div>
						    <table v-if="tweaks.length" class="sfx_options_dialog_table">
						        <thead>
						        <tr>
						            <th>#</th>
						            <th>Title</th>
						            <th>Description</th>
						            <th style="text-align:center;">Actions</th>
						            <th style="text-align:center;">Enabled</th>
						        </tr>
						        </thead>
						        <tbody>
						        <tr v-for="tweak in tweaks" v-if="isObject(tweak)" v-bind:class="{'sfx_options_dialog_option_disabled':!tweak.enabled}">
						            <td>{{$index + 1}}</td>
						            <td class="sfx_options_dialog_option_title">{{tweak.title}}<span v-if="tweak.id" style="font-weight:normal;font-style:italic;color:green;margin-top:5px;" v-tooltip="{content:'Click \\'x\\' to unsubscribe',delay:250}"> (Subscribed)</span></td>
						            <td class="sfx_options_dialog_option_description">
						                {{tweak.description}}
						                <div v-if="tweak.id && tweak.subscription_last_updated_on" style="font-style:italic;color:#999;margin-top:5px;">Subscription last updated: {{ago(tweak.subscription_last_updated_on)}}</div>
						            </td>
						            <td class="sfx_options_dialog_option_action" style="white-space:nowrap;">
						                <span class="sfx_square_control" v-tooltip="Edit" @click="edit_tweak(tweak,$index)">&#9998;</span>
						                <span class="sfx_square_control sfx_square_delete" v-tooltip="Delete" @click="delete_tweak(tweak)">&times;</span>
						            </td>
						            <td>
						                <input id="sfx_tweak_{{$index}}" type="checkbox" @change="toggle_tweak(tweak,$index)" v-model="tweak.enabled"/><label for="sfx_tweak_{{$index}}"></label>
						            </td>
						        </tr>
						        </tbody>
						    </table>

						    <div v-if="tweak_subscriptions">
						        <div class="sfx_options_dialog_panel_header">Available Display Tweaks (Snippets)</div>
						        <div>
						            Below is a list of display tweaks maintained by the Social Fixer team which you may find useful. When you add them to your list, they will be automatically updated to continue functioning if Facebook changes its layout or code.
						        </div>
						        <table class="sfx_options_dialog_table">
						            <thead>
						            <tr>
						                <th>Title</th>
						                <th>Description</th>
						                <th>Add</th>
						            </tr>
						            </thead>
						            <tbody>
						            <tr v-for="tweak in tweak_subscriptions" v-if="isObject(tweak)" v-bind:class="{'sfx_tweak_subscribed':tweak.subscribed}">
						                <template v-if="version_check(tweak)">
						                <td class="sfx_options_dialog_option_title">{{tweak.title}}<span v-if="tweak.subscribed" style="font-weight:900;font-style:italic;color:green;margin-top:5px;" v-tooltip="{content:'To unsubscribe, click \\'x\\' in the Active Tweaks table above',delay:250}"> (Subscribed)</span></td>
						                <td class="sfx_options_dialog_option_description">{{tweak.description}}</td>
						                <td class="sfx_options_dialog_option_action">
						                    <span class="sfx_square_add" v-tooltip="Add To My Tweaks" @click="add_tweak_subscription(tweak)">+</span>
						                </td>
						                </template>
						            </tr>
						            </tbody>
						        </table>
						    </div>
						    <div v-else>
						        Loading Available Tweaks...
						    </div>
						</div>

						<div v-if="editing_tweak" class="sfx_options_dialog_panel">
						    <div class="sfx_panel_title_bar">Edit Tweak</div>
						    <div class="sfx_label_value">
						        <div>Title:</div>
						        <div><input class="sfx_wide" v-model="editing_tweak.title"></div>
						    </div>
						    <div class="sfx_label_value">
						        <div>Description: </div>
						        <div><input class="sfx_wide" v-model="editing_tweak.description"></div>
						    </div>
						    <span data-tooltip-delay="100" v-tooltip="Directly move this tweak to the given position number">
						        <input type="number" class="sfx_input" min="1" max="{{tweaks.length}}" v-model="editing_meta.new_number">Tweak Order
						    </span>
						    <span data-tooltip-delay="100" v-tooltip="Should this tweak be processed at all?">
						        <input type="checkbox" class="normal" v-model="editing_tweak.enabled">Enabled
						    </span>
						    <div>CSS:<br/>
						        <textarea style="width:90%;height:250px;font-size:calc(0.55rem * var(--sfx_ui_scale));font-family:monospace;" v-model="editing_tweak.css"></textarea>
						    </div>
						</div>

					</template>
					<template v-if="section.name=='About'"><div id="sfx_options_content_about">{{{content_about}}}</div></template>
					<template v-if="section.name=='Donate'">
						<div v-if="sfx_option_show_donate" style="margin-bottom:10px;">
							<input id="sfx_option_show_donate" type="checkbox" v-model="options.sfx_option_show_donate.newValue"/><label for="sfx_option_show_donate"></label> Remind me every so often to help support Social Fixer through donations.
						</div>
						<div id="sfx_options_content_donate">{{{content_donate}}}</div>
					</template>
					<template v-if="section.name=='Support'">
						<div style="font-family:monospace;font-size:calc(0.55rem * var(--sfx_ui_scale));border:1px solid #ccc;margin-bottom:5px;padding:7px;">${SFX.user_agent}<br>Social Fixer ${SFX.buildstr}
							<br><span>Extension build target: ${SFX.extension_build_target}</span>
							<br><span>Extension store name: ${SFX.extension_store_name}</span>
							<br><span>Extension ID: ${SFX.extension_id}</span>
							<br><span v-if="support_notes"><br>Support Notes:<br>
								<span v-for="note in support_notes">{{note.who}}: {{note.what}}<br></span>
							</span>
						</div>
						<div id="sfx_options_content_support">{{{content_support}}}</div>
					</template>
				</template>
			</div>
		</div>
	</div>
</div>
`);
				var close_options = function () {
					X('#sfx_options_dialog').remove();
				};
				X.subscribe('options/close', function () {
					close_options();
				});

				// Record some tidbits in the save file which will be useful
				// for support purposes, if a settings file is submitted
				const update_support_data = function() {
					X.storage.set('stats', 'support', {
						user_agent: SFX.user_agent,
						extension_id:  SFX.extension_id,
						buildstr: SFX.buildstr,
						context: FX.context,
						support_notes: X.support_notes,
					});
				};

				var save_options = function () {
					var undef, opt, key, options_to_save = {};
					// Iterate each option
					for (key in FX.options) {
						opt = FX.options[key];
						// Only save non-default settings that have changed
						if (opt.newValue != opt.value) {
							// If it's the default, erase it from options so it will be overriden by the default
							if (opt.newValue == opt['default']) {
								options_to_save[key] = undef;
							}
							else {
								options_to_save[key] = opt.newValue;
							}
						}
					}
					// Store the data in memory
					X.storage.data.filters = X.clone(filters || []);
					X.storage.data.tweaks = X.clone(tweaks || []);

					// persist
					update_support_data();
					X.storage.set('options', options_to_save, function () {
						X.storage.save('filters', null, function () {
							X.storage.save('tweaks', null, function () {
								Object.keys(options_to_save).forEach(
									key => FX.fire_option_update(key, FX.option(key))
								);
								close_options();
								const position = (FX.option('badge_x') < 0) ? 'left' : 'right';
								var note = sticky_note(SFX.badge_sel, position, ' Saved!  <b style="color:red;">Reload all Facebook tabs</b> for changes to take effect! ');
								setTimeout(function () {
									note.remove();
								}, 6 * X.seconds);
							});
						});
					});
				};

				var insist_refresh = function (msg) {
					var note = `<div>${msg}<br><br><span class="sfx_button">REFRESH THE PAGE</span> immediately to activate the changes!`;
					data.show_action_buttons = false;
					X('#sfx_options_dialog_body').css("padding","50px").html(note);
					X('#sfx_options_dialog_body .sfx_button').click(() => window.location.reload());
				};

				var import_data = function (json) {
					var key, user_data;
					var keys = [];
					this.user_options_message = null;
					try {
						user_data = JSON.parse(json);
						for (key in user_data) {
							var d = X.clone(user_data[key]);
							X.storage.data[key] = d;
							X.storage.save(key, null, function () {
							});
							keys.push(key);
						}
						insist_refresh(`Successfully imported keys: ${keys.join(", ")}.`);
					} catch (e) {
						this.user_options_message = "Error importing data: " + e.toString();
					}
				};

				var key;
				if (event_data && event_data.data) {
					for (key in event_data.data) {
						data[key] = event_data.data[key];
					}
				}
				var methods = {
					"save": save_options
					, "cancel": function () {
						if (this.editing_filter) {
							if (this.editing_meta.new) {
								this.filters.length--;
							}
							this.action_button = null;
							this.editing_filter = null;
							this.editing_meta = {};
						}
						else if (this.editing_tweak) {
							if (this.editing_meta.new) {
								this.tweaks.length--;
							}
							this.action_button = null;
							this.editing_tweak = null;
							this.editing_meta = {};
						}
						else {
							close_options();
						}
					}
					, "collapse": function () {
						X('#sfx_options_dialog_body').toggle();
					}
					, "message": function (msg) {
						if (msg) {
							var messages = msg.split(/\s*,\s*/);
							if (messages && messages.length > 0) {
								messages.forEach(function (m) {
									X.publish(m, {});
								});
							}
						}
					}
					, "search": function() {
						var search_section = this.sections[0];
						search_section.options.splice(0,search_section.options.length);
						if (this.searchtext && this.searchtext.length>2) {
							var regex = new RegExp(this.searchtext,"i");
							for (var k in FX.options) {
								var opt = FX.options[k];
								if (regex.test(opt.title) || regex.test(opt.description)) {
									search_section.options.push(opt);
								}
							}
						}
					}
					, "select_section": function (section) {
						this.editing_filter = null;
						this.action_button = null;
						sections.forEach(function (s) {
							s.selected = false;
						});
						section.selected = true;
						X.publish("menu/options/section", section.name);
					}
					, "ago": X.ago
					, "isObject": X.isObject
					, "version_check": function (thingy) {
						return ((!thingy.min_version || X.semver_compare(SFX.version, thingy.min_version) >= 0) && (!thingy.max_version || X.semver_compare(SFX.version, thingy.max_version) <= 0));
					}
					, "clear_test_regex": function (ev) {
						var input = X(ev.target);
						input.attr('title', null).css('background-color', '');
					}
					, "test_regex": function (ev) {
						var input = X(ev.target);
						try {
							new RegExp(input.val());
							input.css('background-color', '');
						}
						catch (e) {
							input.css('background-color', '#e00');
							input.attr('title', e.message);
						}
					}
					, "save_to_file": function () {
						update_support_data();
						// Firefox requires link to be inserted in <body> before clicking
						// https://stackoverflow.com/a/27116581
						var $link = X('<a style="position:absolute;top:0;left:-10px;visibility:hidden;" aria-hidden="true" tabindex="-1"></a>');
						$link.attr('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(JSON.stringify(X.storage.data, null, '  ')));
						$link.attr('download', `Social_Fixer_Settings_${X.today()}.txt`);
						X(document.body).append($link);
						X.ui.click($link, false);
						$link.remove();
					}
					, "load_from_file": function () {
						var $input = X('<input type="file" accept="text/*">');
						$input.change(function (ev) {
							if (ev.target.files && ev.target.files[0]) {
								var reader = new FileReader();

								reader.onload = function (e) {
									import_data.call(this, e.target.result);
								}.bind(this);

								reader.onerror = function (e) {
									this.user_options_message = 'Error importing data: ' + e.toString();
								}.bind(this);

								reader.readAsText(ev.target.files[0]);
							}
						}.bind(this));
						X.ui.click($input, false);
					}
					, "populate_user_options": function () {
						update_support_data();
						this.user_options = X.clone(X.storage.data);
						this.user_options_message = null;
					}
					, "import_data_from_textbox": function () {
						import_data.call(this, X('#sfx_user_data').val());
					}
					, "reset_data": function () {
						if (confirm('Are you sure?\n\nResetting your data will ERASE all user preferences, "read" story data, installed filters, etc.')) {
							X.storage.save('options', {});
							X.storage.save('filters', []);
							X.storage.save('tweaks', []);
							X.storage.save('hiddens', {});
							X.storage.save('postdata', {});
							X.storage.save('friends', {});
							X.storage.save('stats', {});
							X.storage.save('messages', {});
							X.storage.save('tasks', {});
							insist_refresh('All data has been reset.');
						}
					}
					// FILTERS & TWEAKS
					, "shuffle_entry": function (tbl, src, tgt, enact) {
						// Shuffle things around if position was changed
						enact = typeof enact === 'function' ? enact : () => null;
						tgt = SFX.bound(tgt, 0, tbl.length - 1, -1);
						if (src != tgt && tbl[src] && tbl[tgt]) {
							// splice() would break Vue
							const save_src = X.clone(tbl[src]);
							const inc = tgt > src ? 1 : -1;
							for (var idx = src; idx != tgt; idx += inc) {
								tbl.$set(idx, tbl[idx + inc]);
								enact(idx);
							}
							tbl.$set(tgt, save_src);
						}
					}
					// FILTERS
					, "edit_filter": function (filter, index) {
						this.editing_filter = X.clone(filter);
						this.editing_meta.number = index + 1;
						this.editing_meta.new_number = index + 1;
						this.editing_meta = X.clone(this.editing_meta);
						this.action_button = 'done_editing_filter';
					}
					, "delete_filter": function (filter) {
						if (confirm('Are you sure you want to remove this filter?')) {
							this.filters.$remove(filter);
							mark_subscribed_items(data.filter_subscriptions, filters);
						}
					}
					, "up": function (filter,$event,$index) {
						this.shuffle_entry(this.filters, $index, $event.ctrlKey ? 0 : $index - 1);
					}
					, "down": function (filter,$event,$index) {
						this.shuffle_entry(this.filters, $index, $event.ctrlKey ? this.filters.length - 1 : $index + 1);
					}
					, "close_filter": function () {
						this.editing_filter.updated_on = X.time();
						// If it's a subscription and actions are configurable and they have changed, flag as such
						var orig = this.filters[this.editing_meta.number - 1];
						if (orig.id && orig.configurable_actions && !orig.custom_actions) {
							if (!SFX.data_equals(orig.actions, this.editing_filter.actions)) {
								// Updated actions!
								this.editing_filter.custom_actions = true;
							}
						}
						var src = this.editing_meta.number - 1;
						var tgt = this.editing_meta.new_number - 1;
						this.filters.$set(src, this.editing_filter);
						if (tgt != src) {
							this.shuffle_entry(this.filters, src, tgt);
						}
						this.editing_filter = null;
						this.action_button = null;
						this.editing_meta = {};
						mark_subscribed_items(data.filter_subscriptions, filters);
					}
					, "add_filter": function () {
						var new_filter = {match: 'ALL', enabled: true, stop_on_match: true, rules: [{target: 'any', operator: 'contains', matcher: 're', condition: { modifier:'i'}}], actions: [{action: 'hide'}]};
						new_filter.added_on = X.time();
						this.filters.push(new_filter);
						this.editing_meta.new = true;
						this.edit_filter(this.filters[this.filters.length - 1], this.filters.length - 1);
					}
					, "add_subscription": function (filter) {
						var f = X.clone(filter);
						f.enabled = true;
						if (!f.actions || !f.actions.length) {
							f.actions = [{"action": ""}];
							f.configurable_actions = true;
						}
						this.filters.push(f);
						mark_subscribed_items(data.filter_subscriptions, filters);
						//if (f.configurable_actions) {
						//	// Immediately invoke editor if it has configurable actions?
						//	this.edit_filter(this.filters[this.filters.length - 1], this.filters.length - 1);
						//}
					}
					, "add_condition": function () {
						this.editing_filter.rules.push({target: 'any', operator: 'contains', matcher: 're', condition: {modifier: 'i'}});
					}
					, "delete_rule": function (rule) {
						this.editing_filter.rules.$remove(rule);
					}
					, "add_action": function () {
						// Duplicate latent action properties so that choosing an
						// action type immediately suggests suitable action parameters
						let acts = this.editing_filter.actions;
						acts.push(X.clone(acts[acts.length - 1]));
						delete acts[acts.length - 1].action;
					}
					, "delete_action": function (action) {
						this.editing_filter.actions.$remove(action);
					}
					, "regex_test": function (condition) {
						var text = condition.text;
						var modifier = condition.modifier;
						X.publish("test/regex", {"text": text, "modifier": modifier});
					}
					// TWEAKS
					, "edit_tweak": function (tweak, index) {
						this.editing_tweak = X.clone(tweak);
						this.editing_meta.number = index + 1;
						this.editing_meta.new_number = index + 1;
						this.editing_meta = X.clone(this.editing_meta);
						this.action_button = 'done_editing_tweak';
					}
					, "tweak_css_on_off": function (index, enabled) {
						enabled = enabled && this.options.tweaks_enabled.newValue;
						X.css(enabled ? this.tweaks[index].css : null, 'sfx_tweak_style_' + index);
					}
					, "delete_tweak": function (tweak) {
						if (confirm('Are you sure you want to remove this tweak?')) {
							this.tweaks.$remove(tweak);
							this.show_current_tweaks();
							mark_subscribed_items(data.tweak_subscriptions, tweaks);
						}
					}
					, "close_tweak": function () {
						this.editing_tweak.updated_on = X.time();
						var src = this.editing_meta.number - 1;
						var tgt = this.editing_meta.new_number - 1;
						this.tweaks.$set(src, this.editing_tweak);
						if (tgt != src) {
							this.shuffle_entry(this.tweaks, src, tgt,
								idx => this.tweak_css_on_off(idx, X.isObject(this.tweaks[idx]) && this.tweaks[idx].enabled));
						}
						this.tweak_css_on_off(tgt, this.editing_tweak.enabled);
						this.editing_tweak = null;
						this.action_button = null;
						this.editing_meta = {};
						mark_subscribed_items(data.tweak_subscriptions, tweaks);
					}
					, "add_tweak": function () {
						var new_tweak = {"title": "", "description": "", "enabled": true};
						new_tweak.added_on = X.time();
						var index = this.tweaks.push(new_tweak) - 1;
						this.editing_meta.new = true;
						this.edit_tweak(this.tweaks[index], index);
					}
					, "add_tweak_subscription": function (tweak) {
						var o = X.clone(tweak);
						o.enabled = true;
						var index = this.tweaks.push(o) - 1;
						mark_subscribed_items(data.tweak_subscriptions, tweaks);
						this.tweak_css_on_off(index, true);
					}
					, "toggle_tweak": function (tweak, index) {
						this.tweak_css_on_off(index, X.isObject(tweak) && tweak.enabled);
					}
					, "show_current_tweaks": function () {
						for (var index = 0; index < this.tweaks.length; index++) {
							this.tweak_css_on_off(index, X.isObject(this.tweaks[index]) && this.tweaks[index].enabled);
						}
						this.tweak_css_on_off(this.tweaks.length, false);
					}
				};
				template(document.body, dialog, data, methods).ready(function () {
					X.draggable('#sfx_options_dialog');

					// If a default section was passed in, publish that event
					if (event_data.section) {
						X.publish("menu/options/section", event_data.section);
					}
				});
			} catch (e) {
				alert(e);
			}
		});

		X.subscribe("menu/options/section", function (msg, msgdata) {
			// If the section has dynamic data, load it
			sections.forEach(function (s) {
				if (s.name == msgdata && s.property && s.url) {
					X.ajax(s.url, function (content) {
						data[s.property] = X.sanitize(content);
					});
				}
			});
			if (msgdata == "Filters") {
				// Retrieve filters
				retrieve_item_subscriptions('filters', data.filters, function (subscriptions) {
					data.filter_subscriptions = subscriptions;
					update_subscribed_items('filters', data.filters);
				});
			}
			if (msgdata == "Display Tweaks") {
				// Retrieve tweaks
				retrieve_item_subscriptions('tweaks', data.tweaks, function (subscriptions) {
					data.tweak_subscriptions = subscriptions;
					update_subscribed_items('tweaks', data.tweaks);
				});
			}
		});

		// If opening from an "options" url, open options immediately
		FX.on_content_loaded(function () {
			if (/sfx_options=true/.test(location.href)) {
				X.publish("menu/options");
			}
		});
	});
});
