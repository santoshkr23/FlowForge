export function PageHead({ title, sub, children }: { title: string; sub?: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 px-6 pb-6 pt-8 md:px-10">
      <div>
        <h1 className="text-3xl font-bold">{title}</h1>
        {sub && <p className="mt-1 max-w-2xl text-ink-soft">{sub}</p>}
      </div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}

export function Body({ children }: { children: React.ReactNode }) {
  return <div className="px-6 pb-16 md:px-10">{children}</div>;
}

const STATUS: Record<string, string> = {
  SUCCESS: "bg-ok-tint text-ok",
  ERROR: "bg-bad-tint text-bad",
  RUNNING: "bg-spark-tint text-ink",
  QUEUED: "bg-canvas text-ink-soft",
  STOPPED: "bg-canvas text-ink-soft",
};
const STATUS_TEXT: Record<string, string> = { SUCCESS: "Succeeded", ERROR: "Failed", RUNNING: "Running", QUEUED: "Queued", STOPPED: "Stopped" };

export function StatusPill({ status }: { status: string }) {
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS[status] ?? STATUS.QUEUED}`}>{STATUS_TEXT[status] ?? status}</span>;
}
