import { useStore } from "../lib/store";
import { useT } from "../lib/i18n";
import { AppCard } from "./Home";

export function Apps() {
  const { apps, statuses } = useStore();
  const t = useT();
  const installed = apps.filter((a) => statuses[a.id]?.installed);
  const missing = apps.filter((a) => !statuses[a.id]?.installed);
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{t("Apps")}</h1>
          <p>{t("Instalá, iniciá, actualizá y abrí tus herramientas. Las que tienen interfaz web se usan dentro de WorkStudio.")}</p>
        </div>
      </div>
      <div className="section-title">{t("Instaladas · {n}", { n: installed.length })}</div>
      <div className="app-grid">
        {installed.map((a) => (
          <AppCard key={a.id} app={a} />
        ))}
        {installed.length === 0 && <div className="muted">{t("Todavía ninguna. Instalá una de abajo con un clic.")}</div>}
      </div>
      {missing.length > 0 && (
        <>
          <div className="section-title">{t("Para instalar · {n}", { n: missing.length })}</div>
          <div className="app-grid">
            {missing.map((a) => (
              <AppCard key={a.id} app={a} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
