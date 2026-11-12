// Check to make sure that the extension's storage is working correctly
X.ready('storage_check', function() {
    X.task('storage_check', 1*X.days, function() {
        FX.on_options_load(function () { setTimeout(function() {
            var now = X.now();
            var success = null;
            var error = function (err) {
                success = false;
                // Oops, storage didn't work!
                var error_msg="";
                if (err) {
                    error_msg = "<br><br>Error: "+err;
                }
                const version_info = `<br><br>${SFX.user_agent}<br>Social Fixer ${SFX.buildstr}`;
                bubble_note("Social Fixer may have trouble saving your settings. If your settings won't stick, please let us know. See 'Support' under Options for contact info." + error_msg + version_info, {"close": true, "title": "Extension Storage Warning", "style": "width:300px;"});
                X.support_note('storage_check', err);
            };
            setTimeout(function () {
                if (success === null) {
                    error("Timeout waiting for storage response");
                }
            }, 8 * X.seconds);
            try {
                X.storage.set('storage_check', 'storage_checked_on', now, function () {
                    // Storage should have persisted by now
                    // Try retrieving it
                    try {
                        X.storage.get('storage_check', null, function (stats) {
                            if (!stats || !stats.storage_checked_on || (Math.abs(now - stats.storage_checked_on) > 60 * X.seconds)) {
                                var e = null;
                                if (!stats) { e="No stats"; }
                                else if (!stats.storage_checked_on) { e="stats.storage_checked_on doesn't exist"; }
                                else if ((Math.abs(now - stats.storage_checked_on) > 60 * X.seconds)) { e="stats.storage_checked_on = "+Math.abs(now - stats.storage_checked_on); }
                                return error(e);
                            }
                            success = true;
                        }, false);
                    } catch(e) {
                        error(e);
                    }
                });
            } catch(e) {
                error(e);
            }
        },1000);
        });
    });
});
