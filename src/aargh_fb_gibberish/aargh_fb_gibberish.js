X.ready('aargh_fb_gibberish', function () {
    // This layer handles FB's ever-changing array of gibberish CSS
    // class names.  Rolling out initially in late 2019, they now use
    // a gigantic set of 'atomic' CSS classes in their code. 'atomic'
    // in the sense that most (but not all) are classes specifying
    // the smallest possible possible particle of CSS meaning.  For
    // instance, where they might once have had a class meaning
    // 'border: 3px dashed red', they would now use separate classes
    // meaning 'border-left-width: 3px', 'border-left-style: dashed',
    // 'border-left-color: red', plus 3 more sets for border-right,
    // border-top, border-bottom.
    //
    // At the same time as they switched to these CSS 'atoms', they also
    // removed most other logical markup from their HTML, making it ever
    // more difficult to *find* things like 'this is the top node of a
    // post' or 'this is a box in which an ad might appear'.  We find
    // such things by evaluating which CSS is required to display them
    // in the desired manner, then looking for that CSS by atom-name.
    //
    // But then, they keep *changing* those atom-names.  There was an
    // initial set in 2019 (mostly seen by users for the first time in
    // 2020); another set in early/mid 2022; now a 3rd major set in late
    // 2022.  The pace of replacement is increasing, so now we will
    // determine them dynamically at runtime and use our own abstraction
    // layer in our CSS lookups.
    //
    // These abbreviations are used in SFx and socialfixerdata CSS,
    // which is then translated at runtime into CSS which correctly
    // operates the current FB page-at-hand.
    //
    // They are restricted to 10 chars by convention, and by code to
    // digits, lowercase letters, and underscores.  In CSS they are
    // prefixed with 'S2F_' (SFx to FB), so there is no chance at all of
    // namespace conflict; e.g. '.S2F_col_bt1.S2F_font_700'.
    //
    // Yes, it's all incredibly ugly.  Thanks, FB!
    //
    // The words and names 'gibberishes', 'gibberi', 'gibs', 'gib',
    // etc. refer to the gibberish hash names FB are using for these
    // classes.  In the late-2022 version of the scheme, these are
    // 6-to-8 character names composed of lowercase letters and
    // digits, always starting with an 'x'. e.g. '.x1rg5ohu' means
    // 'display:inline-block'.  In SFx CSS this will now be represented
    // as '.S2F_disp_inlb' and translated at runtime to whatever is
    // needed to match the CSS in use by the current page.

    SFX.gib = {
        alinc_flst: { css:'align-content:flex-start', },
        alini_cent: { css:'align-items:center', },
        alini_fxnd: { css:'align-items:flex-end', },
        alini_stre: { css:'align-items:stretch', },
        alisl_cent: { css:'align-self:center', },
        bb_1pxdiv:  { css:'border-bottom:1px solid var(--divider)', },
        bb_bt2:     { css:'border-bottom:1px solid var(--secondary-button-background)', },
        bbcol_div:  { css:'border-bottom-color:var(--divider)', },
        bb_dark:    { css:'border-bottom-color:var(--always-dark-overlay)', },
        bbl_rad0:   { css:'border-bottom-left-radius:0px', },
        bbl_rad10:  { css:'border-bottom-left-radius:10px', },
        bbl_rad50:  { css:'border-bottom-left-radius:50%', },
        bbl_radcrd: { css:'border-bottom-left-radius:var(--card-corner-radius)', },
        bg_accent:  { css:'background-color:var(--accent)', },
        bg_bt2:     { css:'background-color:var(--secondary-button-background)', },
        bg_card:    { css:'background-color:var(--card-background)', },
        bg_cbg:     { css:'background-color:var(--comment-background)', },
        bg_hilit:   { css:'background-color:var(--highlight-bg)', },
        bg_surf:    { css:'background-color:var(--surface-background)', },
        bg_trans:   { css:'background-color:transparent', },
        bot_0:      { css:'bottom:0px', },
        bt_divid:   { css:'border-top:1px solid var(--divider)', },
        btl_rad0:   { css:'border-top-left-radius:0px', },
        bxs_bbox:   { css:'box-sizing:border-box', },
        ch1_none:   { css:'display:none', pseudo:':first-child', },
        col_acc:    { css:'color:var(--accent)', },
        col_bt1:    { css:'color:var(--primary-button-text)', },
        col_btdis:  { css:'color:var(--disabled-button-text)', },
        col_tx1:    { css:'color:var(--primary-text)', },
        col_tx1med: { css:'color:var(--primary-text-on-media)', },
        col_tx2:    { css:'color:var(--secondary-text)', },
        curs_def:   { css:'cursor:default', },
        curs_not:   { css:'cursor:not-allowed', },
        disp_blok:  { css:'display:block', },
        disp_cont:  { css:'display:contents', },
        disp_flex:  { css:'display:flex', },
        disp_infl:  { css:'display:inline-flex', },
        disp_inlb:  { css:'display:inline-block', },
        disp_inl:   { css:'display:inline', },
        disp_none:  { css:'display:none', },
        empty_none: { css:'display:none',   pseudo:':empty', },
        en_nozi:    { css:'z-index:unset',  prefix:'\\.GIB:not\\(\\[disabled]\\) +', },
        fcs_col_ph: { css:'color:var(--placeholder-text)', pseudo:':focus', },
        ffam_def:   { css:'font-family:var(--font-family-default)', },
        fhd_wide:   { css:'max-width:none', media:'max-width:1920px', },
        flbs_100:   { css:'flex-basis:100%', },
        flbs_inh:   { css:'flex-basis:inherit', },
        fldr_col:   { css:'flex-direction:column', },
        fldr_row:   { css:'flex-direction:row', },
        fldr_rrow:  { css:'flex-direction:row-reverse', },
        flex_0px:   { css:'flex-basis:0px', },
        flex_shr1:  { css:'flex-shrink:1', },
        flex_wrap:  { css:'flex-wrap:wrap', },
        flgr_1:     { css:'flex-grow:1', },
        flsh_0:     { css:'flex-shrink:0', },
        flwr_no:    { css:'flex-wrap:nowrap', },
        font_400:   { css:'font-weight:400', },
        font_600:   { css:'font-weight:600', },
        font_700:   { css:'font-weight:700', },
        font_bold:  { css:'font-weight:bold', },
        hei_100:    { css:'height:100%', },
        hei_100_hh: { css:'height:calc(100vh\\s*-\\s*var(--header-height))', },
        hei_1:      { css:'height:1px', },
        hei_inh:    { css:'height:inherit', },
        just_cent:  { css:'justify-content:center', },
        just_flst:  { css:'justify-content:flex-start', },
        just_spbt:  { css:'justify-content:space-between', },
        left_0:     { css:'left:0px', },
        list_none:  { css:'list-style:none', },
        mb_0:       { css:'margin-bottom:0px', },
        mb_6:       { css:'margin-bottom:6px', },
        mr_auto:    { css:'margin-right:auto', },
        mw_100:     { css:'max-width:100%', },
        oflx_hid:   { css:'overflow-x:hidden', },
        opac_0:     { css:'opacity:0', },
        opac_1:     { css:'opacity:1', },
        oscrx_cont: { css:'overscroll-behavior-x:contain', },
        oscry_cont: { css:'overscroll-behavior-y:contain', },
        outl_none:  { css:'outline:none', },
        ovfa_n:     { css:'overflow-anchor:none', },
        ow_bw:      { css:'overflow-wrap:break-word', },
        padb_12:    { css:'padding-bottom:12px', },
        padl_16:    { css:'padding-left:16px', },
        padt_16:    { css:'padding-top:16px', },
        pos_abs:    { css:'position:absolute', },
        pos_fix:    { css:'position:fixed', },
        pos_rel:    { css:'position:relative', },
        pos_stk:    { css:'position:sticky', },
        ryt_0:      { css:'right:0px', },
        snap_st:    { css:'scroll-snap-align:start', },
        top_0:      { css:'top:0px', },
        top_hdrh:   { css:'top:var(--header-height)', },
        touch_man:  { css:'touch-action:manipulation', },
        trans_n:    { css:'transform:none', pseudo:':active', },
        ttf_eei:    { css:'transition-timing-function:var(--fds-animation-enter-exit-in)', },
        txal_cent:  { css:'text-align:center', },
        txal_left:  { css:'text-align:left', },
        txtr_lower: { css:'text-transform:lowercase', },
        va_bot:     { css:'vertical-align:bottom', },
        va_mid:     { css:'vertical-align:middle', },
        vis_vis:    { css:'visibility:visible', },
        wid_100:    { css:'width:100%', },
        wid_1:      { css:'width:1px', },
        wid_fit:    { css:'width:fit-content', },
        wid_panel:  { css:'width:var(--global-panel-width)', },
        wsp_pre:    { css:'white-space:pre-wrap', },
        zi_0:       { css:'z-index:0', },
        zi_1:       { css:'z-index:1', },
        zi_2:       { css:'z-index:2', },
    };

    const log = X.logger('fb_gibberish');

    SFX.gib_make_regexes = function() {
        log(`make_regexes start`);
        Object.values(SFX.gib).forEach(function(entry) {
            let pfx = entry.prefix ? entry.prefix.replace(/GIB/g,'[a-z0-9]{6,8}') : '';
            let psu = entry.pseudo || '';
            let css = entry.css.replace(/:/, ': *').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
            let capture = entry.media ? '\\.([a-z0-9]{6,8})\\.\\1' : '\\.([a-z0-9]{6,8})';
            entry.re = new RegExp(`^${pfx}${capture}${psu} *{ *${css}[ ;]*}`);
            entry.media_re = entry.media ? new RegExp(entry.media.replace(/:/g, ': *')) : /^$/;
        });
        log(`make_regexes end`);
    };

    SFX.gib_find_rule = function(entry, cssMedia, cssText) {
        if (entry.media_re.test(cssMedia) && entry.re.test(cssText)) {
            let newgib = RegExp.$1;
            if (entry.gib && entry.gib != newgib) {
                // 2 gibberi resolve to the same CSS atom: keep the more popular one
                let new_count = X('.' + newgib).length + 1;
                let old_count = entry.count || X('.' + entry.gib).length;
                entry.gib = (new_count > old_count) ? newgib : entry.gib;
                entry.count = Math.max(new_count, old_count);
            } else {
                entry.gib = newgib;
            }
        }
    };

    const basename = (str) => str.replace(/^.*\/|\?.*$/g, '');

    SFX.gib_find_all = function(entries = SFX.gib) {
        log(`find_all start (n = ${Object.keys(entries).length})`);

        // Traverse all style rules in the DOM

        // The per-sheet logging in this loop displays only (1) failed sheets
        // (which are expected but not required to be ones with URLs) and (2)
        // duplicated sheets we've made from failed sheets (which will always
        // have a URL).  If all is well, the log should show a failed attempt
        // with a sheet name, followed by a later success with the same name.

        for (let idx = 0; idx < document.styleSheets.length; ++idx) {
            const sheet = document.styleSheets[idx];
            try {
                for (const rule of sheet.cssRules) {
                    let cssMedia = (rule instanceof CSSMediaRule) ? Array.from(rule.media).join(',') : '';
                    let cssText =  (rule instanceof CSSMediaRule) ? Array.from(rule.cssRules).map(subrule => subrule.cssText).join(' ') : rule.cssText;
                    // Does this rule define one of the gibberi we're looking for?
                    Object.values(entries).forEach(entry => SFX.gib_find_rule(entry, cssMedia, cssText));
                }
                if (sheet.disabled && sheet.ownerNode) {
                    const name = sheet.ownerNode.getAttribute('sfx_name');
                    if (name) {
                        log(`find_all stylesheet #${idx} '${name}' ok`);
                    }
                }
            } catch(e) {
                const name = sheet.href ? ` '${basename(sheet.href)}'` : '';
                log(`find_all stylesheet #${idx}${name} failed: ${e.toString()}`);
            }
        }
        log(`find_all end`);
    };
    SFX.gib_find_one = entry => SFX.gib_find_all([entry]);

    // The following ugliness is because we can't read some of the loaded
    // stylesheets due to CORS.  But they document their URLs and we *do*
    // have the power to download them, so let's do that.  urghghh.
    SFX.gib_stylesheet_count = 0;
    SFX.gib_stylesheet_filenames = [];
    SFX.gib_retrieve_stylesheet = url => {
        const filename = basename(url);
        if (!SFX.gib_stylesheet_filenames.includes(filename)) {
            SFX.gib_stylesheet_filenames.push(filename);
            log(`retrieve_stylesheet '${filename}'`);
            // Grab that style's source
            return new Promise(resolve => {
                X.ajax(url, css => {
                    let sheet_id = `sfx_gib_stylesheet_${SFX.gib_stylesheet_count++}`;
                    // Cram it into a stylesheet
                    X.css(css, sheet_id);
                    X.when(`#${sheet_id}`, function($style_node) {
                        // X.css() is async.  When done, tag the style node so
                        // we can recognize it; then find the corresponding
                        // styleSheet and disable it; no reason for the browser
                        // to be working extra hard to apply the same rules twice.
                        // We just need the browser's power of parsing CSS...
                        $style_node.attr('sfx_name', filename);
                        for (const sheet of document.styleSheets) {
                            if (sheet.ownerNode && sheet.ownerNode.id == sheet_id) {
                                sheet.disabled = true;
                                log(`stylesheet '${filename}' successfully retrieved`);
                            }
                        }
                        resolve(true);
                    });
                });
            });
        }
        return Promise.resolve(true);
    };
    SFX.gib_retrieve_stylesheets = function() {
        const promises = [];
        for (const sheet of document.styleSheets) {
            try {
                sheet.cssRules[0];
            } catch(e) {
                // That stylesheet's rules aren't accessible (CORS?)
                // But maybe we can load it by URL...
                if (sheet.href) {
                    promises.push(SFX.gib_retrieve_stylesheet(sheet.href));
                }
            }
        }
        return Promise.all(promises);
    };

    // Repair any early styles which used gibs
    SFX.gib_styles_fixed = false;
    SFX.gib_fix_styles = function() {
        if (SFX.gib_styles_fixed) {
            return;
        }
        SFX.gib_styles_fixed = true;
        X('head style[id^=sfx_]').forEach(style => {
            ocss = style.textContent;
            ncss = SFX.gib_convert(ocss);
            if (ncss != ocss) style.textContent = ncss;
        });
    };

    let retry_msg = '';
    let retry_time = 0.5;

    SFX.gib_verify = function() {
        let total = Object.keys(SFX.gib).length;
        let found = Object.values(SFX.gib).reduce((v,entry) => v + !!entry.gib, 0);
        let inuse = Object.values(SFX.gib).reduce((v,entry) => v + !!document.querySelector(`.${entry.gib}`), 0);
        X.support_note('fb_gibberish', `gibs to find: ${total}; found: ${found}; inuse: ${inuse}${retry_msg}`);
        log(`verify ${total}:${found}:${inuse}${retry_msg}`);
        if (retry_time < 10 && (found < total / 3 || inuse < total / 10)) {
            setTimeout(() =>
                SFX.gib_retrieve_stylesheets().then(() => {
                    if (found < total) {
                        SFX.gib_find_all();
                    }
                    SFX.gib_verify();
                }), retry_time * X.seconds);
            retry_time *= 2;
        } else {
            SFX.gib_fix_styles();
        }
        retry_msg = ` (retry, previously ${total}:${found}:${inuse})`;
    };

    SFX.gib_make_regexes();
    SFX.gib_retrieve_stylesheets().then(() => {
        SFX.gib_find_all();
        SFX.gib_verify();
    });

    SFX.gib_missing = [];
    SFX.gib_replace = function(token, name, _position, string) {
        if (name in SFX.gib && SFX.gib[name].gib) { // Translation already found
            return SFX.gib[name].gib;
        }
        if (name in SFX.gib) { // Translation not found during setup, maybe now??
            log(`replace retrying '${name}'`);
            SFX.gib_retrieve_stylesheets();
            SFX.gib_find_one(SFX.gib[name]);
            if (SFX.gib[name].gib) {
                SFX.gib_verify();
                log(`replace succeeded '${name}'`);
                return SFX.gib[name].gib;
            }
            log(`replace failed '${name}'`);
            SFX.gib[name].gib = token;
        }
        if (!SFX.gib_missing[name]) SFX.gib_missing[name] = {};
        SFX.gib_missing[name][string] = (SFX.gib_missing[name][string] || 0) + 1;
        return token;
    };
    SFX.gib_convert = str => str.replace(/S2F_([a-z0-9_]*)/g, SFX.gib_replace);
});
