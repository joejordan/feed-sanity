// ========================================================
// Global font size / family options & SFx UI scale
// ========================================================

// sfx_ui_scale must have a value even if this module never initializes
// (i.e. SFx self-disabled)
X.css('html { --sfx_ui_scale:1.2; }', 'sfx_body_font_css');

X.ready( 'font_family', function() {
    FX.add_option('font_family', {
        "section": "General"
        , "title": "Font: Custom Font"
        , "description": "Set a custom font name using CSS syntax to override the default Facebook fonts. You may add multiple fonts, separated by comma."
        , "type": "text"
        , "default": ""
    });
    FX.add_option('font_mult', {
        "section": "General"
        , "title": "Font: Custom Size"
        , "description": "Set a custom text size multiplier from 0.5 to 2.5 (default 1.0)."
        , "type": "text"
        , "default": ""
    });
    FX.add_option('font_ui_mult', {
        "section": "General"
        , "title": "Font: Social Fixer Size"
        , "description": "Set a custom font size multiplier for Social Fixer interface, from 0.5 to 2.5 (default 1.0)."
        , "type": "text"
        , "default": ""
    });
    const body_font_set_css = function () {
        const toRational = (num, places) => (Number(num) || 0).toFixed(places || 4).replace(/(.)\.?0*$/,'$1');
        const font = FX.option('font_family');
        const size = SFX.bound(FX.option('font_mult'), 0.5, 2.5, 1.0);
        const ui_size = SFX.bound(FX.option('font_ui_mult'), 0.5, 2.5, 1.0);
        const css = [];
        if (font) {
            css.push(`body, body *, #facebook body, #facebook body._-kb { font-family:${font} !important; }`);
        }
        if (size != 1.0) {
            // Disable our own CSS so we can read the base size we are trying to scale
            X.css('', 'sfx_body_font_css');
            const baseSize = (getComputedStyle(document.documentElement)['font-size'] || '16px').replace(/px/, '');
            css.push(`html { font-size:${toRational(size * baseSize)}px; }`);
        }
        // Multiplied by 1.2 because the initial sizes chosen for SFx
        // elements when the global font size option was added were too
        // small relative to FB native scale.
        css.push(`html { --sfx_ui_scale:${toRational(ui_size * 1.2)}; }`);
        X.css(css.join('\n'), 'sfx_body_font_css');
    };
    FX.on_option_live(['font_family', 'font_mult', 'font_ui_mult'], body_font_set_css);
});
