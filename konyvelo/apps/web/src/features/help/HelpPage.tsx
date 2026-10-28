import { useEffect } from "react";
import { Link, useLocation } from "react-router";
import { GUIDE } from "../../help/guide";
import { PageHeader } from "../../ui/Page";

/** Súgó kezdőknek: a fő műveletek lépésről lépésre. Egy oldal, tartalomjegyzékkel. */
export function HelpPage() {
  const { hash } = useLocation();
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView();
  }, [hash]);
  return (
    <>
      <PageHeader title="Súgó" description="A legfontosabb teendők lépésről lépésre. A szakkifejezések mellett a ⓘ jelre kattintva rövid magyarázatot talál." />
      <nav className="card" aria-labelledby="sugo-tartalom">
        <h2 id="sugo-tartalom">Tartalom</h2>
        <ul className="help-toc">
          {GUIDE.map((t) => (
            <li key={t.id}>
              <a href={`#${t.id}`}>{t.title}</a>
            </li>
          ))}
        </ul>
      </nav>
      <div className="stack">
        {GUIDE.map((t) => (
          <section key={t.id} id={t.id} className="card help-topic" aria-labelledby={`${t.id}-cim`}>
            <h2 id={`${t.id}-cim`}>{t.title}</h2>
            <p>{t.intro}</p>
            <ol className="help-steps">
              {t.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
            {t.tips?.map((tip) => (
              <p key={tip} className="help-tip">
                <strong>Jó tudni:</strong> {tip}
              </p>
            ))}
            {t.link && (
              <p>
                <Link to={t.link.to}>{t.link.label}</Link>
              </p>
            )}
          </section>
        ))}
      </div>
    </>
  );
}
