const exporting = process.env.CLOUD_CHASER_EXPORT === "1";

const nextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
};

if (exporting) {
  nextConfig.output = "export";
} else {
  nextConfig.rewrites = async () => [
    { source: "/api/:path*", destination: "http://127.0.0.1:8765/api/:path*" },
    { source: "/files/:path*", destination: "http://127.0.0.1:8765/files/:path*" },
  ];
}

export default nextConfig;
