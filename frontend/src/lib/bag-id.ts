// URL-safe base64 (base64url) encoder/decoder for bag paths.
// Used to embed bag paths in URL segments without escaping issues.
//
// :bagId = base64url(utf8(bag_path))

export function encodeBagId(bagPath: string): string {
  const utf8 = new TextEncoder().encode(bagPath);
  let binary = "";
  for (const byte of utf8) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeBagId(bagId: string): string {
  const padded = bagId.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const binary = atob(padded + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
