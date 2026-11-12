X.ready( 'post_font', function() {
    const post_font_opts = {};
    const post_text_selector = '[sfx_post] *';
    const comment_text_selector = '[sfx_post] .S2F_font_400.S2F_col_tx1:not(.S2F_txal_left) *';

    FX.add_option('post_font_size_2', {
        section: 'General',
        title: 'Font: Post Font Size',
        description: 'Set a custom size (in pixels) for post text, including comments.',
        type: 'number',
        min: 5,
        default: '',
        live: post_font_set_css,
    });
    FX.add_option('post_font_family_2', {
        section: 'General',
        title: 'Font: Post Font Family',
        description: 'Set a custom font to be used for post text, including comments.',
        type: 'text',
        default: '',
        live: post_font_set_css,
    });
    FX.add_option('post_comment_font_size_2', {
        section: 'General',
        title: 'Font: Post Comment Font Size',
        description: 'Set a custom size (in pixels) for post comments only.',
        type: 'number',
        min: 5,
        default: '',
        live: post_font_set_css,
    });
    FX.add_option('post_comment_font_family_2', {
        section: 'General',
        title: 'Font: Post Comment Font Family',
        description: 'Set a custom font for post comments only.',
        type: 'text',
        default: '',
        live: post_font_set_css,
    });

    function post_font_set_css(val, opt) {
        post_font_opts[opt] = val;

        var css = [];
        +post_font_opts.post_font_size_2 >= 5 &&
            css.push(`${post_text_selector} { font-size: ${post_font_opts.post_font_size_2}px !important; }`);
        post_font_opts.post_font_family_2 &&
            css.push(`${post_text_selector} { font-family: "${post_font_opts.post_font_family_2}" !important; }`);
        +post_font_opts.post_comment_font_size_2 >= 5 &&
            css.push(`${comment_text_selector} { font-size: ${post_font_opts.post_comment_font_size_2}px !important; }`);
        post_font_opts.post_comment_font_family_2 &&
            css.push(`${comment_text_selector} { font-family: '${post_font_opts.post_comment_font_family_2}' !important; }`);
        X.css(css.join('\n'), 'sfx_post_font_css');
    }
});
