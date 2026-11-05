import { Link } from "../keret/router";
import { PageHeader } from "../ui/Page";

export function NotFound() {
  return (
    <>
      <PageHeader title="Az oldal nem található" />
      <p>
        Ez a cím nem létezik. <Link to="/">Vissza a kezdőlapra</Link>
      </p>
    </>
  );
}
