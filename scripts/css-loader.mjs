// スモークテスト用: .css / CSS Modules インポートを空オブジェクトにスタブする ESM ローダ
export async function resolve(specifier, context, next) {
  if (specifier.endsWith(".css")) {
    return { url: "stub-css:" + specifier, shortCircuit: true };
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (url.startsWith("stub-css:") || url.endsWith(".css")) {
    // CSS Modules は styles.foo の Proxy を返す（未定義クラスでも安全）
    return {
      format: "module",
      shortCircuit: true,
      source:
        "export default new Proxy({}, { get: (_, p) => (typeof p === 'string' ? p : undefined) });",
    };
  }
  return next(url, context);
}
