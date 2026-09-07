"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type DragEvent } from "react";
import clsx from "clsx";

const ACCEPTED_TYPES = ["application/pdf", "image/jpeg", "image/png"];

export function UploadDropzone() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [direction, setDirection] = useState<"EXPENSE" | "INCOME">("EXPENSE");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function uploadFiles(files: FileList | File[]) {
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;

    const invalid = fileArray.filter((f) => !ACCEPTED_TYPES.includes(f.type));
    if (invalid.length > 0) {
      setError(`Nem támogatott fájltípus: ${invalid.map((f) => f.name).join(", ")} (csak PDF, JPG, PNG).`);
      return;
    }

    setError(null);
    setMessage(null);
    setIsUploading(true);

    const formData = new FormData();
    formData.set("direction", direction);
    for (const file of fileArray) {
      formData.append("files", file);
    }

    try {
      const res = await fetch("/api/invoices/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "A feltöltés sikertelen.");
      } else {
        setMessage(`${data.created.length} fájl sikeresen feltöltve.`);
        if (data.errors?.length) {
          setError(data.errors.join(" "));
        }
        router.refresh();
      }
    } catch {
      setError("Hálózati hiba a feltöltés közben.");
    } finally {
      setIsUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files?.length) {
      void uploadFiles(e.dataTransfer.files);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm">
        <span className="font-medium text-slate-700">Ez a feltöltés:</span>
        <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5">
          <button
            type="button"
            onClick={() => setDirection("EXPENSE")}
            className={clsx(
              "rounded-md px-3 py-1 text-sm font-medium",
              direction === "EXPENSE" ? "bg-slate-900 text-white" : "text-slate-600"
            )}
          >
            Kiadás
          </button>
          <button
            type="button"
            onClick={() => setDirection("INCOME")}
            className={clsx(
              "rounded-md px-3 py-1 text-sm font-medium",
              direction === "INCOME" ? "bg-slate-900 text-white" : "text-slate-600"
            )}
          >
            Bevétel
          </button>
        </div>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={clsx(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 text-center transition",
          isDragging ? "border-slate-900 bg-slate-100" : "border-slate-300 bg-white hover:bg-slate-50"
        )}
      >
        <p className="text-sm font-medium text-slate-700">
          {isUploading ? "Feltöltés folyamatban…" : "Húzd ide a számlát, vagy koppints a kiválasztáshoz"}
        </p>
        <p className="text-xs text-slate-400">PDF, JPG vagy PNG — telefonról fotózva is</p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="application/pdf,image/jpeg,image/png"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) void uploadFiles(e.target.files);
          }}
        />
      </div>

      {message && <p className="text-sm text-emerald-600">{message}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
