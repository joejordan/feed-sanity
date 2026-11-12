// Are there any subscribed items at all?
const has_subscriptions = function (user_items) {
    return Object.values(user_items || []).some(item => X.isObject(item) && !!item.id);
};

// Tag each subscribable item with boolean .subscribed indicating whether
// user is subscribed to it
const mark_subscribed_items = function (subscriptions, user_items) {
    // Build up a list of user item id's
    var subscription_ids = {};
    Object.values(user_items || []).forEach(item =>
        X.isObject(item) && item.id && (subscription_ids[item.id] = true));
    Object.values(subscriptions || []).forEach(item =>
        X.isObject(item) && (item.subscribed = !!subscription_ids[item.id]));
};

// Retrieve the JSON list of subscribable items of this type; tag each
// item with boolean .subscribed indicating whether it was found in
// user_items; pass to callback
//
// `name' has three different uses, which for some callers are all the
// same; and for others are different.  To use the same name, pass a
// string; to use different names, pass an array containing:
//
//     [filename, fieldname, storagename]

const retrieve_item_subscriptions = function (name, user_items, callback) {
    if (typeof name === 'string') {
        name = [name, name, name];
    }
    const [filename, fieldname, storagename] = name;
    storagename !== storagename; // 'use' storagename

    X.ajax(`https://matt-kruse.github.io/socialfixerdata/${filename}.json`, function (content) {
        if (content && content[fieldname] && content[fieldname].length > 0) {
            // Mark the subscribed ones
            mark_subscribed_items(content[fieldname], user_items);
        }
        if (callback) {
            callback((content && content[fieldname]) ? content[fieldname] : null);
        }
    });
};

// Retrieve the JSON list of subscribable items of this type; update
// user's subscribed items with any changes found in the JSON (except
// .enabled, and a special case for customized filter actions).  If
// anything changed, write back to storage.
//
// `name' has three different uses, which for some callers are all the
// same; and for others are different.  To use the same name, pass a
// string; to use different names, pass an array containing:
//
//     [filename, fieldname, storagename]

const update_subscribed_items = function (name, user_items, callback, canonicalize) {
    retrieve_item_subscriptions(name, user_items, function (subscriptions) {
        if (!has_subscriptions(user_items)) {
            return callback ? callback(subscriptions, false) : null;
        }
        if (typeof name === 'string') {
            name = [name, name, name];
        }
        const [filename, fieldname, storagename] = name;
        var any_dirty = (filename !== filename); // false, and 'uses' filename
        // Loop through the subscriptions to see if user items need to be updated
        var subscribed = {};
        for (var key of Object.keys(user_items)) {
            var f = user_items[key];
            if (X.isObject(f) && f.id) {
                subscribed[f.id] = f;
            }
        }
        Object.values(subscriptions || []).forEach(function (item) {
            if (!X.isObject(item)) {
                return;
            }
            var user_item = subscribed[item.id];
            if (!user_item) {
                return;
            }
            if (typeof canonicalize === 'function') {
                canonicalize(item);
                canonicalize(user_item);
            }
            var key, dirty = false;
            // Map the properties of the subscription to the user item
            // Don't overwrite the entire object because things like 'enabled' are stored locally
            for (key in item) {
                if (key == "subscribed" || key == "enabled") {
                    continue;
                }
                // Check to see if the user item data needs updated
                // If user has customized actions, don't over-write, otherwise update
                if (fieldname == 'filters' && key == 'actions' &&
                    item.configurable_actions && user_item.custom_actions) {
                    continue;
                }
                if (fieldname == 'filters' && key == 'stop_on_match') {
                    continue;
                }
                if (!SFX.data_equals(user_item[key], item[key])) {
                    user_item[key] = item[key];
                    dirty = true;
                }
            }
            if (dirty) {
                user_item.subscription_last_updated_on = X.now();
                any_dirty = true;
            }
        });
        // if any of the subscriptions were dirty, save the items
        if (any_dirty) {
            X.storage.save(storagename, X.clone(user_items));
        }
        if (callback) {
            callback(subscriptions, any_dirty);
        }
    });
};
SFX.pose({ update_subscribed_items, });
