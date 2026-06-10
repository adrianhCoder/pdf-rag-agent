/** @type {import('next').NextConfig} */
const nextConfig = {
  // Page images live on Vercel Blob; allow rendering them in <img>.
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**.public.blob.vercel-storage.com" }],
  },
};

export default nextConfig;
