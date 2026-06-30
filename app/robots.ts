import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/about", "/ai-react-playground", "/llms.txt"],
        disallow: ["/api/", "/p/", "/integrations/"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
