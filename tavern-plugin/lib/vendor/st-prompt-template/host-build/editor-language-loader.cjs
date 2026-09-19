// Reuse the pinned upstream language definition without initializing its game UI.
module.exports = function (source) {
  function section(start, end) {
    const a = source.indexOf(start), b = source.indexOf(end, a);
    if (a < 0 || b < 0) throw new Error('Upstream EJS editor structure changed');
    return source.slice(a, b);
  }
  return section('const autoComplete =', 'let monaco:')
    + '\nexport function registerEjsLanguage(monaco: any) {\n'
    + section('    // 1. Registered Language', "    eventSource.on(event_types.APP_READY")
    + '\n}\n'
    + section('function getJsSuggestions(', 'function reloadWorldInfoPage(');
};
