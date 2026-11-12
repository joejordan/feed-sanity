// ========================================================
// Provide a View Log option
// ========================================================
X.ready('debugger', function () {
  var log = X.logger('debugger');

  var viewer = null;
  var query = null;
  var property = null;
  var results = null;
  var delay = 0;

  X.publish("menu/add", {"section":"other", "item":{'html': 'Debugger', 'message': 'debugger/open'}});
  X.subscribe("debugger/open", function() {
    log("Debugger opened");
    show();
  });

  function sanitize_selector(str) {
    return str.replace(/[^\w\d -.#():^~*$"=[\]|]/g,'');
  }
  FX.on_content_loaded(function() {
    var launch = false, str=null;
    if (/sfx_debugger_query=([^&]+)/.test(location.href)) {
      str = decodeURIComponent(RegExp.$1);
      // Sanitize
      str = sanitize_selector(str);
      log("Debugger Query set through url: "+str);
      apply_query(str);
      launch = true;
    }
    if (/sfx_debugger_property=([^&]+)/.test(location.href)) {
      str = decodeURIComponent(RegExp.$1);
      // Sanitize
      str = str.replace(/[^\w\d-]/g,'');
      log("Debugger Property set through url: "+str);
      apply_property(str);
      launch = true;
    }
    if (/sfx_debugger_delay=([^&]+)/.test(location.href)) {
      var ms = +decodeURIComponent(RegExp.$1);
      log("Debugger delay set through url: "+str);
      delay = ms;
    }
    if (launch) {
      setTimeout(function() {
        show();
        run();
      },delay);
    }
  });

  var show = function() {
    create_debugger();
    viewer.show();
  };

  var create_debugger = function() {
    if (viewer) { return; }
    viewer = X(FX.oneLineLtrim(`
      <div id="sfx_debugger">
        <div class="sfx_dialog_title_bar" style="margin:0;">
          <div class="sfx_debugger_button" id="sfx_debugger_close">X</div>
          Social Fixer Debugger
        </div>
        <div id="sfx_debugger_controls">
          <div>CSS Query: <input id="sfx_debugger_query" value=""></div>
          <div>Computed CSS Property: <input id="sfx_debugger_property" value=""></div>
          <div>
            <input type="button" class="sfx_button" value="Run" id="sfx_debugger_run">
            <span id="sfx_debugger_url"></span>
          </div>
        </div>
        <div id="sfx_debugger_results"></div>
      </div>
    `));
    X('body').append(viewer);
    results = X('#sfx_debugger_results');
    X("#sfx_debugger_run").click(function() {
      run();
    });
    X("#sfx_debugger_close").click(function() {
      viewer.hide();
    });
    X("#sfx_debugger_query").val(query).change(function(e) {
      apply_query(X.target(e).value);
    });
    X("#sfx_debugger_property").val(property).change(function(e) {
      apply_property(X.target(e).value);
    });
  };
  var apply_query = function(str) {
    query = (str||'').trim();
  };
  var apply_property = function(str) {
    property = (str||'').trim();
  };

  var run = function() {
    results.html('');
    var els = null;
    if (!query) {
      return results.html('No query');
    }
    try {
      els = X.query(query);
    }
    catch(e) {
      return results.html('Query error: '+e.message);
    }
    if (!els.length) {
      return results.html('No results found');
    }

    // Valid query, update the url
    var url = location.href.replace(/&.*/,'');
    url += /\?/.test(url) ? '&' : '?';
    url += "sfx_debugger_query="+encodeURIComponent(query);
    if (property) {
      url += "&sfx_debugger_property=" + encodeURIComponent(property);
    }
    X('#sfx_debugger_url').html(`<a href="${url}">${url}</a>`);

    var count = 0;
    var count_limit = 100;
    var i, j, empty = false, $d=null, $d2=null, $content=null;
    var header = function(type) {
      // Each element of the returned array is an X collection, or possibly a string
      var $header = X(`<div class="sfx_debugger_text_header"></div>`);
      $header.text(type);
      var $action = X(`<span class="sfx_debugger_action">Copy</span>`);
      $action.on('click',function(e) {
        X(e.target.parentNode.nextSibling).select(true);
        return false;
      });
      $header.append($action);
      return $header;
    };
    for (i=0; i<els.length && count<count_limit; i++) {
      //str.push(X(els[i]).tagHTML());
      empty = true;
      $d = X('<div class="sfx_debugger_result sfx_clearfix">');
      if (typeof els[i]==="string") {
        if (++count<count_limit) {
          $content = X(`<div class="sfx_debugger_content sfx_debugger_text_content">`);
          $content.text(els[i]);

          $d.append(header('[Text]'));
          $d.append($content);
          empty = false;
        }
      }
      else {
        var inner_els = els[i];
        for (j=0; j<inner_els.length; j++) {
          if (++count<count_limit) {
            empty = false;
            $d2 = X('<div class="sfx_debugger_subresult sfx_clearfix">');

            $content = X(`<div class="sfx_debugger_content sfx_debugger_node_content">`);
            $content.text(X(inner_els[j]).tagHTML());

            $d2.append(header('[Node]'));
            $d2.append($content);

            (function(el) {
              $d2.on('mouseover',function() {
                el.style.outline = "3px solid blue";
              });
              $d2.on('mouseout',function() {
                el.style.outline = "";
              });
              $d2.on('click',function() {
                viewer.hide();
                el.scrollIntoView(false);
                setTimeout(function() {
                  el.style.outline="10px solid blue";
                },500);
                setTimeout(function() {
                  el.style.outline="";
                },3000);
              });
            })(inner_els[j]);
            $d.append($d2);
          }
        }
      }
      if (!empty) {
        results.append($d);
      }
    }
    if (count>=count_limit) {
      results.prepend(`<div class="sfx_debugger_warning">Result count exceeds limit. Showing the first ${count_limit}.</div>`);
    }
  };
});
