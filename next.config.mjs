export default {
  serverExternalPackages: ["node:sqlite"],
  // The app is a single page, so any other path sends people to it (the sign-in form when signed out).
  async redirects() {
    return [
      {
        source:
          "/:path((?!api/|mcp|health|_next/|favicon[.]ico|icon|apple-icon).+)",
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
              "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
          },
        ],
      },
    ];
  },
};
