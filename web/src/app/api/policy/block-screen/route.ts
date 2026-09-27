// GET /api/policy/block-screen -> the "Match the block" eligibility screen (public.policy_block_screen, migration 131).
export async function GET() {
  try {
    const r = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/policy_block_screen?select=payload&id=eq.mb`, {
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY! }, cache: "no-store",
    });
    const rows = r.ok ? ((await r.json()) as { payload: unknown }[]) : [];
    return Response.json(rows[0]?.payload ?? null, { headers: { "Cache-Control": "public, max-age=600" } });
  } catch {
    return Response.json(null, { status: 502 });
  }
}
