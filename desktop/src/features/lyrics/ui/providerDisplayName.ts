// Provider identifiers stay unchanged in backend requests, selection and caches.
export function providerDisplayName(provider: string): string {
  const key = provider.trim().toLowerCase();
  return key === "liner" || key === "amour" || key === "brand"
    ? "Amour!"
    : provider;
}
