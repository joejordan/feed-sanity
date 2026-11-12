X.ready( 'donate', function() {
    FX.add_option('sfx_option_show_donate2',
        {
            "section": "Advanced"
            , "title": 'Show Donate Message'
            , "description": 'Show a reminder every so often to support Social Fixer development through donations.'
            , "default": true
        }
    );
    FX.on_options_load(function () {
        // Before showing the donate message, wait at least 5 days after install to not annoy people
        X.storage.get('stats', {}, function (stats) {
            if (stats && stats.installed_on && (X.now() - stats.installed_on > 5 * X.days) && X.userid != "anonymous") {
                X.task('sfx_option_show_donate', 30 * X.days, function () {
                    if (FX.option('sfx_option_show_donate2')) {
                        X.when(SFX.badge_sel, function () {
                            X.publish("menu/options", {"section": "Donate", "data": {"sfx_option_show_donate": true}});
                        });
                    }
                });
            }
        }, true);
    });
});
