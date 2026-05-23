/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Allow Next.js to transpile our local workspace package directly from source.
  transpilePackages: ['@aso/shared'],
  // App Store icon and screenshot CDNs are unpredictable; allow any HTTPS source
  // for next/image. We don't use next/image for screenshots in this MVP, but
  // leaving this open avoids a paper-cut if we add it later.
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
    ],
  },
}

export default nextConfig
