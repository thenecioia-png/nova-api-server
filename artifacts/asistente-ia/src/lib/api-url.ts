const viteApiUrl = import.meta.env.VITE_API_URL as string | undefined;
const viteBase = import.meta.env.BASE_URL as string;

export const API_BASE = viteApiUrl
  ? viteApiUrl.replace(/\/$/, "")
  : viteBase.replace(/\/$/, "");
