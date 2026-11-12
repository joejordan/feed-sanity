// ========================================================
// Fix Comments
// ========================================================
X.ready('comment_button', function () {
  var title = 'Fix Enter In Comments, Replies & Chat';
  FX.add_option('comment_button', {title, order: 1, description: 'Use Enter to add a new line instead of submitting comments & replies.', default: false, live: maybe_ok});
  FX.add_option('comment_button_msgs', {title, order: 2, description: 'Use Enter to add a new line instead of submitting chat / messages.', default: false, live: maybe_ok});
  FX.add_option('comment_button_ctrl', {title, order: 3, description: 'Use Ctrl+Enter to submit comments, replies & chat / messages.', default: false, live: maybe_ok});
  FX.add_option('comment_button_emergency', {title, order: 4, description: 'Use alternate method (no Submit buttons; Ctrl+Enter submits).', default: false, live: maybe_ok});
  FX.add_option('comment_button_hint', {hidden: true, default: true});

  /* Changed settings might fix a failure mode, so let's try again */
  var fix_comments_failing = false;
  function maybe_ok() { fix_comments_failing = false; }

  FX.on_options_load(function () {
    var nested_enter_event = false;
    var nested_enter_count = 0;

    var dispatch_enter_event = function (e, $target, shiftKey) {
      // Set a timeout so if it fails, revert back to default behavior
      var saved_enter_count = nested_enter_count;
      setTimeout(function () {
        if (nested_enter_count > saved_enter_count) {
          return;  // It worked!
        }

        // Tell Fix Enter to stop trying; retract Submit buttons & messages
        fix_comments_failing = true;
        remove_all_comment_buttons();

        // Then alert the user and offer some proposed solutions
        var proposed_solution = (FX.option('comment_button_emergency')) ?
                                "disable all 'Fix Enter' options" :
                                "enable the 'Use alternate method' option";
        var proposed_limitation = (FX.option('comment_button_emergency')) ?
                                `For now, 'Enter' submits and 'Shift+Enter' makes new lines
(Facebook's normal behavior)` :
                                `Enter will add new lines, Ctrl+Enter will submit,
but there will be no visible comment/reply Submit button`;
        // 0-timeout to allow button/msg retraction to redraw
        setTimeout(function () {
          alert(`Message from Social Fixer: it looks like 'Fix Enter' is failing.

Please ${proposed_solution}, and watch
the Support group, socialfixer.com/support, for announcements.

No need to report it, you won't be the first.

${proposed_limitation}.`.replace(/\n/g,' \n')); // Opera ^C-to-copy omits newlines
        });
        X.support_note('comment_button', 'failing');
      }, 250);
      nested_enter_event = true;
      $target[0].dispatchEvent(new KeyboardEvent('keydown', {
            bubbles: true
          , cancelable: true
          , charCode: 0
          , code: 'Enter'
          , key: 'Enter'
          , keyCode: 13
          , shiftKey: shiftKey
          , which: 13
      }));
      nested_enter_event = false;
      e.preventDefault();
      e.stopPropagation();
    };

    // Anchor-parent of an entire write-a-comment-or-reply box
    const comment_ancestor_selector = [
        '.S2F_outl_none.S2F_disp_flex',
    ].join(',');

    // Presence of one of these indicates the input text is empty
    const comment_empty_text_selector = [
        '[id*=placeholder]',
        '[aria-describedby*=placeholder]',
        '.S2F_font_400.S2F_fcs_col_ph',
        '.S2F_pos_abs.S2F_col_tx2',
    ].join(',');

    // Presence of this indicates an image, GIF, or sticker attachment
    // aria-label is 'Remove sticker' or similar
    const comment_attachment_selector = [
        '[role=button][aria-label].S2F_bg_bt2.S2F_bbl_rad50',
    ].join(',');

    const comment_is_empty = function($container) {
        const $comment_ancestor = $container.closest(comment_ancestor_selector);
        return (
            // has placeholder prompting to enter a comment
                ($comment_ancestor.find(comment_empty_text_selector).length != 0) &&
            // *and* does not have a 'Remove this [image | GIF | sticker]' button
                ($comment_ancestor.find(comment_attachment_selector).length == 0)
        );
    };

    // Chat input fields on both pop-unders & whole-page chat have
    // these characteristics (and will be separately checked for
    // 'word-wrap:break-word' in code).
    const chat_input_selector = [
        '.S2F_pos_abs ~ * .S2F_col_tx1',
    ].join(',');

    // The 'send a birthday message' form has its own special quirks
    const birthday_input_selector = [
        '[role=dialog] form *',
    ].join(',');
    const birthday_input_rejector = [
        '[role=presentation] *',
    ].join(',');

    // Two kinds of comment input field...
    const comment_input_selector = [
        '[sfx_post] [role=presentation] *',           // inline comment
        '[role=complementary] [role=presentation] *', // 'theater' mode sidebar
    ].join(',');

    const input_field_source = function($target) {
        if ($target.is(birthday_input_selector) && !$target.is(birthday_input_rejector)) {
            // Checked *before* messages, as this field also matches that test
            return 'birthday';
        } else if ($target.is(comment_input_selector)) {
            return 'comment';
        } else if ($target.is(chat_input_selector) &&
                   Object.values($target.css(['word-wrap','word-break'])).includes('break-word')) {
            // 'word-wrap:break-word' or 'word-break:break-word' is sometimes given
            // in a style= parameter rather than a class, so use .css() to detect it.
            return 'message';
        } else if (/events\/birthdays/.test(location.pathname)) {
            // Checked *after* pop-unders so pop-unders work on the birthdays page
            return 'birthday';
        }
        // Nothing we know about...
        return '';
    };
    SFX.pose({ input_field_source, });

    const maybe_remove = function(comment_id, force) {
        const $container = X(`[sfx_comment_id="${comment_id}"]`);
        if (force || comment_is_empty($container)) {
            $container.unbind('focusout', comment_button_data[comment_id].remove_callback);
            $container.removeAttr('sfx_comment_id');
            X(`[id="sfx_comment_button_${comment_id}"]`).remove();
            delete comment_button_data[comment_id];
        }
    };
    const remove_all_comment_buttons = function() {
        Object.keys(comment_button_data).forEach(comment_id => maybe_remove(comment_id, true));
    };

    var comment_button_data = {};
    SFX.pose({ comment_button_data, remove_all_comment_buttons, });

    var comment_button_actions = {
      "comment_button_options": function () {
        X.publish("menu/options", {"highlight_title": title});
      },
      "comment_button_hint_off": function () {
        X.storage.set("options", "comment_button_hint", false);
        X('.sfx_comment_button_hint').remove();
      },
      "dispatch_enter_event": dispatch_enter_event,
    };

    var comment_id = 0;

    X.capture(window, 'keydown', function (e) {
      // This handler is invoked for every input key; bail
      // out early if we have nothing to do...
      // [[[ ==>

      // ==> If we already know our events aren't getting through
      if (fix_comments_failing) {
        return;
      }

      // ==> If this is a nested call (we're on the dispatch chain for
      //    our own injected Enter keys!)
      if (nested_enter_event) {
        nested_enter_count++;
        return;
      }

      // Find the target of the keypress
      var $target = X.target(e, true);

      // ==> If this isn't an editable field
      if (!$target.is('[contenteditable=true][role=textbox]')) {
        return;
      }

      // ==> In emergency mode, just fiddle with shift-state of Enter
      // (no UI, and apply to all input fields of any type)
      if (FX.option('comment_button_emergency')) {
        if (e.keyCode == 13) {
          // Force Ctrl+Enter = submit, else no way to submit comment / reply!
          // Although chat/msgs have native FB submit button, act consistently.
          dispatch_enter_event(e, $target, !e.ctrlKey);
        }
        return;
      }

      // ==> Is this a comment or chat / messages field, or unknown?
      const comment_type = input_field_source($target);
      if (!comment_type) {
        return;
      }

      // <== ]]]

      var this_comment_id = $target.attr('sfx_comment_id');
      if (!this_comment_id) {
        while (X(`[sfx_comment_id="${comment_id}"]`).length) {
          ++comment_id; // skip in-use IDs
        }
        this_comment_id = comment_id++;
        $target.attr('sfx_comment_id', this_comment_id);
        comment_button_data[this_comment_id] = {
          comment_type,
          Xtarget: $target,   // can't use $ in Vue data property names
        };
      }
      const cbd = comment_button_data[this_comment_id];
      if (!cbd) {
        // This happens if >1 SFx running and another is handling this comment_id
        return;
      }

      // Communicate any option changes to Vue -- without triggering
      // any events if they *haven't* changed...
      ['comment_button','comment_button_ctrl','comment_button_hint','comment_button_msgs'].forEach(function(opt) {
        var opt_val = FX.option(opt);
        if (cbd[opt] != opt_val) {
          cbd[opt] = opt_val;
        }
      });
      // Only add our own Submit button to the post-comment/reply & birthday cases
      if (comment_type == 'comment' || comment_type == 'birthday') {
        var tabIndex = 9900 + 2 * this_comment_id;
        $target[0].tabIndex = tabIndex;
        var $note_container = $target.closest('form').parent();
        const comment_or_reply = (comment_type == 'birthday') ? 'Birthday Post'
            : $note_container.closest('[sfx_post] li').length ? 'Reply'
                                                              : 'Comment';

        if (!$note_container.find('[id^=sfx_comment_button_]').length) {
          // Wait a moment to see if this keystroke lands in the input buffer
          setTimeout(() => {
            if (!$note_container.find('[id^=sfx_comment_button_]').length && !comment_is_empty($target)) {
              var html = FX.oneLineLtrim(`
                <div id="sfx_comment_button_${this_comment_id}" class="sfx_clearfix">
                  <input v-if="comment_button" class="sfx_comment_button" type="button" value="Submit ${comment_or_reply}" title="${cbd.comment_button_ctrl ? 'Click or press Ctrl+Enter to Submit' : ''}" style="cursor:pointer;" tabIndex="${9901 + 2 * this_comment_id}" @click="dispatch_enter_event($event, Xtarget, false)">
                  <span v-if="!comment_button && comment_button_hint" class="sfx_comment_button_msg sfx_comment_button_hint">
                    Social Fixer can prevent Enter from submitting comments & replies!<br>
                    <a class="sfx_link" style="color:inherit;" @click="comment_button_options">
                      'Fix Enter' Options
                    </a>
                    &nbsp;&nbsp;
                    <a class="sfx_link" style="color:inherit;" @click="comment_button_hint_off">
                      Don't show this
                    </a>
                  </span>
                </div>
              `);
              cbd.remove_callback = (() => setTimeout(() => maybe_remove(this_comment_id), 0.2 * X.seconds));
              $note_container.bind('focusout', cbd.remove_callback);
              template($note_container[0], html, cbd, comment_button_actions);
            }
          }, 0.05 * X.seconds);
        }
      } else if (comment_type == 'message' && cbd.comment_button_msgs) {
        // Removed: no longer workable code to set the 'Send' button tooltip
        // to 'Enter adds new lines, [Press Ctrl+Enter or] Click here to send'
      }

      if (e.keyCode != 13 ||
          (comment_type != 'message' && !cbd.comment_button) ||
          (comment_type == 'message' && !cbd.comment_button_msgs)) {
        // let FB handle it normally
        return;
      }
      dispatch_enter_event(e, cbd.Xtarget, !(cbd.comment_button_ctrl && (e.ctrlKey || e.metaKey)));
    });
  });
});
