X.ready( 'photo_tags', function() {
    FX.add_option('photo_tags', {
        section: 'General',
        title: 'Show Photo Tags',
        description: 'When hovering over a photo, display caption text or tags added by Facebook',
        default: false,
    });
    FX.on_option('photo_tags', function() {
        FX.on_selector('img[alt]:not([alt=""]', function($img) {
            // We only want to operate on photo tags inside posts.
            // Wait for post processor to identify it as a post.
            setTimeout(() => {
                if ($img.is('[sfx_post] *')) {
                    const at = $img.attr('alt');
                    $img.closest('a,.S2F_pos_rel,.S2F_disp_infl').attr('sfx_photo_tags',at);
                    // Uncommenting this and tweaking '.sfx_photo_tags_text { display:block; }'
                    // makes alt-texts copy-pasteable.  Latent and possible future feature...
                    // $img.closest('a').parent().append(`<pre class="sfx_photo_tags_text">ALT text: '${at}'</pre>`);
                }
            }, 0.5 * X.seconds);
        });
    });
});
