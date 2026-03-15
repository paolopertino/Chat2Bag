import type { PropsWithChildren, ReactNode } from "react";

interface MainLayoutProps extends PropsWithChildren {
  sidebar: ReactNode;
  header: ReactNode;
}

export function MainLayout({ sidebar, header, children }: MainLayoutProps) {
  return (
    <div className="mx-auto max-w-[1500px] px-4 py-6 md:px-6 lg:px-8">
      <div className="mb-6">
        <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--teal)]">AIDA Bag GPT</p>
        <h1 className="text-3xl font-bold leading-tight md:text-4xl">Semantic Frame Search for ROS2 Bags</h1>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[360px_1fr]">
        <aside>{sidebar}</aside>
        <main className="space-y-4">
          {header}
          {children}
        </main>
      </div>
    </div>
  );
}
