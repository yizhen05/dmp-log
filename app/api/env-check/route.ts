import { NextResponse } from "next/server";
import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";

// 設定確認用：環境変数の「名前」と「入っているかどうか」だけを返す（値は返さない）
export function GET() {
  const names = Object.keys(process.env)
    .filter((k) => /SUPABASE/i.test(k) || k.startsWith("NEXT_PUBLIC_"))
    .sort();
  return NextResponse.json({
    vercelEnv: process.env.VERCEL_ENV ?? null,
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    builtIn: { url: !!SUPABASE_URL, key: !!SUPABASE_KEY },
    runtimeNames: names.map((k) => ({ name: JSON.stringify(k), set: !!process.env[k] })),
  });
}
