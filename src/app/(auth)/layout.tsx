export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <span className="text-2xl font-bold text-slate-900">Könyvel</span>
          <p className="mt-1 text-sm text-slate-500">
            Számlák és bizonylatok rendszerezése KKV-knak
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
          {children}
        </div>
      </div>
    </div>
  );
}
