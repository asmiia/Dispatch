export default {
  // Each build gets an id, so an open page can tell that a newer version has been deployed.
  env: { NEXT_PUBLIC_BUILD: String(Date.now()) },
  // The Fluid Functionalism components are third-party TypeScript with a few typing mismatches against our versions.
  typescript: { ignoreBuildErrors: true },
  serverExternalPackages: ["node:sqlite"],
  // MCP clients POST to the URL exactly as configured and do not follow redirects, so /mcp/ must work too.
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return [
      { source: "/mcp/", destination: "/mcp" },
      { source: "/health/", destination: "/health" },
    ];
  },
  // The app is a single page, so any other path sends people to it (the sign-in form when signed out).
  async redirects() {
    return [
      {
        source:
          "/:path((?!api/|mcp|health|_next/|favicon[.]ico|icon|apple-icon|ring[.]wav|ort/).+)",
        destination: "/",
        permanent: false,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "no-store" },
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob:; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' https://huggingface.co https://*.huggingface.co https://*.hf.co; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
          },
        ],
      },
    ];
  },
};
