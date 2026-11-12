X.ready('notify', function() {
    X.subscribe('notify/set', (msg, data) =>
        X.when(data.target, function($target) {
            var old_count = $target.attr('sfx_notification_count') || 0;
            var new_count = +('count' in data ? data.count : old_count || 0) +
                            +('increment' in data ? data.increment : 0);
            $target.attr('sfx_notification_count', new_count);
            if (data.parent_target) {
                old_count == 0 && new_count  > 0 && X.publish('notify/increment', {target: data.parent_target});
                old_count  > 0 && new_count == 0 && X.publish('notify/decrement', {target: data.parent_target});
            }
        }, 200, 100) // nominally 20 seconds
    );

    X.subscribe(['notify/increment', 'notify/decrement', 'notify/clear'], function(msg, data) {
                    const parent_target = data.parent_target, target = data.target;
                    X.publish('notify/set',
                        msg === 'notify/increment' ? { parent_target, target, increment: 1 } :
                        msg === 'notify/decrement' ? { parent_target, target, increment: -1 } :
                        msg === 'notify/clear'     ? { parent_target, target, count: 0 } :
                        {}
                    );
                });
});
