/** Landing origin for canonical, Open Graph and sitemap. Update when a custom domain is connected. */
export const SITE_URL = "https://tangodb-landing.pages.dev";

/** Social preview image (1200×630). JPEG keeps crawler fetches smaller than PNG. */
export const OG_IMAGE_PATH = "/og-image.jpg";

/** Hero photo — display-sized variants in `public/`; full PNG kept as design source. */
export const HERO_IMAGE = {
  width: 800,
  height: 1200,
  sizes: "(min-width: 1280px) 400px, (min-width: 640px) 300px, 260px",
  srcSet: {
    avif: "/new_girl-480.avif 480w, /new_girl.avif 800w",
    webp: "/new_girl-480.webp 480w, /new_girl.webp 800w",
  },
  fallbackSrc: "/new_girl-800.jpg",
} as const;

export const CRM_LOGIN_URL = "https://tangodb.vercel.app/auth/login";

export const CONTACTS = {
  email: "omowdance@gmail.com",
  telegramUrl: "https://t.me/omow_second",
  telegramHandle: "@omow_second",
} as const;

export const DEMO_STUDIO = "Studio Ritmo";
