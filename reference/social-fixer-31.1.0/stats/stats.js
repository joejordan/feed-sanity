FX.on_options_load(function () {
    X.storage.get('stats', {}, function (stats) {
        var today = X.today();
        if (today > (stats.last_ping || 0)) {
            stats.last_ping = today;
            X.ajax("https://SocialFixer.com/version.txt", function (/* ver, status */) {
                X.storage.set('stats', "last_ping", today);
            });
        }
    }, true);
});
