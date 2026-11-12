X.ready( 'disable_tooltips', function() {
    FX.add_option('disable_tooltips', {"title": 'Disable Tooltips', "section": "Advanced", "description": "If you are an Advanced user and no longer need to see the helpful tooltips that pop up when hovering over some things, you can entirely disable them here.", "default": false});

    FX.on_options_load(function () {
        if (FX.option('disable_tooltips')) {
            Vue.directive('tooltip', function (/* newValue, oldValue */) {
            });
        }
    });
});
