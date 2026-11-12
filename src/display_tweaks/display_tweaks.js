// ========================================================
// Display Tweaks
// ========================================================
X.ready( 'display_tweaks', function() {
	FX.add_option('tweaks_enabled', {
		"section": "Display Tweaks"
		, "hidden": true
		, "default": true
	});
	FX.on_options_load(function () {
		var tweaks = FX.storage('tweaks');
		if (!tweaks || !tweaks.length || !FX.option('tweaks_enabled')) {
			return;
		}
		for (var i = 0; i < tweaks.length; i++) {
			if (X.isObject(tweaks[i]) && tweaks[i].enabled && !tweaks[i].disabled) {
				X.css(tweaks[i].css, 'sfx_tweak_style_' + i);
			}
		}
	});
});
