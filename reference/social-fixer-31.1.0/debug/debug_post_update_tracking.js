// As 'post/update' is gone, this doesn't really do anything any more
// But changes post appearance, so let it stand in case someone got used to it

X.ready('debug_post_update_tracking', function() {
    FX.add_option('debug_post_update_tracking', {"section":"Debug", "title": 'Track Post Updates', "description": "Track how often a post receives DOM updates and display the timing", "default": false});
    FX.on_option('debug_post_update_tracking', function() {
        X.subscribe_backlog('post/add', function(msg,data) {
            var now = performance.now();
            const $post = data.$post;
            var size = $post.innerText().length;

            $post.attr('sfx_update_count','0');
            $post.attr('sfx_update_start',now);
            $post.attr('sfx_update_size',size);
            $post.attr('sfx_update_tracking','');
        });
    });
});
