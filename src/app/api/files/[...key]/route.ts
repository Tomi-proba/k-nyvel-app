import { NextResponse } from "next/server";
import { getActiveMembership } from "@/lib/current-company";
import { getStorageDriver } from "@/lib/storage";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string[] }> }
) {
  const active = await getActiveMembership();
  if (!active) {
    return NextResponse.json({ error: "Nincs bejelentkezve." }, { status: 401 });
  }

  const { key: keyParts } = await params;
  const key = keyParts.join("/");
  const [companyId] = keyParts;

  const hasAccess = active.allMemberships.some((m) => m.companyId === companyId);
  if (!hasAccess) {
    return NextResponse.json({ error: "Nincs jogosultság." }, { status: 403 });
  }

  const storage = getStorageDriver();
  try {
    const buffer = await storage.read(key);
    const contentType = guessContentType(key);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "A fájl nem található." }, { status: 404 });
  }
}

function guessContentType(key: string): string {
  const lower = key.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}
