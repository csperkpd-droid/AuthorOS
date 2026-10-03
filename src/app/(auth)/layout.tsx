import { Brand } from "@/components/shell/brand";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      <div className="mb-8">
        <Brand href="/" />
      </div>
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}
