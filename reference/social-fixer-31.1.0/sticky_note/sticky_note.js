// ===================================================
// STICKY NOTES
// ===================================================
// note_parent = selector or DOM object to point to
// left_right = 'left' | 'right' where to put note (default: 'left')
// content = stuff in the note (string of text or HTML source)
// Previous 'close' functionality removed as nothing used it.
const sticky_note = function(note_parent, left_right, content) {
    left_right = (left_right == 'right') ? 'right' : 'left';
    var note = X(FX.oneLineLtrim(`
        <div class="sfx_sticky_note sfx_sticky_note_${left_right}" style="visibility:hidden">
            <div>${content}</div>
            <div class="sfx_sticky_note_arrow_border"></div>
            <div class="sfx_sticky_note_arrow"></div>
        </div>
    `)).appendTo(X(note_parent).first());
    return note.css({ marginTop: -(note[0].offsetHeight / 2) + 'px', visibility: 'visible', });
};
