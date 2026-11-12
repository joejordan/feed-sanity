// Distribute a message when ESC is pressed
window.addEventListener('keydown', event => {
    if (event.keyCode == 27) {
        SFX.prevent_esc = false;
        X.publish('esc/pressed');
        if (SFX.prevent_esc) {
            event.preventDefault();
            event.stopPropagation();
        }
    }
}, { capture: true, });

X.subscribe('esc/prevent', () => SFX.prevent_esc = true);
