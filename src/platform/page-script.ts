/**
 * Runs `code` in the page's own world, as a script loaded from a `blob:`
 * address. Facebook's content security policy blocks inline script text and
 * allows scripts from `blob:` addresses. Resolves once the script has run,
 * and rejects when the page refuses it. The script element and its address
 * are removed either way.
 */
export function runInPage(code: string): Promise<void> {
  const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
  const script = document.createElement('script');
  script.src = url;
  return new Promise((resolve, reject) => {
    const end = (): void => {
      script.remove();
      URL.revokeObjectURL(url);
    };
    script.addEventListener('load', () => {
      end();
      resolve();
    });
    script.addEventListener('error', () => {
      end();
      reject(new Error('the page refused a script from a blob: address'));
    });
    // A userscript can start before the page has a <head>.
    (document.head ?? document.documentElement).append(script);
  });
}
