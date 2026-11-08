export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
// 新しい「publishable key」でも従来の「anon key」でも動きます
export const SUPABASE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
