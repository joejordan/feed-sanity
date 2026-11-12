// Detect whether we are on a login page
X.beforeReady(function () {
    const login_selectors = [
        /* On 'new layout' FB as of 2022-03-31: */
        /*   - 4 of these 6 selectors appear on the plain login page */
        /*   - a different 4 appear on the inline login on a 404 page */
        /*   - 0 appear on logged-in pages */
            /* reg, 404 */ 'body[class*=LoggedOut]',
            /* ---, 404 */ 'form#login_form',
            /* reg, --- */ 'form[data-testid*=login][action*="/login/"]',
            /* reg, 404 */ 'input[name=login_source]',
            /* reg, --- */ 'button[name=login][data-testid*=login]',
            /* ---, 404 */ 'button[id*=login][data-testid*=login]',
    ].join(',');

    FX.isNonLoginPage = (X(login_selectors).length < 2);

    // For users who need to wait until definitely known
    X.publish('login_page/ready');
});
