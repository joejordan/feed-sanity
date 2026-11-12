X.ready( 'debug_post_html', function() {
    // Add an item to the wrench PAI
    X.publish('post/action/add', {"section": "wrench", "label": "Show Post HTML", order: 30, "message": "post/action/post_html"});
    X.subscribe("post/action/post_html", function (msg, data) {
        const html_text = X.htmlEncode(document.getElementById(data.id).outerHTML);

        var content = FX.oneLineLtrim(`
        <div draggable="false">Click in the box, press ${SFX.Ctrl}+a to select all, then ${SFX.Ctrl}+c to copy.</div>
        <div draggable="false">
            <textarea style="white-space:pre-wrap;width:500px;height:250px;overflow:auto;background-color:white;">${html_text}</textarea>
        </div>
        `);
        bubble_note(content, {"position": "top_right", "title": "Post Debug HTML", "close": true});
    });
});
