import { PageHeader } from "../../ui/Page";

/** Még el nem készült főmenüpont (a terv szerinti lépésben készül el). */
export function ComingSoon({ title, step, description }: { title: string; step: number; description: string }) {
  return (
    <>
      <PageHeader title={title} />
      <div className="alert alert-info">
        <p>
          <strong>Ez a rész a fejlesztés {step}. lépésében készül el.</strong>
        </p>
        <p style={{ margin: 0 }}>{description}</p>
      </div>
    </>
  );
}
