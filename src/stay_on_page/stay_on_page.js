FX.add_option('stay_on_page', {
    section: 'Experiments',
    title: 'Stay On Page',
    description: 'Prevent the browser from leaving the current Facebook page when you click on a link',
    default: false,
});

X.subscribe_backlog('context/ready', function() {
    FX.on_options_load(function () {
        // Exclude some pages where this interacts badly or is unhelpful
        if (FX.context.type == 'messages' || FX.context.id == 'settings') {
            return;
        }
        if (FX.option('stay_on_page')) {
            setTimeout(function() {
                X.inject(function() {
                    window.requireLazy(['Run'], function(Run) {
                        Run.onBeforeUnload(function() {
                            return 'Social Fixer: Stay On Page is protecting you from leaving this page before you intended to.  Choose whether you want to stay or leave.';
                        }, false);
                    });
                });
            }, 1.5 * X.seconds);
        }
    });
});
