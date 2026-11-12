FX.add_option('run_on_apps', {"title": 'Run On Apps and Games Pages', "description": 'Run Social Fixer on apps and games pages from apps.facebook.com.', "default": true});
X.beforeReady(function(options) {
    if (/apps.facebook.com/.test(location.href)) {
        if (!options) {
            // Don't run modules yet until prefs are loaded
            return false;
        }
        else {
            //Otherwise check prefs to see if modules should run
            return FX.option('run_on_apps');
        }
    }
});
