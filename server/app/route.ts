export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return new Response("Hunch API", {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
