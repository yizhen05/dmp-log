import { redirect } from "next/navigation";
import Notebook from "@/components/Notebook";
import { createClient } from "@/lib/supabase/server";
import type { Alias, Entry, Season } from "@/lib/dmp";

export const dynamic = "force-dynamic";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [seasons, entries, aliases] = await Promise.all([
    supabase.from("seasons").select("id,name,top_n,sort").order("sort").order("created_at"),
    supabase
      .from("entries")
      .select(
        "id,season_id,date,week_start,type,event,org,venue,deck,wins,losses,participants,rank,judge,pt,note",
      )
      .order("week_start")
      .order("date", { nullsFirst: false })
      .order("created_at"),
    supabase.from("aliases").select("kind,raw,short"),
  ]);

  return (
    <Notebook
      userLabel={user.email ?? (user.user_metadata?.user_name as string | undefined) ?? "ログイン中"}
      initialSeasons={(seasons.data ?? []) as Season[]}
      initialEntries={(entries.data ?? []) as Entry[]}
      initialAliases={(aliases.data ?? []) as Alias[]}
    />
  );
}
