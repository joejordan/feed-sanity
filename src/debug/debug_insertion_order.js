X.ready('debug_insertion_order', function() {
    FX.add_option('debug_show_insertion_order', {"section":"Debug", "title": 'Show Insertion Order', "description": "Highlight portions of posts that are lazily inserted after the post appears on the page.", "default": false});
    FX.on_option('debug_show_insertion_order', function() {
        FX.on_content_inserted(function ($o) {
            var insertion_step = $o.closest('.sfx_inserted').attr('sfx_step') || 0;
            insertion_step++;
            $o.attr('sfx_step', insertion_step);
            $o.addClass("sfx_insert_step_" + insertion_step);
            $o.addClass("sfx_inserted");
        });
    });
});

