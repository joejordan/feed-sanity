// =============================================
// "Bubble" Notes are panels to display... notes
// =============================================
var bubble_note_anon_count = 0;

const bubble_note = function(content,options) {
    options = options || {};
    options.position = options.position || "top_right";
    if (typeof options.close!="boolean") { options.close=false; }
    if (typeof options.draggable!="boolean") { options.draggable=true; }
    // If ID is passed, remove old one if it exists
    if (options.id) {
        X(`[id=${options.id}]`).remove();
    }
    const attr_id = 'id="' + (options.id || `sfx_bubble_note_${++bubble_note_anon_count}`) + '"';
    const attr_style = options.style ? ` style="${options.style}"` : '';
    const attr_class = ` class="sfx_bubble_note sfx_bubble_note_${options.position}` +
        (options.no_esc ? ' sfx_bubble_note_no_esc' : '') +
        (options.className ? ` ${options.className}` : '') + '"';
    const c = X(`<div ${attr_id}${attr_style}${attr_class}>` +
        (options.close ? '<div class="sfx_sticky_note_close"></div>' : '') +
        (options.title ? `<div class="sfx_bubble_note_title">${options.title}</div>` : ''));
    // Bubble note content is generated entirely from within code and is untainted - safe
    c.append(typeof content === 'string' ? `<div class="sfx_bubble_note_content">${content}</div>` : content);
    // Close functionality
    c.find('.sfx_sticky_note_close, .sfx_button_close').click(function() {
        if (typeof options.callback=="function") {
            options.callback(c);
        }
        c.remove();
    });

    FX.on_content_loaded(function() {
        X(document.body).append(c);
        if (options.draggable) {
            c.children().attr('draggable','false');
            X.draggable(c[0]);
        }
    });
    return c;
};
// Hide all bubble notes when ESC is pressed
X.subscribe('esc/pressed', () => {
    const cur_notes = X('.sfx_bubble_note:not(.sfx_bubble_note_no_esc)');
    if (cur_notes.length) {
        X.publish('esc/prevent');
        cur_notes.remove();
    }
});

// A popup that remembers not to show itself next time
const context_message = function(key,content,options) {
    options = options || {};
    X.storage.get('messages',{},function(messages) {
        if (typeof messages[key]=="undefined") {
            // Show the message
            // Add an option to not show the message in the future
            content += FX.oneLineLtrim(`
                <div style="margin:15px 0 15px 0;"><input type="checkbox" class="sfx_dont_show" checked> Don't show this message again</div>
                <div><input type="button" class="sfx_button sfx_button_close" value="OK, Got It"></div>
            `);
            options.close = true;
            options.id = "sfx_content_message_"+key;
            options.title = `<div class="sfx_info_icon">i</div>${options.title}`;
            options.style="padding-left:35px;";
            options.callback = function($popup) {
                if ($popup.find('.sfx_dont_show').prop('checked')) {
                    X.storage.set('messages',key,X.now(),function() {});
                }
            };
            return bubble_note(content,options);
        }
    },true);
};
