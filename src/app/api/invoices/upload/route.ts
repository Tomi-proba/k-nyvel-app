import { NextResponse } from "next/server";
import { getActiveMembership } from "@/lib/current-company";
import { db } from "@/lib/db";
import { buildStorageKey, getStorageDriver } from "@/lib/storage";

const ALLOWED_MIME_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);
const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15 MB

export async function POST(request: Request) {
  const active = await getActiveMembership();
  if (!active) {
    return NextResponse.json({ error: "Nincs bejelentkezve." }, { status: 401 });
  }
  const { membership, userId } = active;

  const formData = await request.formData();
  const files = formData.getAll("files").filter((f): f is File => f instanceof File);
  const directionRaw = formData.get("direction");
  const direction = directionRaw === "INCOME" ? "INCOME" : "EXPENSE";

  if (files.length === 0) {
    return NextResponse.json({ error: "Nincs feltöltendő fájl." }, { status: 400 });
  }

  const storage = getStorageDriver();
  const created: { id: string; fileName: string }[] = [];
  const errors: string[] = [];

  for (const file of files) {
    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      errors.push(`${file.name}: nem támogatott fájltípus (csak PDF, JPG, PNG).`);
      continue;
    }
    if (file.size > MAX_FILE_SIZE) {
      errors.push(`${file.name}: túl nagy fájl (max. 15 MB).`);
      continue;
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const key = buildStorageKey(membership.companyId, file.name);
    await storage.put(key, buffer, file.type);

    const invoice = await db.invoice.create({
      data: {
        companyId: membership.companyId,
        uploadedById: userId,
        fileName: file.name,
        fileUrl: key,
        mimeType: file.type,
        fileSize: file.size,
        direction,
        status: "UPLOADED",
      },
    });
    created.push({ id: invoice.id, fileName: invoice.fileName });
  }

  if (created.length === 0) {
    return NextResponse.json({ error: errors.join(" ") || "A feltöltés sikertelen." }, { status: 400 });
  }

  return NextResponse.json({ created, errors });
}
