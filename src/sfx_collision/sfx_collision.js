X.ready('sfx_collision', function () {
    // Don't run this if the page was loaded a long time ago:
    //
    // Firefox (and family?) seem to update already-installed web_extensions by
    // injecting the new script into the already running page where the old one
    // was previously injected.  Social Fixer sees that the page was previously
    // meddled with (by its own previous version!) -- but we need to ignore it.
    //
    // Collision check doesn't need to fire every time as long as it eventually
    // notifies the user on some later page load.
    //
    // Refs:
    //
    // https://www.w3.org/TR/navigation-timing/#sec-navigation-timing-interface
    // https://developer.mozilla.org/en-US/docs/Web/API/Performance/timing

    if (performance && performance.timing && performance.timing.domLoading) {
        if (X.now() - performance.timing.domLoading > 10 * X.seconds) {
            return;
        }
    }

    X.when(SFX.badge_sel, function ($badge) {
        // Allow all version(s) to finish init & fighting over badge
        setTimeout(function () {
            var collision_alert = function (ver_msg, advice) {
                alert(`\
WARNING: 2+ copies of Social Fixer are running!
- ${SFX.buildstr}
- ${ver_msg}
For best results, please run only one at a time!
=> Back up settings: http://tiny.cc/sfx-saveprefs
=> Remove extra copies: http://tiny.cc/sfx-only-1
=> Help/Support: https://socialfixer.com/support${advice ? '\n' + advice : ''}`);
                X.support_note('sfx_collision', `Other: '${ver_msg}'`);
            };

            var old_buildstr = $badge.attr('old_buildstr');
            $badge.attr('old_buildstr', null);

            // Don't complain about disabled other-versions, they're benign and
            // probably indicate someone doing some sort of complex testing...
            if (/\(disabled\)$/i.test(old_buildstr)) {
                return;
            }

            // This no longer tries to detect ancient (older than v16) SFx.
            // Browser profiles that crusty should just be reset!

            // Another >=16 SFX with collision detection who created badge 1st
            // (if we created badge 1st, he complains for us)
            if (old_buildstr && old_buildstr != "old" && old_buildstr != SFX.buildstr) {
                collision_alert(old_buildstr);
            }
        }, 8 * X.seconds);
    });
});
