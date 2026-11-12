// Vue Customizations specific to Social Fixer
Vue.directive('tooltip', function (o) {
    this.el.setAttribute('data-hover','tooltip');
    // If a config object is passed, o will be parsed and populated
    if (o) {
        if (o.content) {
            this.el.setAttribute('title', o.content);
            this.el.setAttribute('data-tooltip-content', o.content);
        }
        o.uri && this.el.setAttribute('data-tooltip-uri',o.uri);
        this.el.setAttribute('data-tooltip-delay', (typeof o.delay!="undefined") ? o.delay : 1 * X.seconds);
        o.position && this.el.setAttribute('data-tooltip-position', o.position);
        o.align && this.el.setAttribute('data-tooltip-alignh', o.align);
        if (o.icon) {
            this.el.className="sfx-help-icon";
            this.el.setAttribute('data-tooltip-delay',1);
        }
    }
    else {
        this.el.setAttribute('data-tooltip-content', this.expression);
        this.el.setAttribute('title', this.expression);
        if (this.el.getAttribute('data-tooltip-delay')==null) {
            this.el.setAttribute('data-tooltip-delay', "1000");
        }
    }
});
Vue.filter('highlight', function(words, query){
    if (!query) {
        return (words === null || words === undefined) ? '' : words.toString();
    }
    var iQuery = new RegExp(query, "ig");
    return words.toString().replace(iQuery, function(matchedTxt){
        return ('<span class=\'sfx_highlight\'>' + matchedTxt + '</span>');
    });
});
Vue.filter('date', function(val){
    return (new Date(val)).toString().replace(/\s*GMT.*/,'');
});
Vue.filter('ago', function(val){
	return X.ago(val);
});

// Vue's 'json' filter, but return {} instead of '' on parse failure.
// Lets `v-model="my_obj | json+"` not fail when input buffer is empty.
Vue.filter('json+', {
    read: function (t, e) {
        return 'string' == typeof t ? t : JSON.stringify(t, null, arguments.length > 1 ? e : 2);
    },
    write: function (t) {
        try {
            return JSON.parse(t);
        } catch (e) {
            return {};
        }
    }
});

// Custom Components

// Option Checkbox
Vue.component('sfx-checkbox', {
    template:`<span><input id="sfx-cb-{{key}}" type="checkbox" v-on:click="click"/><label for="sfx-cb-{{key}}"></label></span>`,
    props: ['key'],
    activate: function(done) {
        this.$cb = X(this.$el.firstChild);
        this.$cb.prop('checked', FX.option(this.key));
        done();
    },
    methods: {
        click:function() {
            this.$cb.addClass('sfx_saving');
            FX.option(this.key, this.$cb.prop('checked'), true, function() {
                this.$cb.removeClass('sfx_saving');
            });
        }
    }

});
// For Vue Templates
// XXX 2022-09-13 noting a bug where sometimes Vue doesn't call the ready fn
// =============================
const template = function(appendTo,template,data,methods,computed,events) {
    var frag = document.createDocumentFragment();
    var ready = function(){};
    var v = new Vue(X.extend({
        "el":frag
        ,"template":template
        ,"data":data
        ,"methods":methods
        ,"computed":computed
        ,"replace":false
        ,"ready":function() { ready(v); }
    },events));
    if (appendTo) {
        v.$appendTo(appendTo); // Content has already been sanitized
    }
    var o = {
        "$view":v,
        "fragment":frag,
        "ready": function(func) {
            if (v._isReady) { func(); }
            else { ready=func; }
            return o;
        }
    };
    return o;
};
