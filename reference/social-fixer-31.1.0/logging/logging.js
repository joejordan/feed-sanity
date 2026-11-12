// ========================================================
// Provide a View Log option
// ========================================================
X.ready('logging', function () {
  var log = X.logger('logging',{"color":"#666"});
  var viewer = null;
  var entries = null;
  var index = 0;
  var filter = null;

  X.publish("menu/add", {"section":"other", "item":{'html': 'View Log', 'message': 'log/view'}});
  X.subscribe("log/view", function() {
    log("View Log Clicked in Menu");
    show();
  });
  X.subscribe("log/entry", function() {
    if (viewer) {
      populate_entries(true);
    }
  });
  FX.on_content_loaded(function() {
    if (/sfx_log_filter=([^&]+)/.test(location.href)) {
      // Sanitize
      var str = RegExp.$1.replace(/[^\w\d -.]/g,'');
      log("Log Viewer Filter set through url: "+str);
      apply_filter(str);
    }
    if (/sfx_log=true/.test(location.href)) {
      log("Log viewer launched via url");
      show();
    }
  });

  var show = function() {
    create_log_viewer();
    populate_entries(false);
    viewer.show();
  };
  var create_log_viewer = function() {
    if (viewer) { return; }
    viewer = X(FX.oneLineLtrim(`
      <div id="sfx_log_viewer">
        <div class="sfx_dialog_title_bar" style="margin:0;">
          <div class="sfx_log_button" id="sfx_log_close" title="Close">X</div>
          Social Fixer Console
        </div>
        <div id="sfx_log_controls">
          Filter: <input id="sfx_log_filter" value="${filter?filter.source:''}">
        </div>
        <div id="sfx_log_viewer_entries"></div>
      </div>
    `));
    X('body').append(viewer);
    entries = X('#sfx_log_viewer_entries');
    X("#sfx_log_close").click(function() {
      viewer.hide();
    });
    X("#sfx_log_filter").keyup(function(e) {
      apply_filter(X.target(e).value);
      populate_entries(false);
    });
  };
  var apply_filter = function(str) {
    str = (str||'').trim();
    if (str) {
      filter = new RegExp(str, "i");
    }
    else {
      filter = null;
    }
  };
  var populate_entries = function(incremental) {
    var logs = X.logs;
    var html = [];
    if (!incremental) {
      index = 0;
      entries.html('');
    }
    for (; index<logs.length; index++) {
      var entry = logs[index];
      if (!entry.html) {
        entry.html = render_log_entry(entry);
      }
      if (!filter || (filter.test(entry.module) || filter.test(entry.html))) {
        html.push(entry.html);
      }
    }
    entries.append(html.join(''));
  };
  var lz = function(d) { return d.toString().replace(/^(\d)$/,"0$1"); };
  var render_log_entry = function(data) {
    // The log property holds an array of things to log
    var html = data.log.join(",");
    var d = new Date(data.timestamp);
    var timestamp = `${d.getHours()}:${lz(d.getMinutes())}:${lz(d.getSeconds())} ${(data.uptime / X.seconds).toFixed(4)}`;
    var css = data.color ? `color:${data.color};` : '';
    return `<div class="sfx_log_entry" style="${css}">${timestamp} ${data.module?'['+data.module+']':''} ${html}</div>`;
  };

});
