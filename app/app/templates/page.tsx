import { requireCtx } from "@/lib/auth";
import { TEMPLATES } from "@/lib/templates";
import { CATALOG } from "@/lib/engine/catalog";
import { Body, PageHead } from "@/components/app/PageHead";
import { AppIcon } from "@/components/AppIcon";
import { UseTemplate } from "@/components/app/UseTemplate";

export const metadata = { title: "Templates" };

const colorFor = (app: string) => CATALOG.find((m) => m.app === app)?.color;

export default async function Templates() {
  await requireCtx();
  return (
    <>
      <PageHead title="Templates" sub="Ready-made workflows. Copy one into your workspace, connect your apps, and switch it on." />
      <Body>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {TEMPLATES.map((t) => (
            <article key={t.id} className="panel flex flex-col p-5">
              <div className="flex items-center gap-1">
                {t.apps.map((a, i) => (
                  <span key={a + i} className="flex items-center">
                    {i > 0 && <span className="mx-1 h-px w-3 bg-wire" aria-hidden />}
                    <AppIcon app={a} color={colorFor(a)} size={13} />
                  </span>
                ))}
              </div>
              <h2 className="mt-4 text-lg">{t.name}</h2>
              <p className="mt-1 flex-1 text-sm text-ink-soft">{t.description}</p>
              <div className="mt-4 flex items-center justify-between">
                <span className="text-xs text-ink-faint">{t.category}</span>
                <UseTemplate id={t.id} />
              </div>
            </article>
          ))}
        </div>
      </Body>
    </>
  );
}
