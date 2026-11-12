// 'Permalinks' (Notifications & comment/reply timestamps) point to a
// specific comment/reply; but FB's own code only manages to scroll a
// post to the targeted item a small fraction of the time.  Fix that.

X.ready('permalink_target', function() {
 const add_options = function() {
  FX.add_option('permalink_target', {
    section:     'Advanced',
    title:       'Scroll To Comment',
    description: 'Scroll into view the comment / reply target of a clicked notification or permalink',
    order:       10,
    default:     true,
    live:        set_enabled,
  });
  FX.add_option('permalink_target_css', {
    section:     'Advanced',
    title:       'Scroll To Comment',
    description: 'CSS style to apply to that comment / reply ("this:that;other:etc"; blank for none)',
    type:        'text',
    order:       20,
    default:     'border:3px dashed #4c4;background-color:var(--progress-ring-disabled-foreground);',
    live:        set_target_css,
  });
 };

  var permalink_id = '';
  var permalink_selector = '';
  // Are we looking for a new (different) permalink?
  const new_permalink = function() {
    var url_params = location.search.replace(/^\?/, '').split('&');
    // First two are for www.facebook.com
    // 'ctoken=' sometimes appears in m and/or mbasic.facebook.com comment links
    // These are also right for 'new FB' permalinks
    var notif_target = url_params.find(param => /^reply_comment_id=/.test(param)) ||
      url_params.find(param => /^comment_id=/.test(param)) ||
      url_params.find(param => /^ctoken=/.test(param));
    if (!notif_target) {
      permalink_id = '';
      return false;
    }
    var notif_target_id = notif_target.replace(/.*[=_]/, '');
    if (permalink_id == notif_target_id) {
      return false;
    } else {
      permalink_id = notif_target_id;
      permalink_selector = `[role=article] a[href*="${notif_target}"]`;
      return true;
    }
  };

  // Unmark marked permalink when option becomes disabled, or clicking a new link
  const unmark = function() {
    X('.sfx_permalink_target').removeClass('sfx_permalink_target');
  };

  // The target has appeared, scroll to it!
  const target_appears_immediate = function() {
      // X.when() passes a $target, but re-acquire it because
      // FB may have rewritten the HTML during loading.
      const $container = X(permalink_selector).first().closest('[role=article]');
      if ($container.length) {
          unmark();
          $container.addClass('sfx_permalink_target');
          setTimeout(() => {
              $container[0].scrollIntoView();
              const top_tgt = $container.offset().top - (window.innerHeight / 2);
              window.scrollTo(0, top_tgt < 0 ? 0 : top_tgt);
          }, 0.75 * X.seconds);
      }
  };

  const target_appears = function() {
    // On clicking a comment timestamp, target already exists in
    // the current page: pause to allow new page load to start.
    setTimeout(target_appears_immediate, 1 * X.seconds);
  };

  const visibility_changed = function() {
    if (FX.option('permalink_target') &&
      document.visibilityState == 'visible' &&
      new_permalink()) {
      X.when(permalink_selector, target_appears, 500, 100);
    }
  };
  document.addEventListener('visibilitychange', visibility_changed);

  const set_target_css = function(css) {
    if (!FX.option('permalink_target') || typeof css != 'string' || !/[\S]/.test(css)) {
        css = ''; // Remove it
    } else {
        css = `.sfx_permalink_target { ${css} }`;
    }
    X.css(css, 'sfx_permalink_target_css');
  };
  const set_enabled = function(enabled) {
    if (enabled) {
      permalink_id = '';
      visibility_changed();
    } else {
      unmark();
    }
    set_target_css(FX.option('permalink_target_css'));
  };
  X.subscribe('post/action/permalink_target/scroll_to', target_appears_immediate);
  X.publish('post/action/add', {section: 'wrench', label: 'Scroll To Comment', order: 20, message: 'post/action/permalink_target/scroll_to'});

  // This fires on each click to new venue, making this work even
  // when FB's code controls the page replacement mechanism.
  const page_loaded = function() {
    permalink_id = '';
    visibility_changed();
  };
  add_options();
  FX.on_page_load(page_loaded);
});
