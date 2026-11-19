const nextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  async rewrites() {
    return [
      { source: "/api/:path*", destination: "http://127.0.0.1:8765/api/:path*" },
      { source: "/files/:path*", destination: "http://127.0.0.1:8765/files/:path*" },
    ];
  },
};

export default nextConfig;
